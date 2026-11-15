import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { AltegioError } from '../altegio/errors';
import { getCatalogStaffServices } from '../catalog/services';
import { getAltegioConfig } from '../config';
import { dubaiBookingDate, getBookingTimes, getNearestStaffTimes } from './availability';

type Slots = Awaited<ReturnType<typeof getNearestStaffTimes>>;
const inFlight = new Map<string, Promise<Slots>>();
const retryAt = new Map<number, number>();

function checkCooldown(locationId: number) {
  const remaining = Math.ceil(((retryAt.get(locationId) ?? 0) - performance.now()) / 1000);
  if (remaining > 0) throw new AltegioError('rateLimited', String(remaining));
  retryAt.delete(locationId);
}

async function loadSlots(locationId: number, locale: CatalogLocale, staffId: number): Promise<Slots> {
  try {
    return await getNearestStaffTimes(locale, staffId);
  } catch (error) {
    // A supported empty response means there are no slots. Only an unsupported request or invalid payload needs a fallback.
    if (!(error instanceof AltegioError) || (error.response.code !== 'UPSTREAM_INVALID_RESPONSE' &&
      ![400, 404, 422].includes(error.upstreamStatus ?? 0))) throw error;
  }

  checkCooldown(locationId);
  const services = await getCatalogStaffServices(locale, staffId);
  const date = dubaiBookingDate(new Date());
  const slots: Slots = [];
  // Run one request at a time and stop on the first failure, including a rate limit.
  for (const serviceId of new Set(services.map(({ id }) => id))) {
    checkCooldown(locationId);
    slots.push(...await getBookingTimes(locale, serviceId, staffId, date, { ignoreOtherDates: true }));
  }
  return slots;
}

export async function getStaffTodaySlots(locale: CatalogLocale, staffId: number): Promise<Slots> {
  const { locationId } = getAltegioConfig();
  checkCooldown(locationId);
  const key = `${locationId}:${locale}:${staffId}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = loadSlots(locationId, locale, staffId).catch((error: unknown) => {
      if (error instanceof AltegioError && error.response.code === 'UPSTREAM_RATE_LIMITED' && error.retryAfter) {
        const deadline = performance.now() + Number(error.retryAfter) * 1000;
        retryAt.set(locationId, Math.max(retryAt.get(locationId) ?? 0, deadline));
      }
      throw error;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  const slots = await pending;
  const now = new Date();
  const day = dubaiBookingDate(now);
  const byStart = new Map<number, Slots[number]>();
  for (const slot of slots) {
    const start = new Date(slot.datetime);
    if (start > now && dubaiBookingDate(start) === day && !byStart.has(start.getTime())) byStart.set(start.getTime(), slot);
  }
  return [...byStart.entries()].sort(([a], [b]) => a - b).slice(0, 4).map(([, slot]) => slot);
}
