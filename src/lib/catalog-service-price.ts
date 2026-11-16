import type { CatalogLocale, CatalogService } from './contracts/catalog';

type PriceLabels = { unknown: () => string; from: (price: string) => string };

export function formatCatalogServicePrice(
  { priceMin, priceMax, currency }: Pick<CatalogService, 'priceMin' | 'priceMax' | 'currency'>,
  locale: CatalogLocale,
  labels: PriceLabels,
) {
  if (priceMin === null || currency === null) return labels.unknown();
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 0 });
  if (priceMax === null) return labels.from(format.format(priceMin));
  return priceMin === priceMax ? format.format(priceMin) : format.formatRange(priceMin, priceMax);
}

export function formatCatalogServiceDiscount(service: CatalogService, percent: number, locale: CatalogLocale, labels: PriceLabels) {
  const { priceMin, priceMax, currency } = service;
  if (priceMin === null || currency === null) return null;
  const factor = (100 - percent) / 100;
  return {
    original: formatCatalogServicePrice(service, locale, labels),
    sale: formatCatalogServicePrice({
      priceMin: priceMin * factor,
      priceMax: priceMax === null ? null : priceMax * factor,
      currency,
    }, locale, labels),
  };
}
