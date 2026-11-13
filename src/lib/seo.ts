import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { locales, type Locale } from '@/i18n/routing';
import { pageUrl, SITE_URL } from './site';

export { SITE_URL, pageUrl } from './site';

/**
 * Per-page metadata from messages (meta.<key>.title/description/og*), hreflang ru/en/x-default, canonical.
 * The prototype is closed for indexing (DEL-13): noindex, nofollow on every page.
 */
export async function pageMetadata(locale: Locale, key: string, path: string, values: Record<string, string> = {}, opts: { ogFromDescription?: boolean } = {}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'meta' });
  const url = (l: Locale) => pageUrl(l, path);
  return {
    title: t(`${key}.title`, values),
    description: t(`${key}.description`, values),
    robots: { index: false, follow: false },
    alternates: {
      canonical: url(locale),
      languages: { ...Object.fromEntries(locales.map((l) => [l, url(l)])), 'x-default': url('en') },
    },
    openGraph: { title: t(`${key}.ogTitle`, values), description: opts.ogFromDescription ? t(`${key}.description`, values) : t(`${key}.ogDescription`, values), url: url(locale), locale: locale === 'ru' ? 'ru_RU' : 'en_US', type: 'website',
      // brand kit OG template per language (public/og, synced from design/brand-kit/og)
      images: [{ url: `${SITE_URL}/og/og-template-${locale}.png`, width: 1200, height: 630, alt: t(`${key}.ogTitle`, values) }] },
    twitter: { card: 'summary_large_image', images: [`${SITE_URL}/og/og-template-${locale}.png`] },
  };
}

/**
 * Metadata of the account pages (RC-9, security review S-2, lib/analytics/private): the same as a public page plus
 * <meta name="referrer" content="no-referrer"> — the address of a record link (/account/record/{id}/{hash}/) must not travel
 * as the referrer to the next document (the language switch there is a full page load) or to another site.
 */
export async function privateMetadata(locale: Locale, key: string, path: string): Promise<Metadata> {
  return { ...(await pageMetadata(locale, key, path)), referrer: 'no-referrer' };
}
