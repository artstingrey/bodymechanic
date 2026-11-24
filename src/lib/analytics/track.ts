/**
 * Analytics events (ТЗ §14): the only way the site reports anything — `track(event, params)` → window.dataLayer → GTM
 * (GA4 + Meta Pixel are configured in the container, not in the code). Names and parameters strictly follow the §14 table.
 *
 * DECISION (privacy): before consent nothing is written to dataLayer — no queue. GTM processes the whole dataLayer when it
 * loads, so a pre-consent queue would be sent retroactively the moment the visitor clicks «Принять». Events of a visit
 * before the consent are therefore lost on purpose.
 *
 * DECISION (lead 2026-11-07, deck D-01 / D-08, rule M7): nothing about wellbeing goes to GTM — no zone, no complaint text,
 * no note, no chip; service_id / staff_id are opaque numeric IDs only (no title, no slug). The zones stay in the record
 * comment (Altegio). The gate checks every event of a full booking (flows.spec «dataLayer carries no health data»).
 *
 * RC-9 (security review S-2): nothing is written on the account pages or in a document opened with an account address
 * (./private) — so account_login, booking_cancel and booking_reschedule below are declared but never reach dataLayer.
 */
import { measuringAllowed } from './consent';
import { analyticsOff } from './private';

export type BookingSource = '3d' | 'form';

/** ТЗ §14 «События»: event → parameters. */
export interface AnalyticsEvents {
  /** «Начать» pressed (home hero CTA) */
  body_open: Record<string, never>;
  /** gender of the model switched */
  body_model_switch: { model: 'male' | 'female' };
  /** a marker was placed (3D tap, 2D scheme or zone list) — WITHOUT the zone (D-01): the count, the step, the model */
  body_marker_add: { marker_count: number; step: number; model: 'male' | 'female' };
  /** a booking step was shown: 1–7 */
  booking_step: { step: number; source: BookingSource };
  /** a record was created (status «created»; «queued» is not a created record yet) */
  booking_success: { service_id?: number; staff_id: number; value?: number; currency: 'AED'; source: BookingSource };
  /** an error or a slot conflict: slot_taken | network | server | captcha | … */
  booking_error: { reason: string };
  /** «Мои записи» */
  account_login: Record<string, never>;
  booking_cancel: Record<string, never>;
  booking_reschedule: Record<string, never>;
  /** click on a WhatsApp or phone link */
  contact_click: { channel: 'whatsapp' | 'phone' };
}
export type AnalyticsEvent = keyof AnalyticsEvents;

declare global {
  interface Window { dataLayer?: unknown[] }
}

type Args<E extends AnalyticsEvent> = AnalyticsEvents[E] extends Record<string, never> ? [] : [AnalyticsEvents[E]];

export function track<E extends AnalyticsEvent>(event: E, ...params: Args<E>): void {
  if (typeof window === 'undefined' || !measuringAllowed() || analyticsOff()) return;
  const p = (params[0] ?? {}) as Record<string, unknown>;
  const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null));
  (window.dataLayer ||= []).push({ event, ...clean });
}
