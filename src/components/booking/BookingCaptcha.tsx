'use client';

import { DEFAULT_SCRIPT_ID, SCRIPT_URL, Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TURNSTILE_SITE_KEY } from '@/lib/config';
import { BOOKING_CAPTCHA_ACTION } from '@/lib/contracts/booking-record';
import type { CatalogLocale } from '@/lib/contracts/catalog';

const TOKEN_LIFETIME_MS = 300_000;
const LOAD_TIMEOUT_MS = 12_000;
let scriptReady: Promise<void> | undefined;

function loadScript() {
  return scriptReady ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = DEFAULT_SCRIPT_ID;
    script.src = `${SCRIPT_URL}?render=explicit`;
    script.async = true;
    const timer = window.setTimeout(fail, LOAD_TIMEOUT_MS);
    function fail() {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Turnstile script failed to load'));
    }
    script.addEventListener('error', fail, { once: true });
    script.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    document.head.append(script);
  }).catch((error: unknown) => {
    scriptReady = undefined;
    throw error;
  });
}

export function useBookingCaptcha() {
  const id = useId();
  const token = useRef<{ value: string; expires: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);
  const updateToken = useCallback((value: string | null) => {
    token.current = value ? { value, expires: Date.now() + TOKEN_LIFETIME_MS } : null;
    setReady(Boolean(value));
  }, []);

  function takeToken() {
    const current = token.current;
    if (!current || current.expires <= Date.now()) return null;
    updateToken(null);
    setGeneration((n) => n + 1);
    return current.value;
  }

  return { id, ready, generation, updateToken, takeToken };
}

type Captcha = ReturnType<typeof useBookingCaptcha>;
type WidgetState = 'loading' | 'waiting' | 'ready' | 'expired' | 'error';

function CaptchaWidget({ locale, size, id, updateToken }: {
  locale: CatalogLocale; size: 'normal' | 'compact'; id: string; updateToken: Captcha['updateToken'];
}) {
  const t = useTranslations('booking.captcha');
  const widget = useRef<TurnstileInstance>(undefined);
  const loaded = useRef(false);
  const expiry = useRef<number>(undefined);
  const [state, setState] = useState<WidgetState>('loading');
  const [attempt, setAttempt] = useState(0);

  const invalidate = useCallback((state: Exclude<WidgetState, 'ready'>) => {
    clearTimeout(expiry.current);
    updateToken(null);
    setState(state);
  }, [updateToken]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => { if (!loaded.current) invalidate('error'); }, LOAD_TIMEOUT_MS);
    void loadScript().catch(() => { if (active) invalidate('error'); });
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(expiry.current);
      updateToken(null);
    };
  }, [attempt, invalidate, updateToken]);

  function retry() {
    invalidate(loaded.current ? 'waiting' : 'loading');
    if (loaded.current) widget.current?.reset();
    else setAttempt((n) => n + 1);
  }

  return (
    <>
      <Turnstile key={attempt} id={`${id}-widget`} ref={widget} siteKey={TURNSTILE_SITE_KEY} injectScript={false}
        options={{
          size, language: locale, action: BOOKING_CAPTCHA_ACTION, appearance: 'always',
          responseField: false, retry: 'never', refreshExpired: 'manual', refreshTimeout: 'never',
        }}
        onWidgetLoad={() => { loaded.current = true; setState((state) => state === 'loading' ? 'waiting' : state); }}
        onSuccess={(value) => {
          clearTimeout(expiry.current);
          updateToken(value);
          setState('ready');
          expiry.current = window.setTimeout(() => invalidate('expired'), TOKEN_LIFETIME_MS);
        }}
        onExpire={() => invalidate('expired')}
        onError={() => { invalidate('error'); return true; }}
        onTimeout={() => invalidate('error')}
        onUnsupported={() => invalidate('error')} />
      <p id={id} role="status">{state === 'ready' ? '' : t(state)}</p>
      {(state === 'error' || state === 'expired') &&
        <button className="btn btn--text btn--sm" type="button" onClick={retry}>{t('retry')}</button>}
    </>
  );
}

export function BookingCaptcha({ captcha, locale, className = 'captcha' }: {
  captcha: Captcha; locale: CatalogLocale; className?: string;
}) {
  const t = useTranslations('booking.captcha');
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<'normal' | 'compact' | null>(null);
  const { id, generation, updateToken } = captcha;

  useEffect(() => {
    const element = root.current;
    if (!element || !TURNSTILE_SITE_KEY) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setSize(width === 0 ? null : width < 300 ? 'compact' : 'normal');
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={className} ref={root} data-testid="captcha">
      {TURNSTILE_SITE_KEY && size
        ? <CaptchaWidget key={`${generation}-${size}-${locale}`} id={id} locale={locale} size={size} updateToken={updateToken} />
        : <p id={id} role="status">{t(TURNSTILE_SITE_KEY ? 'loading' : 'unavailable')}</p>}
    </div>
  );
}
