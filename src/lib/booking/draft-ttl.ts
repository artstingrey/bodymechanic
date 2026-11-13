/**
 * Lifetime of the booking draft in sessionStorage (RC-9, security review Ж-5): `bm.bookingDraft` (zones, notes about the
 * visitor's wellbeing), `bm.bookingSteps` (name, phone, e-mail, age) and `bm.bookingResult` (zones of the made record).
 * sessionStorage lives as long as the tab — and comes back when the browser restores its tabs — so an unfinished booking
 * could wait there for the next person at a shared computer for days. Each key now carries the time of its last change
 * and is dropped when read later than a day after it.
 */
export const DRAFT_TTL_MS = 24 * 3600_000;

/** `savedAt` (ms) older than a day. A value without the stamp (written before RC-9) is kept: its next save stamps it. */
export const draftExpired = (savedAt: unknown, now = Date.now()): boolean => typeof savedAt === 'number' && now - savedAt > DRAFT_TTL_MS;
