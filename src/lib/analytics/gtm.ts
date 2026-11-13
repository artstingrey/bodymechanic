/**
 * Google Tag Manager (ТЗ §14): GA4 and Meta Pixel live in the container, the site only loads it — and only after consent.
 * - NEXT_PUBLIC_GTM_ID empty (prototype) → nothing is loaded, events stay in window.dataLayer (no third-party requests, DEL-02).
 * - Consent Mode v2: «default» = everything denied, then «update» from the banner choice (analytics → analytics_storage,
 *   marketing → ad_storage / ad_user_data / ad_personalization). A later change in «Настройки cookie» sends another update.
 * - RC-9 (security review S-2): never on the account pages, nor in a document that started on one (./private) — the record
 *   link /account/record/{id}/{hash}/ would reach Google and Meta as the page address.
 * - RC-10 (security review Ж-9): the container is inserted only after a choice that came in the address of the booking
 *   (?service, ?staff, ?date, ?time) has left it (lib/booking/preset). The booking page and the booking flow do that
 *   earlier; the call here keeps the order «address clean → container» whatever the order of effects is.
 */
import { GTM_ID } from '@/lib/config';
import { absorbPresetFromUrl } from '@/lib/booking/preset';
import { testGtmId } from '@/lib/dev/test-hook';
import type { Consent } from './consent';
import { analyticsOff } from './private';

let defaulted = false;
let loaded = false;

/** gtag() as GTM expects it: the Arguments object itself goes into dataLayer (an array would be ignored). */
function gtag(..._args: unknown[]) {
  // eslint-disable-next-line prefer-rest-params
  (window.dataLayer ||= []).push(arguments);
}

const state = (c: Consent) => {
  const v = (on: boolean) => (on ? 'granted' : 'denied');
  return { analytics_storage: v(c.analytics), ad_storage: v(c.marketing), ad_user_data: v(c.marketing), ad_personalization: v(c.marketing) };
};

/** Applies the visitor's choice; loads the container the first time a measuring category is allowed. */
export function applyConsent(c: Consent | null): void {
  if (typeof window === 'undefined' || !c) return;
  if (analyticsOff()) return; // S-2: no container and no dataLayer on an account address or in a document opened with one
  const measuring = c.analytics || c.marketing;
  if (!defaulted && !measuring) return; // nothing allowed and nothing loaded → leave dataLayer untouched
  if (!defaulted) {
    gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
    defaulted = true;
  }
  gtag('consent', 'update', state(c));
  // production uses the build-time NEXT_PUBLIC_GTM_ID; the gate checks the loader with a test id it installed before the
  // page's scripts (lib/dev/test-hook — security review Ж-3: a global set later, e.g. `window.__bmGtmId`, is never read)
  const id = GTM_ID || testGtmId();
  if (!measuring || loaded || !/^GTM-[A-Z0-9]+$/.test(id)) return;
  absorbPresetFromUrl(true); // Ж-9: first the address of the booking loses the choice (it is kept for the flow), then the container
  loaded = true;
  window.dataLayer!.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}
