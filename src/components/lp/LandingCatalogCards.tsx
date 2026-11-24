import type { getTranslations } from 'next-intl/server';
import { CatalogServiceCard } from '@/components/services/CatalogServiceCard';
import { Carousel } from '@/components/ui/Carousel';
import type { CatalogLocale, CatalogServicesResponse } from '@/lib/contracts/catalog';

const SERVICE_IDS = [13982355, 13982356, 13982353, 13982363, 13983057];

export async function LandingCatalogCards({ catalog, locale, percent, t }: {
  catalog: Promise<CatalogServicesResponse | null>;
  locale: CatalogLocale;
  percent: number;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const result = await catalog;
  if (!result) return <p className="sub" role="status">{t('home.services.errorLoad')}</p>;

  const byId = new Map(result.data.services.map((service) => [service.id, service]));
  const services = SERVICE_IDS.map((id) => byId.get(id)).filter((service) => service !== undefined);
  if (!services.length) return <p className="sub" role="status">{t('home.services.empty')}</p>;

  return (
    <Carousel label={t('lp.services.title')} hideCount t={{
      label: t('a11y.carousel.label'), prev: t('a11y.carousel.prev'), next: t('a11y.carousel.next'),
      goTo: t.raw('a11y.carousel.goTo') as string, position: t.raw('a11y.carousel.position') as string,
    }}>
      {services.map((service, i) => (
        <CatalogServiceCard key={service.id} service={service} locale={locale} t={t} index={i + 1} discountPercent={percent} />
      ))}
    </Carousel>
  );
}
