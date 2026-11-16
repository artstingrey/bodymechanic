/**
 * Landing events (lp-brief §5.1 / T-04 / T-05 — Frontend Builder). The only way the landing reports anything:
 * window.dataLayer → GTM (GA4, Meta Pixel and Google Ads tags live in the container, triggered by these events).
 *   lp_view            the page was shown (GA4)
 *   lp_form_start      first focus in a form field (GA4)
 *   lp_form_error      a validation error — its type only (GA4)
 *   lp_lead            Altegio confirmed the booking — Meta Lead, Google Ads «LP Lead», GA4
 *   lp_whatsapp_click  WhatsApp button — Meta Contact (own event_id), Google Ads «LP WhatsApp click» (secondary), GA4
 * Parameters: ONLY lp_version (a | b), lang, placement (hero | sticky | final), offer_id, event_id, error_type. Never the
 * chips, free text, name or phone (Meta Business Tools Terms 1.h, Google health policy — M7): the types below have no
 * field for them, and `push` drops anything else.
 * Same rule as the site (lib/analytics/track): nothing is written before consent — no queue that GTM would send later.
 */
import { measuringAllowed } from '@/lib/analytics/consent';
import CFG from './config.json';

export type Placement = 'hero' | 'sticky' | 'final';
export interface LeadEvent { eventId: string; variant: 'a' | 'b'; locale: string; placement?: Placement }

const ALLOWED = new Set(['lp_version', 'lang', 'placement', 'offer_id', 'event_id', 'error_type']);
let ctx: { variant: 'a' | 'b'; locale: string } | null = null;

/** The page sets its version and language once (LpTracking). */
export function setLpContext(variant: 'a' | 'b', locale: string) { ctx = { variant, locale }; }

function push(event: string, params: Record<string, string | undefined>): boolean {
  if (typeof window === 'undefined' || !measuringAllowed()) return false;
  const base = ctx ? { lp_version: ctx.variant, lang: ctx.locale } : {};
  const clean = Object.fromEntries(Object.entries({ ...base, ...params }).filter(([k, v]) => ALLOWED.has(k) && v != null && v !== ''));
  (window.dataLayer ||= []).push({ event, ...clean });
  return true;
}

/** placement of a form or a button: the sticky bar, the final form, else the first screen (header, hero form, the ?form=sheet sheet) */
export function placementOf(el: Element | null): Placement {
  if (!el) return 'hero';
  if (el.closest('.lp-sticky')) return 'sticky';
  if (el.closest('.lp-final, #lp-f2')) return 'final';
  return 'hero';
}

let viewed = false;
/** lp_view — once per page, the first time measuring is allowed (on load or right after the banner choice) */
export function trackView() { if (!viewed && push('lp_view', {})) viewed = true; }

let started = false;
/** lp_form_start — first focus in a field of any landing form */
export function trackFormStart(placement: Placement) { if (!started && push('lp_form_start', { placement })) started = true; }

/** lp_form_error — one event per failed field; the type only (name | phone | email) */
export function trackFormError(types: string[], placement: Placement) {
  for (const t of types) push('lp_form_error', { error_type: t, placement });
}

/** lp_lead — only after the booking is confirmed; event_id = the request's idempotency key */
export function trackLead({ eventId, variant, locale, placement }: LeadEvent): void {
  if (!ctx) setLpContext(variant, locale);
  push('lp_lead', { event_id: eventId, placement: placement ?? 'hero', offer_id: CFG.offer.id });
}

/** lp_whatsapp_click — its own event id (Meta Contact dedup) */
export function trackWhatsapp(placement: Placement, eventId: string) {
  push('lp_whatsapp_click', { event_id: eventId, placement, offer_id: CFG.offer.id });
}
