import { ApiError } from '@/lib/api/errors';
import type { Slot } from '@/lib/api/types';
import type { CatalogLocale } from '@/lib/contracts/catalog';

type AvailabilitySelection = { serviceId: number; staffId: number; locale: CatalogLocale };

async function getAvailability(selection: AvailabilitySelection, date: string | null, signal: AbortSignal) {
  const { serviceId, staffId, locale } = selection;
  const query = new URLSearchParams({ serviceId: String(serviceId), staffId: String(staffId), locale });
  if (date !== null) query.set('date', date);
  const response = await fetch(`/api/booking/${date === null ? 'dates' : 'times'}?${query}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status === 429 ? 'rateLimit' : 'server');
  const result = await response.json() as { data?: { serviceId: number; staffId: number; date?: string; dates?: string[]; times?: Slot[] } };
  const data = result?.data;
  if (data?.serviceId !== serviceId || data.staffId !== staffId || (date !== null && data.date !== date)) {
    throw new ApiError('server');
  }
  return data;
}

export async function getAvailableDates(selection: AvailabilitySelection, signal: AbortSignal) {
  const { dates } = await getAvailability(selection, null, signal);
  if (!Array.isArray(dates)) throw new ApiError('server');
  return dates;
}

export async function getAvailableTimes(selection: AvailabilitySelection, date: string, signal: AbortSignal) {
  const { times } = await getAvailability(selection, date, signal);
  if (!Array.isArray(times)) throw new ApiError('server');
  return [...new Map(times.map((slot) => [slot.datetime, slot])).values()]
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Keep the 30-day grid, including any later days offered by the branch. */
export function bookingCalendarDays(today: string, available: string[]) {
  const first = Date.parse(today);
  const dayMs = 86_400_000;
  const last = Math.max(first + 29 * dayMs, ...available.map((date) => Date.parse(date)));
  return Array.from({ length: (last - first) / dayMs + 1 }, (_, index) =>
    new Date(first + index * dayMs).toISOString().slice(0, 10));
}
