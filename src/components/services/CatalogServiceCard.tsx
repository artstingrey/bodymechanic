import type { getTranslations } from 'next-intl/server';
import { homeServiceDescription, homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { formatCatalogServicePrice } from '@/lib/catalog-service-price';
import { catalogServiceSlug } from '@/lib/catalog-service-slugs';
import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';
import { ServiceCard } from '@/components/ui/Cards';
import { CatalogServicePhoto } from './CatalogServicePhoto';

const TONES = ['lav', 'sand', 'sky'] as const;

export function CatalogServiceCard({ service, locale, t, index, titleAs, linkLabel }: {
  service: CatalogService;
  locale: CatalogLocale;
  t: Awaited<ReturnType<typeof getTranslations>>;
  index: number;
  titleAs?: 'h2' | 'h3';
  linkLabel: string;
}) {
  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  const title = homeServiceTitle(locale, service, translations);
  const description = homeServiceDescription(locale, service, translations);

  return (
    <ServiceCard href={`/services/${catalogServiceSlug(service.id)}`} linkLabel={linkLabel} index={index} title={title} titleAs={titleAs}
      description={description ?? undefined} tone={TONES[(index - 1) % TONES.length]}
      photo={<CatalogServicePhoto service={service} title={title} t={t} />}
      priceLabel={t('services.card.priceLabel')} durationLabel={t('services.card.durationLabel')}
      price={formatCatalogServicePrice(service, locale, {
        unknown: () => t('home.services.priceUnknown'), from: (price) => t('home.services.priceFrom', { price }),
      })}
      duration={service.durationMin === null ? undefined : t('home.services.duration', { minutes: service.durationMin })} />
  );
}
