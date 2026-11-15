/**
 * JSON-LD of a page (ТЗ §14). All data from the deck and the BFF,
 * so the markup always matches what the page shows. Utility pages (booking, «Мои записи», record links) get none.
 *  home     → HealthAndBeautyBusiness + FAQPage
 *  contacts → HealthAndBeautyBusiness + BreadcrumbList
 *  service  → Service (+ Offer when the price is known) + BreadcrumbList
 *  staff    → Person (real staff only, see personJsonLd) + BreadcrumbList
 *  article  → Article + BreadcrumbList
 *  sections (services, prices, team, journal, privacy, terms) → BreadcrumbList
 */
import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { getArticles } from '@/lib/api';
import type { Service } from '@/lib/api/types';
import { articleJsonLd, breadcrumbJsonLd, businessJsonLd, catalogServiceJsonLd, faqJsonLd, personJsonLd, serviceJsonLd, type PublicServiceLd, type PublicStaffLd } from '@/lib/jsonld';
import { JsonLd } from './JsonLd';

type Section = 'services' | 'prices' | 'team' | 'journal' | 'contacts' | 'privacy' | 'terms';
export type PageLdKind = 'home' | Section | 'service' | 'staff' | 'article';

const SECTION_TITLE: Record<Section, string> = {
  services: 'services.title', prices: 'prices.title', team: 'team.title', journal: 'journal.title', contacts: 'contacts.title',
  privacy: 'docs.privacy.title', terms: 'docs.terms.title',
};

type PageLdProps =
  | { kind: Exclude<PageLdKind, 'service' | 'staff'>; slug?: string }
  | { kind: 'staff'; profile: PublicStaffLd }
  | { kind: 'service'; detail: { source: 'altegio'; service: PublicServiceLd } | { source: 'demo'; service: Service } };

export async function PageLd(props: PageLdProps) {
  const locale = await pageLocale();
  const t = await getTranslations({ locale });
  const brand = t('common.brand');
  const crumbs = (...c: { name: string; path: string }[]) => breadcrumbJsonLd(locale, t('nav.breadcrumbs.home'), c);
  const section = (s: Section) => ({ name: t(SECTION_TITLE[s]), path: `/${s}` });
  const business = () => businessJsonLd(locale, { name: brand, description: t('meta.home.description') });

  switch (props.kind) {
    case 'home': {
      // FAQ = every home.faq.<key> with a question and an answer, in deck order (the TODO(content) notes are not answers)
      const faq = Object.values(t.raw('home.faq') as Record<string, unknown>)
        .filter((v): v is { q: string; a: string } => !!v && typeof v === 'object' && typeof (v as { q?: unknown }).q === 'string' && typeof (v as { a?: unknown }).a === 'string')
        .map(({ q, a }) => ({ q, a }));
      return <JsonLd data={[business(), faqJsonLd(faq)]} />;
    }
    case 'contacts':
      return <JsonLd data={[business(), crumbs(section('contacts'))]} />;
    case 'service': {
      const { detail } = props;
      const s = detail.service;
      const data = detail.source === 'demo' ? serviceJsonLd(locale, detail.service, brand) : catalogServiceJsonLd(locale, s, brand);
      return <JsonLd data={[data, crumbs(section('services'), { name: s.title, path: `/services/${s.slug}` })]} />;
    }
    case 'staff': {
      const s = props.profile;
      return <JsonLd data={[personJsonLd(locale, s, brand), crumbs(section('team'), { name: s.name, path: `/team/${s.slug}` })]} />;
    }
    case 'article': {
      const a = getArticles(locale).find((x) => x.slug === props.slug);
      return a ? <JsonLd data={[articleJsonLd(locale, a, brand), crumbs(section('journal'), { name: a.title, path: `/journal/${a.slug}` })]} /> : null;
    }
    default:
      return <JsonLd data={crumbs(section(props.kind))} />;
  }
}
