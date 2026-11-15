import type { BookingRecordData, BookingRecordRequest, BookingRecordResponse } from '@/lib/contracts/booking-record';

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

export async function sendQuickBooking(input: BookingRecordRequest): Promise<Submission> {
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
        (data.staff === undefined || (Number.isSafeInteger(data.staff.id) && data.staff.id > 0 &&
          (input.staffId === 0 || input.staffId === data.staff.id) &&
          typeof data.staff.name === 'string' && data.staff.name.trim()))) return { status: 'created', data };
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
