import { draftExpired } from './draft-ttl';
import { validBookingInstant, validConfirmation, validConfirmedServices, type BookingResult } from './receipt';
import { isBookingAttemptKey } from '../contracts/booking-record';
import { normalizeBookingServices, validBookingId } from '../contracts/booking-services';

export interface BookingAttemptDetails {
  idempotencyKey: string;
  recoveryKey: string;
  serviceIds: number[];
  staffId: number;
  datetime: string;
  title: string;
  price?: string;
}

export type PendingBooking = { status: 'processing' | 'unknown'; at: string; attempt?: BookingAttemptDetails };
export type StoredBooking = BookingResult | PendingBooking;
export type BookingResultScope = '3d' | 'form' | `lp-${'a' | 'b'}-${string}`;

function resultKey(scope: BookingResultScope) {
  return scope === '3d' ? 'bm.bookingResult' : `bm.bookingResult.${scope}`;
}

export function readStoredBooking(scope: BookingResultScope) {
  try { return sessionStorage.getItem(resultKey(scope)); } catch { return null; }
}

export function writeStoredBooking(scope: BookingResultScope, booking: StoredBooking | null) {
  try {
    if (booking) sessionStorage.setItem(resultKey(scope), JSON.stringify({ ...booking, version: 3 }));
    else sessionStorage.removeItem(resultKey(scope));
  } catch { /* Keep the in-memory result when storage is unavailable. */ }
}

function validAttempt(value: unknown): value is BookingAttemptDetails {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as BookingAttemptDetails;
  return isBookingAttemptKey(attempt.idempotencyKey) && isBookingAttemptKey(attempt.recoveryKey) &&
    attempt.idempotencyKey !== attempt.recoveryKey &&
    !!normalizeBookingServices(undefined, attempt.serviceIds) &&
    validBookingId(attempt.staffId, 0) && validBookingInstant(attempt.datetime) && typeof attempt.title === 'string' &&
    (attempt.price === undefined || typeof attempt.price === 'string');
}

export function decodeStoredBooking(raw: string | null): StoredBooking | null {
  if (!raw) return null;
  try {
    const data: Record<string, unknown> | null = JSON.parse(raw);
    if (!data || (data.version !== 2 && data.version !== 3) || !validBookingInstant(data.at) || draftExpired(Date.parse(data.at))) return null;
    const { status, at, version, services: rawServices, price, serviceTitle, serviceId, serviceIds, durationMin } = data;
    if (status === 'processing' || status === 'unknown') {
      return { status, at, ...(validAttempt(data.attempt) ? { attempt: data.attempt } : {}) };
    }
    if (!validConfirmation(data)) return null;
    const { recordId, datetime, parts, staff, durationSeconds } = data;
    if (version === 3) {
      const ids = normalizeBookingServices(undefined, Array.isArray(rawServices) ? rawServices.map((service) => service?.id) : null);
      if (!ids || !validConfirmedServices(ids, rawServices)) return null;
      return { status: 'created', recordId, datetime, parts, staff, durationSeconds, at,
        services: rawServices, price: typeof price === 'string' ? price : undefined };
    }
    if (typeof serviceTitle !== 'string' || !serviceTitle.trim()) return null;
    const ids = normalizeBookingServices(serviceId, serviceIds);
    const titles = ids?.length === 1 ? [serviceTitle] : serviceTitle.split(' · ');
    const services = ids && ids.length === titles.length ? ids.map((id, index) => ({ id, title: titles[index] })) : [];
    const seconds = durationSeconds ?? (!parts && typeof durationMin === 'number' && validBookingId(durationMin * 60)
      && validBookingInstant(new Date(Date.parse(datetime) + durationMin * 60_000).toString()) ? durationMin * 60 : undefined);
    return { status: 'created', recordId, datetime, parts, staff, durationSeconds: seconds, at, services,
      legacyTitle: services.length ? undefined : serviceTitle };
  } catch {
    return null;
  }
}
