import { cache } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { getArticles, getServices, getStaff, serviceSlugs } from '@/lib/api';
import { catalogServiceId } from '@/lib/catalog-service-slugs';
import { formatCatalogServicePrice } from '@/lib/catalog-service-price';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogServiceDetail } from '@/server/catalog/service-detail';
import { PageHead } from '@/components/sections/PageHead';
import { CatalogServicePhoto } from '@/components/services/CatalogServicePhoto';
import { BookingLink } from '@/components/booking/BookingLink';
import { StaffCard } from '@/components/ui/Cards';
import { Photo, hasPhoto } from '@/components/ui/Photo';
import { serviceFacts } from '@/components/services/ServiceFacts';
import { ServiceStaff } from '@/components/services/ServiceStaff';
import { isTodo } from '@/components/ui/Todo';

const demoSlugs = new Set(serviceSlugs());
const PHOTO_SIZES = '(min-width: 1200px) 400px, (min-width: 1024px) 40vw, (min-width: 600px) 92vw, 360px';

const resolveService = cache(async (locale: CatalogLocale, slug: string) => {
  if (catalogServiceId(slug) === undefined) {
    if (!demoSlugs.has(slug)) return null;
    const service = (await getServices(locale)).find((entry) => entry.slug === slug);
    return service ? { source: 'demo', service } as const : null;
  }

  await connection();
  const catalog = await getCatalogServiceDetail(slug, locale).catch(() => undefined);
  if (catalog === undefined) return { source: 'unavailable' } as const;
  if (!catalog) return null;

  const { data: { service, category } } = catalog;
  const t = await getTranslations({ locale });
  const translations = t.raw('home.services.cards') as Record<string, { title: string; description: string } | undefined>;
  const translation = translations[service.id];
  return {
    source: 'altegio',
    service: {
      ...service,
      title: (locale === 'ru' && service.title) || translation?.title || service.title,
      description: (locale === 'en' ? translation?.description ?? service.description : service.description ?? translation?.description) ?? null,
      categoryTitle: category?.title ?? null,
    },
  } as const;
});

export async function generateMetadata({ params }: PageProps<'/[locale]/services/[slug]'>) {
  const { slug } = await params;
  const locale = await pageLocale();
  const detail = await resolveService(locale, slug);
  if (!detail) return {};
  const path = `/services/${slug}`;
  if (detail.source === 'unavailable') {
    const t = await getTranslations({ locale });
    return pageMetadata(locale, 'catalogService', path, { service: t('service.unavailableTitle') }, {
      description: t('service.unavailable'), ogFromDescription: true,
    });
  }
  const { service: s } = detail;
  if (detail.source === 'altegio') {
    return pageMetadata(locale, 'catalogService', path, { service: s.title }, {
      description: s.description ?? undefined, ogFromDescription: true,
    });
  }
  return pageMetadata(locale, 'service', path, {
    service: s.title, priceMin: String(s.priceMin ?? ''), durationMin: String(s.durationMin ?? ''),
  }, { ogFromDescription: s.priceMin == null || s.durationMin == null });
}

const SECTIONS = ['forWhom', 'indications', 'session', 'options', 'contra', 'specialists', 'faq', 'related'] as const;
const SPECIALISTS_HEADING = 'service-specialists-title';

export default async function ServicePage({ params }: PageProps<'/[locale]/services/[slug]'>) {
  const { slug } = await params;
  const locale = await pageLocale();
  const t = await getTranslations();
  // Resolve existence before rendering any content or a Suspense fallback.
  const detail = await resolveService(locale, slug);
  if (!detail) notFound();
  if (detail.source === 'unavailable') {
    const title = t('service.unavailableTitle');
    return (
      <article className="container page">
        <PageHead crumbs={[{ href: '/services', label: t('services.title') }, { label: title }]} title={title} up />
        <p className="lead" role="alert">{t('service.unavailable')}</p>
        <a href={`/${locale}/services/${slug}/`} className="btn btn--secondary">{t('home.services.retry')}</a>
      </article>
    );
  }
  const { service: s } = detail;
  const facts = serviceFacts(t as unknown as Parameters<typeof serviceFacts>[0]);
  const articles = getArticles(locale).slice(0, 2);
  const staff = detail.source === 'demo' ? await getStaff(locale, s.id) : null;
  
  const staffList = staff?.length ? (
    <ul className="card-grid card-grid--4">{staff.map((p) => (
      <li key={p.id}><StaffCard name={p.name} href={`/team/${p.slug}`} photoCaption={t('placeholder.specialistPhoto')} /></li>
    ))}</ul>
  ) : null;
  const body = t('service.todo.body');
  const placeholder = isTodo(body) ? null : <p>{body}</p>;
  const price = detail.source === 'altegio' ? formatCatalogServicePrice(detail.service, locale, {
    unknown: () => t('home.services.priceUnknown'), from: (price) => t('home.services.priceFrom', { price }),
  }) : facts.priceShort(detail.service);
  const duration = detail.source === 'altegio'
    ? s.durationMin === null ? '' : t('home.services.duration', { minutes: s.durationMin })
    : facts.durationShort(detail.service);
  return (
    <article className="container page">
      <PageLd kind="service" detail={detail} />
      {/* R-FINAL-2 D-03 (lead, option A): below 1024 the text comes first — head, price, «Записаться», then the description and
          the photo, so H1 and the button are in the first screen on the whole device matrix. ≥ 1024 looks as before (pages.css
          puts the description back above the price). The photo is below the first screen on phones: lazy, no priority. */}
      <div className="svc-hero">
        <div className="svc-hero__photo">
          {detail.source === 'altegio'
            ? <CatalogServicePhoto serviceId={s.id} title={s.title} t={t} detail />
            : hasPhoto('services', s.slug)
              ? <Photo set="services" id={s.slug} alt={s.title} sizes={PHOTO_SIZES} priority="high" /> : null}
        </div>
        <div className="svc-hero__text">
          <PageHead crumbs={[{ href: '/services', label: t('services.title') }, { label: s.title }]} eyebrow={s.categoryTitle} title={s.title} up />
          <dl className="facts">
            <div><dt>{t('services.card.priceLabel')}</dt><dd className="tn">{price}</dd></div>
            {detail.source === 'altegio' || duration ? <div><dt>{t('services.card.durationLabel')}</dt><dd className="tn">{duration}</dd></div> : null}
          </dl>
          <BookingLink preset={{ service: s.id }} className="btn btn--primary btn-book">{t('service.cta')}</BookingLink>
          {s.description ? <p className="lead hero-lead">{s.description}</p> : null}
        </div>
      </div>
      <div className="doc-sections">
        {SECTIONS.filter((k) => k === 'specialists' || (k === 'related' && articles.length) || placeholder).map((k) => (
          <section key={k} className={k === 'specialists' || k === 'related' ? 'doc-sections__wide' : undefined}
            hidden={k !== 'specialists'} aria-labelledby={k === 'specialists' ? SPECIALISTS_HEADING : undefined}>
            <h2 className="h3" id={k === 'specialists' ? SPECIALISTS_HEADING : undefined} tabIndex={k === 'specialists' ? -1 : undefined}>
              {t(`service.section.${k}`)}
            </h2>
            {k === 'specialists' ? (
              detail.source === 'altegio' ? <ServiceStaff key={s.id} locale={locale} serviceId={s.id} headingId={SPECIALISTS_HEADING} t={t} />
                : staffList ?? placeholder
            )
              : k === 'related' && articles.length ? <ul className="link-list">{articles.map((a) => <li key={a.slug}><Link href={`/journal/${a.slug}`}>{a.title}</Link></li>)}</ul>
              : placeholder}
          </section>
        ))}
      </div>
    </article>
  );
}
