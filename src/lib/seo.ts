import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { locales, type Locale } from '@/i18n/routing';
import { pageUrl, SITE_URL } from './site';

export { SITE_URL, pageUrl } from './site';

/**
 * Per-page metadata from messages (meta.<key>.title/description/og*), hreflang ru/en/x-default, canonical.
 */
export async function pageMetadata(locale: Locale, key: string, path: string, values: Record<string, string> = {}, opts: { ogFromDescription?: boolean; description?: string } = {}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'meta' });
  const url = (l: Locale) => pageUrl(l, path);
  const description = opts.description ?? t(`${key}.description`, values);
  return {
    title: t(`${key}.title`, values),
    description,
    alternates: {
      canonical: url(locale),
      languages: { ...Object.fromEntries(locales.map((l) => [l, url(l)])), 'x-default': url('en') },
    },
    openGraph: { title: t(`${key}.ogTitle`, values), description: opts.ogFromDescription ? description : t(`${key}.ogDescription`, values), url: url(locale), locale: locale === 'ru' ? 'ru_RU' : 'en_US', type: 'website',
      // brand kit OG template per language (public/og, synced from design/brand-kit/og)
      images: [{ url: `${SITE_URL}/og/og-template-${locale}.png`, width: 1200, height: 630, alt: t(`${key}.ogTitle`, values) }] },
    twitter: { card: 'summary_large_image', images: [`${SITE_URL}/og/og-template-${locale}.png`] },
  };
}

/**
 * Keep private account pages out of search and suppress the referrer on links from a booking record.
 */
export async function privateMetadata(locale: Locale, key: string, path: string): Promise<Metadata> {
  return { ...(await pageMetadata(locale, key, path)), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}
