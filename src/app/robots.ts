import type { MetadataRoute } from 'next';
import { locales } from '@/i18n/routing';
import { SITE_URL } from '@/lib/seo';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const disallow = ['/lp/', ...locales.flatMap((locale) => [`/${locale}/lp/`, `/${locale}/account`])];
  return { rules: { userAgent: '*', allow: '/', disallow }, sitemap: `${SITE_URL}/sitemap.xml` };
}
