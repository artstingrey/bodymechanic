import { getRequestConfig } from 'next-intl/server';
import { locale as rootLocale } from 'next/root-params';
import { isLocale, routing } from './routing';

// Messages come only from messages/{ru,en}.json — synced copies of site/copy/messages.*.json (README §9).
export default getRequestConfig(async () => {
  const param = await rootLocale();
  const locale = isLocale(param) ? param : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'Asia/Dubai', // ТЗ §12: время всегда в поясе Дубая
  };
});
