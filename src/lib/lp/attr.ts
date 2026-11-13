/**
 * Landing attribution (lp-brief §5, T-02 / T-07 / T-14 — Frontend Builder).
 *  - Read once per page load from the URL: utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, gbraid,
 *    wbraid, fbclid. Stored at once in sessionStorage `bm_attr` — that is not a transfer to third parties (J-04), so it
 *    happens before any consent. The lead request carries it to the BFF, which is the main store (cookies of an in-app
 *    browser or Safari's capped script cookies may not live long — T-13).
 *  - UTM of the FIRST visit are kept (a later visit does not overwrite them); click IDs are overwritten by newer ones
 *    (platforms attribute by the last click); the time of the first visit is kept.
 *  - T-14: utm_content / utm_term are neutral IDs only (^[a-z]{2}_[a-z0-9]{1,8}$, e.g. cr_a3, kw_012) — any other value is
 *    dropped to null here and again by the BFF, and never logged (no phrases about body parts or conditions, M7).
 *  - T-02 / L-02: right after reading, utm_term and utm_content are removed from the address (history.replaceState) BEFORE
 *    GTM can load: Meta Pixel sends the full URL (dl) with every event and Google receives it even with cookies denied.
 *  - After consent «Аналитика» or «Маркетинг» the first-visit UTM also go to the first-party cookie bm_utm for 30 days (the
 *    site's format, lib/analytics/utm), removed when the consent is withdrawn (J-04).
 */
import { measuringAllowed } from '@/lib/analytics/consent';
import { UTM_COOKIE, UTM_MAX_AGE } from '@/lib/analytics/utm';

export const ATTR_KEY = 'bm_attr';
export const NEUTRAL_ID = /^[a-z]{2}_[a-z0-9]{1,8}$/;
const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;
const CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbclid'] as const;
export const STRIP_FROM_URL = ['utm_term', 'utm_content'] as const;
const MAX_LEN = 100;
/**
 * A click ID (gclid, gbraid, wbraid, fbclid): base64url-like, up to 500 characters. RC-9: they used to be cut to 100 like the
 * UTM values, but today's fbclid is longer — a cut fbclid gave a wrong _fbc (fb.1.<ms>.<fbclid>) and Meta could not match the
 * click. A value with other characters is not a click ID and is dropped. The demo BFF checks with the same pattern.
 */
export const CLICK_ID = /^[\w.-]{1,500}$/;

export type UtmKey = (typeof UTM_KEYS)[number];
export type ClickKey = (typeof CLICK_KEYS)[number];
export interface Attribution {
  utm: Record<UtmKey, string | null>;
  /** ISO time of the first visit in Dubai time (+04:00); null when the UTM came back from the bm_utm cookie (time not kept there) */
  firstTouchAt: string | null;
  clickIds: Record<ClickKey, string | null>;
  /** ms of the visit that brought the current fbclid — for a manual _fbc (fb.1.<ms>.<fbclid>) */
  fbclidAt: number | null;
}

/** T-14: utm_content / utm_term pass only as neutral IDs */
export const neutralOrNull = (v: string | null | undefined) => (v && NEUTRAL_ID.test(v) ? v : null);

const clean = (v: string | null) => {
  const s = v?.trim().slice(0, MAX_LEN);
  return s ? s : null;
};
/** a click ID whole or not at all — never cut */
const cleanId = (v: string | null) => { const s = v?.trim() ?? ''; return CLICK_ID.test(s) ? s : null; };

/** ISO with the Dubai offset (the studio's time zone): 2026-11-07T14:32:05+04:00 */
export function dubaiIso(ms: number): string {
  const d = new Date(ms + 4 * 3600_000);
  return `${d.toISOString().slice(0, 19)}+04:00`;
}

export function readAttribution(): Attribution | null {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(ATTR_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch { return null; }
}

/** Parses the landing URL: UTM (content / term only as neutral IDs) and click IDs. */
export function attributionFrom(search: string) {
  const q = new URLSearchParams(search);
  const utm = Object.fromEntries(UTM_KEYS.map((k) => {
    const v = clean(q.get(`utm_${k}`));
    return [k, k === 'content' || k === 'term' ? neutralOrNull(v) : v];
  })) as Record<UtmKey, string | null>;
  const clickIds = Object.fromEntries(CLICK_KEYS.map((k) => [k, cleanId(q.get(k))])) as Record<ClickKey, string | null>;
  return { utm, clickIds };
}

/**
 * The first visit's UTM from the bm_utm cookie (30 days; written — here or on the site — only while «Аналитика» or
 * «Маркетинг» is allowed, and read under the same condition). RC-9: a returning visitor opens the landing in a new tab —
 * no bm_attr there — and the lead used to go without any UTM although the cookie had them. Click IDs are never in the cookie.
 */
function utmFromCookie(): Record<UtmKey, string | null> | null {
  if (!measuringAllowed()) return null;
  try {
    const c = JSON.parse(cookie(UTM_COOKIE) || 'null') as Record<string, unknown> | null;
    if (!c || typeof c !== 'object') return null;
    const utm = Object.fromEntries(UTM_KEYS.map((k) => {
      const raw = c[`utm_${k}`];
      const v = clean(typeof raw === 'string' ? raw : null);
      return [k, k === 'content' || k === 'term' ? neutralOrNull(v) : v];
    })) as Record<UtmKey, string | null>;
    return UTM_KEYS.some((k) => utm[k]) ? utm : null;
  } catch { return null; }
}

/**
 * Once per page load, BEFORE any tag can load: store the attribution of this visit and strip utm_term / utm_content from
 * the address. Returns the stored attribution.
 */
export function captureAttribution(now = Date.now()): Attribution | null {
  if (typeof window === 'undefined') return null;
  const { utm, clickIds } = attributionFrom(window.location.search);
  const prev = readAttribution();
  const hasUtm = UTM_KEYS.some((k) => utm[k]);
  // RC-9 (lead): only a tab that has NO attribution of its own — no bm_attr and no tags in this address — takes the UTM
  // kept in the cookie (a returning visitor, with consent). A visit that brings its own tags is attributed to them, as
  // before: someone who came back by a new ad belongs to that ad, not to the campaign of a month ago.
  const kept = prev || hasUtm ? null : utmFromCookie();
  const first = prev && UTM_KEYS.some((k) => prev.utm[k]) ? prev.utm : kept;
  const next: Attribution = {
    utm: first ?? (hasUtm ? utm : (prev?.utm ?? utm)), // within the tab's session the first visit wins (T-02)
    // the cookie does not keep the time of the first visit: unknown stays null, it is never invented
    firstTouchAt: prev ? prev.firstTouchAt : kept ? null : dubaiIso(now),
    clickIds: { ...(prev?.clickIds ?? { gclid: null, gbraid: null, wbraid: null, fbclid: null }) },
    fbclidAt: prev?.fbclidAt ?? null,
  };
  for (const k of CLICK_KEYS) {
    if (!clickIds[k]) continue;
    if (k === 'fbclid' && clickIds.fbclid !== next.clickIds.fbclid) next.fbclidAt = now;
    next.clickIds[k] = clickIds[k]; // the last click wins
  }
  try { sessionStorage.setItem(ATTR_KEY, JSON.stringify(next)); } catch { /* storage off: the request still carries this page's values */ }
  stripUrl();
  syncAttrCookie(next);
  return next;
}

/** T-02 / L-02: utm_term and utm_content leave the address (the hash and the other parameters stay). */
export function stripUrl(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const k of STRIP_FROM_URL) if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
  if (changed) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/** bm_utm (30 days) only while «Аналитика» or «Маркетинг» is allowed; the site's format: { utm_source: …, … } */
export function syncAttrCookie(a: Attribution | null = readAttribution()): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const has = document.cookie.split('; ').some((c) => c.startsWith(`${UTM_COOKIE}=`));
  if (measuringAllowed()) {
    const utm = a ? Object.fromEntries(UTM_KEYS.filter((k) => a.utm[k]).map((k) => [`utm_${k}`, a.utm[k]!])) : {};
    if (!has && Object.keys(utm).length) document.cookie = `${UTM_COOKIE}=${encodeURIComponent(JSON.stringify(utm))}; Max-Age=${UTM_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  } else if (has) {
    document.cookie = `${UTM_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  }
}

const cookie = (name: string) => {
  if (typeof document === 'undefined') return null;
  const c = document.cookie.split('; ').find((x) => x.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.slice(name.length + 1)) : null;
};

/** Meta browser id: the _fbp cookie of the Pixel (exists only after consent «Маркетинг»), else null. */
export const fbp = () => cookie('_fbp');

/** Meta click id: the _fbc cookie, else built from the stored fbclid in Meta's format fb.1.<ms>.<fbclid> (T-02). */
export function fbc(a: Attribution | null = readAttribution()): string | null {
  const c = cookie('_fbc');
  if (c) return c;
  return a?.clickIds.fbclid && a.fbclidAt ? `fb.1.${a.fbclidAt}.${a.clickIds.fbclid}` : null;
}

/**
 * T-07: which Google click IDs go to a conversion upload. All caught IDs are STORED with the lead; sent: gclid whenever it
 * exists; wbraid and gbraid never together (GBRAID_WBRAID_BOTH_SET) — with both, wbraid only.
 */
export function googleClickIdsToSend(ids: Partial<Record<ClickKey, string | null>>): { gclid?: string; wbraid?: string; gbraid?: string } {
  const out: { gclid?: string; wbraid?: string; gbraid?: string } = {};
  if (ids.gclid) out.gclid = ids.gclid;
  if (ids.wbraid) out.wbraid = ids.wbraid;
  else if (ids.gbraid) out.gbraid = ids.gbraid;
  return out;
}
