import type { CatalogLocale, CatalogService } from './contracts/catalog';

type PriceLabels = { unknown: () => string; from: (price: string) => string };
type CatalogPrice = Pick<CatalogService, 'priceMin' | 'priceMax' | 'currency'>;

export function formatCatalogServicePrice(
  { priceMin, priceMax, currency }: CatalogPrice,
  locale: CatalogLocale,
  labels: PriceLabels,
) {
  if (priceMin === null || currency === null) return labels.unknown();
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 0 });
  if (priceMax === null) return labels.from(format.format(priceMin));
  return priceMin === priceMax ? format.format(priceMin) : format.formatRange(priceMin, priceMax);
}

export function formatCatalogServiceDiscount(service: CatalogService, percent: number, locale: CatalogLocale, labels: PriceLabels) {
  if (service.priceMin === null || service.currency === null) return null;
  return {
    original: formatCatalogServicePrice(service, locale, labels),
    sale: formatCatalogServicePrice(discountedCatalogPrice(service, percent), locale, labels),
  };
}

function discountedCatalogPrice({ priceMin, priceMax, currency }: CatalogPrice, percent: number): CatalogPrice {
  const factor = (100 - percent) / 100;
  return { priceMin: priceMin === null ? null : priceMin * factor, priceMax: priceMax === null ? null : priceMax * factor, currency };
}

export function formatCatalogServiceTotal(services: readonly CatalogPrice[], locale: CatalogLocale, labels: PriceLabels, percent = 0) {
  const currency = services[0]?.currency;
  if (!currency || services.some((service) => service.currency !== currency || service.priceMin === null)) return labels.unknown();
  const scale = 10 ** new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
  let min = 0;
  let max: number | null = 0;
  for (const service of services) {
    const price = discountedCatalogPrice(service, percent);
    min += Math.round(price.priceMin! * scale);
    max = max === null || price.priceMax === null ? null : max + Math.round(price.priceMax * scale);
  }
  return formatCatalogServicePrice({ priceMin: min / scale, priceMax: max === null ? null : max / scale, currency }, locale, labels);
}

export function catalogServiceDuration(services: readonly Pick<CatalogService, 'durationMin'>[], slotSeconds?: number) {
  if (slotSeconds !== undefined) return slotSeconds / 60;
  if (!services.length || services.some(({ durationMin }) => durationMin === null)) return null;
  return services.reduce((sum, { durationMin }) => sum + (durationMin ?? 0), 0);
}
