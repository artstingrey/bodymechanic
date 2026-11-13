import { locale as rootLocale } from 'next/root-params';
import { isLocale, type Locale } from '@/i18n/routing';

/** Locale of the current route (root param of app/[locale]); validated against the supported list. */
export async function pageLocale(): Promise<Locale> {
  const l = await rootLocale();
  return isLocale(l) ? l : 'en';
}
