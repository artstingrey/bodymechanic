'use client';
/**
 * Cookie consent on the ad landing (lp-brief T-01 / §5.5, M7 — Frontend Builder; visual polish: art director).
 * Same storage and event as the site's banner (localStorage `bm.consent`, window event `bm:consent`): one choice per
 * domain — given on the site it holds here and back. Until a choice nothing third-party loads (LpTracking + lib/analytics/gtm).
 * Placement: a compact bar fixed to the TOP of the screen — the bottom belongs to the sticky CTA and the hero form button
 * must stay whole on the first screen of every phone (README-CONTEXT); ≤ half of the visible screen (lead, L01; was 30 %, D-02).
 * «Настроить» opens the categories; Android «Назад» closes them (useBackCloses). The static HTML never contains it
 * (no flash for returning visitors): it appears after hydration only when there is no stored choice, or on `bm:cookie-settings`.
 * Strings come from the deck (cookie.*), passed in by the server page (the landing's message provider stays lp-only).
 */
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { CONSENT_EVENT, CONSENT_KEY, type Consent } from '@/lib/analytics/consent';
import { Checkbox } from '@/components/ui/Choice';
import { useBackCloses } from '@/lib/ui/useBackCloses';
import '@/styles/lp-consent.css';

export interface LpConsentStrings {
  label: string; title: string; text: string; learnMore: string; acceptAll: string; necessaryOnly: string; customize: string; save: string;
  analytics: string; analyticsDesc: string; marketing: string; marketingDesc: string; necessary: string; necessaryDesc: string; utmNote: string;
}

const OPEN = 'bm:cookie-settings';
const subscribe = (cb: () => void) => { window.addEventListener(CONSENT_EVENT, cb); window.addEventListener('storage', cb); return () => { window.removeEventListener(CONSENT_EVENT, cb); window.removeEventListener('storage', cb); }; };
const hasConsent = () => { try { return !!localStorage.getItem(CONSENT_KEY); } catch { return false; } };

export function LpConsent({ s, privacyHref }: { s: LpConsentStrings; privacyHref: string }) {
  const uid = useId();
  const consented = useSyncExternalStore(subscribe, hasConsent, () => true); // server: nothing in the static HTML
  const [forced, setForced] = useState(false);
  const [custom, setCustom] = useState(false);
  const [c, setC] = useState({ analytics: false, marketing: false });
  const open = !consented || forced;
  useBackCloses(open && custom, () => setCustom(false));
  useEffect(() => {
    const reopen = () => { setForced(true); setCustom(true); };
    window.addEventListener(OPEN, reopen);
    return () => window.removeEventListener(OPEN, reopen);
  }, []);
  const save = (v: { analytics: boolean; marketing: boolean }) => {
    const consent: Consent = { necessary: true, ...v, at: new Date().toISOString() };
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)); } catch { /* storage off: the choice holds for this page */ }
    setForced(false); setCustom(false);
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent })); // LpTracking: Consent Mode update + GTM
  };
  if (!open) return null;
  return (
    <section className="lp-consent" role="dialog" aria-modal="false" aria-labelledby={`${uid}-t`} data-testid="lp-consent" data-custom={custom ? '' : undefined}>
      <div className="lp-consent__in">
        {/* the text (and the categories) scroll inside only when the bar would exceed half the screen (enlarged system text) — the
            buttons stay visible, a shadow marks the cut edge (lp-consent.css) */}
        <div className="lp-consent__scroll">
          <p className="lp-consent__text"><b id={`${uid}-t`}>{s.title}.</b> {s.text} <a href={privacyHref} target="_blank" rel="noopener">{s.learnMore}</a></p>
          {custom ? (
            <fieldset className="lp-consent__cats">
              <legend className="sr-only">{s.label}</legend>
              <Checkbox checked disabled>{s.necessary}<small>{s.necessaryDesc}</small></Checkbox>
              <Checkbox checked={c.analytics} onChange={(e) => setC({ ...c, analytics: e.target.checked })}>{s.analytics}<small>{s.analyticsDesc}</small></Checkbox>
              <Checkbox checked={c.marketing} onChange={(e) => setC({ ...c, marketing: e.target.checked })}>{s.marketing}<small>{s.marketingDesc}</small></Checkbox>
              <p className="lp-consent__note">{s.utmNote}</p>
            </fieldset>
          ) : null}
        </div>
        <div className="lp-consent__acts">
          <button type="button" className="btn btn--p" onClick={() => save({ analytics: true, marketing: true })}>{s.acceptAll}</button>
          <button type="button" className="btn lp-consent__secondary" onClick={() => save({ analytics: false, marketing: false })}>{s.necessaryOnly}</button>
          {custom
            ? <button type="button" className="btn lp-consent__secondary" onClick={() => save(c)}>{s.save}</button>
            : <button type="button" className="btn lp-consent__link" onClick={() => setCustom(true)}>{s.customize}</button>}
        </div>
      </div>
    </section>
  );
}
