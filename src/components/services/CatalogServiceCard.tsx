import type { getTranslations } from 'next-intl/server';
import { homeServiceDescription, homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { formatCatalogServiceDiscount, formatCatalogServicePrice } from '@/lib/catalog-service-price';
import { catalogServiceSlug } from '@/lib/catalog-service-slugs';
import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';
import { ServiceCard } from '@/components/ui/Cards';
import { CatalogServicePhoto } from './CatalogServicePhoto';

const TONES = ['lav', 'sand', 'sky'] as const;

export function CatalogServiceCard({ service, locale, t, index, titleAs, linkLabel, discountPercent, photoSizes }: {
  service: CatalogService;
  locale: CatalogLocale;
  t: Awaited<ReturnType<typeof getTranslations>>;
  index: number;
  titleAs?: 'h2' | 'h3';
  linkLabel?: string;
  discountPercent?: number;
  photoSizes?: string;
}) {
  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  const title = homeServiceTitle(locale, service, translations);
  const description = homeServiceDescription(locale, service, translations);
  const labels = {
    unknown: () => t('home.services.priceUnknown'),
    from: (price: string) => t('home.services.priceFrom', { price }),
  };
  const discount = discountPercent === undefined ? null : formatCatalogServiceDiscount(service, discountPercent, locale, labels);
  const price = discount
    ? <span className="price-row"><span className="price">{discount.sale}</span> <s>{discount.original}</s></span>
    : formatCatalogServicePrice(service, locale, labels);
  const link = linkLabel === undefined ? {} : { href: `/services/${catalogServiceSlug(service.id)}`, linkLabel };

  return (
    <ServiceCard {...link} serviceId={service.id} index={index} title={title} titleAs={titleAs}
      description={description ?? undefined} tone={TONES[(index - 1) % TONES.length]}
      photo={<CatalogServicePhoto serviceId={service.id} title={title} t={t} sizes={photoSizes} />}
      priceLabel={t('services.card.priceLabel')} durationLabel={t('services.card.durationLabel')}
      price={price}
      duration={service.durationMin === null ? undefined : t('home.services.duration', { minutes: service.durationMin })} />
  );
}
