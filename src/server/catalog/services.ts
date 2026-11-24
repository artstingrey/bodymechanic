import 'server-only';

import { catalogCategoryTitles } from '@/content/catalog-categories';
import type { CatalogCategory, CatalogLocale, CatalogServicesResponse } from '@/lib/contracts/catalog';
import { isRecord } from '../altegio/client';
import { AltegioError } from '../altegio/errors';
import { fetchBookServices, fetchBusinessServices } from '../altegio/services';
import { getAltegioConfig } from '../config';
import { cachePublicCatalog } from './cache';

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function price(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function durationInMinutes(seconds: unknown): number | null {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null;
}

function publicDescription(comment: unknown): string | null {
  if (typeof comment !== 'string') return null;
  const description = comment.trim();
  // Publish plain-text booking comments; omit values containing HTML markup.
  return description && !/<[a-z!/?]/i.test(description) ? description : null;
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function identity(value: Record<string, unknown>): CatalogCategory {
  const id = positiveId(value.id);
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (id === null || !title) throw new AltegioError('invalidResponse');
  return { id, title };
}

function normalizeCatalog(data: unknown, currency: string | null): CatalogServicesResponse['data'] {
  if (!isRecord(data) || !Array.isArray(data.services)) throw new AltegioError('invalidResponse');
  const rawCategories = data.category ?? data.categories ?? [];
  if (!Array.isArray(rawCategories)) throw new AltegioError('invalidResponse');

  const categories = rawCategories.map((value: unknown) => {
    if (!isRecord(value)) throw new AltegioError('invalidResponse');
    return identity(value);
  });
  const services = data.services.map((value: unknown) => {
    if (!isRecord(value)) throw new AltegioError('invalidResponse');
    return {
      ...identity(value),
      description: publicDescription(value.comment),
      categoryId: positiveId(value.category_id),
      priceMin: price(value.price_min),
      priceMax: price(value.price_max),
      currency,
      durationMin: durationInMinutes(value.seance_length),
      imageUrl: imageUrl(value.image),
    };
  });
  return { services, categories };
}

async function loadServices(locationId: number, currency: string | null, locale: CatalogLocale, staffId?: number) {
  const data = await fetchBookServices(locationId, locale, staffId);
  try {
    return normalizeCatalog(data, currency);
  } catch (error) {
    console.warn('[altegio]', { operation: 'book_services', code: 'UPSTREAM_INVALID_RESPONSE' });
    throw error;
  }
}

const getCachedServices = cachePublicCatalog('book-services-v2', loadServices);

// Base duration is independent of locale. Cache only the service IDs and durations.
const getCachedBusinessDurations = cachePublicCatalog('business-service-durations-v2', async (locationId: number) => {
  const data = await fetchBusinessServices(locationId);
  if (!Array.isArray(data)) {
    console.warn('[altegio]', { operation: 'business_services', code: 'UPSTREAM_INVALID_RESPONSE' });
    throw new AltegioError('invalidResponse');
  }
  const durations: Partial<Record<number, number>> = {};
  for (const service of data) {
    if (!isRecord(service)) continue;
    const id = positiveId(service.id);
    const duration = durationInMinutes(service.duration);
    if (id !== null && duration !== null) durations[id] = duration;
  }
  return durations;
});

export async function getCatalogServices(locale: CatalogLocale, { withBusinessDuration = true, fresh = false, staffId }: {
  withBusinessDuration?: boolean; fresh?: boolean; staffId?: number;
} = {}): Promise<CatalogServicesResponse> {
  const { locationId, currency, businessToken } = getAltegioConfig();
  const [catalog, durations] = await Promise.all([
    (fresh ? loadServices : getCachedServices)(locationId, currency, locale, staffId),
    staffId === undefined && businessToken && withBusinessDuration ? getCachedBusinessDurations(locationId).catch(() => null) : null,
  ]);
  const data = {
    categories: catalog.categories.map((category) => ({
      ...category, title: catalogCategoryTitles.get(category.id)?.[locale] ?? category.title,
    })),
    services: durations
      ? catalog.services.map((service) => ({ ...service, durationMin: durations[service.id] ?? service.durationMin }))
      : catalog.services,
  };
  return { data, meta: { source: 'altegio', locale, ...(staffId === undefined ? {} : { staffId }) } };
}

export async function getCatalogStaffServices(locale: CatalogLocale, staffId: number) {
  const { locationId, currency } = getAltegioConfig();
  const { services } = await getCachedServices(locationId, currency, locale, staffId);
  return services;
}
