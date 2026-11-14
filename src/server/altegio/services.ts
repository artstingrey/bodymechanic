import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { altegioGet, bookingLanguages } from './client';

export function fetchBookServices(locationId: number, locale: CatalogLocale): Promise<unknown> {
  return altegioGet('book_services', `book_services/${locationId}?without_seances=1`, bookingLanguages[locale]);
}
