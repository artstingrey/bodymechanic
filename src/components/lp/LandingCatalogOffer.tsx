import { randomInt } from 'node:crypto';
import type { getTranslations } from 'next-intl/server';
import { homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { formatCatalogServiceDiscount } from '@/lib/catalog-service-price';
import type { CatalogLocale, CatalogServicesResponse } from '@/lib/contracts/catalog';

export function chooseLandingOffer(catalog: CatalogServicesResponse | null, locale: CatalogLocale, percent: number,
  t: Awaited<ReturnType<typeof getTranslations>>, fallback: string) {
  const eligible = catalog?.data.services.filter(({ priceMin, currency }) => priceMin !== null && currency !== null);
  if (!eligible?.length) return fallback;

  const service = eligible[randomInt(eligible.length)];
  const price = formatCatalogServiceDiscount(service, percent, locale, {
    unknown: () => t('home.services.priceUnknown'),
    from: (amount) => t('home.services.priceFrom', { price: amount }),
  });
  if (!price) return fallback;

  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  return t('lp.offer.catalogBody', {
    service: homeServiceTitle(locale, service, translations), salePrice: price.sale, price: price.original,
  });
}

export async function LandingCatalogOffer({ text }: { text: Promise<string> }) {
  return await text;
}
