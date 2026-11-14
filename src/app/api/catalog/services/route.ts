import type { NextRequest } from 'next/server';
import type { CatalogErrorCode, CatalogErrorResponse } from '@/lib/contracts/catalog';
import { AltegioError } from '@/server/altegio/errors';
import { getCatalogServices } from '@/server/catalog/services';

const CACHE_CONTROL = { 'Cache-Control': 'no-store' };

function errorResponse(status: number, code: CatalogErrorCode, message: string, retryAfter?: string) {
  return Response.json({ error: { code, message } } satisfies CatalogErrorResponse, {
    status,
    headers: retryAfter ? { ...CACHE_CONTROL, 'Retry-After': retryAfter } : CACHE_CONTROL,
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const locale = params.get('locale') ?? 'en';
  if ((locale !== 'en' && locale !== 'ru') || params.size > (params.has('locale') ? 1 : 0)) {
    return errorResponse(400, 'INVALID_QUERY', 'Use at most one locale parameter with the value ru or en.');
  }

  try {
    const catalog = await getCatalogServices(locale);
    return Response.json(catalog, { headers: CACHE_CONTROL });
  } catch (error) {
    if (error instanceof AltegioError) {
      const { status, code, message } = error.response;
      return errorResponse(status, code, message, error.retryAfter);
    }
    console.error('[catalog] Unexpected error in getCatalogServices');
    return errorResponse(500, 'INTERNAL_ERROR', 'The service catalog request failed.');
  }
}
