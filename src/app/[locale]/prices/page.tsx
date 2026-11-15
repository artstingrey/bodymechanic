import { Suspense } from 'react';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { formatCatalogServicePrice } from '@/lib/catalog-service-price';
import { catalogServiceSlug } from '@/lib/catalog-service-slugs';
import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { getCatalogServices } from '@/server/catalog/services';
import { PageLd } from '@/components/seo/PageLd';
import { HomeCatalogResult } from '@/components/sections/HomeCatalogResult';
import { PageHead } from '@/components/sections/PageHead';
import { StateCard } from '@/components/ui/Misc';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'prices', '/prices');
}

async function PricesCatalog({ locale }: { locale: CatalogLocale }) {
  await connection();
  const t = await getTranslations({ locale });
  const catalog = await getCatalogServices(locale).catch(() => null);
  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  const labels = {
    unknown: () => t('home.services.priceUnknown'),
    from: (price: string) => t('home.services.priceFrom', { price }),
  };
  const groups = (catalog?.data.categories ?? []).map(({ id, title }) => ({
    id, title, services: [] as CatalogService[],
  }));
  const byCategory = new Map(groups.map((group) => [group.id, group.services]));
  const uncategorized: CatalogService[] = [];
  for (const service of catalog?.data.services ?? []) {
    const group = service.categoryId === null ? uncategorized : byCategory.get(service.categoryId) ?? uncategorized;
    group.push(service);
  }

  return (
    <HomeCatalogResult headingId="prices-title" slides={locale} failed={!catalog}
      error={t('prices.error')} retry={t('home.services.retry')} loading={t('prices.loading')}>
      {catalog?.data.services.length === 0 ? <StateCard text={t('home.services.empty')} /> : null}
      {[...groups, { id: 'uncategorized', title: t('prices.uncategorized'), services: uncategorized }]
        .filter(({ services }) => services.length > 0).map(({ id, title, services }) => (
        <section key={id} className="page-sec">
          <h2 className="h3">{title}</h2>
          <div className="table-wrap">
            <table className="price-table">
              <thead>
                <tr>
                  <th scope="col">{t('prices.col.service')}</th>
                  <th scope="col">{t('prices.col.price')}</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <th scope="row">
                      <Link href={`/services/${catalogServiceSlug(service.id)}`}>
                        {homeServiceTitle(locale, service, translations)}
                      </Link>
                    </th>
                    <td className="tn price-table__price">{formatCatalogServicePrice(service, locale, labels)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </HomeCatalogResult>
  );
}

/** /prices (ТЗ §10): price list by category. */
export default async function PricesPage() {
  const locale = await pageLocale();
  const t = await getTranslations({ locale });
  return (
    <div className="container page">
      <PageLd kind="prices" />
      <PageHead up titleId="prices-title" title={t('prices.title')} lead={t('prices.lead')} />
      <Suspense fallback={<div className="home-catalog-state" role="status">{t('prices.loading')}</div>}>
        <PricesCatalog locale={locale} />
      </Suspense>
      <div className="page-cta">
        <p className="cap">{t('prices.note')}</p>
        <Link href="/booking" className="btn btn--primary btn-book">{t('prices.cta')}</Link>
      </div>
    </div>
  );
}
