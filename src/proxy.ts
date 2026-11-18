import { NextResponse, type NextRequest } from 'next/server';
import { isLocale } from '@/i18n/routing';
import { articleSlugs, serviceSlugs, staffSlugs } from '@/lib/api';
import { catalogServiceId } from '@/lib/catalog-service-slugs';
import { catalogStaffId } from '@/lib/catalog-staff-slug';

const pages = new Set([
  '', 'body-model', 'booking', 'contacts', 'journal', 'prices', 'privacy', 'services', 'team', 'terms',
  'account', 'account/record', 'lp/a', 'lp/b',
  ...articleSlugs().map((slug) => `journal/${slug}`),
  ...serviceSlugs().map((slug) => `services/${slug}`),
  ...staffSlugs().map((slug) => `team/${slug}`),
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.endsWith('/')) return NextResponse.next();

  const [, locale, ...segments] = pathname.split('/');
  if (!isLocale(locale)) return NextResponse.next();
  const page = segments.join('/');
  const catalogService = segments.length === 2 && segments[0] === 'services' && catalogServiceId(segments[1]) !== undefined;
  const catalogStaff = segments.length === 2 && segments[0] === 'team' && catalogStaffId(segments[1]) !== undefined;
  if (!pages.has(page) && !catalogService && !catalogStaff && !/^account\/record\/[^/]+\/[^/]+$/.test(page)) {
    return NextResponse.next();
  }

  const canonical = new URL(request.url);
  canonical.pathname = `${pathname}/`;
  return NextResponse.redirect(canonical, 308);
}

export const config = { matcher: ['/:locale(ru|en)/:path*'] };
