/**
 * Landing lead — the request to the BFF (lp-brief §5.3, T-03; Frontend Builder). POST /api/lp/lead with:
 *   eventId (UUID v4 = idempotencyKey: the BFF keeps it 24 h and answers a repeat with the first result; the same id is the
 *   Meta event_id of Pixel + CAPI), lang, version, name, phone (E.164), interests (chip ids), consent, offerId,
 *   attribution (first-visit UTM, click IDs, _fbp / _fbc), page (url without utm_term / utm_content, referrer).
 * Answer {status: "ok" | "queued", eventId}; the browser's lp_lead fires only after it (never on the click).
 * Prototype: no network — ./bff-mock answers like the BFF would (T-12); the gate switches its states with
 * `?mock=queued|server|offline|off` (lib/api/mock-flags — gate only).
 * Chips stay with us: in the request to OUR server only, never in dataLayer / Pixel / URL (M7).
 * RC-9 (security review S-1): the request (name, phone) is never left on `window` — the gate gets it through its own sink.
 */
import { readConsent } from '@/lib/analytics/consent';
import { toTest } from '@/lib/dev/test-hook';
import CFG from './config.json';
import { fbc, fbp, readAttribution, type Attribution, type ClickKey, type UtmKey } from './attr';

/** What the form knows */
export interface LeadInput {
  name: string; phone: string; details: string[]; detailsConsent: boolean;
  variant: 'a' | 'b'; locale: string; idempotencyKey: string;
}

/** The request body (lp-brief §5.3) */
export interface LeadRequest {
  eventId: string;
  lang: string;
  version: 'A' | 'B';
  name: string;
  phone: string;
  interests: string[];
  consent: { privacy: true; details: boolean; analytics: boolean; marketing: boolean };
  offerId: string;
  attribution: {
    utm: Record<UtmKey, string | null>;
    firstTouchAt: string | null;
    clickIds: Record<ClickKey, string | null>;
    fbp: string | null;
    fbc: string | null;
  };
  page: { url: string; referrer: string };
}
export interface LeadResult { status: 'ok' | 'queued'; eventId: string }

const EMPTY_UTM: Attribution['utm'] = { source: null, medium: null, campaign: null, content: null, term: null };
const EMPTY_IDS: Attribution['clickIds'] = { gclid: null, gbraid: null, wbraid: null, fbclid: null };

export function buildRequest(i: LeadInput): LeadRequest {
  const a = readAttribution();
  const c = readConsent();
  const url = new URL(window.location.href);
  url.hash = '';
  return {
    eventId: i.idempotencyKey,
    lang: i.locale,
    version: i.variant === 'b' ? 'B' : 'A',
    name: i.name,
    phone: i.phone,
    interests: i.details,
    // privacy: the submit itself is the consent (lp.consent.submit under the button); details only with a chip selected
    consent: { privacy: true, details: i.details.length > 0 && i.detailsConsent, analytics: !!c?.analytics, marketing: !!c?.marketing },
    offerId: CFG.offer.id,
    attribution: {
      utm: a?.utm ?? EMPTY_UTM,
      firstTouchAt: a?.firstTouchAt ?? null,
      clickIds: a?.clickIds ?? EMPTY_IDS,
      fbp: fbp(),
      fbc: fbc(a),
    },
    page: { url: url.toString(), referrer: document.referrer },
  };
}

export async function postLead(i: LeadInput): Promise<LeadResult> {
  const req = buildRequest(i);
  toTest('lp-request', req); // the gate: the body as the BFF would receive it (a no-op for a visitor)
  // stage 2: fetch('/api/lp/lead', { method: 'POST', body: JSON.stringify(req), keepalive: true }) — same contract
  const { receiveLead } = await import('./bff-mock');
  return receiveLead(req);
}

/** UUID v4 (randomUUID needs a secure context; the fallback builds the same format from getRandomValues) */
export function newKey(): string {
  const c = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let k = 0; k < 16; k++) b[k] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
