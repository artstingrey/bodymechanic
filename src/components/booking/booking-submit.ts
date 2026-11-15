import type { BookingRecordData, BookingRecordErrorCode, BookingRecordRequest, BookingRecordResponse } from '@/lib/contracts/booking-record';

export type CreatedBooking = Extract<BookingRecordData, { status: 'created' }>;
type BookingError = Extract<BookingRecordResponse, { error: unknown }>['error'];
export type Submission =
  | { status: 'created'; data: CreatedBooking }
  | { status: 'rejected'; error: BookingError }
  | { status: 'processing' | 'unknown' };

const definiteRejections: Readonly<Record<string, number>> = {
  INVALID_BODY: 400, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, INVALID_ORIGIN: 403,
  BOOKING_UNAVAILABLE: 503, SERVICE_NOT_FOUND: 404, STAFF_NOT_FOUND: 404, SLOT_TAKEN: 409,
  PREPAYMENT_REQUIRED: 422, SMS_REQUIRED: 422, BOOKING_REJECTED: 422,
  RATE_LIMITED: 429, UPSTREAM_RATE_LIMITED: 429, UPSTREAM_TIMEOUT: 504,
};

const rejectionNotices = {
  SLOT_TAKEN: 'slotTaken', STAFF_NOT_FOUND: 'staffUnavailable', SERVICE_NOT_FOUND: 'serviceUnavailable',
  PREPAYMENT_REQUIRED: 'prepayment', SMS_REQUIRED: 'sms', RATE_LIMITED: 'rateLimited', UPSTREAM_RATE_LIMITED: 'rateLimited',
  INVALID_FIELDS: 'invalidFields',
} as const satisfies Partial<Record<BookingRecordErrorCode, string>>;
type RejectionNotice = typeof rejectionNotices[keyof typeof rejectionNotices] | 'unavailable';

export function bookingRejectionNotice(code: BookingRecordErrorCode): RejectionNotice {
  const notices: Partial<Record<BookingRecordErrorCode, RejectionNotice>> = rejectionNotices;
  return notices[code] ?? 'unavailable';
}

function validStaff(staff: CreatedBooking['staff']) {
  return staff === undefined || (staff && Number.isSafeInteger(staff.id) && staff.id > 0 &&
    typeof staff.name === 'string' && staff.name.trim());
}

function validParts(data: CreatedBooking) {
  if (data.parts === undefined) return true;
  if (!Array.isArray(data.parts) || data.parts.length < 2 || data.parts[0]?.recordId !== data.recordId) return false;
  const start = Date.parse(data.datetime);
  return new Set(data.parts.map((part) => part?.recordId)).size === data.parts.length &&
    Date.parse(data.parts[0].datetime) === start &&
    data.parts.every((part) => part && Number.isSafeInteger(part.recordId) && part.recordId > 0 &&
      typeof part.title === 'string' && part.title.trim() && typeof part.datetime === 'string' &&
      Date.parse(part.datetime) >= start && validStaff(part.staff) &&
      (part.durationSeconds === undefined || (Number.isSafeInteger(part.durationSeconds) &&
        part.durationSeconds > 0 && Number.isFinite(new Date(Date.parse(part.datetime) + part.durationSeconds * 1000).getTime()))));
}

export async function sendBooking(input: BookingRecordRequest): Promise<Submission> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 70_000);
  try {
    const response = await fetch('/api/booking/record', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      mode: 'same-origin', cache: 'no-store', redirect: 'error',
      body: JSON.stringify(input), signal: controller.signal,
    });
    const body = await response.json() as BookingRecordResponse;
    if ('data' in body) {
      const data = body.data;
      if (response.status === 201 && data.status === 'created' &&
        Number.isSafeInteger(data.recordId) && data.recordId > 0 &&
        data.serviceId === input.serviceId && data.datetime === input.datetime &&
        validStaff(data.staff) && (data.staff === undefined || input.staffId === 0 || input.staffId === data.staff.id) &&
        validParts(data)) return { status: 'created', data };
      if (response.status === 202 && data.status === 'processing') return { status: 'processing' };
    } else if ('error' in body) {
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
