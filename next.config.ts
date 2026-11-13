import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// R-APP-01 N-03: on Render a missing site URL would put https://bodymechanic.example into canonical/hreflang/OG/sitemap.
if (process.env.RENDER && !process.env.NEXT_PUBLIC_SITE_URL) {
  throw new Error('NEXT_PUBLIC_SITE_URL is not set: add the service URL in Render → Environment (README, «Render»).');
}
// Any other host (and a local build): the placeholder origin is used — say so in the build log instead of shipping it silently
if (!process.env.NEXT_PUBLIC_SITE_URL && process.env.NODE_ENV === 'production') {
  console.warn('! NEXT_PUBLIC_SITE_URL is not set: canonical, hreflang, Open Graph and sitemap.xml use https://bodymechanic.example (docs/CONFIG-DEPLOY.md)');
}

const nextConfig: NextConfig = {
  // Static prototype on Render (README §14): one HTML file per route and locale.
  output: 'export',
  // `/en/services` → `/en/services/index.html`: deep links and F5 work on a plain static host (DEL-12).
  trailingSlash: true,
  // next/image has no optimizer in a static export; images are pre-generated (AVIF/WebP) at build time.
  images: { unoptimized: true },
  // Root layout lives under app/[locale] (dynamic segment) → unmatched URLs need a global 404 → out/404.html.
  experimental: { globalNotFound: true },
  // DECISION: Cache Components / Partial Prefetching stay off for the static export prototype:
  // nothing here is dynamic, and it keeps next-intl + export on the well-trodden path. Revisit at stage 2 (BFF).
  cacheComponents: false,
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  // Static export ignores headers/redirects/rewrites: they live in the Render service config (README, «Render»).
};

export default withNextIntl(nextConfig);
