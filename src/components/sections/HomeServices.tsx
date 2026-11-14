import { Suspense } from 'react';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';
import { getCatalogServices } from '@/server/catalog/services';
import { Carousel } from '@/components/ui/Carousel';
import { ServiceCard } from '@/components/ui/Cards';
import { Photo, hasPhoto } from '@/components/ui/Photo';
import { HomeServicePhoto } from './HomeServicePhoto';
import { HomeCatalogResult } from './HomeCatalogResult';
import { homeServiceIllustrations } from '@/content/home-services';

const CARD_SIZES = '(min-width: 1920px) 420px, (min-width: 1440px) 400px, (min-width: 1024px) 30vw, (min-width: 768px) 45vw, 76vw';
const TONES = ['lav', 'sand', 'sky'] as const;

function servicePrice({ priceMin, priceMax, currency }: CatalogService, locale: CatalogLocale, t: Awaited<ReturnType<typeof getTranslations>>) {
  if (priceMin === null || currency === null) return t('home.services.priceUnknown');
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 0 });
  if (priceMax === null) return t('home.services.priceFrom', { price: format.format(priceMin) });
  return priceMin === priceMax ? format.format(priceMin) : format.formatRange(priceMin, priceMax);
}

async function HomeServicesCards({ locale, t }: { locale: CatalogLocale; t: Awaited<ReturnType<typeof getTranslations>> }) {
  // Runtime configuration and CRM availability must not decide the build output.
  await connection();
  const catalog = await getCatalogServices(locale).catch(() => null);
  const services = catalog?.data.services;
  const translations = t.raw('home.services.cards') as Record<string, { title: string; description: string } | undefined>;
  return (
    <HomeCatalogResult
      headingId="services-title"
      slides={services?.map(({ id }) => id).join(',') ?? ''}
      failed={!catalog}
      error={t('home.services.errorLoad')}
      retry={t('home.services.retry')}
      loading={t('home.services.loading')}
    >
      {services?.length ? (
        <Carousel label={t('home.services.title')} hideCount t={{
          label: t('a11y.carousel.label'), prev: t('a11y.carousel.prev'), next: t('a11y.carousel.next'),
          goTo: t.raw('a11y.carousel.goTo') as string, position: t.raw('a11y.carousel.position') as string,
        }}>
          {services.map((service, i) => {
            const translation = translations[service.id];
            const title = (locale === 'ru' && service.title) || translation?.title || service.title;
            const description = locale === 'en'
              ? translation?.description ?? service.description
              : service.description ?? translation?.description;
            const illustration = homeServiceIllustrations.get(service.id);
            const caption = t('placeholder.illustrativePhoto');
            const localPhoto = illustration && hasPhoto('services', illustration)
              ? <Photo set="services" id={illustration} sizes={CARD_SIZES} alt={title} />
              : undefined;
            const src = service.imageUrl && new URL(service.imageUrl).hostname.replace(/\.$/, '') !== 'api.alteg.io'
              ? service.imageUrl : null;
            return (
              <ServiceCard key={service.id} index={i + 1} title={title}
                description={description ?? undefined} tone={TONES[i % TONES.length]}
                photo={<HomeServicePhoto key={`${src}:${illustration}`} src={src} alt={title}
                  illustration={localPhoto} caption={caption} unavailable={t('home.services.photoUnavailable')} />}
                priceLabel={t('services.card.priceLabel')} durationLabel={t('services.card.durationLabel')}
                price={servicePrice(service, locale, t)}
                duration={service.durationMin === null ? undefined : t('home.services.duration', { minutes: service.durationMin })} />
            );
          })}
        </Carousel>
      ) : services ? <p className="lead" role="status">{t('home.services.empty')}</p> : null}
    </HomeCatalogResult>
  );
}

export async function HomeServices({ locale }: { locale: CatalogLocale }) {
  const t = await getTranslations({ locale });
  return (
    <section className="section home-sec" aria-labelledby="services-title">
      <div className="container">
        <div className="sec-head">
          <div>
            <h2 id="services-title" className="h2" data-split="" tabIndex={-1}>{t('home.services.title')}</h2>
            <p className="lead">{t('home.services.lead')}</p>
          </div>
        </div>
        <Suspense fallback={<div className="home-catalog-state" role="status">{t('home.services.loading')}</div>}>
          <HomeServicesCards locale={locale} t={t} />
        </Suspense>
      </div>
    </section>
  );
}
