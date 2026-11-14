import 'server-only';

import type { NextRequest } from 'next/server';
import type { CatalogErrorCode, CatalogErrorResponse, CatalogLocale } from '@/lib/contracts/catalog';
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
  load: (locale: CatalogLocale) => Promise<unknown>,
  resource: 'service' | 'staff',
) {
  const params = request.nextUrl.searchParams;
  const locale = params.get('locale') ?? 'en';
  if ((locale !== 'en' && locale !== 'ru') || params.size > (params.has('locale') ? 1 : 0)) {
    return errorResponse(400, 'INVALID_QUERY', 'Use at most one locale parameter with the value ru or en.');
  }

  try {
    return Response.json(await load(locale), { headers: CACHE_CONTROL });
  } catch (error) {
    if (error instanceof AltegioError) {
      const { status, code, message } = error.response;
      return errorResponse(status, code, message, error.retryAfter);
    }
    console.error('[catalog] Unexpected error loading public %s', resource);
    return errorResponse(500, 'INTERNAL_ERROR', `The ${resource} catalog request failed.`);
  }
}
