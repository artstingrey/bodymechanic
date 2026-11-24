import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { locale as rootLocale } from 'next/root-params';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Body3DProvider } from '@/components/body3d/Body3DProvider';
import { isLocale, locales } from '@/i18n/routing';
import { pickMessages } from '@/lib/i18n/pickMessages';
import '../../globals.css';
import '@/styles/font-fallback.css';
import '@/styles/site-font.css';
import '@/styles/body-viewer.css';

export const dynamicParams = false;
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#F7F4F0', colorScheme: 'only light' };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('body3d.viewer');
  return { title: t('title') };
}

export default async function ViewerLayout({ children }: LayoutProps<'/[locale]'>) {
  const locale = await rootLocale();
  if (!isLocale(locale)) notFound();
  const messages = await pickMessages(['body3d', 'home.hero.posterAlt', 'nav.langSwitch']);
  return (
    <html lang={locale} data-body-viewer>
      <body>
        <NextIntlClientProvider messages={messages}>
          <Body3DProvider viewer>{children}</Body3DProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
