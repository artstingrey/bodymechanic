import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { altegioGet } from './client';

const bookingLanguages = { ru: 'ru-RU', en: 'en-US' } satisfies Record<CatalogLocale, string>;

export function fetchBookServices(locationId: number, locale: CatalogLocale): Promise<unknown> {
  return altegioGet('book_services', `book_services/${locationId}?without_seances=1`, bookingLanguages[locale]);
}
