import type { BookingRecordConfirmation, BookingRecordPart, BookingRecordSetConfirmation } from '@/lib/contracts/booking-record';
import { equalBookingServices, validBookingId } from '@/lib/contracts/booking-services';
import type { CatalogLocale } from '@/lib/contracts/catalog';

export type BookingResult = BookingRecordConfirmation & {
  services: BookingRecordSetConfirmation['services'];
  durationSeconds?: number;
  price?: string;
  at: string;
  legacyTitle?: string;
};

export function validBookingInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validStaff(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const staff = value as BookingRecordConfirmation['staff'];
  return !!staff && validBookingId(staff.id) && typeof staff.name === 'string' && !!staff.name.trim();
}

function validDuration(start: string, seconds: unknown) {
  return seconds === undefined || validBookingId(seconds) && Number.isFinite(new Date(Date.parse(start) + seconds * 1000).getTime());
}

export function validConfirmation(value: unknown): value is BookingRecordConfirmation & { durationSeconds?: number } {
  if (!value || typeof value !== 'object') return false;
  const data = value as BookingRecordConfirmation & { durationSeconds?: number };
  if (data.status !== 'created' || !validBookingId(data.recordId) || !validBookingInstant(data.datetime) ||
    !validStaff(data.staff) || !validDuration(data.datetime, data.durationSeconds)) return false;
  const parts = data.parts;
  if (parts === undefined) return true;
  if (!Array.isArray(parts) || parts.length < 2 || parts[0]?.recordId !== data.recordId) return false;
  const start = Date.parse(data.datetime);
  return Date.parse(parts[0].datetime) === start && new Set(parts.map((part) => part?.recordId)).size === parts.length &&
    parts.every((part) => part && validBookingId(part.recordId) && typeof part.title === 'string' && !!part.title.trim() &&
      validBookingInstant(part.datetime) && Date.parse(part.datetime) >= start && validStaff(part.staff) &&
      validDuration(part.datetime, part.durationSeconds));
}

export function validConfirmedServices(ids: number[], value: unknown): value is BookingRecordSetConfirmation['services'] {
  return Array.isArray(value) && value.every((service) => service && typeof service.title === 'string' &&
    service.title.trim() && service.title.length <= 300) && equalBookingServices(ids, value.map(({ id }) => id));
}

export const receiptTitle = (result: BookingResult) => result.legacyTitle ?? result.services.map(({ title }) => title).join(' · ');

export function receiptEnd(result: BookingResult) {
  if (result.durationSeconds !== undefined) return new Date(Date.parse(result.datetime) + result.durationSeconds * 1000).toISOString();
  // Older compound receipts recorded durations on the parts only.
  if (result.parts?.every(({ durationSeconds }) => durationSeconds !== undefined)) {
    return new Date(Math.max(...result.parts.map((part) => Date.parse(part.datetime) + part.durationSeconds! * 1000))).toISOString();
  }
}

export function receiptDuration(result: BookingResult) {
  const end = receiptEnd(result);
  return end === undefined ? undefined : (Date.parse(end) - Date.parse(result.datetime)) / 60_000;
}

export function bookingDateFormat(locale: CatalogLocale, dateStyle: 'long' | 'medium' = 'medium') {
  return new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Dubai', dateStyle, timeStyle: 'short', hourCycle: 'h23' });
}

export function bookingPartTime(part: BookingRecordPart, format: Intl.DateTimeFormat) {
  const start = new Date(part.datetime);
  return part.durationSeconds === undefined ? format.format(start)
    : format.formatRange(start, new Date(start.getTime() + part.durationSeconds * 1000));
}
