import 'server-only';

import type { NextRequest } from 'next/server';
import type { CatalogErrorCode, CatalogErrorResponse, CatalogLocale } from '@/lib/contracts/catalog';
import { validBookingId } from '@/lib/contracts/booking-services';
import { AltegioError } from '@/server/altegio/errors';

const CACHE_CONTROL = { 'Cache-Control': 'no-store' };

function errorResponse(status: number, code: CatalogErrorCode, message: string, retryAfter?: string) {
  return Response.json({ error: { code, message } } satisfies CatalogErrorResponse, {
    status,
    headers: retryAfter ? { ...CACHE_CONTROL, 'Retry-After': retryAfter } : CACHE_CONTROL,
  });
}

export async function respondWithCatalog(
  request: NextRequest,
  load: (locale: CatalogLocale, staffId?: number) => Promise<unknown>,
  resource: 'service' | 'staff',
  { allowStaffFilter = false } = {},
) {
  const params = request.nextUrl.searchParams;
  const locale = params.get('locale') ?? 'en';
  const rawStaff = allowStaffFilter ? params.get('staffId') : null;
  const staffId = rawStaff === null ? undefined : /^\d+$/.test(rawStaff) ? Number(rawStaff) : NaN;
  const allowedCount = Number(params.has('locale')) + Number(rawStaff !== null);
  if ((locale !== 'en' && locale !== 'ru') || params.size !== allowedCount ||
    (staffId !== undefined && !validBookingId(staffId))) {
    return errorResponse(400, 'INVALID_QUERY', 'Use at most one locale parameter with the value ru or en.');
  }

  try {
    const catalog = await load(locale, staffId);
    if (catalog === null) return errorResponse(404, 'SERVICE_NOT_FOUND', 'The public service was not found.');
    return Response.json(catalog, { headers: CACHE_CONTROL });
  } catch (error) {
    if (error instanceof AltegioError) {
      const { status, code, message } = error.response;
      return errorResponse(status, code, message, error.retryAfter);
    }
    console.error('[catalog] Unexpected error loading public %s', resource);
    return errorResponse(500, 'INTERNAL_ERROR', `The ${resource} catalog request failed.`);
  }
}
