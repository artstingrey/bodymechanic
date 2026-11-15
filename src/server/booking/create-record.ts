import 'server-only';

import type { BookingRecordRequest } from '@/lib/contracts/booking-record';
import { altegioGet, altegioPost, bookingLanguages, isRecord } from '../altegio/client';
import { AltegioError } from '../altegio/errors';
import { fetchBookServices } from '../altegio/services';
import { getCatalogServiceStaff } from '../catalog/staff';
import { dubaiBookingDate, getBookingTimes } from './availability';
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

async function confirmedStaff(locationId: number, input: BookingRecordRequest, recordId: number, hash: string, instant: Date) {
  try {
    const record = await altegioGet('read_booking_record',
      `book_record/${locationId}/${recordId}/${encodeURIComponent(hash)}`, bookingLanguages[input.locale], true);
    if (!isRecord(record) || record.id !== recordId || record.deleted !== false ||
      typeof record.datetime !== 'string' || Date.parse(record.datetime) !== instant.getTime() ||
      !Array.isArray(record.services) || !record.services.some((service: unknown) => isRecord(service) && service.id === input.serviceId) ||
      !isRecord(record.staff) || !validId(record.staff.id) || (input.staffId !== 0 && record.staff.id !== input.staffId) ||
      typeof record.staff.name !== 'string' || !record.staff.name.trim() || record.staff.name.length > 200) return undefined;
    return { id: record.staff.id, name: record.staff.name.trim() };
  } catch {
    // The documented creation receipt is sufficient. Details may require separate permissions.
    return undefined;
  }
}

export async function createBookingRecord(locationId: number, input: BookingRecordRequest, instant: Date): Promise<RecordOutcome> {
  const { locale, serviceId, staffId, datetime, contact } = input;
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

    sending = true;
    const result = await altegioPost('book_record', locationId, language, { ...contact, appointments });
    if (result.status !== 201) return rejected(result.status, result.payload, sending);
    if (!isRecord(result.payload) || result.payload.success !== true ||
      !Array.isArray(result.payload.data) || result.payload.data.length !== 1) return unknown;
    const record: unknown = result.payload.data[0];
    if (!isRecord(record) || record.id !== correlationId || !validId(record.record_id) ||
      typeof record.record_hash !== 'string' || !/^[a-z\d_-]{1,128}$/i.test(record.record_hash)) return unknown;

    const staff = await confirmedStaff(locationId, input, record.record_id, record.record_hash, instant);
    return { status: 201, data: {
      status: 'created', recordId: record.record_id, serviceId, datetime, ...(staff ? { staff } : {}),
    } };
  } catch (error) {
    return upstreamFailure(error, sending);
  }
}
