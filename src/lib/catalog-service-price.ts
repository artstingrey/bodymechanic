import type { CatalogLocale, CatalogService } from './contracts/catalog';

export function formatCatalogServicePrice(
  { priceMin, priceMax, currency }: CatalogService,
  locale: CatalogLocale,
  labels: { unknown: () => string; from: (price: string) => string },
) {
  if (priceMin === null || currency === null) return labels.unknown();
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 0 });
  if (priceMax === null) return labels.from(format.format(priceMin));
  return priceMin === priceMax ? format.format(priceMin) : format.formatRange(priceMin, priceMax);
}
