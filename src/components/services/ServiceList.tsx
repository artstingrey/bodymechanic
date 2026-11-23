import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { CatalogLocale, CatalogServicesResponse } from '@/lib/contracts/catalog';
import { CatalogServiceCard } from '@/components/services/CatalogServiceCard';
import { StateCard } from '@/components/ui/Misc';

type Props = CatalogServicesResponse['data'] & { locale: CatalogLocale; category?: string | string[] };

export async function ServiceList({ services, categories, locale, category }: Props) {
  const t = await getTranslations({ locale });
  const selected = categories.find(({ id }) => String(id) === category);
  const list = selected ? services.filter(({ categoryId }) => categoryId === selected.id) : services;

  return (
    <>
      <div className="list-bar">
        <nav aria-label={t('services.filter.category')} className="chips">
          <Link className="chip" href="/services" aria-current={!selected ? 'page' : undefined}>{t('services.filter.categoryAll')}</Link>
          {categories.map(({ id, title }) => (
            <Link key={id} className="chip" href={{ pathname: '/services', query: { category: id } }}
              aria-current={selected?.id === id ? 'page' : undefined}>{title}</Link>
          ))}
        </nav>
        <p role="status" className="cap tn">{t('services.count', { count: list.length })}</p>
      </div>
      {list.length ? (
        <ul className="card-grid">
          {list.map((service, i) => (
            <li key={service.id}>
              <CatalogServiceCard service={service} locale={locale} t={t} index={i + 1}
                linkLabel={t('common.actions.details')} titleAs="h2" />
            </li>
          ))}
        </ul>
      ) : <StateCard text={t(selected ? 'services.empty' : 'home.services.empty')} />}
    </>
  );
}
