import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { altegioGet, bookingLanguages } from './client';

export function fetchBookServices(locationId: number, locale: CatalogLocale, staffId?: number): Promise<unknown> {
  const query = new URLSearchParams({ without_seances: '1' });
  if (staffId !== undefined) query.set('staff_id', String(staffId));
  return altegioGet('book_services', `book_services/${locationId}?${query}`, bookingLanguages[locale]);
}
