import 'server-only';

import { catalogServiceId, catalogServiceSlug } from '@/lib/catalog-service-slugs';
import type { CatalogLocale, CatalogServiceDetailResponse } from '@/lib/contracts/catalog';
import { getCatalogServices } from './services';

export async function getCatalogServiceDetail(slug: string, locale: CatalogLocale): Promise<CatalogServiceDetailResponse | null> {
  const id = catalogServiceId(slug);
  if (id === undefined) return null;

  const { data, meta } = await getCatalogServices(locale);
  const service = data.services.find((entry) => entry.id === id);
  if (!service) return null;
  const category = data.categories.find((entry) => entry.id === service.categoryId) ?? null;
  return { data: { service: { ...service, slug: catalogServiceSlug(id) }, category }, meta };
}
