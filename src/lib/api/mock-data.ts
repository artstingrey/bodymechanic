/**
 * Prototype mock data. Rules (README «Жёсткие правила» + lead): no invented names, prices, reviews, addresses or phones.
 * Services, categories and prices come from site/copy/mock-data.json (Market Analyst; client's plan: 650 / 750 / 900 AED,
 * exercise therapy and rehab «price on request»), resolved into mock-catalog.json by `npm run sync`.
 * Specialist names and article titles come from the copy deck.
 * Numeric ids emulate Altegio ids of the BFF contract (ТЗ §08); slugs stand in for CMS documents.
 */
import catalog from './mock-catalog.json';
import type { Locale } from './types';

type L10n = Record<Locale, string>;
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const CURRENCY = catalog.currency;
export const DEMO_LABEL: L10n = catalog.demo;

export const CATEGORIES: { id: number; title: L10n; slug: string }[] = catalog.categories.map((c, i) => ({ id: i + 1, title: c.title, slug: c.key }));

export const SERVICES = catalog.services.map((s, i) => ({
  id: 101 + i,
  key: s.key,
  title: s.title as L10n,
  description: s.description as L10n,
  categoryId: CATEGORIES.find((c) => c.slug === s.categoryKey)!.id,
  priceMin: s.priceMin as number | null,
  priceMax: null as number | null,
  priceOnRequest: s.priceOnRequest,
  durationMin: s.durationMin as number | null,
  slug: kebab(s.key),
  hasCms: i === 0, // PG-04: the first service = full CMS page, the others = «only Altegio data»
}));
const sid = (key: string) => SERVICES.find((s) => s.key === key)!.id;

export const STAFF = [1, 2, 3, 4].map((i) => ({
  id: 200 + i,
  // «Специалист студии 1…4»: the number only tells the demo cards apart (no names — lead's rule)
  name: { ru: `${catalog.specialist.ru} ${i}`, en: `${catalog.specialist.en} ${i}` } as L10n,
  position: DEMO_LABEL,
  avatarUrl: null as string | null,
  rating: null as number | null,
  slug: `specialist-${i}`,
  serviceIds: SERVICES.filter((_, k) => (k + i) % 2 === 0 || k === 0).map((s) => s.id),
}));

const nth = (tpl: L10n, n: number): L10n => ({ ru: tpl.ru.replace('{n}', String(n)), en: tpl.en.replace('{n}', String(n)) });
export const ARTICLES = [1, 2, 3].map((i) => ({
  slug: `demo-article-${i}`,
  title: nth(catalog.articleTitle, i),
  category: DEMO_LABEL,
  excerpt: catalog.articleTodo as L10n, // journal.todo.articles
}));

/** zone → service rules (ТЗ 6.6). Demo mapping only — real rules are a TODO(content) in CMS (body3d.todo.zoneRules). */
const R = (...keys: string[]) => keys.map(sid);
export const ZONE_RULES: Record<string, number[]> = {
  neck_collar: R('sports', 'manual'), shoulder_girdle: R('sports', 'mfrPir'), chest: R('classic'), abdomen: R('classic'),
  thoracic_spine: R('manual', 'sports'), lumbar: R('lfkKinesio', 'manual', 'sports'), gluteal: R('sports', 'mfrPir'),
  hip_joint: R('lfkKinesio', 'orthoRehab'), quadriceps: R('sports', 'lfkKinesio'), hamstrings: R('sports', 'mfrPir'),
  knee: R('lfkKinesio', 'orthoRehab'), calves: R('sports', 'mfrPir'), ankle: R('lfkKinesio', 'orthoRehab'), foot: R('sports'),
  shoulder_joint: R('lfkKinesio', 'orthoRehab'), elbow_forearm: R('mfrPir'), hand: R('classic'),
  shin: R('sports', 'lfkKinesio'), // zone since 2026-11-06 (runners)
};

export const DEMO_RECORD = { id: 9001, hash: 'demo-hash' };
