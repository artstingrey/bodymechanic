import { ApiError } from '@/lib/api/errors';
import { SERVICES, STAFF } from '@/lib/api/mock-data';
import type { CatalogLocale, CatalogServicesResponse } from '@/lib/contracts/catalog';

const legacyServiceKeys = new Map(SERVICES.map(({ id, key }) => [id, key]));
const legacyStaffIds = new Set(STAFF.map(({ id }) => id));
const sportsMassageId = 13982355;
const classicMassageId = 13982356;
const massageExtras = [13982351, 13688504]; // Ice bath after massage, home massage.
const zoneRecommendations = new Map<string, readonly number[]>([
  ['sports', [sportsMassageId, ...massageExtras]],
  ['classic', [classicMassageId, ...massageExtras]],
  ['lfkKinesio', [13983057]],
  ['manual', [13983060]],
  ['orthoRehab', [13983065]],
  ['mfrPir', [13983067]],
]);

const legacyPresets = new Map([['sports', sportsMassageId], ['classic', classicMassageId]]);

export function catalogRecommendationIds(legacyId: number): readonly number[] {
  const key = legacyServiceKeys.get(legacyId);
  return key === undefined ? [] : zoneRecommendations.get(key) ?? [];
}

export function restoreServiceId(id: number | null): number | null {
  if (id == null || !Number.isSafeInteger(id) || id <= 0) return null;
  const key = legacyServiceKeys.get(id);
  return key === undefined ? id : legacyPresets.get(key) ?? null;
}

export function isLegacyStaffId(id: number) {
  return legacyStaffIds.has(id);
}

export async function getBookingCatalog(locale: CatalogLocale, signal: AbortSignal, staffId?: number) {
  const query = new URLSearchParams({ locale });
  if (staffId) query.set('staffId', String(staffId));
  const response = await fetch(`/api/catalog/services?${query}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status === 429 ? 'rateLimit' : 'server');
  const catalog = await response.json() as CatalogServicesResponse;
  if (!Array.isArray(catalog?.data?.services) || !Array.isArray(catalog.data.categories) ||
    (staffId !== undefined && catalog.meta?.staffId !== staffId)) throw new ApiError('server');
  return catalog.data;
}
