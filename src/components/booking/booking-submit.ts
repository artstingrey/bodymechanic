import { validConfirmation, validConfirmedServices } from '@/lib/booking/receipt';
import type { BookingAttemptDetails } from '@/lib/booking/result';
import type { BookingRecordData, BookingRecordErrorCode, BookingRecordRequest, BookingRecordResponse } from '@/lib/contracts/booking-record';
import { equalBookingServices, normalizeBookingServices } from '@/lib/contracts/booking-services';
import type { CatalogLocale } from '@/lib/contracts/catalog';

export type CreatedBooking = Extract<BookingRecordData, { status: 'created' }>;
type BookingError = Extract<BookingRecordResponse, { error: unknown }>['error'];
export type Submission =
  | { status: 'created'; data: CreatedBooking }
  | { status: 'rejected'; error: BookingError }
  | { status: 'processing' | 'unknown' };

const definiteRejections: Readonly<Record<string, number>> = {
  INVALID_BODY: 400, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, INVALID_ORIGIN: 403,
  BOOKING_UNAVAILABLE: 503, SERVICE_NOT_FOUND: 404, STAFF_NOT_FOUND: 404, SLOT_TAKEN: 409,
  CAPTCHA_INVALID: 422, CAPTCHA_UNAVAILABLE: 503,
  PREPAYMENT_REQUIRED: 422, SMS_REQUIRED: 422, BOOKING_REJECTED: 422,
  RATE_LIMITED: 429, UPSTREAM_RATE_LIMITED: 429, UPSTREAM_TIMEOUT: 504,
};

const rejectionNotices = {
  SLOT_TAKEN: 'slotTaken', STAFF_NOT_FOUND: 'staffUnavailable', SERVICE_NOT_FOUND: 'serviceUnavailable',
  PREPAYMENT_REQUIRED: 'prepayment', SMS_REQUIRED: 'sms', RATE_LIMITED: 'rateLimited', UPSTREAM_RATE_LIMITED: 'rateLimited',
  INVALID_FIELDS: 'invalidFields',
  CAPTCHA_INVALID: 'captchaInvalid', CAPTCHA_UNAVAILABLE: 'captchaUnavailable',
} as const satisfies Partial<Record<BookingRecordErrorCode, string>>;
type RejectionNotice = typeof rejectionNotices[keyof typeof rejectionNotices] | 'unavailable';

export function bookingRejectionNotice(code: BookingRecordErrorCode): RejectionNotice {
  const notices: Partial<Record<BookingRecordErrorCode, RejectionNotice>> = rejectionNotices;
  return notices[code] ?? 'unavailable';
}

type ExpectedReceipt = Pick<BookingAttemptDetails, 'serviceIds' | 'staffId' | 'datetime'>;

function matchesReceipt(data: CreatedBooking, expected: ExpectedReceipt, legacy: boolean) {
  if (!validConfirmation(data) || data.datetime !== expected.datetime ||
    (data.staff && expected.staffId !== 0 && expected.staffId !== data.staff.id)) return false;
  const ids = expected.serviceIds;
  if (legacy) return data.serviceId === ids[0] && data.serviceIds === undefined;
  return data.serviceId === undefined && equalBookingServices(ids, data.serviceIds) &&
    validConfirmedServices(ids, data.services) &&
    (ids.length === 1 || !!data.staff && (!data.parts || data.parts.every((part) => part.staff?.id === data.staff?.id)));
}

async function requestBooking(path: 'record' | 'record/status', input: object, expected: ExpectedReceipt, legacy = false): Promise<Submission> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path === 'record' ? 70_000 : 10_000);
  try {
    const response = await fetch(`/api/booking/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      mode: 'same-origin', cache: 'no-store', redirect: 'error',
      body: JSON.stringify(input), signal: controller.signal,
    });
    const body = await response.json() as BookingRecordResponse;
    if ('data' in body) {
      const data = body.data;
      if (response.status === 201 && data.status === 'created' && matchesReceipt(data, expected, legacy)) return { status: 'created', data };
      if (response.status === 202 && data.status === 'processing') return { status: 'processing' };
    } else if ('error' in body && (path === 'record' || response.headers.get('X-Booking-Outcome') === 'stored')) {
      const { error } = body;
      if (definiteRejections[error.code] === response.status ||
        (error.code === 'INVALID_FIELDS' && [400, 422].includes(response.status))) return { status: 'rejected', error };
    }
  } catch {
    // A lost or invalid response does not establish whether a record was created.
  } finally {
    clearTimeout(timeout);
  }
  return { status: 'unknown' };
}

export function sendBooking(input: BookingRecordRequest): Promise<Submission> {
  const serviceIds = normalizeBookingServices(input.serviceId, input.serviceIds);
  return serviceIds
    ? requestBooking('record', input, { ...input, serviceIds }, input.serviceIds === undefined)
    : Promise.resolve({ status: 'unknown' });
}

export function checkBooking(booking: BookingAttemptDetails, locale: CatalogLocale) {
  const { idempotencyKey, recoveryKey } = booking;
  return requestBooking('record/status', { idempotencyKey, recoveryKey, locale }, booking);
}
