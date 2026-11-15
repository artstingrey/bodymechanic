import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { altegioGet, bookingLanguages, isRecord } from '../altegio/client';
import { AltegioError } from '../altegio/errors';
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

export async function getBookingDates(locale: CatalogLocale, serviceId: number, staffId: number) {
  const { locationId } = getAltegioConfig();
  const query = new URLSearchParams({ 'service_ids[]': String(serviceId), staff_id: String(staffId) });
  const data = await altegioGet('book_dates', `book_dates/${locationId}?${query}`, bookingLanguages[locale]);
  if (!isRecord(data) || !Array.isArray(data.booking_dates) || !data.booking_dates.every(isBookingDate)) {
    throw new AltegioError('invalidResponse');
  }
  return [...new Set<string>(data.booking_dates)].sort();
}

export async function getBookingTimes(locale: CatalogLocale, serviceId: number, staffId: number, date: string,
  { ignoreOtherDates = false } = {}) {
  const { locationId } = getAltegioConfig();
  const query = new URLSearchParams({ 'service_ids[]': String(serviceId) });
  const data = await altegioGet('book_times', `book_times/${locationId}/${staffId}/${date}?${query}`, bookingLanguages[locale]);
  if (!Array.isArray(data)) throw new AltegioError('invalidResponse');

  return data.flatMap((slot: unknown) => {
    const { datetime, instant } = bookingSlot(slot);
    if (dubaiBookingDate(instant) !== date) {
      if (ignoreOtherDates) return [];
      throw new AltegioError('invalidResponse');
    }
    return [{ datetime, time: dubaiTime.format(instant) }];
  });
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
