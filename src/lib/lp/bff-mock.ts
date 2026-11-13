/**
 * Prototype BFF for POST /api/lp/lead (lp-brief §5, T-03 / T-05 / T-06 / T-07 / T-09 / T-10 / T-12 / T-14; Frontend Builder).
 * Nothing leaves the browser: it answers like the server would and — only for the gate — builds, without sending, what
 * the server sends:
 *   - the Telegram message for the admins (T-09, template §5.3; marks per lp-config notifications.telegram);
 *   - the Meta Conversions API event (T-06) — ONLY with consent «Маркетинг»: same event_id as the Pixel's Lead,
 *     event_source_url = origin + path (no query), ph / fn SHA-256, fbc / fbp, custom_data lp_version only;
 *   - the Google Ads upload record (T-07: gclid always; wbraid and gbraid never together → wbraid) — ONLY with consent
 *     «Маркетинг» (R-LP-04 F-01: an upload is a transfer to a third party); without it the click IDs stay in the lead only;
 *   - the Altegio comment (T-10, stage 2): prefix «[Сайт/LP]» + first-visit UTM.
 * Server rules mirrored here: validation, utm_content / utm_term only as neutral IDs (else null, never logged — T-14),
 * idempotency by eventId for 24 h (a repeat returns the first answer: one Telegram message, one Lead), a rate limit,
 * gate only (lib/api/mock-flags): `?mock=queued` (backup queue), `?mock=server` / `?mock=offline` (the first call fails, the
 * retry succeeds), `?mock=off`.
 * RC-9 (security review S-1): the artefacts carry the visitor's name and phone, so they are built only when the gate
 * listens (lib/dev/test-hook) and handed to its sink — one `lp-bff` delivery per ACCEPTED lead (a repeat of the same key
 * delivers nothing). Nothing is kept on `window` and nothing is printed to the console.
 * The real BFF (stage 2) keeps tokens and chat ids in server env only — never NEXT_PUBLIC_* (T-06, T-09).
 */
import { failOnce, mockMode } from '@/lib/api/mock-flags';
import { ApiError } from '@/lib/api/errors';
import { formatComment } from '@/lib/altegio/formatComment';
import { hasTestSink, toTest } from '@/lib/dev/test-hook';
import CFG from './config.json';
import { CLICK_ID, googleClickIdsToSend, neutralOrNull } from './attr';
import type { LeadRequest, LeadResult } from './lead';

/** One accepted lead as the gate's sink receives it (channel `lp-bff`); capi / ads only with consent «Маркетинг». */
export interface BffArtefacts {
  request: LeadRequest;
  telegram: string;
  capi?: unknown;
  ads?: unknown;
  comment: string;
}

const SENT_KEY = 'bm.lp.sent';
const DAY = 24 * 3600_000;
const RATE = { max: 5, windowMs: 10 * 60_000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9]\d{7,14}$/;
const chipIds = new Set(Object.values(CFG.versions).flatMap((v) => v.chips.map((c) => c.id)));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sent = Record<string, { at: number; result: LeadResult }>;
const readSent = (): Sent => { try { return JSON.parse(sessionStorage.getItem(SENT_KEY) || '{}'); } catch { return {}; } };
const memory: Sent = {};

// The sample the real server is written from (security review Ж-2): every field is checked, by type, length and characters.
const LANGS = ['ru', 'en'];
const MAX = { name: 100, tag: 100, url: 2048 };
/** a control character (line breaks included): never part of a name or a tag */
const hasControl = (s: string) => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32 || c === 127) return true; } return false; };
/** Meta's _fbp / _fbc: fb.<n>.<ms>.<id>; click IDs (gclid, gbraid, wbraid, fbclid): CLICK_ID of ./attr */
const FB_COOKIE = /^fb\.\d\.\d{10,13}\.[\w.-]{1,500}$/;
const DUBAI_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+04:00$/;
const LP_PATH = /^\/(?:ru|en)\/lp\/(?:a|b)\/?$/;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max && !hasControl(v) ? v : null);
const match = (v: unknown, rx: RegExp) => (typeof v === 'string' && rx.test(v) ? v : null);

/**
 * What the server keeps of a request: the KNOWN fields only (anything else is dropped), every attribution value checked.
 * A bad tracking value becomes null and never rejects the lead — a visitor with a mangled link must still be able to leave
 * a request; utm_content / utm_term pass only as neutral IDs (T-14: anything else is null and is not logged).
 */
function known(r: LeadRequest): LeadRequest {
  const a = (r?.attribution ?? {}) as Partial<LeadRequest['attribution']>;
  const utm = (a.utm ?? {}) as Partial<LeadRequest['attribution']['utm']>, ids = (a.clickIds ?? {}) as Partial<LeadRequest['attribution']['clickIds']>;
  return {
    eventId: r.eventId, lang: r.lang, version: r.version, name: r.name, phone: r.phone, interests: r.interests,
    consent: { privacy: true, details: r.consent?.details === true, analytics: r.consent?.analytics === true, marketing: r.consent?.marketing === true },
    offerId: r.offerId,
    attribution: {
      utm: {
        source: text(utm.source, MAX.tag), medium: text(utm.medium, MAX.tag), campaign: text(utm.campaign, MAX.tag),
        content: neutralOrNull(text(utm.content, MAX.tag)), term: neutralOrNull(text(utm.term, MAX.tag)),
      },
      firstTouchAt: match(a.firstTouchAt, DUBAI_ISO),
      clickIds: { gclid: match(ids.gclid, CLICK_ID), gbraid: match(ids.gbraid, CLICK_ID), wbraid: match(ids.wbraid, CLICK_ID), fbclid: match(ids.fbclid, CLICK_ID) },
      fbp: match(a.fbp, FB_COOKIE),
      fbc: match(a.fbc, FB_COOKIE),
    },
    page: { url: r.page?.url, referrer: text(r.page?.referrer, MAX.url) ?? '' },
  };
}

/** server-side validation (zod at stage 2): the same rules, 400 on anything else */
function validate(r: LeadRequest): string | null {
  if (typeof r.eventId !== 'string' || !UUID.test(r.eventId)) return 'eventId';
  if (!LANGS.includes(r.lang)) return 'lang';
  if (r.version !== 'A' && r.version !== 'B') return 'version';
  if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > MAX.name || hasControl(r.name)) return 'name';
  if (typeof r.phone !== 'string' || !E164.test(r.phone)) return 'phone';
  if (!Array.isArray(r.interests) || r.interests.length > chipIds.size || r.interests.some((x) => !chipIds.has(x))) return 'interests';
  if (r.interests.length && !r.consent.details) return 'consentDetails'; // lp.error.consentDetails
  // the offer is the server's own setting: the real BFF ignores this field and writes its own; a request that names
  // another offer is not this site's form
  if (r.offerId !== CFG.offer.id) return 'offerId';
  // the page goes into the admins' message and the CAPI event: an http(s) address of a landing of THIS site, bounded
  // (the real BFF compares the origin with its configured site URL)
  if (typeof r.page.url !== 'string' || r.page.url.length > MAX.url) return 'page';
  try {
    const u = new URL(r.page.url);
    if (!/^https?:$/.test(u.protocol) || u.origin !== window.location.origin || !LP_PATH.test(u.pathname)) return 'page';
  } catch { return 'page'; }
  return null;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Meta ph: digits only, no leading zeros, with the country code (971501234567) */
const metaPhone = (e164: string) => e164.replace(/\D/g, '').replace(/^0+/, '');
const pathOf = (url: string) => { const u = new URL(url); return `${u.origin}${u.pathname}`; };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** «7 нояб., 14:32 (Дубай)» */
function dubaiTime(ms: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} (Дубай)`;
}

/** T-09: the admins' message (Telegram HTML). Server-side text for the admins — wording from lp-brief §5.3. */
async function telegramMessage(r: LeadRequest, res: LeadResult, at: number): Promise<string> {
  const tg = CFG.notifications.telegram;
  const u = r.attribution.utm;
  const ids = Object.entries(r.attribution.clickIds).filter(([, v]) => v).map(([k, v]) => `${k} ${esc(v!)}`);
  const lines = [
    // every value is escaped, the validated ones too (security review Ж-2): the template must stay safe when a rule changes
    `Новая заявка с лендинга · версия ${esc(r.version)} · ${esc(r.lang.toUpperCase())}`,
    `Время: ${dubaiTime(at)}`,
    `Имя: ${esc(r.name)}`,
    `Телефон: <a href="https://wa.me/${metaPhone(r.phone)}">${esc(r.phone)}</a>`,
  ];
  if (r.interests.length) {
    if (tg.includeMarks) {
      // after the lawyers' answer (J-13): «Что важно: …» in Russian — loaded only then, never in the bundle now
      const ru = (await import('../../../messages/ru.json')).default as unknown as { lp: { chips: Record<string, string> } };
      lines.push(`Что важно: ${r.interests.map((c) => ru.lp.chips[c] ?? c).join('; ')}`);
    } else {
      lines.push(tg.marksLineRu, tg.marksHintRu);
    }
  }
  lines.push(`Оффер: ${esc(r.offerId)}`);
  const utm = [u.source, u.medium, u.campaign, u.content, u.term].filter(Boolean);
  if (utm.length) lines.push(`UTM: ${utm.map((x) => esc(x!)).join(' / ')}`);
  if (ids.length) lines.push(`Клик-ID: ${ids.join(' · ')}`);
  lines.push(`Страница: ${esc(new URL(r.page.url).pathname)}`);
  lines.push(`Согласия: персональные данные — да, маркетинг — ${r.consent.marketing ? 'да' : 'нет'}`);
  if (res.status === 'queued') lines.push('Статус: в резервной очереди (система записи не ответила за 10 с)');
  lines.push(`Номер заявки: ${esc(r.eventId.slice(0, 8))}`);
  return lines.join('\n');
}

/** T-06: the CAPI event — only with consent «Маркетинг» */
async function capiEvent(r: LeadRequest, at: number) {
  return {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(at / 1000),
      event_id: r.eventId,
      event_source_url: pathOf(r.page.url),
      action_source: 'website',
      user_data: {
        ph: [await sha256(metaPhone(r.phone))],
        fn: [await sha256(r.name.trim().toLowerCase())],
        client_ip_address: null, // the real BFF: the request's IP, not hashed
        client_user_agent: navigator.userAgent,
        ...(r.attribution.fbc ? { fbc: r.attribution.fbc } : {}),
        ...(r.attribution.fbp ? { fbp: r.attribution.fbp } : {}),
      },
      custom_data: { lp_version: `lp_${r.version.toLowerCase()}` },
    }],
  };
}

/**
 * T-07: what a Google Ads upload would carry (stage 2 via Data Manager API) — built only with consent «Маркетинг» (the caller
 * checks; R-LP-04 F-01), and the record says so: consent ad_user_data / ad_personalization = GRANTED.
 */
async function adsRecord(r: LeadRequest, at: number) {
  return {
    conversion: 'LP Lead',
    order_id: r.eventId,
    conversion_time: new Date(at).toISOString(),
    ...googleClickIdsToSend(r.attribution.clickIds),
    hashed_phone_number: await sha256(r.phone),
    consent: { ad_user_data: 'GRANTED', ad_personalization: 'GRANTED' },
  };
}

export async function receiveLead(input: LeadRequest): Promise<LeadResult> {
  await wait(700); // network-ish: the busy state is real
  failOnce('lp-lead'); // ?mock=server | offline: the first call fails, the retry succeeds
  // known fields only, attribution cleaned (T-14: utm_content / utm_term as neutral IDs, else null — and not logged)
  const r = known(input);
  const bad = validate(r);
  if (bad) throw new ApiError('server'); // 400 at stage 2
  const now = Date.now();
  const sent = { ...readSent(), ...memory };
  const hit = sent[r.eventId];
  if (hit && now - hit.at < DAY) return hit.result; // idempotent: no second message, no second Lead
  const recent = Object.values(sent).filter((s) => now - s.at < RATE.windowMs).length;
  if (recent >= RATE.max) throw new ApiError('rateLimit'); // 429 at stage 2

  const result: LeadResult = { status: mockMode() === 'queued' ? 'queued' : 'ok', eventId: r.eventId };
  memory[r.eventId] = { at: now, result };
  try { sessionStorage.setItem(SENT_KEY, JSON.stringify({ ...readSent(), [r.eventId]: { at: now, result } })); } catch { /* memory still dedups */ }

  // What the server would send — built only for the gate (S-1): a visitor's page builds none of it
  if (hasTestSink()) {
    const utm = Object.fromEntries(Object.entries({ utm_source: r.attribution.utm.source, utm_medium: r.attribution.utm.medium, utm_campaign: r.attribution.utm.campaign }).filter(([, v]) => v)) as Record<string, string>;
    const artefacts: BffArtefacts = {
      request: r,
      telegram: await telegramMessage(r, result, now),
      // third parties only with consent «Маркетинг» (T-06 CAPI, T-07 Google Ads upload — R-LP-04 F-01); the lead keeps every ID
      ...(r.consent.marketing ? { capi: await capiEvent(r, now), ads: await adsRecord(r, now) } : {}),
      comment: formatComment({ source: 'lp', utm }),
    };
    toTest('lp-bff', artefacts); // one delivery per lead actually created (one per key)
  }
  return result;
}
