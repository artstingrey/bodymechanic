import type { getTranslations } from 'next-intl/server';
import { homeServiceIllustrations, homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { formatCatalogServicePrice } from '@/lib/catalog-service-price';
import { catalogServiceSlug } from '@/lib/catalog-service-slugs';
import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';
import { HomeServicePhoto } from '@/components/sections/HomeServicePhoto';
import { ServiceCard } from '@/components/ui/Cards';
import { Photo, hasPhoto } from '@/components/ui/Photo';

const TONES = ['lav', 'sand', 'sky'] as const;

export function CatalogServiceCard({ service, locale, t, index, sizes, titleAs, linkLabel }: {
  service: CatalogService;
  locale: CatalogLocale;
  t: Awaited<ReturnType<typeof getTranslations>>;
  index: number;
  sizes: string;
  titleAs?: 'h2' | 'h3';
  linkLabel: string;
}) {
  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  const title = homeServiceTitle(locale, service, translations);
  const editorialDescription = translations[service.id]?.description;
  const description = locale === 'en'
    ? editorialDescription ?? service.description
    : service.description ?? editorialDescription;
  const illustration = homeServiceIllustrations.get(service.id);
  const localPhoto = illustration && hasPhoto('services', illustration)
    ? <Photo set="services" id={illustration} sizes={sizes} alt={title} />
    : undefined;
  const src = service.imageUrl && new URL(service.imageUrl).hostname.replace(/\.$/, '') !== 'api.alteg.io'
    ? service.imageUrl : null;

  return (
    <ServiceCard href={`/services/${catalogServiceSlug(service.id)}`} linkLabel={linkLabel} index={index} title={title} titleAs={titleAs}
      description={description ?? undefined} tone={TONES[(index - 1) % TONES.length]}
      photo={<HomeServicePhoto key={`${src}:${illustration}`} src={src} alt={title} illustration={localPhoto}
        caption={t('placeholder.illustrativePhoto')} unavailable={t('home.services.photoUnavailable')} />}
      priceLabel={t('services.card.priceLabel')} durationLabel={t('services.card.durationLabel')}
      price={formatCatalogServicePrice(service, locale, {
        unknown: () => t('home.services.priceUnknown'), from: (price) => t('home.services.priceFrom', { price }),
      })}
      duration={service.durationMin === null ? undefined : t('home.services.duration', { minutes: service.durationMin })} />
  );
}
