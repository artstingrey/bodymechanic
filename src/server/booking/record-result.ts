import 'server-only';

import type {
  BookingRecordErrorCode, BookingRecordField, BookingRecordResponse, BookingRecordSetConfirmation,
} from '@/lib/contracts/booking-record';
import type { CatalogLocale } from '@/lib/contracts/catalog';

export type RecordOutcome =
  | { status: number; data: BookingRecordSetConfirmation | { status: 'processing' | 'unknown' }; retryAfter?: string }
  | { status: number; code: BookingRecordErrorCode; fields?: BookingRecordField[]; retryAfter?: string };

export const processing: RecordOutcome = { status: 202, data: { status: 'processing' }, retryAfter: '2' };
export const unknown: RecordOutcome = { status: 202, data: { status: 'unknown' } };
export const unavailable: RecordOutcome = { status: 503, code: 'BOOKING_UNAVAILABLE' };
export const captchaInvalid = { status: 422, code: 'CAPTCHA_INVALID' } as const;
export const captchaUnavailable = { status: 503, code: 'CAPTCHA_UNAVAILABLE' } as const;

const messages = {
  PREPAYMENT_REQUIRED: ['This service requires prepayment.', 'Для этой услуги нужна предоплата.'],
  SMS_REQUIRED: ['This location requires SMS verification.', 'Филиал требует подтверждения по SMS.'],
  SLOT_TAKEN: ['This time is no longer available.', 'Это время больше недоступно.'],
  SERVICE_NOT_FOUND: ['This service is unavailable.', 'Эта услуга недоступна.'],
  STAFF_NOT_FOUND: ['No applicable specialist is available.', 'Подходящий специалист недоступен.'],
  INVALID_FIELDS: ['Check the indicated fields.', 'Проверьте указанные поля.'],
  CAPTCHA_INVALID: ['The security check was rejected. Complete a new check.', 'Проверка не пройдена. Пройдите её ещё раз.'],
  CAPTCHA_UNAVAILABLE: ['The security check is temporarily unavailable. Try again.', 'Проверка временно недоступна. Повторите попытку.'],
  IDEMPOTENCY_CONFLICT: ['This key already belongs to another booking attempt.', 'Этот ключ уже относится к другой попытке записи.'],
  RATE_LIMITED: ['Too many booking attempts. Try again later.', 'Слишком много попыток записи. Повторите позже.'],
  UPSTREAM_RATE_LIMITED: ['Too many booking attempts. Try again later.', 'Слишком много попыток записи. Повторите позже.'],
} satisfies Partial<Record<BookingRecordErrorCode, [string, string]>>;

export function recordResponse(outcome: RecordOutcome, locale: CatalogLocale, legacySelection = false) {
  let body: BookingRecordResponse;
  if ('data' in outcome) {
    const data = outcome.data;
    if (legacySelection && data.status === 'created') {
      const { recordId, datetime, staff, parts } = data;
      body = { data: { status: 'created', recordId, serviceId: data.serviceIds[0], datetime, staff, parts } };
    } else {
      body = { data };
    }
  } else {
    const copy: Partial<Record<BookingRecordErrorCode, [string, string]>> = messages;
    const message = (copy[outcome.code] ?? ['The booking request could not be accepted.', 'Не удалось принять запрос на запись.'])[locale === 'ru' ? 1 : 0];
    body = { error: { code: outcome.code, message, ...(outcome.fields ? { fields: outcome.fields } : {}) } };
  }
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (outcome.retryAfter) headers.set('Retry-After', outcome.retryAfter);
  return Response.json(body, { status: outcome.status, headers });
}
