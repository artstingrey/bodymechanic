import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import { locale as rootLocale } from 'next/root-params';
import { NextIntlClientProvider } from 'next-intl';
import { isLocale, locales } from '@/i18n/routing';
import { pickMessages } from '@/lib/i18n/pickMessages';
import { FocusIntoView } from '@/components/layout/FocusIntoView';
import '@/styles/font-fallback.css';
import '@/styles/lp.css';

/**
 * Root layout of the ad landing (/[locale]/lp/[variant], task 01a1b325): its own document — no site header, footer, menu,
 * 3D provider, GSAP or cookie banner of the site, and NOT the site's variable Manrope: four static instances (400/600/700/800,
 * the same Latin + Cyrillic subset; WebKit draws the variable font at its thinnest — R-LP-01).
 */
// The constant's name is the CSS family name next/font emits. It must differ from the site's «manrope»: both layouts
// import styles/font-fallback.css, so Turbopack puts these @font-face rules into a CSS chunk that EVERY site page loads.
// Under one family name the site drew 400–800 with these static files (+70 KB) and WebKit re-laid its text out when they
// came after the first frame (RC-6, DEV-16). Under «manropeLp» the site never asks for them.
const manropeLp = localFont({
  src: [
    { path: '../../../fonts/lp/Manrope-400.woff2', weight: '400', style: 'normal' },
    { path: '../../../fonts/lp/Manrope-600.woff2', weight: '600', style: 'normal' },
    { path: '../../../fonts/lp/Manrope-700.woff2', weight: '700', style: 'normal' },
    { path: '../../../fonts/lp/Manrope-800.woff2', weight: '800', style: 'normal' },
  ],
  // RC-6 (lead + AD): optional — no swap after the first paint, ever: with swap the late Manrope re-wrapped the copy (MO-15,
  // 390: CLS 0.108; /lp/b 768: the form 47 px down). The fallback is ours, metric-calibrated per weight and script
  // (styles/font-fallback.css «Manrope Fallback A / R») — next/font's own fallback had no font-weight, so the bold H1 was
  // Arial Regular with a faux bold, narrower than Manrope (2 lines instead of 3).
  display: 'optional', variable: '--font-lp', adjustFontFallback: false,
  fallback: ['Manrope Fallback A', 'Manrope Fallback R', 'system-ui', 'Arial'],
  // next/font's own preload stays off (RC-6, MO-15 is the source of truth): its 4 preloads are high priority and took the line
  // from the hero photo — R-LP-03 F-04 again: MO-15 390 /lp/a 680 → 936 ms, /lp/b 688 → 868. Without ANY preload, though, the
  // faces missed the first frame even from the cache and repeat visits stayed on the fallback too (RC-7, AD + HR). So
  // scripts/lp-postexport.mjs writes the 4 preloads itself with fetchpriority="low" (variant A, lead): behind the hero photo
  // on a first visit (mostly the calibrated fallback, the layout is the same — accepted), ready on the next ones. Next also
  // leaked next/font preloads into every site page (route path, no route groups) — the script keeps both sides clean
  preload: false,
});

export const dynamicParams = false;
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// colorScheme «only light»: Samsung Internet / Chrome forced dark must not invert the brand colours (README-CONTEXT, Android)
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#F7F4F0', colorScheme: 'only light' };

export const metadata: Metadata = {
  robots: { index: false, follow: false }, // ad landing: never indexed, not in the sitemap
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' }, { url: '/favicon.ico', sizes: '32x32' }],
    apple: '/apple-touch-icon.png',
  },
};

// A/B: «form in the hero» (default) or «button → bottom sheet» (?form=sheet). Set on <html> before the first paint, so the
// static HTML of both variants never shifts (lead: query or config; the default lives here). The empty touchstart listener: iOS
// shows :active only when the page listens to touches (RC-8, the buttons' press).
const FORM_FLAG = `(function(){try{var f=new URLSearchParams(location.search).get('form');if(f==='sheet'||f==='hero')document.documentElement.setAttribute('data-lp-form',f)}catch(e){}document.addEventListener('touchstart',function(){},{passive:true})})();`;

export default async function LandingLayout({ children }: LayoutProps<'/[locale]'>) {
  const locale = await rootLocale();
  if (!isLocale(locale)) notFound();
  const messages = await pickMessages(['lp', 'forms.field', 'forms.error', 'common.actions', 'prototype.demoBadge']);
  return (
    <html lang={locale} className={manropeLp.variable} data-lp-form="hero" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: FORM_FLAG }} /></head>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        <FocusIntoView />{/* the site component: iOS keyboard never covers the field being typed in */}
      </body>
    </html>
  );
}
