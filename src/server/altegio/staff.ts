import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { altegioGet, bookingLanguages } from './client';
import { bookingServiceParams } from './services';

export function fetchBookStaff(locationId: number, locale: CatalogLocale, serviceId?: number): Promise<unknown> {
  const query = serviceId === undefined ? '' : `?${bookingServiceParams([serviceId])}`;
  return altegioGet('book_staff', `book_staff/${locationId}${query}`, bookingLanguages[locale]);
}
