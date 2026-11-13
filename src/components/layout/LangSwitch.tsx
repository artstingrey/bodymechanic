'use client';
/**
 * RU/EN switch (GL-03): keeps the current page, query (?step=…) and hash; the booking draft survives in sessionStorage.
 * The choice is remembered (cookie NEXT_LOCALE + localStorage) — the root page uses it to pick the locale.
 */
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { locales, type Locale } from '@/i18n/routing';
import { carryEntryFlag } from '@/lib/booking/preset';

export function rememberLocale(l: Locale) {
  try { localStorage.setItem('bm.locale', l); } catch { /* ignore */ }
  document.cookie = `NEXT_LOCALE=${l}; path=/; max-age=31536000; samesite=lax`;
}

export function LangSwitch({ variant = 'short' }: { variant?: 'short' | 'long' }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const pathname = usePathname(); // without the locale prefix
  return (
    <nav aria-label={t('nav.langSwitch.label')} className={variant === 'long' ? 'lang-switch lang-switch--long' : 'lang-switch'}>
      {locales.map((l, i) => {
        const path = `/${l}${pathname === '/' ? '/' : `${pathname.replace(/\/$/, '')}/`}`;
        const label = variant === 'long' ? t(`footer.lang.${l}`) : t(`nav.langSwitch.${l}`);
        const sep = i > 0 && variant === 'short' ? <span className="sep" aria-hidden="true">·</span> : null;
        return l === locale ? (
          <span key={l} style={{ display: 'contents' }}>{sep}<span aria-current="true" lang={l}>{label}</span></span>
        ) : (
          <span key={l} style={{ display: 'contents' }}>{sep}<a href={path} hrefLang={l} lang={l} aria-label={`${label}. ${t(l === 'ru' ? 'nav.langSwitch.toRu' : 'nav.langSwitch.toEn')}`} /* WCAG 2.5.3: the name starts with the visible «EN» */
            onClick={(e) => {
              rememberLocale(l);
              // Ж-9: a booking opened with a service keeps that word for the entry in the other language (it used to be ?service=)
              if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) carryEntryFlag();
              e.currentTarget.href = path + window.location.search + window.location.hash;
            }}>
            {label}
          </a></span>
        );
      })}
    </nav>
  );
}
