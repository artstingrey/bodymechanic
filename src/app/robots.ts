import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

// ТЗ §14 robots.txt. The prototype is closed for indexing (DEL-13): Disallow: / for everyone (+ noindex on every page).
// Launch: switch to `allow: '/'` together with the robots meta in lib/seo.ts and the [locale] layout. The sitemap line stays.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' }, sitemap: `${SITE_URL}/sitemap.xml` };
}
