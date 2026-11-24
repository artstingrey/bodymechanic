import 'server-only';

import type { CatalogLocale, CatalogStaffMember, CatalogStaffResponse } from '@/lib/contracts/catalog';
import { isRecord } from '../altegio/client';
import { AltegioError } from '../altegio/errors';
import { fetchBookStaff } from '../altegio/staff';
import { getAltegioConfig } from '../config';
import { cachePublicCatalog } from './cache';

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function portraitUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.replace(/\.$/, '');
    if (host === 'api.alteg.io' || (host === 'app.alteg.io' && url.pathname === '/images/no-master.png')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeStaff(data: unknown): CatalogStaffMember[] {
  if (!Array.isArray(data)) throw new AltegioError('invalidResponse');

  const seen = new Set<number>();
  const staff: CatalogStaffMember[] = [];
  for (const member of data as unknown[]) {
    if (!isRecord(member)) throw new AltegioError('invalidResponse');
    const { id } = member;
    const name = optionalText(member.name);
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || !name || seen.has(id)) {
      throw new AltegioError('invalidResponse');
    }
    seen.add(id);
    if (member.hidden === 1 || member.fired === 1) continue;

    staff.push({
      id,
      name,
      specialization: optionalText(member.specialization),
      position: isRecord(member.position) ? optionalText(member.position.title) : null,
      imageUrl: portraitUrl(member.avatar_big) ?? portraitUrl(member.avatar),
    });
  }
  return staff;
}

async function loadStaff(locationId: number, locale: CatalogLocale, serviceId?: number) {
  const data = await fetchBookStaff(locationId, locale, serviceId);
  try {
    return { staff: normalizeStaff(data) };
  } catch (error) {
    console.warn('[altegio]', { operation: 'book_staff', code: 'UPSTREAM_INVALID_RESPONSE' });
    throw error;
  }
}

const getCachedStaff = cachePublicCatalog('book-staff-v1', loadStaff);

export async function getCatalogStaff(locale: CatalogLocale): Promise<CatalogStaffResponse> {
  const { locationId } = getAltegioConfig();
  const data = await getCachedStaff(locationId, locale);
  return { data, meta: { source: 'altegio', locale } };
}

/** The caller resolves the service against the public catalog before asking for its staff. */
export async function getCatalogServiceStaff(locale: CatalogLocale, serviceId: number): Promise<CatalogStaffMember[]> {
  const { locationId } = getAltegioConfig();
  const { staff } = await getCachedStaff(locationId, locale, serviceId);
  return staff;
}

/** Online Booking does not document whether its staff filter matches every selected service. */
export async function getCommonServiceStaff(locale: CatalogLocale, serviceIds: readonly number[]): Promise<CatalogStaffMember[]> {
  if (serviceIds.length === 1) return getCatalogServiceStaff(locale, serviceIds[0]);
  const { locationId } = getAltegioConfig();
  const { staff } = await loadStaff(locationId, locale, serviceIds[0]);
  let common = staff;
  for (const serviceId of serviceIds.slice(1)) {
    if (!common.length) break;
    const { staff } = await loadStaff(locationId, locale, serviceId);
    const ids = new Set(staff.map(({ id }) => id));
    common = common.filter(({ id }) => ids.has(id));
  }
  return common;
}
