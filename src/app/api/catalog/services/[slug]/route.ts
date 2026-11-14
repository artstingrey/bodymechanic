import type { NextRequest } from 'next/server';
import { respondWithCatalog } from '@/server/catalog/route';
import { getCatalogServiceDetail } from '@/server/catalog/service-detail';

export async function GET(request: NextRequest, { params }: RouteContext<'/api/catalog/services/[slug]'>) {
  const { slug } = await params;
  return respondWithCatalog(request, (locale) => getCatalogServiceDetail(slug, locale), 'service');
}
