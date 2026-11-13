'use client';
/**
 * Page-level messages for client components (R-CODE-02 F-04, RSC payload): the locale layout sends only what every page
 * needs (header, footer, cookie, common…); a page adds its own namespaces here, MERGED into the layout's — a nested
 * NextIntlClientProvider alone would replace them (use-intl does not merge). Server side: lib/i18n/pickMessages.
 */
import { useMemo, type ReactNode } from 'react';
import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl';

type M = Record<string, unknown>;
const isObj = (v: unknown): v is M => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(a: M, b: M): M {
  const out: M = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? merge(a[k] as M, v) : v;
  return out;
}

export function ScopeMessages({ messages, children }: { messages: M; children: ReactNode }) {
  const parent = useMessages() as M;
  const locale = useLocale();
  const merged = useMemo(() => merge(parent, messages), [parent, messages]);
  return <NextIntlClientProvider locale={locale} messages={merged}>{children}</NextIntlClientProvider>;
}
