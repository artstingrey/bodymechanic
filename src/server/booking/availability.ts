import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { validBookingId, type BookingTime } from '@/lib/contracts/booking-services';
import { altegioGet, bookingLanguages, isRecord } from '../altegio/client';
import { AltegioError } from '../altegio/errors';
import { bookingServiceParams } from '../altegio/services';
import { getAltegioConfig } from '../config';

const dubaiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', dateStyle: 'short' });
const dubaiTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});

function bookingSlot(slot: unknown) {
  const datetime = isRecord(slot) ? slot.datetime : null;
  const instant = parseBookingDatetime(datetime);
  if (typeof datetime !== 'string' || !instant) throw new AltegioError('invalidResponse');
  return { datetime, instant };
}

export function isBookingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseBookingDatetime(value: unknown): Date | null {
  if (typeof value !== 'string' || !isBookingDate(value.slice(0, 10)) ||
    !/^T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value.slice(10))) return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

export function dubaiBookingDate(instant: Date) {
  return dubaiDate.format(instant);
}

export async function getBookingDates(locale: CatalogLocale, serviceIds: readonly number[], staffId: number) {
  const { locationId } = getAltegioConfig();
  const query = bookingServiceParams(serviceIds);
  query.set('staff_id', String(staffId));
  const data = await altegioGet('book_dates', `book_dates/${locationId}?${query}`, bookingLanguages[locale]);
  if (!isRecord(data) || !Array.isArray(data.booking_dates) || !data.booking_dates.every(isBookingDate)) {
    throw new AltegioError('invalidResponse');
  }
  return [...new Set<string>(data.booking_dates)].sort();
}

export async function getBookingTimes(locale: CatalogLocale, serviceIds: readonly number[], staffId: number, date: string,
  { ignoreOtherDates = false } = {}): Promise<BookingTime[]> {
  const { locationId } = getAltegioConfig();
  const query = bookingServiceParams(serviceIds);
  const data = await altegioGet('book_times', `book_times/${locationId}/${staffId}/${date}?${query}`, bookingLanguages[locale]);
  if (!Array.isArray(data)) throw new AltegioError('invalidResponse');

  return data.flatMap((slot: unknown) => {
    const { datetime, instant } = bookingSlot(slot);
    if (dubaiBookingDate(instant) !== date) {
      if (ignoreOtherDates) return [];
      throw new AltegioError('invalidResponse');
    }
    const session = slot as Record<string, unknown>;
    // sum_length is the documented total. seance_length alone cannot establish the length of a set.
    const duration = session.sum_length ?? (serviceIds.length === 1 ? session.seance_length : undefined);
    return [{ datetime, time: dubaiTime.format(instant), ...(validBookingId(duration) ? { durationSeconds: duration } : {}) }];
  });
}

export function mergeBookingTimes(lists: BookingTime[][]) {
  const byInstant = new Map<number, BookingTime>();
  for (const slot of lists.flat()) {
    const start = Date.parse(slot.datetime);
    const existing = byInstant.get(start);
    if (!existing) byInstant.set(start, slot);
    else if (existing.durationSeconds !== slot.durationSeconds) {
      byInstant.set(start, { datetime: existing.datetime, time: existing.time });
    }
  }
  return [...byInstant.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export async function getNearestStaffTimes(locale: CatalogLocale, staffId: number) {
  const { locationId } = getAltegioConfig();
  const data = await altegioGet('book_staff_seances', `book_staff_seances/${locationId}/${staffId}`, bookingLanguages[locale]);
  if (!isRecord(data) || !Array.isArray(data.seances)) throw new AltegioError('invalidResponse');
  return data.seances.map((slot: unknown) => {
    const { datetime, instant } = bookingSlot(slot);
    return { datetime, time: dubaiTime.format(instant) };
  });
}
