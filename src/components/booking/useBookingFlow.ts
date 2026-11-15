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
import { homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { errorKind, recommendServices } from '@/lib/api';
import { dubaiToday } from '@/lib/api/dubai';
import type { ApiErrorKind } from '@/lib/api/errors';
import type { Service } from '@/lib/api/types';
import { body, useBody } from '@/lib/body3d/store';
import { formatCatalogServicePrice } from '@/lib/catalog-service-price';
import { track } from '@/lib/analytics/track';
import { useFieldErrors } from '@/lib/forms/useFieldErrors';
import { collect, messageArgs, normalizePhone, requiredEmail, rules, type ErrorCode } from '@/lib/forms/validate';
import { clearResult, loadResult, saveResult, type StoredBooking } from '@/lib/booking/result';
import { PRESET_PARAMS, absorbPresetFromUrl, entryBroughtService, takePreset, type HandOver } from '@/lib/booking/preset';
import type { Locale } from '@/i18n/routing';
import type { BookingRecordRequest } from '@/lib/contracts/booking-record';
import { getAvailableDates, getAvailableTimes } from './booking-availability';
import { getBookingStaff } from './booking-staff';
import { bookingRejectionNotice, sendBooking } from './booking-submit';
import { confirmedCatalogId, getBookingCatalog, isLegacyStaffId, restoreServiceId } from './service-catalog';
import { useBookingSelection } from './useBookingSelection';

/** search params on the client only: calling useSearchParams() in the static prerender would make the whole flow
 *  client-rendered (CSR bailout) — exactly what the prerendered step 1 avoids */
const useClientSearchParams: () => Pick<URLSearchParams, 'get'> | null = typeof window === 'undefined' ? () => null : useSearchParams;
const NO_PARAMS: Pick<URLSearchParams, 'get'> = new URLSearchParams();

export const STEPS = ['zones', 'service', 'specialist', 'time', 'contacts', 'review', 'done'] as const;
export type BookingError = ApiErrorKind | 'slotTaken';

/** Async data with loading / error / retry, without setState in the effect body (state is keyed by the request). */
export function useAsync<T>(enabled: boolean, load: (signal: AbortSignal) => Promise<T>, key: unknown[], refreshOnEntry = false) {
  const [nonce, setNonce] = useState(0);
  const serialized = JSON.stringify([...key, nonce]);
  const identity = useMemo(() => ({ serialized, enabled }), [serialized, enabled]);
  const k = refreshOnEntry ? identity : serialized;
  const [res, setRes] = useState<{ k: typeof k; data?: T; error?: ApiErrorKind }>({ k: '' });
  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    load(request.signal).then((data) => { if (!request.signal.aborted) setRes({ k, data }); }, (e) => { if (!request.signal.aborted) { setRes({ k, error: errorKind(e) }); track('booking_error', { reason: errorKind(e) }); } });
    return () => request.abort();
    // `k` captures every input of `load` (the caller passes them in `key`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, enabled]);
  const status: 'idle' | 'loading' | 'error' | 'ready' = !enabled ? 'idle' : res.k !== k ? 'loading' : res.error ? 'error' : 'ready';
  return { status, data: res.k === k ? res.data : undefined, error: res.k === k ? res.error : undefined, retry: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useBookingFlow(demoServices: Service[]) {
  const t = useTranslations();
  const f = useFormatter();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const urlParams = useClientSearchParams();
  const [ready, setReady] = useState(false); // hydrated: the URL and the stored choices are in effect
  const [stored, setStored] = useState<StoredBooking | null>(null);
  const result = stored?.status === 'created' ? stored : null;
  const lockedStep = stored ? (result ? 7 : 6) : null;
  const sp = ready && urlParams ? urlParams : NO_PARAMS;
  const requestedStep = Number(sp.get('step'));
  const step = lockedStep ?? (Number.isInteger(requestedStep) ? Math.min(STEPS.length, Math.max(1, requestedStep)) : 1);
  const go = useCallback((n: number) => {
    router.push(n === 1 ? '/booking/' : `/booking/?step=${n}`);
  }, [router]);

  const markers = useBody((s) => s.markers);
  const generalNote = useBody((s) => s.generalNote);
  const model = useBody((s) => s.model);
  const restoredDraft = useBody((s) => s.restored);

  // Ж-9: presets are handed over, not written into the address (lib/booking/preset).
  const { sel, update, updateContact, clear, load } = useBookingSelection();
  const [selRestored, setSelRestored] = useState(false);
  const handedOver = useRef<HandOver | null | undefined>(undefined); // taken once, also when the effect runs twice (StrictMode)
  // Hydration-time read of the URL and sessionStorage (external, client-only): the render before it must equal the static
  // HTML, so this state cannot be initialised lazily; a layout effect re-renders before the first paint.
  useLayoutEffect(() => {
    // a link from outside (/booking/?service=…): on a page load the page's inline script has already moved the choice out of
    // the address; this covers what it does not (storage off, an address reached without a page load)
    absorbPresetFromUrl();
    if (handedOver.current === undefined) handedOver.current = takePreset();
    const p = handedOver.current ?? {};
    const presetServiceId = restoreServiceId(p.service ?? null);
    const legacyStaff = p.staff !== undefined && isLegacyStaffId(p.staff);
    const s = load({
      ...(presetServiceId === null ? {} : { serviceId: presetServiceId }),
      ...(p.staff && !legacyStaff ? { staffId: p.staff } : {}),
      ...(p.date && !legacyStaff ? { wantDate: p.date, wantTime: p.time ?? null, date: null, datetime: null } : {}),
    });
    // a service this visit brought itself is not «a draft found» — also after F5 on the same history entry and after the
    // language switch (`own`: the flag of the entry in the other language came along)
    const ownService = entryBroughtService(presetServiceId !== null || !!p.own);
    const hasSavedSelection = s.serviceId !== null || !!(s.contact.fullname || s.contact.phone || s.contact.email || s.contact.age);
    setSelRestored(hasSavedSelection && !ownService);
    setStored(loadResult());
    setReady(true);
    // once, on mount: a later hand-over on the same page does not override the choice (as ?service= did not)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [restoreDismissed, setRestoreDismissed] = useState(false);

  const catalogQ = useAsync(ready && step >= 2, (signal) => getBookingCatalog(locale, signal), ['catalog', locale]);
  const catalog = catalogQ.data;
  const services = useMemo(() => {
    if (!catalog) return [];
    const categories = new Map(catalog.categories.map(({ id, title }) => [id, title]));
    const translations = t.raw('home.services.cards') as HomeServiceTranslations;
    return catalog.services.map((item) => ({
      id: item.id,
      title: homeServiceTitle(locale, item, translations),
      currency: item.currency,
      durationMin: item.durationMin,
      categoryTitle: item.categoryId === null ? undefined : categories.get(item.categoryId),
      price: formatCatalogServicePrice(item, locale, {
        unknown: () => t('home.services.priceUnknown'),
        from: (price) => t('home.services.priceFrom', { price }),
      }),
      duration: item.durationMin === null ? null : t('home.services.duration', { minutes: item.durationMin }),
    }));
  }, [catalog, locale, t]);
  const recommended = useMemo(() => recommendServices(markers.map((m) => m.zoneId))
    .map(confirmedCatalogId)
    .filter((id): id is number => id !== undefined && services.some((s) => s.id === id)), [markers, services]);
  const ordered = useMemo(() => [...services].sort((a, b) => {
    const ra = recommended.indexOf(a.id), rb = recommended.indexOf(b.id);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  }), [services, recommended]);
  const catalogService = services.find((s) => s.id === sel.serviceId) ?? null;
  const needsService = step >= 3 && (sel.serviceId === null || (catalogQ.status === 'ready' && !catalogService));
  useEffect(() => {
    if (!stored && catalogQ.status === 'ready' && sel.serviceId !== null && !catalogService) {
      update({ serviceId: null, staffId: 0, date: null, datetime: null, wantDate: null, wantTime: null });
    }
  }, [stored, catalogQ.status, sel.serviceId, catalogService, update]);
  const selectService = (serviceId: number) => update({
    serviceId,
    date: null,
    datetime: null,
    // A preset without a service can carry a specialist or preferred day for the first choice.
    ...(sel.serviceId === null ? {} : { staffId: 0, wantDate: null, wantTime: null }),
  });

  const catalogServiceId = catalogService?.id;
  const staffQ = useAsync(step >= 3 && catalogServiceId !== undefined,
    (signal) => getBookingStaff(locale, catalogServiceId!, signal), ['staff', locale, catalogServiceId]);
  const staffName = staffQ.status === 'ready' ? staffQ.data?.find(({ id }) => id === sel.staffId)?.name ?? null : null;
  const staffUnavailable = staffQ.status === 'ready' && sel.staffId !== 0 && staffName === null;
  const selectStaff = useCallback((staffId: number) => {
    update({ staffId, date: null, datetime: null, wantDate: null, wantTime: null });
  }, [update]);
  useEffect(() => {
    if (!stored && staffUnavailable) selectStaff(0);
  }, [stored, staffUnavailable, selectStaff]);

  const availabilityEnabled = step >= 4 && !result && catalogServiceId !== undefined && staffQ.status === 'ready' && !staffUnavailable;
  const availabilitySelection = { serviceId: catalogServiceId!, staffId: sel.staffId, locale };
  const datesQ = useAsync(availabilityEnabled, (signal) => getAvailableDates(availabilitySelection, signal),
    ['dates', locale, catalogServiceId, sel.staffId], true);
  const today = dubaiToday();
  const availableDates = datesQ.status === 'ready' ? datesQ.data!.filter((date) => date >= today) : [];
  const preferredDate = sel.date ?? sel.wantDate ?? null;
  const selectedDate = preferredDate && availableDates.includes(preferredDate) ? preferredDate : null;
  const [takenSeq, setTakenSeq] = useState(0); // refresh after a slot conflict when record creation is connected
  const timesQ = useAsync(availabilityEnabled && selectedDate !== null,
    (signal) => getAvailableTimes(availabilitySelection, selectedDate!, signal),
    ['times', locale, catalogServiceId, sel.staffId, selectedDate, takenSeq], true);
  const slots = timesQ.status === 'ready' ? timesQ.data : undefined;
  const savedSlot = slots?.find(({ datetime }) => datetime === sel.datetime);
  const wantedSlot = !sel.datetime && selectedDate === sel.wantDate
    ? slots?.find(({ time }) => time === sel.wantTime) : undefined;
  const selectedDatetime = (savedSlot ?? wantedSlot)?.datetime ?? null;
  useEffect(() => {
    if (stored) return;
    if (datesQ.status === 'ready' && sel.date && !selectedDate) update({ date: null, datetime: null });
    else if (slots && sel.datetime && !savedSlot) update({ datetime: null });
    else if (wantedSlot && selectedDate) update({ date: selectedDate, datetime: wantedSlot.datetime, wantTime: null });
  }, [stored, datesQ.status, sel.date, sel.datetime, selectedDate, slots, savedSlot, wantedSlot, update]);
  const slotUnfit = !!sel.wantTime && !selectedDatetime && (
    (datesQ.status === 'ready' && !selectedDate)
    || (!!slots && selectedDate === sel.wantDate && !wantedSlot));

  const needsTime = step >= 5 && !selectedDatetime && (
    (!sel.datetime && !(sel.wantDate && sel.wantTime)) || timesQ.status === 'ready' || (datesQ.status === 'ready' && !selectedDate) ||
    [catalogQ.status, staffQ.status, datesQ.status, timesQ.status].includes('error'));
  // ---- formatting (Dubai time, ТЗ §07)
  const time = useCallback((iso: string) => f.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Dubai' }), [f]);
  const day = useCallback((ymd: string) => f.dateTime(new Date(`${ymd}T12:00:00+04:00`), { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'Asia/Dubai' }), [f]);
  const when = useCallback((iso: string) => `${day(dubaiToday(new Date(iso)))}, ${t('common.timeWithZone', { time: time(iso) })}`, [day, time, t]);

  // ---- step 1 → 2 rule (ТЗ §07 step 1): a marker or a general note
  const canLeaveZones = markers.length > 0 || generalNote.trim().length > 0;
  // ---- step 5: contacts — own validation (R-CODE-02 F-05): field errors, focus on the first, summary for several
  const contactV = useFieldErrors();
  const contactCheck = (c: typeof sel.contact, ageBad = false) => collect([
    ['c-name', rules.name(c.fullname)],
    ['c-phone', rules.phone(c.phone)],
    ['c-email', requiredEmail(c.email)],
    ['c-age', rules.age(c.age, ageBad)],
    ['c-consent', rules.filled(c.consent === true, 'consentRequired')],
    ['c-health', rules.filled(c.health === true, 'healthRequired')],
  ]);
  const contactOk = Object.keys(contactCheck(sel.contact)).length === 0;
  const needsContacts = step >= 6 && !contactOk;
  // Sync the cleaned address with the router and return deep links to the first required choice.
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const syncPreset = PRESET_PARAMS.some((k) => urlParams?.get(k) != null) && PRESET_PARAMS.every((k) => !url.searchParams.has(k));
    const linkedStep = Number(url.searchParams.get('step'));
    const fallback = linkedStep >= 3 ? (needsService ? 2 : needsTime ? 4 : needsContacts ? 5 : step === 7 ? 6 : null) : null;
    const replacement = lockedStep ?? fallback;
    if (!syncPreset && (replacement === null || replacement === linkedStep)) return;
    if (replacement !== null) url.searchParams.set('step', String(replacement));
    const own = Object.fromEntries(Object.entries((window.history.state ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith('__')));
    window.history.replaceState(own, '', url);
  }, [ready, urlParams, needsService, needsTime, lockedStep, needsContacts, step]);
  const contactMsg = (id: string) => { const c = contactV.errors[id]; return c ? t(`forms.error.${c}`, messageArgs(c)) : undefined; };
  /** blur / change of one field: `code` from the same rules, `filled` = the field has a value */
  const contactField = (id: string, code: ErrorCode | null, filled = true) => contactV.field(id, code, filled);
  const submitContacts = () => {
    if (!selectedDatetime) return false;
    const ageBad = (document.getElementById('c-age') as HTMLInputElement | null)?.validity.badInput ?? false;
    if (!contactV.submit(contactCheck(sel.contact, ageBad))) return false;
    const c = sel.contact;
    updateContact({ fullname: c.fullname.trim(), phone: normalizePhone(c.phone), email: c.email?.trim() || undefined }); // E.164 for the BFF
    go(6);
    return true;
  };
  /** the first step that still needs input (step 1 may be skipped) */
  const firstIncomplete = useCallback(() => (!sel.serviceId ? 2 : !sel.datetime ? 4 : !contactOk ? 5 : 6), [sel.serviceId, sel.datetime, contactOk]);

  // ТЗ §14 booking_step: once per step change (step 7 only with a result — without it the flow redirects); this flow = source 3d
  const trackedStep = useRef(0);
  useEffect(() => {
    if (!ready || (step === 7 && !result) || trackedStep.current === step) return;
    trackedStep.current = step;
    track('booking_step', { step, source: '3d' });
  }, [ready, step, result]);

  // Lock synchronously before the first await, including before React disables the button.
  const activeAttempt = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BookingError | null>(null);
  const [reviewNotice, setReviewNotice] = useState<ReturnType<typeof bookingRejectionNotice>>();
  const canConfirm = step === 6 && !!catalogService && !!selectedDatetime && contactOk && !stored;
  async function confirm() {
    if (activeAttempt.current || !canConfirm || !catalogService || !selectedDatetime) return;
    const idempotencyKey = globalThis.crypto?.randomUUID?.();
    if (!idempotencyKey) { setReviewNotice('unavailable'); return; }
    const { fullname, phone, email, age } = sel.contact;
    const input: BookingRecordRequest = {
      source: '3d', serviceId: catalogService.id, staffId: sel.staffId, datetime: selectedDatetime, locale,
      contact: { fullname: fullname.trim(), phone: normalizePhone(phone), email: email!.trim() }, age,
      consent: true, idempotencyKey,
      body3d: {
        healthConsent: true, model, generalNote: generalNote || undefined,
        markers: markers.map(({ zoneId, intensity, note }) => ({ zoneId, intensity, note })),
      },
    };
    activeAttempt.current = true;
    const at = new Date().toISOString();
    const pending = { status: 'unknown', at } as const;
    // A reload during the request must never start a second creation.
    saveResult(pending);
    setStored(pending);
    setReviewNotice(undefined);
    setError(null);
    setBusy(true);
    const response = await sendBooking(input);
    setBusy(false);
    if (response.status === 'created') {
      const snapshot = {
        ...response.data, serviceTitle: catalogService.title, durationMin: catalogService.durationMin,
        zones: markers.map(({ zoneId }) => zoneId), at,
      };
      saveResult(snapshot);
      setStored(snapshot);
      clear();
      body.resetDraft();
      if (catalogService.currency === 'AED') track('booking_success', {
        service_id: response.data.serviceId, staff_id: response.data.staff?.id ?? input.staffId, currency: 'AED', source: '3d',
      });
      return;
    }
    if (response.status === 'rejected') {
      const { code } = response.error;
      clearResult();
      setStored(null);
      activeAttempt.current = false;
      track('booking_error', { reason: code.toLowerCase() });
      if (code === 'SLOT_TAKEN') {
        setError('slotTaken');
        update({ datetime: null, wantTime: null });
        setTakenSeq((n) => n + 1);
        go(4);
      } else {
        setReviewNotice(bookingRejectionNotice(code));
      }
      return;
    }
    const uncertain = { status: response.status, at };
    saveResult(uncertain);
    setStored(uncertain);
  }

  const startOver = useCallback(() => {
    // Remove the completed step before clearing the result so the deep-link guard cannot redirect to step 2.
    window.history.replaceState(null, '', window.location.pathname);
    activeAttempt.current = false;
    clearResult();
    setStored(null);
    clear();
    body.resetDraft();
    setError(null);
    setRestoreDismissed(true);
  }, [clear]);

  return {
    t, ready, step, go, locale, slotUnfit, model, markers, generalNote, sel, update, updateContact, services: demoServices, ordered, recommended, staffName,
    catalogQ, catalogService, selectService, selectStaff,
    today, availableDates, selectedDate, selectedDatetime,
    staffQ, datesQ, timesQ, time, day, when, canLeaveZones, contactOk, firstIncomplete,
    contactErrors: contactV.errors, contactAttempt: contactV.attempt, contactMsg, contactField, submitContacts,
    busy, error, setError, confirm, result, startOver, canConfirm, reviewNotice, stored,
    offerRestore: step === 1 && !restoreDismissed && (restoredDraft || selRestored),
    continueDraft: () => { setRestoreDismissed(true); body.dismissRestored(); if (selRestored) go(firstIncomplete()); },
    discardDraft: () => { setRestoreDismissed(true); clear(); body.resetDraft(); },
  };
}
export type Flow = ReturnType<typeof useBookingFlow>;
