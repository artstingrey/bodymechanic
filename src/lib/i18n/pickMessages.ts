import { getMessages } from 'next-intl/server';

type M = Record<string, unknown>;

/**
 * Messages for the client components of ONE page (with components/i18n/ScopeMessages): dotted paths → a nested subset,
 * e.g. ['body3d', 'home.hero', 'booking.error'] → { body3d: {…}, home: { hero }, booking: { error } }.
 */
export async function pickMessages(paths: string[]): Promise<M> {
  const all = (await getMessages()) as M;
  const out: M = {};
  for (const path of paths) {
    const keys = path.split('.');
    let src: unknown = all;
    for (const k of keys) src = src && typeof src === 'object' ? (src as M)[k] : undefined;
    if (src === undefined) throw new Error(`pickMessages: no messages at «${path}»`);
    let dst = out;
    keys.slice(0, -1).forEach((k) => { dst = (dst[k] ??= {}) as M; });
    dst[keys.at(-1)!] = src;
  }
  return out;
}

/** Namespaces every page needs on the client (header, burger, language switch, footer, cookie card, shared UI). */
export const GLOBAL_CLIENT_MESSAGES = ['nav', 'footer', 'cookie', 'common', 'a11y', 'placeholder'] as const;
