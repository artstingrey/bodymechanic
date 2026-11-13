import type { MetadataRoute } from 'next';
import { locales } from '@/i18n/routing';
import { pageUrl } from '@/lib/seo';
import { articleSlugs, serviceSlugs, staffSlugs } from '@/lib/api';

// ТЗ §14: sitemap.xml with language versions — every public page in every language, each entry with the full set of
// alternates (ru, en, x-default → en), as search engines expect. Utility pages (booking steps 2–7, «Мои записи», record
// links) are not listed. Static file in the export.
export const dynamic = 'force-static';

const SITEMAP_PATHS = () => ['/', '/booking/', '/services/', '/prices/', '/team/', '/journal/', '/contacts/', '/privacy/', '/terms/',
  ...serviceSlugs().map((s) => `/services/${s}/`), ...staffSlugs().map((s) => `/team/${s}/`), ...articleSlugs().map((s) => `/journal/${s}/`)];

export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP_PATHS().flatMap((p) => {
    const languages = { ...Object.fromEntries(locales.map((l) => [l, pageUrl(l, p)])), 'x-default': pageUrl('en', p) };
    return locales.map((l) => ({ url: pageUrl(l, p), alternates: { languages } }));
  });
}
