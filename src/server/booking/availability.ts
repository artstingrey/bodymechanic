import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { altegioGet, bookingLanguages, isRecord } from '../altegio/client';
import { AltegioError } from '../altegio/errors';
import { getAltegioConfig } from '../config';

const dubaiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', dateStyle: 'short' });
const dubaiTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});

export function isBookingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

export async function getBookingTimes(locale: CatalogLocale, serviceId: number, staffId: number, date: string) {
  const { locationId } = getAltegioConfig();
  const query = new URLSearchParams({ 'service_ids[]': String(serviceId) });
  const data = await altegioGet('book_times', `book_times/${locationId}/${staffId}/${date}?${query}`, bookingLanguages[locale]);
  if (!Array.isArray(data)) throw new AltegioError('invalidResponse');

  return data.map((slot: unknown) => {
    const datetime = isRecord(slot) ? slot.datetime : null;
    if (typeof datetime !== 'string' || !isBookingDate(datetime.slice(0, 10)) ||
      !/^T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(datetime.slice(10))) {
      throw new AltegioError('invalidResponse');
    }
    const instant = new Date(datetime);
    if (!Number.isFinite(instant.getTime()) || dubaiDate.format(instant) !== date) {
      throw new AltegioError('invalidResponse');
    }
    return { datetime, time: dubaiTime.format(instant) };
  });
}
