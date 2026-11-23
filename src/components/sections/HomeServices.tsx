import { Suspense } from 'react';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogServices } from '@/server/catalog/services';
import { ButtonLink } from '@/components/ui/Button';
import { Carousel } from '@/components/ui/Carousel';
import { CatalogServiceCard } from '@/components/services/CatalogServiceCard';
import { HomeCatalogResult } from './HomeCatalogResult';

async function HomeServicesCards({ locale, t }: { locale: CatalogLocale; t: Awaited<ReturnType<typeof getTranslations>> }) {
  // Runtime configuration and CRM availability must not decide the build output.
  await connection();
  const catalog = await getCatalogServices(locale).catch(() => null);
  const services = catalog?.data.services;
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
          {services.map((service, i) => (
            <CatalogServiceCard key={service.id} service={service} locale={locale} t={t} index={i + 1}
              linkLabel={t('home.services.cardLink')} />
          ))}
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
          <ButtonLink href="/services" variant="text">{t('home.services.all')}</ButtonLink>
        </div>
        <Suspense fallback={<div className="home-catalog-state" role="status">{t('home.services.loading')}</div>}>
          <HomeServicesCards locale={locale} t={t} />
        </Suspense>
      </div>
    </section>
  );
}
