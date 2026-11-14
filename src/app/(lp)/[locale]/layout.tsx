import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { locale as rootLocale } from 'next/root-params';
import { NextIntlClientProvider } from 'next-intl';
import { isLocale, locales } from '@/i18n/routing';
import { pickMessages } from '@/lib/i18n/pickMessages';
import { FocusIntoView } from '@/components/layout/FocusIntoView';
import { PreloadFonts } from '@/components/layout/PreloadFonts';
import '@/styles/font-fallback.css';
import '@/styles/lp.css';

/**
 * Root layout of the ad landing (/[locale]/lp/[variant], task 01a1b325): its own document — no site header, footer, menu,
 * 3D provider, GSAP or cookie banner of the site, and NOT the site's variable Manrope: four static instances (400/600/700/800,
 * the same Latin + Cyrillic subset; WebKit draws the variable font at its thinnest — R-LP-01).
 */
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
    <html lang={locale} data-lp-form="hero" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FORM_FLAG }} />
      </head>
      <body>
        <PreloadFonts landing />
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        <FocusIntoView />{/* the site component: iOS keyboard never covers the field being typed in */}
      </body>
    </html>
  );
}
