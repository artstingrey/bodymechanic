import { defineRouting } from 'next-intl/routing';

export const locales = ['ru', 'en'] as const;
export type Locale = (typeof locales)[number];

// ТЗ §12: the root page picks /ru/ or /en/ on the client, with EN as the default.
export const routing = defineRouting({
  locales,
  defaultLocale: 'en',
  localePrefix: 'always',
});

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (locales as readonly string[]).includes(v);
