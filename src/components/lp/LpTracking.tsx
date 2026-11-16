'use client';
/**
 * Landing measurement bootstrap (lp-brief §5, Frontend Builder), mounted once by the landing page. Order matters:
 *  1. attribution of this visit → sessionStorage bm_attr, utm_term / utm_content removed from the address (T-02, T-14)
 *     — before any tag can exist;
 *  2. consent (the landing's LpConsent or a choice made on the site): Consent Mode v2 «default» denied, «update» from
 *     the choice, then GTM — never before the page's `load` (T-11), never without «Аналитика» or «Маркетинг» (T-01);
 *     a later change sends another update; bm_utm cookie follows the consent (J-04);
 *  3. events (lib/lp/track): lp_view once measuring is allowed; lp_form_start on the first focus in a form field;
 *     lp_whatsapp_click on WhatsApp navigation (its own event id). Forms validate before recording the navigation.
 * No queue before consent: events of a visit before the choice are dropped on purpose (as on the site).
 */
import { useEffect } from 'react';
import { CONSENT_EVENT, CONSENT_KEY, measuringAllowed, readConsent } from '@/lib/analytics/consent';
import { applyConsent } from '@/lib/analytics/gtm';
import { captureAttribution, syncAttrCookie } from '@/lib/lp/attr';
import { newKey } from '@/lib/lp/lead';
import { placementOf, setLpContext, trackFormStart, trackView, trackWhatsapp } from '@/lib/lp/track';

/** T-11: tags not before the page's load event */
function afterLoad(fn: () => void) {
  if (document.readyState === 'complete') fn();
  else window.addEventListener('load', () => fn(), { once: true });
}

export function LpTracking({ variant, locale }: { variant: 'a' | 'b'; locale: string }) {
  useEffect(() => {
    setLpContext(variant, locale);
    captureAttribution();
    const consentChanged = () => {
      syncAttrCookie();
      afterLoad(() => { applyConsent(readConsent()); if (measuringAllowed()) trackView(); });
    };
    consentChanged();
    const onStorage = (e: StorageEvent) => { if (e.key === CONSENT_KEY) consentChanged(); };
    const onFocus = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.matches('.lp-form input, .lp-form textarea, .lp-form select')) trackFormStart(placementOf(el));
    };
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest('a[data-track="whatsapp"], a[href^="https://wa.me/"]') : null;
      if (el) trackWhatsapp(placementOf(el), newKey());
    };
    window.addEventListener(CONSENT_EVENT, consentChanged);
    window.addEventListener('storage', onStorage);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('click', onClick, true); // capture: the link may open WhatsApp before a bubbling handler runs
    return () => {
      window.removeEventListener(CONSENT_EVENT, consentChanged);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('click', onClick, true);
    };
  }, [variant, locale]);
  return null;
}
