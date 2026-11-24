import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { locale as rootLocale } from 'next/root-params';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { isLocale, locales } from '@/i18n/routing';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { MockFlags } from '@/components/dev/MockFlags';
import { CookieBanner } from '@/components/layout/CookieBanner';
import { Body3DProvider } from '@/components/body3d/Body3DProvider';
import { BookFab } from '@/components/layout/BookFab';
import { MotionRoot } from '@/components/motion/MotionRoot';
import { Analytics } from '@/components/analytics/Analytics';
import { PrivateBoundary } from '@/components/layout/PrivateBoundary';
import { FocusIntoView } from '@/components/layout/FocusIntoView';
import { PreloadFonts } from '@/components/layout/PreloadFonts';
import { GLOBAL_CLIENT_MESSAGES } from '@/lib/i18n/pickMessages';
import '../globals.css';
import '@/styles/font-fallback.css';
import '@/styles/site-font.css';

export const dynamicParams = false;
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// colorScheme «only light»: Samsung Internet / Chrome forced dark must not invert the light-only design (Android matrix)
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#F7F4F0', colorScheme: 'only light' };

export async function generateMetadata(): Promise<Metadata> {
  const locale = await rootLocale();
  const t = await getTranslations({ locale: isLocale(locale) ? locale : 'en', namespace: 'meta' });
  return {
    title: { default: t('home.title'), template: '%s' },
    applicationName: 'Body Mechanic', // README §11: manifest short_name
    manifest: locale === 'ru' ? '/site.ru.webmanifest' : '/site.webmanifest',
    icons: {
      icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' }, { url: '/favicon-16.png', type: 'image/png', sizes: '16x16' }, { url: '/favicon.ico', sizes: '32x32' }],
      apple: '/apple-touch-icon.png',
    },
  };
}

// Namespaces used by client components; page texts and meta stay on the server.
// R-CODE-02 F-04: only what every page needs; pages add their own namespaces (ScopeMessages + pickMessages)
const CLIENT_NAMESPACES = GLOBAL_CLIENT_MESSAGES;

export default async function LocaleLayout({ children }: LayoutProps<'/[locale]'>) {
  const locale = await rootLocale();
  if (!isLocale(locale)) notFound();
  const t = await getTranslations();
  const all = (await getMessages()) as Record<string, unknown>;
  const messages = Object.fromEntries(CLIENT_NAMESPACES.map((k) => [k, all[k]]));
  return (
    <html lang={locale}>
      <body>
        <PreloadFonts />
        <a href="#main" className="skip-link">{t('nav.skipToContent')}</a>
        <NextIntlClientProvider messages={messages}>
          <Body3DProvider>
            <Header />
            <main id="main" tabIndex={-1}>{children}</main>
            <Footer />
            <BookFab label={t('nav.book')} aria={t('nav.bookFloatingAria')} />
            <CookieBanner />
            <MockFlags />
            <MotionRoot />
            <Analytics />
            <PrivateBoundary />
            <FocusIntoView />
          </Body3DProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
