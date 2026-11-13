import { defineRouting } from 'next-intl/routing';

export const locales = ['ru', 'en'] as const;
export type Locale = (typeof locales)[number];

// ТЗ §12: /ru/… and /en/…, default EN. No middleware in a static export: the root page picks the locale on the client.
export const routing = defineRouting({
  locales,
  defaultLocale: 'en',
  localePrefix: 'always',
});

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (locales as readonly string[]).includes(v);
