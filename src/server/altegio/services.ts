import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { altegioGet, bookingLanguages } from './client';

export function bookingServiceParams(serviceIds: readonly number[]) {
  return new URLSearchParams(serviceIds.map((id) => ['service_ids[]', String(id)]));
}

export function fetchBookServices(locationId: number, locale: CatalogLocale, staffId?: number): Promise<unknown> {
  const query = new URLSearchParams({ without_seances: '1' });
  if (staffId !== undefined) query.set('staff_id', String(staffId));
  return altegioGet('book_services', `book_services/${locationId}?${query}`, bookingLanguages[locale]);
}

export function fetchBusinessServices(locationId: number): Promise<unknown> {
  return altegioGet('business_services', `locations/${locationId}/services`, bookingLanguages.en, { business: true });
}
