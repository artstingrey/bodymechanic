import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { getArticles, getServices, getStaff, serviceSlugs } from '@/lib/api';
import { PageHead } from '@/components/sections/PageHead';
import { BookingLink } from '@/components/booking/BookingLink';
import { Badge } from '@/components/ui/Badge';
import { StaffCard } from '@/components/ui/Cards';
import { Photo, hasPhoto } from '@/components/ui/Photo';
import { serviceFacts } from '@/components/services/ServiceFacts';
import { Todo } from '@/components/ui/Todo';

export const dynamicParams = false;
export function generateStaticParams() {
  return serviceSlugs().map((slug) => ({ slug }));
}

async function find(slug: string) {
  return (await getServices(await pageLocale())).find((s) => s.slug === slug);
}

export async function generateMetadata({ params }: PageProps<'/[locale]/services/[slug]'>) {
  const { slug } = await params;
  const s = await find(slug);
  // «From {priceMin} AED, {durationMin} min» only when both are known; «price on request» services fall back to the description.
  return pageMetadata(await pageLocale(), 'service', `/services/${slug}`, { service: s?.title ?? '', priceMin: String(s?.priceMin ?? ''), durationMin: String(s?.durationMin ?? '') }, { ogFromDescription: s?.priceMin == null || s?.durationMin == null });
}

const SECTIONS = ['forWhom', 'indications', 'session', 'options', 'contra', 'specialists', 'faq', 'related'] as const;

/** /services/[slug] (ТЗ §10): CMS description + Altegio price and specialists; PG-04 — service 1 has a CMS doc, others only Altegio data. */
export default async function ServicePage({ params }: PageProps<'/[locale]/services/[slug]'>) {
  const { slug } = await params;
  const locale = await pageLocale();
  const t = await getTranslations();
  const s = await find(slug);
  if (!s) notFound();
  const staff = await getStaff(locale, s.id);
  const facts = serviceFacts(t as unknown as Parameters<typeof serviceFacts>[0]);
  const articles = getArticles(locale).slice(0, 2);
  const staffList = (
    <ul className="card-grid card-grid--4">{staff.map((p) => (
      <li key={p.id}><StaffCard name={p.name} href={`/team/${p.slug}`} photoCaption={t('placeholder.specialistPhoto')} /></li>
    ))}</ul>
  );
  return (
    <article className="container page">
      <PageLd kind="service" slug={slug} />
      {/* R-FINAL-2 D-03 (lead, option A): below 1024 the text comes first — head, price, «Записаться», then the description and
          the photo, so H1 and the button are in the first screen on the whole device matrix. ≥ 1024 looks as before (pages.css
          puts the description back above the price). The photo is below the first screen on phones: lazy, no priority. */}
      <div className="svc-hero">
        <div className="svc-hero__photo">
          {hasPhoto('services', s.slug) ? <>
            {/* the LCP element even with the text first (first screen of a 412×823 phone): eager + high; phones 360px → 640w (R-FINAL-2 perf) */}
            <Photo set="services" id={s.slug} alt={`${t('placeholder.illustrativePhoto')}: ${s.title}`} sizes="(min-width: 1024px) 40vw, (min-width: 600px) 92vw, 360px" priority="high" />
            <p className="photo-cap">{t('placeholder.illustrativePhoto')}</p>
          </> : null}
        </div>
        <div className="svc-hero__text">
          <PageHead crumbs={[{ href: '/services', label: t('services.title') }, { label: s.title }]} eyebrow={s.categoryTitle} title={s.title} up />
          <dl className="facts">
            <div><dt>{t('services.card.priceLabel')}</dt><dd className="tn">{facts.priceShort(s)} <Badge>{facts.demo}</Badge></dd></div>
            {facts.durationShort(s) ? <div><dt>{t('services.card.durationLabel')}</dt><dd className="tn">{facts.durationShort(s)}</dd></div> : null}
          </dl>
          {/* Ж-9: the service is handed over at the click, the address is the bare /booking/ (components/booking/BookingLink) */}
          <BookingLink preset={{ service: s.id }} className="btn btn--primary btn-book">{t('service.cta')}</BookingLink>
          {s.description ? <p className="lead hero-lead">{s.description}</p> : null}
        </div>
      </div>
      {s.hasCms ? (
        <div className="doc-sections">
          {SECTIONS.map((k) => (
            <section key={k} className={k === 'specialists' || k === 'related' ? 'doc-sections__wide' : undefined}>
              <h2 className="h3">{t(`service.section.${k}`)}{k === 'specialists' ? <> <Badge>{t('prototype.demoBadge')}</Badge></> : null}</h2>
              {k === 'specialists' ? staffList
                : k === 'related' ? <ul className="link-list">{articles.map((a) => <li key={a.slug}><Link href={`/journal/${a.slug}`}>{a.title}</Link></li>)}</ul>
                : <Todo as="p">{t('service.todo.body')}</Todo>}
            </section>
          ))}
        </div>
      ) : (
        <section className="page-sec">
          <h2 className="h3">{t('service.section.specialists')} <Badge>{t('prototype.demoBadge')}</Badge></h2>
          {staffList}
        </section>
      )}
    </article>
  );
}
