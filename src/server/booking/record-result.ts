import 'server-only';

import type {
  BookingRecordData, BookingRecordErrorCode, BookingRecordField, BookingRecordResponse,
} from '@/lib/contracts/booking-record';
import type { CatalogLocale } from '@/lib/contracts/catalog';

export type RecordOutcome =
  | { status: number; data: BookingRecordData; retryAfter?: string }
  | { status: number; code: BookingRecordErrorCode; fields?: BookingRecordField[]; retryAfter?: string };

export const processing: RecordOutcome = { status: 202, data: { status: 'processing' }, retryAfter: '2' };
export const unknown: RecordOutcome = { status: 202, data: { status: 'unknown' } };
export const unavailable: RecordOutcome = { status: 503, code: 'BOOKING_UNAVAILABLE' };

const messages = {
  PREPAYMENT_REQUIRED: ['This service requires prepayment.', 'Для этой услуги нужна предоплата.'],
  SMS_REQUIRED: ['This location requires SMS verification.', 'Филиал требует подтверждения по SMS.'],
  SLOT_TAKEN: ['This time is no longer available.', 'Это время больше недоступно.'],
  SERVICE_NOT_FOUND: ['This service is unavailable.', 'Эта услуга недоступна.'],
  STAFF_NOT_FOUND: ['No applicable specialist is available.', 'Подходящий специалист недоступен.'],
  INVALID_FIELDS: ['Check the indicated fields.', 'Проверьте указанные поля.'],
  IDEMPOTENCY_CONFLICT: ['This key already belongs to another booking attempt.', 'Этот ключ уже относится к другой попытке записи.'],
  RATE_LIMITED: ['Too many booking attempts. Try again later.', 'Слишком много попыток записи. Повторите позже.'],
  UPSTREAM_RATE_LIMITED: ['Too many booking attempts. Try again later.', 'Слишком много попыток записи. Повторите позже.'],
} satisfies Partial<Record<BookingRecordErrorCode, [string, string]>>;

export function recordResponse(outcome: RecordOutcome, locale: CatalogLocale) {
  let body: BookingRecordResponse;
  if ('data' in outcome) {
    body = { data: outcome.data };
  } else {
    const copy: Partial<Record<BookingRecordErrorCode, [string, string]>> = messages;
    const message = (copy[outcome.code] ?? ['The booking request could not be accepted.', 'Не удалось принять запрос на запись.'])[locale === 'ru' ? 1 : 0];
    body = { error: { code: outcome.code, message, ...(outcome.fields ? { fields: outcome.fields } : {}) } };
  }
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (outcome.retryAfter) headers.set('Retry-After', outcome.retryAfter);
  return Response.json(body, { status: outcome.status, headers });
}
