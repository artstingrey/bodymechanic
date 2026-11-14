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
  trailingSlash: true,
  // Proxy adds a slash to localized pages while the API keeps its direct URL.
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  // Images are pre-generated (AVIF/WebP) at build time.
  images: { unoptimized: true },
  // A global 404 handles unmatched paths across the separate root layouts.
  experimental: { globalNotFound: true },
  cacheComponents: false,
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  async rewrites() {
    // Keep the branded global 404 for unsupported single-segment locales now that the home route renders on demand.
    const unsupportedLocale = '/:locale((?!ru(?:/|$)|en(?:/|$))[^/]+)';
    return {
      afterFiles: ['', '/'].map((slash) => ({
        source: unsupportedLocale + slash,
        destination: '/unsupported-locale/:locale/',
      })),
    };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'accelerometer=(), gyroscope=(), magnetometer=(), camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), midi=(), display-capture=(), xr-spatial-tracking=(), browsing-topics=()' },
        ],
      },
      {
        source: '/:locale(ru|en)/account/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/models/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/fonts/v1/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/:file(site|site.ru).webmanifest',
        headers: [{ key: 'Content-Type', value: 'application/manifest+json' }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
