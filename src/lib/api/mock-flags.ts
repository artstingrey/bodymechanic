/**
 * Deterministic mock states for the gate (R-APP-01 F-01/F-07): `?mock=<mode>` in any URL of the tab; the mode is kept in
 * sessionStorage until `?mock=off`.
 * RC-9 (security review S-3): honoured ONLY when the gate installed its hook before the page's scripts (lib/dev/test-hook,
 * e2e/helpers.ts `testHook`). For a visitor the parameter does nothing — neither read nor stored — so nobody can break the
 * form in someone's tab with a link.
 *   queued      — POST /record answers {status:"queued"}
 *   slot_taken  — the first POST /check answers slot_taken (the slot then disappears from GET /times)
 *   offline     — the FIRST call of every endpoint fails with a network error, the retry succeeds
 *   server      — same, with a 5xx
 *   nodates     — GET /dates returns no dates (the 30 days are fully booked)
 * Without a flag: 13:30 is always «taken» at POST /check (classic demo of the race), everything else succeeds.
 */
import { ApiError } from './errors';
import { mockAllowed } from '@/lib/dev/test-hook';

export type MockMode = 'queued' | 'slot_taken' | 'offline' | 'server' | 'nodates';
const KEY = 'bm.mock';
const MODES: MockMode[] = ['queued', 'slot_taken', 'offline', 'server', 'nodates'];

export function mockMode(): MockMode | null {
  if (typeof window === 'undefined' || !mockAllowed()) return null;
  const q = new URLSearchParams(window.location.search).get('mock');
  try {
    if (q === 'off') sessionStorage.removeItem(KEY);
    else if (q && MODES.includes(q as MockMode)) sessionStorage.setItem(KEY, q);
    return (sessionStorage.getItem(KEY) as MockMode | null) ?? null;
  } catch { return MODES.includes(q as MockMode) ? (q as MockMode) : null; }
}

/** offline / server: the first call of `endpoint` in this tab fails, the next one (the user's «Повторить») succeeds. */
export function failOnce(endpoint: string) {
  const m = mockMode();
  if (m !== 'offline' && m !== 'server') return;
  const k = `bm.mock.failed.${endpoint}`;
  try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch { /* storage off: fail every time */ }
  throw new ApiError(m === 'offline' ? 'network' : 'server');
}

/** Slots reported as taken by POST /check — GET /times no longer offers them (ТЗ §07 «обновлённые слоты»). */
const TAKEN = 'bm.takenSlots';
export const takenSlots = (): string[] => { try { return JSON.parse(sessionStorage.getItem(TAKEN) || '[]'); } catch { return []; } };
export const markTaken = (datetime: string) => { try { sessionStorage.setItem(TAKEN, JSON.stringify([...new Set([...takenSlots(), datetime])])); } catch { /* ignore */ } };
/** slot_taken mode fires once per tab */
export function consumeSlotTaken(): boolean {
  if (mockMode() !== 'slot_taken') return false;
  try { if (sessionStorage.getItem('bm.mock.slotTakenFired')) return false; sessionStorage.setItem('bm.mock.slotTakenFired', '1'); } catch { /* ignore */ }
  return true;
}
