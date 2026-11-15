import 'server-only';

import type { NextRequest } from 'next/server';
import type { CatalogErrorCode } from '@/lib/contracts/catalog';
import { AltegioError } from '../altegio/errors';
import { getCatalogServices } from '../catalog/services';
import { getCatalogServiceStaff, getCatalogStaff } from '../catalog/staff';
import { getBookingDates, getBookingTimes, isBookingDate } from './availability';
import { getStaffTodaySlots } from './staff-today';

const cacheControl = { 'Cache-Control': 'no-store' };
const allowedParams = {
  staff: ['serviceId', 'locale'],
  dates: ['serviceId', 'staffId', 'locale'],
  times: ['serviceId', 'staffId', 'date', 'locale'],
};

function errorResponse(status: number, code: CatalogErrorCode | 'STAFF_NOT_FOUND', message: string, retryAfter?: string) {
  return Response.json({ error: { code, message } }, {
    status,
    headers: retryAfter ? { ...cacheControl, 'Retry-After': retryAfter } : cacheControl,
  });
}

function parseId(value: string | null): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function bookingDataError(error: unknown, resource: string) {
  if (error instanceof AltegioError) {
    const { status, code } = error.response;
    return errorResponse(code === 'UPSTREAM_RATE_LIMITED' ? 429 : status, code,
      'Booking data is temporarily unavailable.', error.upstreamRetryAfter ?? error.retryAfter);
  }
  console.error('[booking] Unexpected error loading %s', resource);
  return errorResponse(500, 'INTERNAL_ERROR', 'The booking request failed.');
}

export async function respondWithStaffToday(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const locale = params.get('locale') ?? 'en';
  const staffId = parseId(params.get('staffId'));
  if ((locale !== 'ru' && locale !== 'en') || !staffId || params.size !== (params.has('locale') ? 2 : 1)) {
    return errorResponse(400, 'INVALID_QUERY', 'Invalid specialist availability parameters.');
  }

  try {
    const { data: { staff } } = await getCatalogStaff(locale);
    if (!staff.some(({ id }) => id === staffId)) return errorResponse(404, 'STAFF_NOT_FOUND', 'The specialist was not found.');
    const times = await getStaffTodaySlots(locale, staffId);
    return Response.json({ data: { times } }, { headers: cacheControl });
  } catch (error) {
    return bookingDataError(error, 'staff-today');
  }
}

export async function respondWithBooking(request: NextRequest, resource: keyof typeof allowedParams) {
  const params = request.nextUrl.searchParams;
  const locale = params.get('locale') ?? 'en';
  const serviceId = parseId(params.get('serviceId'));
  const staffId = resource === 'staff' ? 0 : parseId(params.get('staffId'));
  const date = params.get('date');
  if ((locale !== 'ru' && locale !== 'en') || !serviceId || staffId === null ||
    (resource === 'times' && !isBookingDate(date)) ||
    [...params.keys()].some((name) => !allowedParams[resource].includes(name) || params.getAll(name).length !== 1)) {
    return errorResponse(400, 'INVALID_QUERY', 'Invalid booking query parameters.');
  }

  try {
    const { data: { services } } = await getCatalogServices(locale);
    if (!services.some(({ id }) => id === serviceId)) {
      return errorResponse(404, 'SERVICE_NOT_FOUND', 'The public service was not found.');
    }

    if (resource === 'staff' || staffId !== 0) {
      const staff = await getCatalogServiceStaff(locale, serviceId);
      if (resource === 'staff') {
        return Response.json({ data: { serviceId, staff: staff.map(({ id, name }) => ({ id, name })) } }, { headers: cacheControl });
      }
      if (!staff.some(({ id }) => id === staffId)) {
        return errorResponse(404, 'STAFF_NOT_FOUND', 'The specialist was not found for this service.');
      }
    }

    const data = date === null
      ? { serviceId, staffId, dates: await getBookingDates(locale, serviceId, staffId) }
      : { serviceId, staffId, date, times: await getBookingTimes(locale, serviceId, staffId, date) };
    return Response.json({ data }, { headers: cacheControl });
  } catch (error) {
    return bookingDataError(error, resource);
  }
}
