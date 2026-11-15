import 'server-only';

import type { CatalogCategory, CatalogLocale, CatalogServicesResponse } from '@/lib/contracts/catalog';
import { isRecord } from '../altegio/client';
import { AltegioError } from '../altegio/errors';
import { fetchBookServices } from '../altegio/services';
import { getAltegioConfig } from '../config';
import { cachePublicCatalog } from './cache';

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function price(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
    const seconds = value.seance_length;
    return {
      ...identity(value),
      description: publicDescription(value.comment),
      categoryId: positiveId(value.category_id),
      priceMin: price(value.price_min),
      priceMax: price(value.price_max),
      currency,
      durationMin: typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null,
      imageUrl: imageUrl(value.image),
    };
  });
  return { services, categories };
}

const getCachedServices = cachePublicCatalog('book-services-v2', async (locationId: number, currency: string | null, locale: CatalogLocale, staffId?: number) => {
  const data = await fetchBookServices(locationId, locale, staffId);
  try {
    return normalizeCatalog(data, currency);
  } catch (error) {
    console.warn('[altegio]', { operation: 'book_services', code: 'UPSTREAM_INVALID_RESPONSE' });
    throw error;
  }
});

export async function getCatalogServices(locale: CatalogLocale): Promise<CatalogServicesResponse> {
  const { locationId, currency } = getAltegioConfig();
  const data = await getCachedServices(locationId, currency, locale);
  return { data, meta: { source: 'altegio', locale } };
}

export async function getCatalogStaffServices(locale: CatalogLocale, staffId: number) {
  const { locationId, currency } = getAltegioConfig();
  const { services } = await getCachedServices(locationId, currency, locale, staffId);
  return services;
}
