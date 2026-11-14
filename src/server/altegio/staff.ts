import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { altegioGet, bookingLanguages } from './client';

export function fetchBookStaff(locationId: number, locale: CatalogLocale): Promise<unknown> {
  return altegioGet('book_staff', `book_staff/${locationId}`, bookingLanguages[locale]);
}
