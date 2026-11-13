'use client';
/**
 * Cookie banner with categories (ТЗ §04, GL-09; ui-kit «Cookie-баннер»). Analytics (GTM) would load only after consent;
 * in the prototype GTM is a stub without an ID, so nothing third-party is ever requested (DEL-02).
 * Logic unchanged from the skeleton (Frontend Builder); visual layer: card bottom-left (≥768) / bottom sheet (phones), switches.
 */
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Choice';
import { useBackCloses } from '@/lib/ui/useBackCloses';

type Consent = { necessary: true; analytics: boolean; marketing: boolean; at: string };
const KEY = 'bm.consent';
const OPEN = 'bm:cookie-settings';

export function CookieSettingsLink({ label }: { label: string }) {
  return <button type="button" className="link-button" onClick={() => window.dispatchEvent(new Event(OPEN))}>{label}</button>;
}

const subscribe = (cb: () => void) => { window.addEventListener('bm:consent', cb); window.addEventListener('storage', cb); return () => { window.removeEventListener('bm:consent', cb); window.removeEventListener('storage', cb); }; };
const hasConsent = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };

export function CookieBanner() {
  const t = useTranslations('cookie');
  const uid = useId();
  // Server snapshot = consent present → no banner in the static HTML (no layout jump for returning visitors).
  const consented = useSyncExternalStore(subscribe, hasConsent, () => true);
  const [forced, setForced] = useState(false);
  const open = !consented || forced;
  const [custom, setCustom] = useState(false);
  const [c, setC] = useState({ analytics: false, marketing: false });
  // Android «Back» closes the cookie settings (reopened from the footer, or expanded with «Настроить»); the first-visit
  // banner itself stays until a choice is made
  useBackCloses(open && (forced || custom), () => { setForced(false); setCustom(false); });
  useEffect(() => {
    const reopen = () => { setForced(true); setCustom(true); };
    window.addEventListener(OPEN, reopen);
    return () => window.removeEventListener(OPEN, reopen);
  }, []);
  const save = (v: { analytics: boolean; marketing: boolean }) => {
    const consent: Consent = { necessary: true, ...v, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(consent)); } catch { /* ignore */ }
    setForced(false);
    window.dispatchEvent(new CustomEvent('bm:consent', { detail: consent })); // lib/analytics listens (stage 2: GTM)
  };
  if (!open) return null;
  const row = (key: 'necessary' | 'analytics' | 'marketing', checked: boolean, onChange?: (v: boolean) => void) => (
    <div className="row">
      <div>
        <b id={`${uid}-${key}`}>{t(`cat.${key}.title`)}</b>
        <small id={`${uid}-${key}-d`}>{t(`cat.${key}.desc`)}{key === 'necessary' ? <> · {t('alwaysOn')}</> : null}</small>
      </div>
      <Switch checked={checked} onChange={onChange} labelledBy={`${uid}-${key}`} describedBy={`${uid}-${key}-d`} disabled={key === 'necessary'} />
    </div>
  );
  // Phones and low landscape (DEV-02/06, R-FINAL-2 D-02): a compact card — title, policy link, the three actions; the full text
  // and the categories live in the «Настроить» sheet ([data-custom]). Same buttons, same order, same consent logic.
  return (
    <section className="cookie" role="dialog" aria-label={t('dialogLabel')} aria-modal="false" data-custom={custom ? '' : undefined}>
      <div className="cookie__msg">
        <h2>{t('title')}</h2>
        <p><span className="cookie__text">{t('text')}</span> <Link href="/privacy" prefetch={false} className="link">{t('learnMore')}</Link></p>
      </div>
      {custom ? (
        <fieldset className="cats">
          <legend className="sr-only">{t('dialogLabel')}</legend>
          {row('necessary', true)}
          {row('analytics', c.analytics, (v) => setC({ ...c, analytics: v }))}
          {row('marketing', c.marketing, (v) => setC({ ...c, marketing: v }))}
          {/* lead: how the UTM tags depend on these two categories (lib/analytics/utm) */}
          <p className="cookie__note">{t('utmNote')}</p>
        </fieldset>
      ) : null}
      <div className="acts">
        <Button size="sm" onClick={() => save({ analytics: true, marketing: true })}>{t('acceptAll')}</Button>
        <Button size="sm" variant="secondary" onClick={() => save({ analytics: false, marketing: false })}>{t('necessaryOnly')}</Button>
        {custom
          ? <Button size="sm" variant="text" icon="check" onClick={() => save(c)}>{t('save')}</Button>
          : <Button size="sm" variant="text" onClick={() => setCustom(true)}>{t('customize')}</Button>}
      </div>
    </section>
  );
}
