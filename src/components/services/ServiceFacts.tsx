/**
 * Price · duration · «Демо» of a service — one implementation for cards, the price list, the booking and the 3D side panel.
 * Works in server and client components (next-intl useTranslations). Rules of site/copy/mock-data.json:
 *  - priceOnRequest → «Цена — по запросу» (mock.price.onRequest); otherwise «от {price} AED» (priceMin; range if priceMax);
 *  - durationMin null → not shown; 100 → «до 1 ч 40 мин» (the client's plan gives only this upper bound, mock.duration.upTo);
 *  - prices are always shown next to the «Демо» badge (prototype.demoBadge).
 */
import { useTranslations } from 'next-intl';

export type Facts = { priceMin: number | null; priceMax: number | null; priceOnRequest: boolean; durationMin: number | null };

type T = ((key: string, values?: Record<string, string | number>) => string) & { has?: (key: string) => boolean };

/** Pure formatter — for async server components pass `await getTranslations()`; elsewhere use useServiceFacts(). */
export function serviceFacts(t: T) {
  const price = (s: Facts) =>
    s.priceOnRequest ? t('mock.price.onRequest')
    : s.priceMin == null ? null
    : s.priceMax != null && s.priceMax !== s.priceMin ? t('common.priceRange', { min: s.priceMin, max: s.priceMax })
    : t('common.priceFrom', { price: s.priceMin });
  const duration = (s: Facts) =>
    s.durationMin == null ? null
    : s.durationMin === 100 ? t('mock.duration.upTo')
    : s.durationMin >= 60 ? t('common.durationHours', { hours: Math.floor(s.durationMin / 60), minutes: s.durationMin % 60 })
    : t('common.duration', { minutes: s.durationMin });
  /** under a «Цена» label (cards, the service page, the price list): «по запросу», not «Цена — по запросу» (design audit F17) */
  const priceShort = (s: Facts) => (s.priceOnRequest ? t('mock.price.onRequestShort') : price(s));
  /** F17 (BD; MA: the client's plan has neither price nor duration for these services): the «Цена | Длительность» pair always
   *  has two columns — under labels (cards, the service page) the duration cell repeats the short «по запросу»; in the price list
   *  it takes mock.duration.onRequest «По запросу» (comes with the RC-3 deck; until then the cell stays empty) */
  const durationShort = (s: Facts) => (s.durationMin == null && s.priceOnRequest ? t('mock.price.onRequestShort') : duration(s));
  const durationList = (s: Facts) => (s.durationMin == null && s.priceOnRequest && t.has?.('mock.duration.onRequest') ? t('mock.duration.onRequest') : duration(s));
  return { price, priceShort, duration, durationShort, durationList, demo: t('prototype.demoBadge') };
}
export const useServiceFacts = () => serviceFacts(useTranslations() as unknown as T);

/** «{category} · {price} · {duration} [Демо]» — empty parts are skipped. */
export function ServiceFacts({ s, category }: { s: Facts; category?: string }) {
  const f = useServiceFacts();
  const parts = [category, f.price(s), f.duration(s)].filter(Boolean);
  return <>{parts.join(' · ')} <span className="demo-badge">{f.demo}</span></>;
}
