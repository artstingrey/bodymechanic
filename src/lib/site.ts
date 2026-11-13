/** Site origin and page URLs (no framework imports — shared by metadata, JSON-LD, sitemap and the gate). */
import type { Locale } from '../i18n/routing';

/** Site origin for canonical/hreflang. Set NEXT_PUBLIC_SITE_URL on Render; local builds use a placeholder origin. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://bodymechanic.example').replace(/\/$/, '');

/** Absolute URL of a page: pageUrl('ru', '/services/sports') → https://…/ru/services/sports/ (trailingSlash export). */
export function pageUrl(locale: Locale, path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return `${SITE_URL}/${locale}/${clean ? `${clean}/` : ''}`;
}
