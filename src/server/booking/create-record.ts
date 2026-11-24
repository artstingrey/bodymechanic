import 'server-only';

import { createTranslator } from 'next-intl';
import { formatComment } from '@/lib/altegio/formatComment';
import type { BookingRecordPart, ConfirmedBookingService, NormalizedBookingRecordRequest } from '@/lib/contracts/booking-record';
import { validBookingId } from '@/lib/contracts/booking-services';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { landingBookingChips } from '@/lib/lp/booking';
import { altegioGet, altegioPost, bookingLanguages, isRecord } from '../altegio/client';
import { AltegioError } from '../altegio/errors';
import { fetchBookServices } from '../altegio/services';
import { getCommonServiceStaff, localizeCatalogStaff } from '../catalog/staff';
import { dubaiBookingDate, getBookingTimes, parseBookingDatetime } from './availability';
import { unavailable, unknown, type RecordOutcome } from './record-result';

const serviceMissing: RecordOutcome = { status: 404, code: 'SERVICE_NOT_FOUND' };
const staffMissing: RecordOutcome = { status: 404, code: 'STAFF_NOT_FOUND' };
const slotTaken: RecordOutcome = { status: 409, code: 'SLOT_TAKEN' };
const prepaymentRequired: RecordOutcome = { status: 422, code: 'PREPAYMENT_REQUIRED' };
const correlationId = 1;

async function appointmentComment(input: NormalizedBookingRecordRequest) {
  const { locale, age, condition } = input;
  if (input.source === '3d') {
    return formatComment({ source: '3d', age, gender: input.body3d.model, markers: input.body3d.markers, generalNote: input.body3d.generalNote });
  }
  if (input.source === 'lp') {
    const { default: messages } = await import(`../../../messages/${locale}.json`);
    const t = createTranslator({ locale, messages });
    const marks = input.details?.flatMap((id) => {
      const key = landingBookingChips.get(id);
      return key ? [t(key)] : [];
    }).join(', ');
    const generalNote = [marks, condition].filter(Boolean).join('\n');
    return formatComment({ source: 'lp', generalNote, utm: input.utm }, locale);
  }
  if (age !== undefined || condition) return formatComment({ source: 'form', age, generalNote: condition }, locale);
}

function upstreamErrorCodes(payload: unknown) {
  const meta = isRecord(payload) && isRecord(payload.meta) ? payload.meta : null;
  return [meta?.code, ...(Array.isArray(meta?.errors)
    ? meta.errors.map((error: unknown) => isRecord(error) ? error.code : undefined) : [])]
    .flatMap((code) => typeof code === 'string' || typeof code === 'number' ? [String(code)] : []);
}

function rejected(status: number, payload: unknown, sending: boolean): RecordOutcome {
  if (status === 409) return slotTaken;
  if (status === 403 || status === 422) {
    const codes = upstreamErrorCodes(payload);
    if (codes.includes('433') || codes.includes('437')) return slotTaken;
    if (codes.includes('436')) return staffMissing;
    if (codes.includes('438')) return serviceMissing;
    if (codes.includes('432')) return { status: 422, code: 'SMS_REQUIRED' };
    if (codes.includes('431')) return { status: 422, code: 'INVALID_FIELDS', fields: ['phone'] };
    if (codes.includes('435')) return { status: 422, code: 'INVALID_FIELDS', fields: ['fullname'] };
    return status === 422 || codes.includes('434') ? { status: 422, code: 'BOOKING_REJECTED' } : unavailable;
  }
  if ([400, 401, 404].includes(status)) return unavailable;
  return sending ? unknown : unavailable;
}

function upstreamFailure(error: unknown, sending: boolean): RecordOutcome {
  if (error instanceof AltegioError) {
    if (error.response.code === 'UPSTREAM_RATE_LIMITED') {
      return { status: 429, code: 'UPSTREAM_RATE_LIMITED', retryAfter: error.upstreamRetryAfter ?? error.retryAfter };
    }
    if (sending) return unknown;
    if (error.response.code === 'UPSTREAM_TIMEOUT') return { status: 504, code: 'UPSTREAM_TIMEOUT' };
    return { ...unavailable, retryAfter: error.upstreamRetryAfter };
  }
  console.error('[booking] Unexpected record failure');
  return sending ? unknown : unavailable;
}

type Receipt = { recordId: number; hash: string };
type Appointment = { id: number; services: number[]; staff_id: number; datetime: string };
type CheckedAppointment = { appointment: Appointment; durationSeconds?: number };

function serviceTitle(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 300) || undefined : undefined;
}

function parseReceipts(payload: unknown, composite: boolean): Receipt[] {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data) ||
    payload.data.length === 0 || payload.data.length > (composite ? 10 : 1)) return [];

  const result = new Map<number, Receipt>();
  for (const record of payload.data as unknown[]) {
    // Altegio assigns its own response IDs to the parts of a composite service.
    if (!isRecord(record) || (composite ? !validBookingId(record.id) : record.id !== correlationId) || !validBookingId(record.record_id) ||
      typeof record.record_hash !== 'string' || !/^[a-z\d_-]{1,128}$/i.test(record.record_hash) ||
      result.has(record.record_id)) return [];
    result.set(record.record_id, { recordId: record.record_id, hash: record.record_hash });
  }
  return [...result.values()];
}

async function readCreatedRecord(locationId: number, locale: CatalogLocale, { recordId, hash }: Receipt) {
  try {
    const record = await altegioGet('read_booking_record',
      `book_record/${locationId}/${recordId}/${encodeURIComponent(hash)}`, bookingLanguages[locale], { allowBareRecord: true });
    if (!isRecord(record) || record.id !== recordId || record.deleted !== false ||
      typeof record.datetime !== 'string' || !Array.isArray(record.services)) return null;
    // The public detail endpoint also returns offsets such as +0400.
    const datetime = record.datetime.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const instant = parseBookingDatetime(datetime);
    if (!instant) return null;
    const member = record.staff;
    const staff = isRecord(member) && validBookingId(member.id) && typeof member.name === 'string' &&
      member.name.trim() && member.name.length <= 200
      ? localizeCatalogStaff(locale, { id: member.id, name: member.name.trim() }) : undefined;
    return {
      recordId, datetime, instant: instant.getTime(), staff, services: record.services as unknown[],
      durationSeconds: validBookingId(record.length) && record.length <= 2_147_483_647 ? record.length : undefined,
    };
  } catch {
    return null;
  }
}

async function confirmCreation(
  locationId: number, input: NormalizedBookingRecordRequest, instant: Date, receipts: Receipt[], composite: boolean,
  titles: ReadonlyMap<number, string>, slotDuration?: number,
): Promise<RecordOutcome> {
  const { serviceIds, staffId } = input;
  const base = { status: 'created' as const, serviceIds, datetime: input.datetime };
  const details = await Promise.all(receipts.map((receipt) => readCreatedRecord(locationId, input.locale, receipt)));
  const records = details.filter((record) => record !== null).sort((a, b) => a.instant - b.instant);
  const lines = records.flatMap(({ services }) => services.filter(isRecord));
  const services: ConfirmedBookingService[] = [];
  for (const id of serviceIds) {
    const line = lines.find((item) => item.id === id);
    const title = serviceTitle(line?.title) ?? titles.get(id);
    if (!title) return unknown;
    services.push({ id, title });
  }
  if (serviceIds.length === 1 && !composite) {
    // The receipt identifies the only requested appointment even when detail lookup is unavailable.
    const record = records[0];
    if (record && (record.instant !== instant.getTime() || record.services.length !== 1 || lines[0]?.id !== serviceIds[0] ||
      (lines[0].amount !== undefined && lines[0].amount !== 1) ||
      (staffId !== 0 && record.staff && record.staff.id !== staffId))) return unknown;
    return { status: 201, data: { ...base, services, recordId: receipts[0].recordId, staff: record?.staff,
      durationSeconds: record?.durationSeconds ?? slotDuration } };
  }

  if (records.length !== receipts.length || records[0].instant !== instant.getTime()) return unknown;
  const staff = staffId === 0 ? records[0].staff : records.find((record) => record.staff?.id === staffId)?.staff;
  if (staffId !== 0 && !staff) return unknown;

  const confirmedIds = records.flatMap(({ services }) => services.map((service) => isRecord(service) ? service.id : undefined));
  if (serviceIds.length > 1) {
    // Online Booking does not describe how to associate an expanded component with its selected package ID.
    const remaining = new Set<unknown>(serviceIds);
    if (!staff || records.some((record) => record.staff?.id !== staff.id) ||
      lines.some(({ amount }) => amount !== undefined && amount !== 1) ||
      !confirmedIds.every((id) => remaining.delete(id)) || remaining.size) return unknown;
  } else if (records.length === 1 && !confirmedIds.includes(serviceIds[0])) {
    // A single component cannot confirm that a split package was booked.
    return unknown;
  }

  const endTimes = records.flatMap(({ instant, durationSeconds }) =>
    durationSeconds === undefined ? [] : [instant + durationSeconds * 1000]);
  const durationSeconds = endTimes.length === records.length ? (Math.max(...endTimes) - instant.getTime()) / 1000 : slotDuration;

  const parts: BookingRecordPart[] = [];
  if (records.length > 1) {
    for (const record of records) {
      const titles = record.services.flatMap((service) => isRecord(service) && validBookingId(service.id) &&
        typeof service.title === 'string' && service.title.trim() && service.title.length <= 300 ? [service.title.trim()] : []);
      if (!titles.length || titles.length !== record.services.length) return unknown;
      const { recordId, datetime, durationSeconds, staff } = record;
      parts.push({ recordId, datetime, title: titles.join(' + '), durationSeconds, staff });
    }
  }
  return { status: 201, data: { ...base, services, recordId: records[0].recordId, staff,
    ...(parts.length ? { parts } : {}), ...(validBookingId(durationSeconds) ? { durationSeconds } : {}),
  } };
}

async function checkAppointment(locationId: number, language: string, appointment: Appointment) {
  const check = await altegioPost('book_check', locationId, language, { appointments: [appointment] });
  const body = isRecord(check.payload) ? check.payload : null;
  const accepted = check.empty || (body?.success === true && (!('data' in body) || body.data === null));
  if (check.status === 201 && accepted) return null;

  const data = body?.data;
  console.warn('[booking] preflight rejected', {
    stage: 'book_check', serviceIds: appointment.services, anyStaff: appointment.staff_id === 0, httpStatus: check.status, empty: check.empty,
    success: typeof body?.success === 'boolean' ? body.success : undefined,
    dataType: Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data,
    errorCodes: upstreamErrorCodes(check.payload).filter((code) => /^\d{3,5}$/.test(code)),
  });
  return { notFound: check.status === 404, outcome: check.status === 201 ? unavailable : rejected(check.status, check.payload, false) };
}

async function findAvailableAppointment(
  locationId: number, locale: CatalogLocale, date: string, appointment: Appointment, candidates: number[],
):
  Promise<CheckedAppointment | { outcome: RecordOutcome }> {
  // Leave time for creation and reading the receipts before the form's request timeout.
  const deadline = Date.now() + 15_000;
  const timeout: RecordOutcome = { status: 504, code: 'UPSTREAM_TIMEOUT' };
  let outcome = candidates.length ? slotTaken : staffMissing;
  for (const id of candidates) {
    if (Date.now() >= deadline) return { outcome: timeout };
    const times = await getBookingTimes(locale, appointment.services, id, date);
    const slot = times.find(({ datetime }) => datetime === appointment.datetime);
    if (!slot) continue;
    if (Date.now() >= deadline) return { outcome: timeout };

    const candidate = { ...appointment, staff_id: id };
    const failure = await checkAppointment(locationId, bookingLanguages[locale], candidate);
    if (Date.now() >= deadline) return { outcome: timeout };
    if (!failure) return { appointment: candidate, durationSeconds: slot.durationSeconds };
    if (failure.notFound || failure.outcome === staffMissing) {
      outcome = staffMissing;
    } else if (failure.outcome !== slotTaken) {
      return { outcome: failure.outcome };
    }
  }
  return { outcome };
}

export async function createBookingRecord(locationId: number, input: NormalizedBookingRecordRequest, instant: Date): Promise<RecordOutcome> {
  const { locale, serviceIds, staffId, datetime, contact } = input;
  const language = bookingLanguages[locale];
  let checked: CheckedAppointment = { appointment: { id: correlationId, services: serviceIds, staff_id: staffId, datetime } };
  let sending = false;
  try {
    if (instant.getTime() <= Date.now()) return slotTaken;
    const catalog = await fetchBookServices(locationId, locale);
    if (!isRecord(catalog) || !Array.isArray(catalog.services)) {
      console.warn('[booking] preflight rejected', { stage: 'book_services', reason: 'invalid_catalog' });
      return unavailable;
    }
    const byId = new Map(catalog.services.filter(isRecord).map((item) => [item.id, item]));
    const titles = new Map<number, string>();
    let composite = false;
    for (const serviceId of serviceIds) {
      const service = byId.get(serviceId);
      if (!service) return serviceMissing;
      if (service.prepaid === 'required') return prepaymentRequired;
      if (service.prepaid !== 'forbidden' && service.prepaid !== 'allowed') {
        const prepaid = service.prepaid;
        console.warn('[booking] preflight rejected', {
          stage: 'book_services', serviceId, reason: 'unknown_prepayment',
          prepaid: typeof prepaid === 'string' && /^[a-z_-]{0,32}$/i.test(prepaid) ? prepaid : undefined,
          prepaidType: prepaid === null ? 'null' : typeof prepaid,
        });
        return unavailable;
      }
      const title = serviceTitle(service.title);
      if (title) titles.set(serviceId, title);
      composite ||= service.is_composite === true;
    }

    const date = dubaiBookingDate(instant);
    const comment = await appointmentComment(input);
    if (staffId === 0 && serviceIds.length > 1) {
      const staff = await getCommonServiceStaff(locale, serviceIds);
      const available = await findAvailableAppointment(locationId, locale, date, checked.appointment, staff.map(({ id }) => id));
      if ('outcome' in available) return available.outcome;
      checked = available;
    } else {
      if (staffId !== 0 && !(await getCommonServiceStaff(locale, serviceIds)).some(({ id }) => id === staffId)) return staffMissing;
      const times = await getBookingTimes(locale, serviceIds, staffId, date);
      const slot = times.find((candidate) => candidate.datetime === datetime);
      if (!slot) return slotTaken;
      checked.durationSeconds = slot.durationSeconds;

      const failure = await checkAppointment(locationId, language, checked.appointment);
      if (failure) {
        if (!composite || staffId !== 0 || !failure.notFound) return failure.outcome;
        const staff = await getCommonServiceStaff(locale, serviceIds);
        const fallback = await findAvailableAppointment(locationId, locale, date, checked.appointment, staff.map(({ id }) => id));
        if ('outcome' in fallback) return fallback.outcome;
        checked = fallback;
      }
    }

    sending = true;
    const { appointment, durationSeconds } = checked;
    const result = await altegioPost('book_record', locationId, language, {
      ...contact, appointments: [appointment], ...(comment ? { comment } : {}),
    });
    const response = isRecord(result.payload) ? result.payload : null;
    const responseData = response?.data;
    console.log('[booking] Altegio book_record response', JSON.stringify({
      httpStatus: result.status,
      source: input.source,
      anyStaff: appointment.staff_id === 0,
      errorCodes: upstreamErrorCodes(result.payload).filter((code) => /^\d{3,5}$/.test(code)),
      empty: result.empty,
      composite,
      success: typeof response?.success === 'boolean' ? response.success : typeof response?.success,
      responseType: Array.isArray(result.payload) ? 'array' : result.payload === null ? 'null' : typeof result.payload,
      responseFields: response ? Object.keys(response) : [],
      data: Array.isArray(responseData) ? {
        count: responseData.length,
        items: responseData.slice(0, 10).map((item: unknown) => isRecord(item) ? {
          fields: Object.keys(item),
          requestIdMatches: item.id === correlationId,
          idType: typeof item.id,
          recordIdType: typeof item.record_id,
          recordIdValid: validBookingId(item.record_id),
          recordHashValid: typeof item.record_hash === 'string' && /^[a-z\d_-]{1,128}$/i.test(item.record_hash),
        } : { type: typeof item }),
      } : { type: responseData === null ? 'null' : typeof responseData, fields: isRecord(responseData) ? Object.keys(responseData) : undefined },
    }));
    if (result.status !== 201) return rejected(result.status, result.payload, sending);
    const receipts = parseReceipts(result.payload, composite);
    if (!receipts.length) return unknown;
    return await confirmCreation(locationId, { ...input, staffId: appointment.staff_id }, instant, receipts, composite, titles, durationSeconds);
  } catch (error) {
    return upstreamFailure(error, sending);
  }
}
