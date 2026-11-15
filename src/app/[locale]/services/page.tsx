import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogServices } from '@/server/catalog/services';
import { PageLd } from '@/components/seo/PageLd';
import { ServiceList } from '@/components/services/ServiceList';
import { PageHead } from '@/components/sections/PageHead';
import { HomeCatalogResult } from '@/components/sections/HomeCatalogResult';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'services', '/services');
}

type SearchParams = PageProps<'/[locale]/services'>['searchParams'];

async function ServicesCatalog({ locale, searchParams }: { locale: CatalogLocale; searchParams: SearchParams }) {
  // Resolve request-time params before reading the catalog so builds never contact CRM.
  const { category } = await searchParams;
  const t = await getTranslations({ locale });
  const catalog = await getCatalogServices(locale).catch(() => null);
  return (
    <HomeCatalogResult headingId="services-title" slides={String(category ?? '')} failed={!catalog}
      error={t('home.services.errorLoad')} retry={t('home.services.retry')} loading={t('home.services.loading')}>
      {catalog ? <ServiceList {...catalog.data} category={category} /> : null}
    </HomeCatalogResult>
  );
}

export default async function ServicesPage({ searchParams }: PageProps<'/[locale]/services'>) {
  const locale = await pageLocale();
  const t = await getTranslations();
  return (
    <div className="container page">
      <PageLd kind="services" />
      <PageHead up titleId="services-title" title={t('services.title')} lead={t('services.lead')} />
      <Suspense fallback={<div className="home-catalog-state" role="status">{t('home.services.loading')}</div>}>
        <ServicesCatalog locale={locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
