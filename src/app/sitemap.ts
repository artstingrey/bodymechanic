import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { locales, type Locale } from '@/i18n/routing';
import { catalogServiceSlug } from '@/lib/catalog-service-slugs';
import { catalogStaffSlug } from '@/lib/catalog-staff-slug';
import { pageUrl } from '@/lib/site';
import { getCatalogServices } from '@/server/catalog/services';
import { getCatalogStaff } from '@/server/catalog/staff';

const publicPaths = ['/', '/booking/', '/services/', '/prices/', '/team/', '/contacts/', '/privacy/', '/terms/'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Generate XML at request time so even a partial response uses the latest available catalog on the next request.
  await connection();

  const paths = new Map(publicPaths.map((path) => [path, new Set<Locale>(locales)]));
  function add(path: string, locale: Locale) {
    const available = paths.get(path) ?? new Set<Locale>();
    available.add(locale);
    paths.set(path, available);
  }

  const catalogs = await Promise.all(locales.map(async (locale) => ({
    locale,
    results: await Promise.allSettled([getCatalogServices(locale, { withBusinessDuration: false }), getCatalogStaff(locale)]),
  })));
  for (const { locale, results: [services, staff] } of catalogs) {
    if (services.status === 'fulfilled') {
      for (const { id } of services.value.data.services) add(`/services/${catalogServiceSlug(id)}/`, locale);
    }
    if (staff.status === 'fulfilled') {
      for (const { id } of staff.value.data.staff) add(`/team/${catalogStaffSlug(id)}/`, locale);
    }
  }

  return [...paths].flatMap(([path, available]) => {
    const versions = locales.filter((locale) => available.has(locale));
    const languages = Object.fromEntries(versions.map((locale) => [locale, pageUrl(locale, path)]));
    if (languages.en) languages['x-default'] = languages.en;
    return versions.map((locale) => ({ url: languages[locale], alternates: { languages } }));
  });
}
