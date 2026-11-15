import { ApiError } from '@/lib/api/errors';
import { SERVICES, STAFF } from '@/lib/api/mock-data';
import type { CatalogLocale, CatalogServicesResponse } from '@/lib/contracts/catalog';

const legacyServiceKeys = new Map(SERVICES.map(({ id, key }) => [id, key]));
const legacyStaffIds = new Set(STAFF.map(({ id }) => id));
const confirmedServices = new Map([['sports', 13982355], ['classic', 13982356]]);

/** Only mappings confirmed for zone recommendations in 6.1. */
export function confirmedCatalogId(demoId: number) {
  const key = legacyServiceKeys.get(demoId);
  return key === undefined ? undefined : confirmedServices.get(key);
}

export function restoreServiceId(id: number | null): number | null {
  if (id == null || !Number.isSafeInteger(id) || id <= 0) return null;
  return legacyServiceKeys.has(id) ? confirmedCatalogId(id) ?? null : id;
}

export function isLegacyStaffId(id: number) {
  return legacyStaffIds.has(id);
}

export async function getBookingCatalog(locale: CatalogLocale, signal: AbortSignal) {
  const response = await fetch(`/api/catalog/services?locale=${locale}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status === 429 ? 'rateLimit' : 'server');
  const catalog = await response.json() as CatalogServicesResponse;
  if (!Array.isArray(catalog?.data?.services) || !Array.isArray(catalog.data.categories)) throw new ApiError('server');
  return catalog.data;
}
