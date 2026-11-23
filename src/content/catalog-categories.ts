import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import en from '../../messages/en.json';
import ru from '../../messages/ru.json';

export const catalogCategoryIds = {
  onlineBooking: 13989203,
  offsiteServices: 13989204,
} as const;

export const catalogCategoryTitles: ReadonlyMap<number, Record<CatalogLocale, string>> = new Map([
  [catalogCategoryIds.offsiteServices, { ru: ru.nav.main.offsiteServices, en: en.nav.main.offsiteServices }],
]);
