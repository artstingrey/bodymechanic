import type { Metadata, Viewport } from 'next';
import { pageUrl } from '@/lib/site';
import en from '../../../messages/en.json';

// Root URL "/" only: a tiny standalone document that sends the visitor to /ru/ or /en/ (see page.tsx).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', colorScheme: 'only light' };
export const metadata: Metadata = { title: en.common.brand, alternates: { canonical: pageUrl('en', '/') } };

export default function RootRedirectLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
