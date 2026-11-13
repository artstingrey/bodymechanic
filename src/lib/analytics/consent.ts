/**
 * Cookie consent as stored by the cookie banner (components/layout/CookieBanner): localStorage `bm.consent`,
 * change event `bm:consent` on window (+ `storage` from other tabs). Read-only here.
 */
export interface Consent { necessary: true; analytics: boolean; marketing: boolean; at: string }

export const CONSENT_KEY = 'bm.consent';
export const CONSENT_EVENT = 'bm:consent';

export function readConsent(): Consent | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Consent>;
    return { necessary: true, analytics: c.analytics === true, marketing: c.marketing === true, at: String(c.at ?? '') };
  } catch { return null; }
}

/**
 * Analytics may run when the visitor allowed at least one measuring category: «Аналитика» (GA4) or «Маркетинг» (Meta Pixel).
 * Which tag may actually fire is decided inside GTM by Consent Mode (analytics_storage / ad_storage), see ./gtm.ts.
 */
export const measuringAllowed = (c: Consent | null = readConsent()) => !!c && (c.analytics || c.marketing);
