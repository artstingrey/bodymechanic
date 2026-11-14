import type { NextRequest } from 'next/server';
import { respondWithCatalog } from '@/server/catalog/route';
import { getCatalogServices } from '@/server/catalog/services';

export function GET(request: NextRequest) {
  return respondWithCatalog(request, getCatalogServices, 'service');
}
