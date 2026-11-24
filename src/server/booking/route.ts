import 'server-only';

import type { NextRequest } from 'next/server';
import { normalizeBookingServices, type BookingDatesData, type BookingStaffData, type BookingTimesData } from '@/lib/contracts/booking-services';
import type { CatalogErrorCode } from '@/lib/contracts/catalog';
import type { StaffTodayResponse } from '@/lib/contracts/staff-today';
import { AltegioError } from '../altegio/errors';
import { getCatalogServices } from '../catalog/services';
import { getCommonServiceStaff, getCatalogStaff } from '../catalog/staff';
import { getBookingDates, getBookingTimes, isBookingDate, mergeBookingTimes } from './availability';
import { getStaffTodaySlots } from './staff-today';

const cacheControl = { 'Cache-Control': 'no-store' };
const allowedParams = {
  staff: ['serviceId', 'serviceIds', 'locale'],
  dates: ['serviceId', 'serviceIds', 'staffId', 'locale'],
  times: ['serviceId', 'serviceIds', 'staffId', 'date', 'locale'],
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
    return Response.json({ data: { times } } satisfies StaffTodayResponse, { headers: cacheControl });
  } catch (error) {
    return bookingDataError(error, 'staff-today');
  }
}

export async function respondWithBooking(request: NextRequest, resource: keyof typeof allowedParams) {
  const params = request.nextUrl.searchParams;
  const locale = params.get('locale') ?? 'en';
  const serviceId = params.has('serviceId') ? parseId(params.get('serviceId')) : undefined;
  const legacySelection = !params.has('serviceIds');
  const serviceIds = normalizeBookingServices(serviceId, legacySelection ? undefined : params.getAll('serviceIds').map(parseId));
  const staffId = resource === 'staff' ? 0 : parseId(params.get('staffId'));
  const date = params.get('date');
  if (!serviceIds) return errorResponse(400, 'INVALID_QUERY', 'Provide a valid serviceId or a nonempty set of serviceIds.');
  if ((locale !== 'ru' && locale !== 'en') || staffId === null ||
    (resource === 'times' && !isBookingDate(date)) ||
    [...params.keys()].some((name) => !allowedParams[resource].includes(name) ||
      (name !== 'serviceIds' && params.getAll(name).length !== 1))) {
    return errorResponse(400, 'INVALID_QUERY', 'Invalid booking query parameters.');
  }

  try {
    const { data: { services } } = await getCatalogServices(locale, { withBusinessDuration: false, fresh: !legacySelection });
    const publicIds = new Set(services.map(({ id }) => id));
    if (!serviceIds.every((id) => publicIds.has(id))) {
      if (legacySelection) return errorResponse(404, 'SERVICE_NOT_FOUND', 'The public service was not found.');
      return Response.json({ error: {
        code: 'SERVICE_NOT_FOUND',
        message: 'Some selected services are unavailable.',
        serviceIds: serviceIds.filter((id) => !publicIds.has(id)),
      } }, { status: 404, headers: cacheControl });
    }

    const selection = legacySelection ? { serviceId: serviceIds[0] } : { serviceIds };
    let candidates = [staffId];
    if (resource === 'staff' || staffId !== 0 || serviceIds.length > 1) {
      const staff = await getCommonServiceStaff(locale, serviceIds);
      if (resource === 'staff') {
        const data = { ...selection, staff: staff.map(({ id, name }) => ({ id, name })) } satisfies BookingStaffData;
        return Response.json({ data }, { headers: cacheControl });
      }
      if (staffId === 0) candidates = staff.map(({ id }) => id);
      else if (!staff.some(({ id }) => id === staffId)) {
        return errorResponse(404, 'STAFF_NOT_FOUND', 'The specialist was not found for the selected services.');
      }
    }

    let data: BookingDatesData | BookingTimesData;
    if (date === null) {
      const dates = await Promise.all(candidates.map((id) => getBookingDates(locale, serviceIds, id)));
      data = { ...selection, staffId, dates: [...new Set(dates.flat())].sort() };
    } else {
      const slots = await Promise.all(candidates.map((id) => getBookingTimes(locale, serviceIds, id, date)));
      const times = staffId === 0 && serviceIds.length > 1 ? mergeBookingTimes(slots) : slots.flat();
      data = { ...selection, staffId, date, times: legacySelection ? times.map(({ datetime, time }) => ({ datetime, time })) : times };
    }
    return Response.json({ data }, { headers: cacheControl });
  } catch (error) {
    return bookingDataError(error, resource);
  }
}
