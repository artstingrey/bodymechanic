import 'server-only';

import { createTranslator } from 'next-intl';
import { formatComment } from '@/lib/altegio/formatComment';
import type { BookingRecordPart, BookingRecordRequest } from '@/lib/contracts/booking-record';
import { landingBookingChips } from '@/lib/lp/booking';
import { altegioGet, altegioPost, bookingLanguages, isRecord } from '../altegio/client';
import { AltegioError } from '../altegio/errors';
import { fetchBookServices } from '../altegio/services';
import { getCatalogServiceStaff } from '../catalog/staff';
import { dubaiBookingDate, getBookingTimes, parseBookingDatetime } from './availability';
import { validId } from './record-request';
import { unavailable, unknown, type RecordOutcome } from './record-result';

const serviceMissing: RecordOutcome = { status: 404, code: 'SERVICE_NOT_FOUND' };
const staffMissing: RecordOutcome = { status: 404, code: 'STAFF_NOT_FOUND' };
const slotTaken: RecordOutcome = { status: 409, code: 'SLOT_TAKEN' };
const prepaymentRequired: RecordOutcome = { status: 422, code: 'PREPAYMENT_REQUIRED' };
const correlationId = 1;

async function appointmentComment(input: BookingRecordRequest) {
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

function parseReceipts(payload: unknown, composite: boolean): Receipt[] {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data) ||
    payload.data.length === 0 || payload.data.length > (composite ? 10 : 1)) return [];

  const result = new Map<number, Receipt>();
  for (const record of payload.data as unknown[]) {
    // Altegio assigns its own response IDs to the parts of a composite service.
    if (!isRecord(record) || (composite ? !validId(record.id) : record.id !== correlationId) || !validId(record.record_id) ||
      typeof record.record_hash !== 'string' || !/^[a-z\d_-]{1,128}$/i.test(record.record_hash) ||
      result.has(record.record_id)) return [];
    result.set(record.record_id, { recordId: record.record_id, hash: record.record_hash });
  }
  return [...result.values()];
}

async function readCreatedRecord(locationId: number, locale: BookingRecordRequest['locale'], { recordId, hash }: Receipt) {
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
    const staff = isRecord(member) && validId(member.id) && typeof member.name === 'string' &&
      member.name.trim() && member.name.length <= 200 ? { id: member.id, name: member.name.trim() } : undefined;
    return {
      recordId, datetime, instant: instant.getTime(), staff, services: record.services as unknown[],
      durationSeconds: validId(record.length) && record.length <= 2_147_483_647 ? record.length : undefined,
    };
  } catch {
    return null;
  }
}

async function confirmCreation(locationId: number, input: BookingRecordRequest, instant: Date, receipts: Receipt[], composite: boolean): Promise<RecordOutcome> {
  const base = { status: 'created' as const, serviceId: input.serviceId, datetime: input.datetime };
  const details = await Promise.all(receipts.map((receipt) => readCreatedRecord(locationId, input.locale, receipt)));
  if (receipts.length === 1) {
    const record = details[0];
    const matchesSelection = record?.instant === instant.getTime() &&
      record.services.some((service) => isRecord(service) && service.id === input.serviceId);
    const staff = matchesSelection && (input.staffId === 0 || record.staff?.id === input.staffId) ? record.staff : undefined;
    // A single component cannot confirm that a split package was booked.
    if (composite && (!matchesSelection || (input.staffId !== 0 && !staff))) return unknown;
    return { status: 201, data: { ...base, recordId: receipts[0].recordId, ...(staff ? { staff } : {}) } };
  }

  const records = details.filter((record) => record !== null).sort((a, b) => a.instant - b.instant);
  if (records.length !== receipts.length || records[0].instant !== instant.getTime()) return unknown;
  const staff = input.staffId === 0 ? records[0].staff : records.find((record) => record.staff?.id === input.staffId)?.staff;
  if (input.staffId !== 0 && !staff) return unknown;

  const parts: BookingRecordPart[] = [];
  for (const record of records) {
    const titles = record.services.flatMap((service) => isRecord(service) && validId(service.id) &&
      typeof service.title === 'string' && service.title.trim() && service.title.length <= 300 ? [service.title.trim()] : []);
    if (!titles.length || titles.length !== record.services.length) return unknown;
    const { recordId, datetime, durationSeconds, staff } = record;
    parts.push({ recordId, datetime, title: titles.join(' + '), durationSeconds, staff });
  }
  return { status: 201, data: { ...base, recordId: parts[0].recordId, parts, ...(staff ? { staff } : {}) } };
}

async function checkAppointment(locationId: number, language: string, serviceId: number, appointment: Appointment) {
  const check = await altegioPost('book_check', locationId, language, { appointments: [appointment] });
  const body = isRecord(check.payload) ? check.payload : null;
  const accepted = check.empty || (body?.success === true && (!('data' in body) || body.data === null));
  if (check.status === 201 && accepted) return null;

  const data = body?.data;
  console.warn('[booking] preflight rejected', {
    stage: 'book_check', serviceId, anyStaff: appointment.staff_id === 0, httpStatus: check.status, empty: check.empty,
    success: typeof body?.success === 'boolean' ? body.success : undefined,
    dataType: Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data,
    errorCodes: upstreamErrorCodes(check.payload).filter((code) => /^\d{3,5}$/.test(code)),
  });
  return { notFound: check.status === 404, outcome: check.status === 201 ? unavailable : rejected(check.status, check.payload, false) };
}

async function findAvailableAppointment(locationId: number, input: BookingRecordRequest, date: string, appointment: Appointment):
  Promise<{ appointment: Appointment } | { outcome: RecordOutcome }> {
  // Leave time for creation and reading the receipts before the form's request timeout.
  const deadline = Date.now() + 15_000;
  const timeout: RecordOutcome = { status: 504, code: 'UPSTREAM_TIMEOUT' };
  const { locale, serviceId, datetime } = input;
  const staff = await getCatalogServiceStaff(locale, serviceId);
  let outcome = staff.length ? slotTaken : staffMissing;
  for (const { id } of staff) {
    if (Date.now() >= deadline) return { outcome: timeout };
    const times = await getBookingTimes(locale, serviceId, id, date);
    if (!times.some((slot) => slot.datetime === datetime)) continue;
    if (Date.now() >= deadline) return { outcome: timeout };

    const candidate = { ...appointment, staff_id: id };
    const failure = await checkAppointment(locationId, bookingLanguages[locale], serviceId, candidate);
    if (Date.now() >= deadline) return { outcome: timeout };
    if (!failure) return { appointment: candidate };
    if (failure.notFound || failure.outcome === staffMissing) {
      outcome = staffMissing;
    } else if (failure.outcome !== slotTaken) {
      return { outcome: failure.outcome };
    }
  }
  return { outcome };
}

export async function createBookingRecord(locationId: number, input: BookingRecordRequest, instant: Date): Promise<RecordOutcome> {
  const { locale, serviceId, staffId, datetime, contact } = input;
  const language = bookingLanguages[locale];
  let appointment = { id: correlationId, services: [serviceId], staff_id: staffId, datetime };
  let sending = false;
  try {
    if (instant.getTime() <= Date.now()) return slotTaken;
    const catalog = await fetchBookServices(locationId, locale);
    if (!isRecord(catalog) || !Array.isArray(catalog.services)) {
      console.warn('[booking] preflight rejected', { stage: 'book_services', serviceId, reason: 'invalid_catalog' });
      return unavailable;
    }
    const service = (catalog.services as unknown[]).find((item) => isRecord(item) && item.id === serviceId);
    if (!isRecord(service)) return serviceMissing;
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

    if (staffId !== 0 && !(await getCatalogServiceStaff(locale, serviceId)).some(({ id }) => id === staffId)) return staffMissing;
    const date = dubaiBookingDate(instant);
    const times = await getBookingTimes(locale, serviceId, staffId, date);
    if (!times.some((slot) => slot.datetime === datetime)) return slotTaken;

    const comment = await appointmentComment(input);
    const composite = service.is_composite === true;
    const failure = await checkAppointment(locationId, language, serviceId, appointment);
    if (failure) {
      if (!composite || staffId !== 0 || !failure.notFound) return failure.outcome;
      const fallback = await findAvailableAppointment(locationId, input, date, appointment);
      if ('outcome' in fallback) return fallback.outcome;
      appointment = fallback.appointment;
    }

    sending = true;
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
      composite: service.is_composite === true,
      compositeType: typeof service.is_composite,
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
          recordIdValid: validId(item.record_id),
          recordHashValid: typeof item.record_hash === 'string' && /^[a-z\d_-]{1,128}$/i.test(item.record_hash),
        } : { type: typeof item }),
      } : { type: responseData === null ? 'null' : typeof responseData, fields: isRecord(responseData) ? Object.keys(responseData) : undefined },
    }));
    if (result.status !== 201) return rejected(result.status, result.payload, sending);
    const receipts = parseReceipts(result.payload, composite);
    if (!receipts.length) return unknown;
    return await confirmCreation(locationId, { ...input, staffId: appointment.staff_id }, instant, receipts, composite);
  } catch (error) {
    return upstreamFailure(error, sending);
  }
}
