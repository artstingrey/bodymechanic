import { connection } from 'next/server';
import type { getTranslations } from 'next-intl/server';
import { CatalogServicePhoto } from '@/components/services/CatalogServicePhoto';
import { Carousel } from '@/components/ui/Carousel';
import { homeServiceDescription, homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { formatCatalogServiceDiscount } from '@/lib/catalog-service-price';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogServices } from '@/server/catalog/services';

const SERVICE_IDS = [13982355, 13982356, 13982353, 13982363, 13983057];
const PHOTO_SIZES = '(min-width: 1920px) 420px, (min-width: 1440px) 400px, (min-width: 1024px) 30vw, (min-width: 768px) 45vw, 76vw';

export async function LandingCatalogCards({ locale, percent, t }: {
  locale: CatalogLocale;
  percent: number;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  await connection();
  const catalog = await getCatalogServices(locale).catch(() => null);
  if (!catalog) return <p className="sub" role="status">{t('home.services.errorLoad')}</p>;

  const byId = new Map(catalog.data.services.map((service) => [service.id, service]));
  const services = SERVICE_IDS.map((id) => byId.get(id)).filter((service) => service !== undefined);
  if (!services.length) return <p className="sub" role="status">{t('home.services.empty')}</p>;

  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  const labels = {
    unknown: () => t('home.services.priceUnknown'),
    from: (price: string) => t('home.services.priceFrom', { price }),
  };

  return (
    <Carousel label={t('lp.services.title')} hideCount t={{
      label: t('a11y.carousel.label'), prev: t('a11y.carousel.prev'), next: t('a11y.carousel.next'),
      goTo: t.raw('a11y.carousel.goTo') as string, position: t.raw('a11y.carousel.position') as string,
    }}>
      {services.map((service, i) => {
        const title = homeServiceTitle(locale, service, translations);
        const description = homeServiceDescription(locale, service, translations);
        const price = formatCatalogServiceDiscount(service, percent, locale, labels);
        return (
          <article key={service.id} className="lp-card" data-service-id={service.id}>
            <div className="ph">
              <CatalogServicePhoto service={service} title={title} sizes={PHOTO_SIZES} t={t} />
            </div>
            <div className="bd">
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              {description ? <p>{description}</p> : null}
              <dl>
                <div>
                  <dt>{t('services.card.priceLabel')}</dt>
                  <dd>
                    {price ? <span className="price-row"><span className="price">{price.sale}</span> <s>{price.original}</s></span> : labels.unknown()}
                  </dd>
                </div>
                {service.durationMin !== null ? (
                  <div><dt>{t('services.card.durationLabel')}</dt><dd>{t('home.services.duration', { minutes: service.durationMin })}</dd></div>
                ) : null}
              </dl>
            </div>
          </article>
        );
      })}
    </Carousel>
  );
}
