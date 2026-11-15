import 'server-only';

import { formatComment } from '@/lib/altegio/formatComment';
import type { BookingRecordPart, BookingRecordRequest } from '@/lib/contracts/booking-record';
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

function rejected(status: number, payload: unknown, sending: boolean): RecordOutcome {
  if (status === 409) return slotTaken;
  if (status === 403 || status === 422) {
    const meta = isRecord(payload) && isRecord(payload.meta) ? payload.meta : null;
    const codes = [meta?.code, ...(Array.isArray(meta?.errors)
      ? meta.errors.map((error: unknown) => isRecord(error) ? error.code : undefined) : [])].map(String);
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

function parseReceipts(payload: unknown, composite: boolean): Receipt[] {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data) ||
    payload.data.length === 0 || payload.data.length > (composite ? 10 : 1)) return [];

  const result = new Map<number, Receipt>();
  for (const record of payload.data as unknown[]) {
    if (!isRecord(record) || record.id !== correlationId || !validId(record.record_id) ||
      typeof record.record_hash !== 'string' || !/^[a-z\d_-]{1,128}$/i.test(record.record_hash) ||
      result.has(record.record_id)) return [];
    result.set(record.record_id, { recordId: record.record_id, hash: record.record_hash });
  }
  return [...result.values()];
}

async function readCreatedRecord(locationId: number, locale: BookingRecordRequest['locale'], { recordId, hash }: Receipt) {
  try {
    const record = await altegioGet('read_booking_record',
      `book_record/${locationId}/${recordId}/${encodeURIComponent(hash)}`, bookingLanguages[locale], true);
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

export async function createBookingRecord(locationId: number, input: BookingRecordRequest, instant: Date): Promise<RecordOutcome> {
  const { locale, serviceId, staffId, datetime, contact, age, condition } = input;
  const language = bookingLanguages[locale];
  const appointments = [{ id: correlationId, services: [serviceId], staff_id: staffId, datetime }];
  let sending = false;
  try {
    if (instant.getTime() <= Date.now()) return slotTaken;
    const catalog = await fetchBookServices(locationId, locale);
    if (!isRecord(catalog) || !Array.isArray(catalog.services)) return unavailable;
    const service = (catalog.services as unknown[]).find((item) => isRecord(item) && item.id === serviceId);
    if (!isRecord(service)) return serviceMissing;
    if (service.prepaid === 'required') return prepaymentRequired;
    if (service.prepaid !== 'forbidden' && service.prepaid !== 'allowed') return unavailable;

    if (staffId !== 0 && !(await getCatalogServiceStaff(locale, serviceId)).some(({ id }) => id === staffId)) return staffMissing;
    const times = await getBookingTimes(locale, serviceId, staffId, dubaiBookingDate(instant));
    if (!times.some((slot) => slot.datetime === datetime)) return slotTaken;

    const check = await altegioPost('book_check', locationId, language, { appointments });
    if (check.status !== 201) return rejected(check.status, check.payload, sending);
    if (!check.empty && !(isRecord(check.payload) && check.payload.success === true &&
      (!('data' in check.payload) || check.payload.data === null))) return unavailable;

    const comment = age !== undefined || condition
      ? formatComment({ source: 'form', age, generalNote: condition }, locale)
      : undefined;
    sending = true;
    const result = await altegioPost('book_record', locationId, language, {
      ...contact, appointments, ...(comment ? { comment } : {}),
    });
    if (result.status !== 201) return rejected(result.status, result.payload, sending);
    const composite = service.is_composite === true;
    const receipts = parseReceipts(result.payload, composite);
    if (!receipts.length) return unknown;
    return await confirmCreation(locationId, input, instant, receipts, composite);
  } catch (error) {
    return upstreamFailure(error, sending);
  }
}
