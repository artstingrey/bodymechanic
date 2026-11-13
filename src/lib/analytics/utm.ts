/**
 * UTM of the first visit (ТЗ §14 → §08) → the record comment («UTM: google / cpc / sports_massage», lib/altegio/formatComment).
 *
 * Lead's decision (conservative, GDPR / UAE PDPL): attribution is NOT strictly necessary.
 *  - Without consent the tags of the landing URL live in sessionStorage only (this tab session) and still reach the comment
 *    of a booking made in this session.
 *  - After consent «Аналитика» or «Маркетинг» they move into the first-party cookie bm_utm for 30 days.
 *  - Consent withdrawn → the cookie is removed (the value stays in sessionStorage for this session).
 * The first tagged visit wins: a later visit with other tags does not overwrite the stored value.
 * TODO(legal): the client's lawyers may relax this (e.g. treat bm_utm as necessary) — privacy policy wording.
 */
import { measuringAllowed } from './consent';

export const UTM_COOKIE = 'bm_utm';
export const UTM_SESSION_KEY = 'bm.utm';
export const UTM_MAX_AGE = 30 * 24 * 3600; // 30 days, seconds
const KEY = /^utm_[a-z0-9_]{1,40}$/;
const MAX_KEYS = 10;
const MAX_LEN = 100;
type Utm = Record<string, string>;

const clean = (v: unknown): Utm | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const out = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, x]) => KEY.test(k) && typeof x === 'string' && x).slice(0, MAX_KEYS)) as Utm;
  return Object.keys(out).length ? out : undefined;
};

function fromCookie(): Utm | undefined {
  if (typeof document === 'undefined') return undefined;
  const raw = document.cookie.split('; ').find((c) => c.startsWith(`${UTM_COOKIE}=`));
  if (!raw) return undefined;
  try { return clean(JSON.parse(decodeURIComponent(raw.slice(UTM_COOKIE.length + 1)))); } catch { return undefined; }
}
function fromSession(): Utm | undefined {
  try { return clean(JSON.parse(sessionStorage.getItem(UTM_SESSION_KEY) || 'null')); } catch { return undefined; }
}
function writeCookie(utm: Utm | null) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = utm
    ? `${UTM_COOKIE}=${encodeURIComponent(JSON.stringify(utm))}; Max-Age=${UTM_MAX_AGE}; Path=/; SameSite=Lax${secure}`
    : `${UTM_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}

/** The stored first-visit tags (cookie after consent, else this session's copy). */
export function readUtm(): Utm | undefined {
  if (typeof window === 'undefined') return undefined;
  return fromCookie() ?? fromSession();
}

/** Parses utm_* from the landing URL; keys lower-cased, values trimmed and capped. */
export function utmFrom(search: string): Utm {
  const out: Utm = {};
  for (const [k, v] of new URLSearchParams(search)) {
    const key = k.toLowerCase(), val = v.trim().slice(0, MAX_LEN);
    if (KEY.test(key) && val && !(key in out) && Object.keys(out).length < MAX_KEYS) out[key] = val;
  }
  return out;
}

/** Keeps storage in line with the consent: cookie only while a measuring category is allowed. */
export function syncUtmConsent(): void {
  if (typeof window === 'undefined') return;
  const cookie = fromCookie();
  if (measuringAllowed()) {
    const s = fromSession();
    if (!cookie && s) writeCookie(s);
  } else if (cookie) {
    try { sessionStorage.setItem(UTM_SESSION_KEY, JSON.stringify(cookie)); } catch { /* ignore */ }
    writeCookie(null);
  }
}

/** Called once per page load: stores the tags of the landing URL unless the first visit is already stored. */
export function captureUtm(): void {
  if (typeof window === 'undefined') return;
  if (!readUtm()) {
    const utm = utmFrom(window.location.search);
    if (Object.keys(utm).length) { try { sessionStorage.setItem(UTM_SESSION_KEY, JSON.stringify(utm)); } catch { /* ignore */ } }
  }
  syncUtmConsent();
}
