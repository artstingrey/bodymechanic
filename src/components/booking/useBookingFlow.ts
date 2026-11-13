'use client';
/**
 * Booking logic (ТЗ §07) — state, data, actions. The step views in ./steps/* only render what this hook returns
 * (Web Art Director owns the views; Frontend Builder owns this file).
 *  - step in the URL (?step=N), choices in sessionStorage (useBookingSelection + body store);
 *  - every data step has loading / error («Повторить») / empty states (R-APP-01 F-07);
 *  - the result is persisted (lib/booking/result) and the draft is cleared on success (F-01, F-02);
 *  - step 7 without a result → the first unfinished step (F-01);
 *  - R-FINAL perf (option A): step 1 is PRERENDERED — the static HTML is the real step 1 (its poster = the LCP, no
 *    client-only swap). The URL (?step), the choice a link handed over and the stored choices are read after hydration
 *    (`ready`, set in a layout effect → re-rendered before the first paint); deep links to steps 2–7 stay hidden until
 *    then (app/[locale]/booking/page.tsx), so step 1 never flashes;
 *  - RC-10, Ж-9: a choice that comes with a link (service, specialist, day, time) is not kept in the address — see
 *    lib/booking/preset. The address of the booking is /booking/ or /booking/?step=N, nothing else.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { errorKind, getDates, getStaff, getTimes, postCheck, postCode, postRecord, recommendServices } from '@/lib/api';
import type { ApiErrorKind } from '@/lib/api/errors';
import type { Service, Slot, Staff } from '@/lib/api/types';
import { body, useBody } from '@/lib/body3d/store';
import { BOOKING_SMS_REQUIRED } from '@/lib/config';
import { track } from '@/lib/analytics/track';
import { useFieldErrors } from '@/lib/forms/useFieldErrors';
import { collect, messageArgs, normalizePhone, rules, type ErrorCode } from '@/lib/forms/validate';
import { clearResult, loadResult, saveResult, type BookingResult } from '@/lib/booking/result';
import { PRESET_PARAMS, absorbPresetFromUrl, entryBroughtService, takePreset, type HandOver } from '@/lib/booking/preset';
import type { Locale } from '@/i18n/routing';
import { useBookingSelection } from './useBookingSelection';

/** search params on the client only: calling useSearchParams() in the static prerender would make the whole flow
 *  client-rendered (CSR bailout) — exactly what the prerendered step 1 avoids */
const useClientSearchParams: () => Pick<URLSearchParams, 'get'> | null = typeof window === 'undefined' ? () => null : useSearchParams;
const NO_PARAMS: Pick<URLSearchParams, 'get'> = new URLSearchParams();

export const STEPS = ['zones', 'service', 'specialist', 'time', 'contacts', 'review', 'done'] as const;
export type BookingError = ApiErrorKind | 'slotTaken';

/** Async data with loading / error / retry, without setState in the effect body (state is keyed by the request). */
export function useAsync<T>(enabled: boolean, load: () => Promise<T>, key: unknown[]) {
  const [nonce, setNonce] = useState(0);
  const k = JSON.stringify([...key, nonce]);
  const [res, setRes] = useState<{ k: string; data?: T; error?: ApiErrorKind }>({ k: '' });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    load().then((data) => { if (alive) setRes({ k, data }); }, (e) => { if (alive) { setRes({ k, error: errorKind(e) }); track('booking_error', { reason: errorKind(e) }); } });
    return () => { alive = false; };
    // `k` captures every input of `load` (the caller passes them in `key`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, enabled]);
  const status: 'idle' | 'loading' | 'error' | 'ready' = !enabled ? 'idle' : res.k !== k ? 'loading' : res.error ? 'error' : 'ready';
  return { status, data: res.k === k ? res.data : undefined, error: res.k === k ? res.error : undefined, retry: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useBookingFlow(services: Service[]) {
  const t = useTranslations();
  const f = useFormatter();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const urlParams = useClientSearchParams();
  const [ready, setReady] = useState(false); // hydrated: the URL and the stored choices are in effect
  const sp = ready && urlParams ? urlParams : NO_PARAMS;
  const step = Math.min(7, Math.max(1, Number(sp.get('step')) || 1));
  const slotLink = useRef(false); // R-FINAL-2: came from a specialist's slot (staff + date + time) → step 2 → straight to 4
  const stepNow = useRef(step);
  useEffect(() => { stepNow.current = step; }, [step]);
  const go = useCallback((n: number, replace = false) => {
    if (n === 3 && stepNow.current === 2 && slotLink.current) n = 4; // forward from the service only; «Назад» from 4 still reaches 3
    const href = n === 1 ? '/booking' : `/booking?step=${n}`;
    if (replace) router.replace(href); else router.push(href);
  }, [router]);

  const markers = useBody((s) => s.markers);
  const generalNote = useBody((s) => s.generalNote);
  const model = useBody((s) => s.model);
  const restoredDraft = useBody((s) => s.restored);

  // The service and specialist pages, a specialist's free window and «Записаться снова» preselect the choice (only known
  // services, ids > 0). Ж-9: it is handed over, not written into the address (lib/booking/preset).
  const { sel, update, updateContact, clear, load } = useBookingSelection();
  const [selRestored, setSelRestored] = useState(false);
  const handedOver = useRef<HandOver | null | undefined>(undefined); // taken once, also when the effect runs twice (StrictMode)
  // ---- result (step 7) — survives F5; without it step 7 is not reachable
  const [result, setResult] = useState<BookingResult | null>(null);
  // Hydration-time read of the URL and sessionStorage (external, client-only): the render before it must equal the static
  // HTML, so this state cannot be initialised lazily; a layout effect re-renders before the first paint.
  useLayoutEffect(() => {
    // a link from outside (/booking/?service=…): on a page load the page's inline script has already moved the choice out of
    // the address; this covers what it does not (storage off, an address reached without a page load)
    absorbPresetFromUrl();
    if (handedOver.current === undefined) handedOver.current = takePreset();
    const p = handedOver.current ?? {};
    const s = load({
      ...(services.some((x) => x.id === p.service) ? { serviceId: p.service } : {}),
      ...(p.staff ? { staffId: p.staff } : {}),
      ...(p.date ? { wantDate: p.date, date: null, datetime: null } : {}),
      ...(p.date && p.time ? { wantTime: p.time } : {}),
    });
    // a service this visit brought itself is not «a draft found» — also after F5 on the same history entry and after the
    // language switch (`own`: the flag of the entry in the other language came along)
    setSelRestored(s.serviceId != null && !entryBroughtService(!!p.service || !!p.own));
    setResult(loadResult());
    setReady(true);
    // once, on mount: a later hand-over on the same page does not override the choice (as ?service= did not)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The router read the address before the parameters left it (only when the layout effect above had to move them): it
  // would write them back with its next history update. Its own documented way to learn the current address without a
  // navigation or a request is a native replaceState with a state object that is not the router's (Native History API).
  useEffect(() => {
    if (!ready || !PRESET_PARAMS.some((k) => urlParams?.get(k) != null)) return;
    if (PRESET_PARAMS.some((k) => new URLSearchParams(window.location.search).has(k))) return; // nothing was moved: leave it
    const own = Object.fromEntries(Object.entries((window.history.state ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith('__')));
    window.history.replaceState(own, '', `${window.location.pathname}${window.location.search}${window.location.hash}`);
  }, [ready, urlParams]);
  const [restoreDismissed, setRestoreDismissed] = useState(false);

  const recommended = useMemo(() => recommendServices(markers.map((m) => m.zoneId)), [markers]);
  const ordered = useMemo(() => [...services].sort((a, b) => {
    const ra = recommended.indexOf(a.id), rb = recommended.indexOf(b.id);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  }), [services, recommended]);
  const service = services.find((s) => s.id === sel.serviceId) ?? null;

  // ---- data (steps 3, 4, 6)
  const [takenSeq, setTakenSeq] = useState(0); // a slot_taken answer refreshes the times (the taken slot disappears)
  const staffQ = useAsync<Staff[]>((step === 3 || step === 6) && !!sel.serviceId, () => getStaff(locale, sel.serviceId!), ['staff', locale, sel.serviceId]);
  const datesQ = useAsync<string[]>(step === 4 && !!sel.serviceId, () => getDates(sel.serviceId!, sel.staffId), ['dates', sel.serviceId, sel.staffId]);
  // the day in effect: picked by the visitor, else the preferred day of the link when it is free for this service / specialist
  const day0 = sel.date ?? (sel.wantDate && datesQ.data?.includes(sel.wantDate) ? sel.wantDate : null);
  const timesQ = useAsync<Slot[]>(step === 4 && !!sel.serviceId && !!day0, () => getTimes(sel.serviceId!, sel.staffId, day0!), ['times', sel.serviceId, sel.staffId, day0, takenSeq]);
  // N2-01: the specialist's name for the summary of steps 4–6 when it came with the link (?staff — the slot link skips step 3,
  // so the per-service list above was never loaded); also covers a specialist outside the chosen service's list
  const knownInList = !!staffQ.data?.some((s) => s.id === sel.staffId);
  const staffAllQ = useAsync<Staff[]>(step >= 4 && step <= 6 && sel.staffId > 0 && !knownInList, () => getStaff(locale), ['staff-all', locale]);
  const staffName = sel.staffId ? (staffQ.data?.find((s) => s.id === sel.staffId) ?? staffAllQ.data?.find((s) => s.id === sel.staffId))?.name ?? null : null;

  // ---- slot link of the specialist page (?staff&date&time, R-FINAL-2): after the service → step 4 with that slot picked
  //      when the service has it; else the calendar opens on that day with booking.time.slotUnfit (no default service)
  useEffect(() => { slotLink.current = !!(sel.wantTime && sel.wantDate && sel.staffId); }, [sel.wantTime, sel.wantDate, sel.staffId]);
  const wantedSlot = step === 4 && sel.wantTime && day0 === sel.wantDate ? timesQ.data?.find((s) => s.time === sel.wantTime) ?? null : null;
  useEffect(() => { if (wantedSlot && !sel.datetime) update({ date: wantedSlot.datetime.slice(0, 10), datetime: wantedSlot.datetime, wantTime: null }); }, [wantedSlot, sel.datetime, update]);
  const slotUnfit = step === 4 && !!sel.wantTime && !sel.datetime && (
    (datesQ.status === 'ready' && !!sel.wantDate && !datesQ.data?.includes(sel.wantDate))
    || (timesQ.status === 'ready' && day0 === sel.wantDate && !wantedSlot));

  // ---- formatting (Dubai time, ТЗ §07)
  const time = useCallback((iso: string) => f.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }), [f]);
  const day = useCallback((ymd: string) => f.dateTime(new Date(`${ymd}T12:00:00+04:00`), { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'Asia/Dubai' }), [f]);
  const when = useCallback((iso: string) => `${day(iso.slice(0, 10))}, ${t('common.timeWithZone', { time: time(iso) })}`, [day, time, t]);

  // ---- step 1 → 2 rule (ТЗ §07 step 1): a marker or a general note
  const canLeaveZones = markers.length > 0 || generalNote.trim().length > 0;
  // ---- step 5: contacts — own validation (R-CODE-02 F-05): field errors, focus on the first, summary for several
  const contactV = useFieldErrors();
  const contactCheck = (c: typeof sel.contact, ageBad = false) => collect([
    ['c-name', rules.name(c.fullname)],
    ['c-phone', rules.phone(c.phone)],
    ['c-email', rules.email(c.email)],
    ['c-age', rules.age(c.age, ageBad)],
    ['c-consent', rules.filled(c.consent, 'consentRequired')],
    ['c-health', rules.filled(c.health, 'healthRequired')],
  ]);
  const contactOk = Object.keys(contactCheck(sel.contact)).length === 0;
  const contactMsg = (id: string) => { const c = contactV.errors[id]; return c ? t(`forms.error.${c}`, messageArgs(c)) : undefined; };
  /** blur / change of one field: `code` from the same rules, `filled` = the field has a value */
  const contactField = (id: string, code: ErrorCode | null, filled = true) => contactV.field(id, code, filled);
  const submitContacts = () => {
    const ageBad = (document.getElementById('c-age') as HTMLInputElement | null)?.validity.badInput ?? false;
    if (!contactV.submit(contactCheck(sel.contact, ageBad))) return;
    const c = sel.contact;
    updateContact({ fullname: c.fullname.trim(), phone: normalizePhone(c.phone), email: c.email?.trim() || undefined }); // E.164 for the BFF
    go(6);
  };
  /** the first step that still needs input (step 1 may be skipped) */
  const firstIncomplete = useCallback(() => (!sel.serviceId ? 2 : !sel.datetime ? 4 : !contactOk ? 5 : 6), [sel.serviceId, sel.datetime, contactOk]);

  useEffect(() => { if (ready && step === 7 && !result) go(firstIncomplete(), true); }, [ready, step, result, go, firstIncomplete]);
  // ТЗ §14 booking_step: once per step change (step 7 only with a result — without it the flow redirects); this flow = source 3d
  const trackedStep = useRef(0);
  useEffect(() => {
    if (!ready || (step === 7 && !result) || trackedStep.current === step) return;
    trackedStep.current = step;
    track('booking_step', { step, source: '3d' });
  }, [ready, step, result]);

  // ---- step 6: captcha (Turnstile at stage 2; demo token here), optional SMS code
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  useEffect(() => {
    if (step !== 6 || captchaToken) return;
    const id = window.setTimeout(() => setCaptchaToken(`demo-${Date.now().toString(36)}`), 600);
    return () => window.clearTimeout(id);
  }, [step, captchaToken]);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  // ---- confirm
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BookingError | null>(null);
  const [idempotencyKey] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}`));
  const confirm = useCallback(async () => {
    if (!service || !sel.datetime || !captchaToken) return;
    setError(null);
    if (BOOKING_SMS_REQUIRED && !codeSent) { await postCode(sel.contact.phone); setCodeSent(true); return; }
    setBusy(true);
    const draft = { ...body.draft(locale), serviceIds: [service.id], staffId: sel.staffId, datetime: sel.datetime };
    try {
      const check = await postCheck(draft);
      if ('error' in check) { track('booking_error', { reason: 'slot_taken' }); setBusy(false); setError('slotTaken'); update({ datetime: null }); setTakenSeq((n) => n + 1); go(4); return; }
      const res = await postRecord({ draft, contact: sel.contact, captchaToken, idempotencyKey, source: '3d', ...(BOOKING_SMS_REQUIRED ? { code } : {}) });
      if (res.status === 'created') track('booking_success', { service_id: service.id, staff_id: sel.staffId, value: service.priceOnRequest ? undefined : service.priceMin ?? undefined, currency: 'AED', source: '3d' });
      const snapshot: BookingResult = { ...res, datetime: sel.datetime, serviceTitle: service.title, durationMin: service.durationMin, staffName, zones: markers.map((m) => m.zoneId), at: new Date().toISOString() };
      saveResult(snapshot);
      setResult(snapshot);
      clear(); // ТЗ 6.8 MUST: the draft is cleared after a successful booking (F-02)
      body.resetDraft();
      setBusy(false);
      go(7);
    } catch (e) {
      setBusy(false);
      setError(errorKind(e));
      track('booking_error', { reason: errorKind(e) });
    }
  }, [service, sel, captchaToken, codeSent, locale, update, go, idempotencyKey, code, staffName, markers, clear]);

  const startOver = useCallback(() => {
    clearResult(); setResult(null); clear(); body.resetDraft(); setError(null); setRestoreDismissed(true); go(1);
  }, [clear, go]);

  return {
    t, ready, step, go, locale, slotUnfit, model, markers, generalNote, sel: day0 === sel.date ? sel : { ...sel, date: day0 }, update, updateContact, services, ordered, recommended, service, staffName,
    staffQ, datesQ, timesQ, time, day, when, canLeaveZones, contactOk, firstIncomplete,
    contactErrors: contactV.errors, contactAttempt: contactV.attempt, contactMsg, contactField, submitContacts,
    captchaToken, code, setCode, codeSent, busy, error, setError, confirm, result, startOver,
    offerRestore: step === 1 && !restoreDismissed && (restoredDraft || selRestored),
    continueDraft: () => { setRestoreDismissed(true); body.dismissRestored(); const n = firstIncomplete(); if (n > 1 && sel.serviceId) go(n); },
    discardDraft: () => { setRestoreDismissed(true); clear(); body.resetDraft(); },
  };
}
export type Flow = ReturnType<typeof useBookingFlow>;
