/**
 * JSON-LD (ТЗ §14): HealthAndBeautyBusiness, Service (price from the BFF — demo prices in the prototype), Person, FAQPage,
 * BreadcrumbList, Article. Pure builders; pages render them with <JsonLd> (components/seo/JsonLd).
 * Rules: no invented facts (empty TODO(content) values are not emitted); the business is never typed as a medical entity
 * (MedicalBusiness / MedicalClinic / Physiotherapy / MedicalOrganization are banned, as are the forbidden words of the deck).
 */
import type { Locale } from '../i18n/routing';
import type { JournalArticle, Service, Staff } from './api/types';
import { STUDIO } from './config';
import { pageUrl, SITE_URL } from './site';

const CTX = 'https://schema.org';
export const BUSINESS_ID = `${SITE_URL}/#business`;
type Node = Record<string, unknown>;

const ogImage = (locale: Locale) => `${SITE_URL}/og/og-template-${locale}.png`;
const dubai = { '@type': 'City', name: STUDIO.locality };

/** Short reference to the studio for provider / worksFor / publisher. */
export const businessRef = (locale: Locale, name: string): Node => ({ '@type': 'HealthAndBeautyBusiness', '@id': BUSINESS_ID, name, url: pageUrl(locale, '/') });

export function businessJsonLd(locale: Locale, p: { name: string; description: string }): Node {
  return {
    '@context': CTX,
    '@type': 'HealthAndBeautyBusiness',
    '@id': BUSINESS_ID,
    name: p.name,
    description: p.description,
    url: pageUrl(locale, '/'),
    logo: `${SITE_URL}/icon-512.png`,
    image: ogImage(locale),
    address: {
      '@type': 'PostalAddress',
      ...(STUDIO.streetAddress ? { streetAddress: STUDIO.streetAddress } : {}), // TODO(content): street address
      addressLocality: STUDIO.locality,
      addressCountry: STUDIO.country,
    },
    ...(STUDIO.telephone ? { telephone: STUDIO.telephone } : {}), // TODO(content): phone
    ...(STUDIO.openingHours.length ? { openingHours: STUDIO.openingHours } : {}), // TODO(content): opening hours
    areaServed: dubai,
    currenciesAccepted: STUDIO.currency,
  };
}

export function serviceJsonLd(locale: Locale, s: Service, brand: string): Node {
  const url = pageUrl(locale, `/services/${s.slug}`);
  const priced = s.priceMin != null && !s.priceOnRequest;
  return {
    '@context': CTX,
    '@type': 'Service',
    '@id': `${url}#service`,
    name: s.title,
    description: s.description,
    serviceType: s.categoryTitle,
    url,
    provider: businessRef(locale, brand),
    areaServed: dubai,
    // «price on request» services get no Offer (no invented price); the prototype prices are the client's plan («Демо»)
    ...(priced ? {
      offers: {
        '@type': 'Offer',
        price: s.priceMin,
        priceCurrency: STUDIO.currency,
        url: `${pageUrl(locale, '/booking')}?service=${s.id}`,
        ...(s.priceMax != null ? { priceSpecification: { '@type': 'PriceSpecification', minPrice: s.priceMin, maxPrice: s.priceMax, priceCurrency: STUDIO.currency } } : {}),
      },
    } : {}),
  };
}

/**
 * DECISION (lead allowed either way): no Person for the demo cards «Специалист студии N» — structured data about a person
 * that does not exist would mislead search engines. The builder is ready for real staff (Altegio + CMS «staff»):
 * `placeholder: false` → Person is emitted.
 */
export function personJsonLd(locale: Locale, s: Staff, brand: string): Node | null {
  if (s.placeholder) return null;
  return {
    '@context': CTX,
    '@type': 'Person',
    name: s.name,
    jobTitle: s.position,
    url: pageUrl(locale, `/team/${s.slug}`),
    ...(s.avatarUrl ? { image: s.avatarUrl.startsWith('http') ? s.avatarUrl : `${SITE_URL}${s.avatarUrl}` } : {}),
    worksFor: businessRef(locale, brand),
  };
}

/** FAQPage: only the visible answer text; the TODO(content) notes of the prototype are not part of an answer. */
export function faqJsonLd(items: { q: string; a: string }[]): Node | null {
  if (!items.length) return null;
  return {
    '@context': CTX,
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({ '@type': 'Question', name: it.q, acceptedAnswer: { '@type': 'Answer', text: it.a } })),
  };
}

/** BreadcrumbList = the visible breadcrumbs «Главная / … / current» (nav.breadcrumbs). */
export function breadcrumbJsonLd(locale: Locale, home: string, crumbs: { name: string; path: string }[]): Node {
  const all = [{ name: home, path: '/' }, ...crumbs];
  return {
    '@context': CTX,
    '@type': 'BreadcrumbList',
    itemListElement: all.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: pageUrl(locale, c.path) })),
  };
}

/** Article: the studio is author and publisher until the CMS gives the author-specialist. TODO(content): datePublished, cover. */
export function articleJsonLd(locale: Locale, a: JournalArticle, brand: string): Node {
  const url = pageUrl(locale, `/journal/${a.slug}`);
  const org = { ...businessRef(locale, brand), logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` } };
  return {
    '@context': CTX,
    '@type': 'Article',
    headline: a.title.slice(0, 110),
    ...(a.excerpt && !a.excerpt.startsWith('TODO(') ? { description: a.excerpt } : {}), // no content placeholder in structured data
    inLanguage: locale,
    url,
    mainEntityOfPage: url,
    image: ogImage(locale),
    author: businessRef(locale, brand),
    publisher: org,
  };
}
