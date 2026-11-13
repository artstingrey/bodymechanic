'use client';
/**
 * Analytics bootstrap (ТЗ §14), mounted once in the locale layout:
 *  - UTM of the first visit → sessionStorage; cookie for 30 days only with consent (lib/analytics/utm);
 *  - consent from the cookie banner → Consent Mode + GTM loader (lib/analytics/gtm), also when the choice changes later;
 *  - delegated clicks: [data-track="body_open"] («Начать») and contact_click for WhatsApp / phone links anywhere on the site
 *    (header, footer, contacts, step 7) — no per-link handlers in the visual layer. Not in «Мои записи»: the account
 *    pages have no analytics at all (lib/analytics/private).
 */
import { useEffect } from 'react';
import { CONSENT_EVENT, CONSENT_KEY, readConsent } from '@/lib/analytics/consent';
import { applyConsent } from '@/lib/analytics/gtm';
import { track } from '@/lib/analytics/track';
import { captureUtm, syncUtmConsent } from '@/lib/analytics/utm';

function channelOf(a: HTMLAnchorElement): 'whatsapp' | 'phone' | null {
  const href = a.getAttribute('href') || '';
  if (/^tel:/i.test(href)) return 'phone';
  if (/^(https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/|whatsapp:)/i.test(href)) return 'whatsapp';
  return null;
}

export function Analytics() {
  useEffect(() => {
    captureUtm();
    applyConsent(readConsent());
    const onConsent = () => { applyConsent(readConsent()); syncUtmConsent(); };
    const onStorage = (e: StorageEvent) => { if (e.key === CONSENT_KEY) onConsent(); };
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      if (el.closest('[data-track="body_open"]')) track('body_open');
      const a = el.closest('a');
      const channel = a ? channelOf(a) : null;
      if (channel) track('contact_click', { channel });
    };
    window.addEventListener(CONSENT_EVENT, onConsent);
    window.addEventListener('storage', onStorage);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener(CONSENT_EVENT, onConsent);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return null;
}
