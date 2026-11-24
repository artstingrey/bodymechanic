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
import { recommendServices } from '@/lib/api';
import { dubaiToday } from '@/lib/api/dubai';
import type { ApiErrorKind } from '@/lib/api/errors';
import { body, useBody } from '@/lib/body3d/store';
import { catalogServiceDuration, formatCatalogServicePrice, formatCatalogServiceTotal } from '@/lib/catalog-service-price';
import { track } from '@/lib/analytics/track';
import { useFieldErrors } from '@/lib/forms/useFieldErrors';
import { collect, messageArgs, normalizePhone, requiredEmail, rules, type ErrorCode } from '@/lib/forms/validate';
import { PRESET_PARAMS, absorbPresetFromUrl, entryBroughtService, takePreset, type HandOver } from '@/lib/booking/preset';
import type { Locale } from '@/i18n/routing';
import type { BookingRecordInput } from '@/lib/contracts/booking-record';
import { updateBookingServices } from '@/lib/contracts/booking-services';
import { bookingUrl, getBookingOptions } from './useBookingOptions';
import { useAsync } from './useAsync';
import { bookingRejectionNotice } from './booking-submit';
import { useBookingAttempt, type BookingAttemptOutcome } from './useBookingAttempt';
import { catalogRecommendationIds, getBookingCatalog, isLegacyStaffId, restoreServiceId } from './service-catalog';
import { useBookingSelection } from './useBookingSelection';

/** search params on the client only: calling useSearchParams() in the static prerender would make the whole flow
 *  client-rendered (CSR bailout) — exactly what the prerendered step 1 avoids */
const useClientSearchParams: () => Pick<URLSearchParams, 'get'> | null = typeof window === 'undefined' ? () => null : useSearchParams;
const NO_PARAMS: Pick<URLSearchParams, 'get'> = new URLSearchParams();

export const STEPS = ['zones', 'service', 'specialist', 'time', 'contacts', 'review', 'done'] as const;
export type BookingError = ApiErrorKind | 'slotTaken';

export function useBookingFlow() {
  const t = useTranslations();
  const f = useFormatter();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const urlParams = useClientSearchParams();
  const [ready, setReady] = useState(false); // hydrated: the URL and the stored choices are in effect
  const { stored, busy, book, check, clear: clearResult } = useBookingAttempt('3d', locale);
  const [reviewNotice, setReviewNotice] = useState<ReturnType<typeof bookingRejectionNotice>>();
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
    const fromStaffProfile = p.staffProfile === true && !legacyStaff;
    const profileWindow = fromStaffProfile && !!p.date && !!p.time;
    const s = load({
      ...(presetServiceId !== null || profileWindow ? { serviceIds: presetServiceId === null ? [] : [presetServiceId] } : {}),
      ...(p.staff && !legacyStaff ? { staffId: p.staff } : {}),
      ...(fromStaffProfile ? { staffPreset: { serviceId: presetServiceId ?? undefined }, wantDate: null, wantTime: null } : {}),
      ...(p.date && !legacyStaff ? { wantDate: p.date, wantTime: p.time ?? null, date: null, datetime: null } : {}),
    });
    // a service this visit brought itself is not «a draft found» — also after F5 on the same history entry and after the
    // language switch (`own`: the flag of the entry in the other language came along)
    const ownService = entryBroughtService(presetServiceId !== null || fromStaffProfile || !!p.own);
    const hasSavedSelection = s.serviceIds.length > 0 || !!(s.contact.fullname || s.contact.phone || s.contact.email || s.contact.age);
    setSelRestored(hasSavedSelection && !ownService);
    setReady(true);
    // once, on mount: a later hand-over on the same page does not override the choice (as ?service= did not)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [restoreDismissed, setRestoreDismissed] = useState(false);

  const catalogQ = useAsync(ready && step >= 2, (signal) => getBookingCatalog(locale, signal), ['catalog', locale]);
  const catalog = catalogQ.data;
  const [removedServices, setRemovedServices] = useState<number[]>([]);
  const [changedAfterRemoval, setChangedAfterRemoval] = useState(false);
  const missingFromCatalog = catalogQ.status === 'ready' ? sel.serviceIds.filter((id) => !catalog?.services.some((item) => item.id === id)) : [];
  const selectedIds = sel.serviceIds.filter((id) => !removedServices.includes(id) && !missingFromCatalog.includes(id));
  const serviceSelected = catalogQ.status === 'ready' && selectedIds.length > 0 && selectedIds.length === sel.serviceIds.length;
  const selection = { serviceIds: selectedIds, locale };
  const staffQ = useAsync((step >= 3 || reviewNotice === 'serviceUnavailable') && serviceSelected,
    (signal) => getBookingOptions('staff', bookingUrl('staff', selection), signal), ['staff', locale, selectedIds], true);
  const staff = staffQ.data ?? [];
  const staffReady = staffQ.status === 'ready' && staff.length > 0;
  const soleStaff = staffReady && staff.length === 1 ? staff[0].id : null;
  const profileStaffUnavailable = !!sel.staffPreset && staffQ.status === 'ready' && !staff.some(({ id }) => id === sel.staffId);
  const staffId = soleStaff ?? sel.staffId;
  const staffName = staffReady ? staff.find(({ id }) => id === staffId)?.name ?? null : null;
  const staffUnavailable = staffReady && staffId !== 0 && !staffName;
  const needsStaff = step >= 4 && staffQ.status === 'ready' && (!staffReady || profileStaffUnavailable || staffUnavailable);
  const serviceRemoved = removedServices.length > 0 && !changedAfterRemoval;
  const needsService = step >= 3 && (!sel.serviceIds.length || serviceRemoved || missingFromCatalog.length > 0 || !!staffQ.missing);
  const selectStaff = useCallback((staffId: number) => {
    update({ staffId, staffPreset: null, date: null, datetime: null, wantDate: null, wantTime: null });
  }, [update]);
  useEffect(() => {
    if (stored || profileStaffUnavailable) return;
    if (soleStaff !== null && soleStaff !== sel.staffId) {
      if (sel.staffId === 0) update({ staffId: soleStaff });
      else selectStaff(soleStaff);
    }
    else if (staffUnavailable) selectStaff(0);
  }, [stored, soleStaff, sel.staffId, staffUnavailable, profileStaffUnavailable, selectStaff, update]);

  const staffCatalogQ = useAsync(serviceSelected && staffId > 0 && (step === 2 || staffReady && !!staffName),
    (signal) => getBookingCatalog(locale, signal, staffId).catch(() => null), ['staff-catalog', locale, staffId], true);
  const catalogByStaff = staffCatalogQ.status === 'ready' ? staffCatalogQ.data?.services : undefined;
  const services = useMemo(() => {
    if (!catalog) return [];
    const categories = new Map(catalog.categories.map(({ id, title }) => [id, title]));
    const staffServices = new Map(catalogByStaff?.map((item) => [item.id, item]));
    const translations = t.raw('home.services.cards') as HomeServiceTranslations;
    return catalog.services.filter(({ id }) => !removedServices.includes(id)).map((item) => {
      const detail = staffServices.get(item.id) ?? item;
      return {
        ...detail,
        id: item.id,
        title: homeServiceTitle(locale, item, translations),
        categoryTitle: item.categoryId === null ? undefined : categories.get(item.categoryId),
        price: formatCatalogServicePrice(detail, locale, {
          unknown: () => t('home.services.priceUnknown'),
          from: (price) => t('home.services.priceFrom', { price }),
        }),
        duration: detail.durationMin === null ? null : t('home.services.duration', { minutes: detail.durationMin }),
      };
    });
  }, [catalog, catalogByStaff, locale, removedServices, t]);
  const recommended = useMemo(() => {
    const availableIds = new Set(services.map(({ id }) => id));
    for (const legacyId of recommendServices(markers.map(({ zoneId }) => zoneId))) {
      const matches = catalogRecommendationIds(legacyId).filter((id) => availableIds.has(id));
      if (matches.length > 0) return matches;
    }
    return [];
  }, [markers, services]);
  const ordered = useMemo(() => [...services].sort((a, b) => {
    const ra = recommended.indexOf(a.id), rb = recommended.indexOf(b.id);
    return (ra < 0 ? recommended.length : ra) - (rb < 0 ? recommended.length : rb);
  }), [services, recommended]);
  const selectedServices = selectedIds.flatMap((id) => services.find((item) => item.id === id) ?? []);
  const serviceTitle = selectedServices.map(({ title }) => title).join(' · ');
  const price = formatCatalogServiceTotal(selectedServices, locale, {
    unknown: () => t('home.services.priceUnknown'),
    from: (price) => t('home.services.priceFrom', { price }),
  });
  const servicePrice = staffId && selectedServices.some(({ id }) => !catalogByStaff?.some((item) => item.id === id)) &&
    price !== t('home.services.priceUnknown') ? t('booking.service.estimate', { price }) : price;
  const selectService = (id: number, checked: boolean) => {
    setChangedAfterRemoval(true);
    setReviewNotice(undefined);
    update((current) => {
      const retainPreference = !current.serviceIds.length || !!current.staffPreset;
      return { serviceIds: updateBookingServices(current.serviceIds, id, checked), date: null, datetime: null,
        ...(current.staffPreset ? {} : { staffId: 0 }),
        ...(retainPreference ? {} : { wantDate: null, wantTime: null }) };
    });
  };
  const advanceFromService = () => {
    setChangedAfterRemoval(true);
    go(sel.staffPreset && sel.wantDate && sel.wantTime ? 4 : 3);
  };

  const availabilityEnabled = step >= 4 && !result && serviceSelected && staffReady && !staffUnavailable && !profileStaffUnavailable;
  const availabilitySelection = { ...selection, staffId };
  const datesQ = useAsync(availabilityEnabled, (signal) => getBookingOptions('dates', bookingUrl('dates', availabilitySelection), signal),
    ['dates', locale, selectedIds, staffId], true);
  const today = dubaiToday();
  const availableDates = datesQ.status === 'ready' ? datesQ.data!.filter((date) => date >= today) : [];
  const preferredDate = sel.date ?? sel.wantDate ?? null;
  const selectedDate = preferredDate && availableDates.includes(preferredDate) ? preferredDate : null;
  const timesQ = useAsync(availabilityEnabled && selectedDate !== null,
    (signal) => getBookingOptions('times', bookingUrl('times', { ...availabilitySelection, date: selectedDate! }), signal),
    ['times', locale, selectedIds, staffId, selectedDate], true);
  const slots = timesQ.status === 'ready' ? timesQ.data : undefined;
  const savedSlot = slots?.find(({ datetime }) => datetime === sel.datetime);
  const wantedSlot = !sel.datetime && selectedDate === sel.wantDate
    ? slots?.find(({ time }) => time === sel.wantTime) : undefined;
  const selectedSlot = savedSlot ?? wantedSlot;
  const selectedDatetime = selectedSlot?.datetime ?? null;
  const durationMin = catalogServiceDuration(selectedServices, selectedSlot?.durationSeconds);
  const serviceDuration = durationMin === null ? null : t(selectedIds.length > 1 && selectedSlot?.durationSeconds === undefined
    ? 'booking.service.durationEstimate' : 'home.services.duration', { minutes: durationMin });
  const removed = [...missingFromCatalog, ...(staffQ.missing ?? []), ...(datesQ.missing ?? []), ...(timesQ.missing ?? [])]
    .filter((id) => sel.serviceIds.includes(id));
  if (!stored && removed.length) {
    setRemovedServices((current) => [...new Set([...current, ...removed])]);
    setChangedAfterRemoval(false);
    update((current) => ({ serviceIds: current.serviceIds.filter((id) => !removed.includes(id)),
      staffId: current.staffPreset ? current.staffId : 0, date: null, datetime: null, wantDate: null, wantTime: null }));
  }
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
  ]);
  const contactOk = Object.keys(contactCheck(sel.contact)).length === 0;
  const needsContacts = step >= 6 && !contactOk;
  // Sync the cleaned address with the router and return deep links to the first required choice.
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const syncPreset = PRESET_PARAMS.some((k) => urlParams?.get(k) != null) && PRESET_PARAMS.every((k) => !url.searchParams.has(k));
    const linkedStep = Number(url.searchParams.get('step'));
    const fallback = linkedStep >= 3 ? (needsService ? 2 : needsStaff ? 3 : needsTime ? 4 : needsContacts ? 5 : step === 7 ? 6 : null) : null;
    const replacement = lockedStep ?? fallback;
    if (!syncPreset && (replacement === null || replacement === linkedStep)) return;
    if (replacement !== null) url.searchParams.set('step', String(replacement));
    const own = Object.fromEntries(Object.entries((window.history.state ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith('__')));
    window.history.replaceState(own, '', url);
  }, [ready, urlParams, needsService, needsStaff, needsTime, lockedStep, needsContacts, step]);
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
  const firstIncomplete = useCallback(() => (!sel.serviceIds.length ? 2 : !sel.datetime ? 4 : !contactOk ? 5 : 6), [sel.serviceIds.length, sel.datetime, contactOk]);

  // ТЗ §14 booking_step: once per step change (step 7 only with a result — without it the flow redirects); this flow = source 3d
  const trackedStep = useRef(0);
  useEffect(() => {
    if (!ready || (step === 7 && !result) || trackedStep.current === step) return;
    trackedStep.current = step;
    track('booking_step', { step, source: '3d' });
  }, [ready, step, result]);

  const [error, setError] = useState<BookingError | null>(null);
  const canConfirm = step === 6 && serviceSelected && availabilityEnabled && !!selectedDatetime && contactOk && !stored;
  async function confirm(captchaToken: string) {
    if (!canConfirm || !selectedDatetime) return;
    const idempotencyKey = globalThis.crypto?.randomUUID?.();
    if (!idempotencyKey) { setReviewNotice('unavailable'); return; }
    const { fullname, phone, email, age } = sel.contact;
    const input: BookingRecordInput = {
      source: '3d', serviceIds: selectedIds, staffId, datetime: selectedDatetime, locale,
      contact: { fullname: fullname.trim(), phone: normalizePhone(phone), email: email!.trim() }, age,
      consent: true, idempotencyKey,
      body3d: {
        model, generalNote: generalNote || undefined,
        markers: markers.map(({ zoneId, intensity, note }) => ({ zoneId, intensity, note })),
      },
    };
    setReviewNotice(undefined);
    setError(null);
    finishBooking(await book(input, { title: serviceTitle, price: price === t('home.services.priceUnknown') ? undefined : price }, captchaToken));
  }

  function finishBooking(response: BookingAttemptOutcome) {
    if (!response) return;
    if (response.status === 'created') {
      clear();
      body.resetDraft();
      if (selectedServices.length > 0 && selectedServices.every(({ currency }) => currency === 'AED')) track('booking_success', {
        service_id: response.data.services.length === 1 ? response.data.services[0].id : undefined,
        staff_id: response.data.staff?.id ?? response.attempt.staffId, currency: 'AED', source: '3d',
      });
      return;
    }
    if (response.status === 'rejected') {
      const { code } = response.error;
      track('booking_error', { reason: code.toLowerCase() });
      if (code === 'SLOT_TAKEN') {
        setError('slotTaken');
        update({ datetime: null, wantTime: null });
        datesQ.retry();
        timesQ.retry();
        go(4);
      } else if (code === 'SERVICE_NOT_FOUND') {
        update({ date: null, datetime: null });
        catalogQ.retry();
        staffQ.retry();
        go(2);
        setReviewNotice(bookingRejectionNotice(code));
      } else if (code === 'STAFF_NOT_FOUND') {
        selectStaff(0);
        staffQ.retry();
        go(3);
      } else {
        setReviewNotice(bookingRejectionNotice(code));
      }
      return;
    }
  }

  const checkStatus = async () => { finishBooking(await check()); };

  const startOver = useCallback(() => {
    // Remove the completed step before clearing the result so the deep-link guard cannot redirect to step 2.
    window.history.replaceState(null, '', window.location.pathname);
    clearResult();
    clear();
    body.resetDraft();
    setError(null);
    setRestoreDismissed(true);
  }, [clear, clearResult]);

  return {
    t, ready, step, go, locale, slotUnfit, model, markers, generalNote, sel, update, updateContact, ordered, recommended, staffName,
    catalogQ, serviceSelected, selectedIds, serviceTitle, servicePrice, serviceDuration, selectService, advanceFromService, selectStaff,
    staffId, staffReady, profileStaffUnavailable, serviceRemoved,
    today, availableDates, selectedDate, selectedDatetime,
    staffQ, datesQ, timesQ, time, day, when, canLeaveZones, contactOk, firstIncomplete,
    contactErrors: contactV.errors, contactAttempt: contactV.attempt, contactMsg, contactField, submitContacts,
    busy, error, setError, confirm, checkStatus, result, startOver, canConfirm, reviewNotice, stored,
    offerRestore: step === 1 && !restoreDismissed && (restoredDraft || selRestored),
    continueDraft: () => { setRestoreDismissed(true); body.dismissRestored(); if (selRestored) go(firstIncomplete()); },
    discardDraft: () => { setRestoreDismissed(true); clear(); body.resetDraft(); },
  };
}
export type Flow = ReturnType<typeof useBookingFlow>;
