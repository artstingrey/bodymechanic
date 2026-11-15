import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { catalogServiceSlug } from '@/lib/catalog-service-slugs';
import type { CatalogServicesResponse } from '@/lib/contracts/catalog';
import { ServiceCard } from '@/components/ui/Cards';
import { StateCard } from '@/components/ui/Misc';

const TONES = ['lav', 'sand', 'sky'] as const;

type Props = CatalogServicesResponse['data'] & { category?: string | string[] };

export async function ServiceList({ services, categories, category }: Props) {
  const t = await getTranslations();
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
          {list.map(({ id, title, description }, i) => (
            <li key={id}>
              <ServiceCard href={`/services/${catalogServiceSlug(id)}`} index={i + 1} title={title}
                description={description ?? undefined} tone={TONES[i % TONES.length]}
                linkLabel={t('common.actions.details')} titleAs="h2" />
            </li>
          ))}
        </ul>
      ) : <StateCard text={t(selected ? 'services.empty' : 'home.services.empty')} />}
    </>
  );
}
