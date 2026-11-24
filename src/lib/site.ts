/** Site origin and page URLs (no framework imports — shared by metadata, JSON-LD, sitemap and the gate). */
import type { Locale } from '../i18n/routing';

/** Explicit canonical origin takes precedence over the domain selected by Vercel. */
const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
const defaultSiteUrl = productionDomain ? `https://${productionDomain}` : 'https://bodymechanic.example';
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || defaultSiteUrl).replace(/\/$/, '');

/** Absolute URL of a page: pageUrl('ru', '/services/sports') → https://…/ru/services/sports/. */
export function pageUrl(locale: Locale, path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return `${SITE_URL}/${locale}/${clean ? `${clean}/` : ''}`;
}
