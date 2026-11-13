'use client';
/** /services list: category chips (?category=massage|rehab, README §13) + service cards (photo, Цена | Длительность, «Демо»). */
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Service } from '@/lib/api/types';
import { useServiceFacts } from '@/components/services/ServiceFacts';
import { Badge } from '@/components/ui/Badge';
import { ServiceCard } from '@/components/ui/Cards';
import { Photo, hasPhoto } from '@/components/ui/Photo';
import { StateCard } from '@/components/ui/Misc';

type Cat = { id: number; slug: string; title: string };
const TONES = ['lav', 'sand', 'sky'] as const;
// R-FINAL-2 (LCP /services): on phones 360px — a 412 px phone at DPR 1.75 (Lighthouse mobile) then takes the 640w file
// (92vw asked for 663 device px → 1280w); DPR 3 iPhones still get 1280w. Only the first card is eager + high (the LCP).
// RC-3 V1 (VP): .card-grid has two columns from 600 px (was 768) → (100vw − 2 gutters − 16) / 2 ≈ 46vw there
const SIZES = '(min-width: 1920px) 460px, (min-width: 1440px) 420px, (min-width: 1024px) 31vw, (min-width: 600px) 46vw, 360px';

function Filtered({ services, categories, slug }: { services: Service[]; categories: Cat[]; slug: string }) {
  const t = useTranslations();
  const facts = useServiceFacts();
  const cat = categories.find((c) => c.slug === slug);
  const list = cat ? services.filter((s) => s.categoryId === cat.id) : services;
  return (
    <>
      <div className="list-bar">
        <nav aria-label={t('services.filter.category')} className="chips">
          <Link className="chip" href="/services" aria-current={!cat ? 'page' : undefined}>{t('services.filter.categoryAll')}</Link>
          {categories.map((c) => <Link key={c.id} className="chip" href={{ pathname: '/services', query: { category: c.slug } }} aria-current={cat?.id === c.id ? 'page' : undefined}>{c.title}</Link>)}
        </nav>
        <p role="status" className="cap tn">{t('services.count', { count: list.length })}</p>
      </div>
      {list.length ? (
        <ul className="card-grid">{list.map((s, i) => (
          <li key={s.id}>
            <ServiceCard href={`/services/${s.slug}`} index={i + 1} title={s.title} description={s.description}
              tone={s.slug === 'thai' ? 'sky' : TONES[i % 3]}
              photo={hasPhoto('services', s.slug) ? <Photo set="services" id={s.slug} alt={`${t('placeholder.illustrativePhoto')}: ${s.title}`} sizes={SIZES} priority={i === 0 ? 'high' : false} /> : undefined}
              photoCaption={t('placeholder.illustrativePhoto')}
              priceLabel={t('services.card.priceLabel')} durationLabel={t('services.card.durationLabel')}
              price={<><span>{facts.priceShort(s)}</span><Badge>{facts.demo}</Badge></>} duration={facts.durationShort(s) ? <span>{facts.durationShort(s)}</span> : undefined}
              linkLabel={t('common.actions.details')} titleAs="h2" />
          </li>))}
        </ul>
      ) : <StateCard text={t('services.empty')} />}
    </>
  );
}

function FromQuery(props: { services: Service[]; categories: Cat[] }) {
  const slug = useSearchParams().get('category') ?? 'all';
  return <Filtered {...props} slug={slug} />;
}

export function ServiceList(props: { services: Service[]; categories: Cat[]; initial?: string }) {
  return props.initial ? <Filtered {...props} slug={props.initial} /> : <FromQuery {...props} />;
}
