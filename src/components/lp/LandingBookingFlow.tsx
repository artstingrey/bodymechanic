'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { BookingServiceOptions } from '@/components/booking/BookingServiceOptions';
import { bookingCalendarDays } from '@/components/booking/booking-availability';
import { bookingRejectionNotice } from '@/components/booking/booking-submit';
import type { BookingAttempt, BookingAttemptOutcome } from '@/components/booking/useBookingAttempt';
import { getBookingCatalog } from '@/components/booking/service-catalog';
import { bookingUrl, useBookingOptions, type BookingOptionsStatus } from '@/components/booking/useBookingOptions';
import { Calendar, SlotPicker } from '@/components/ui/Calendar';
import { Checkbox } from '@/components/ui/Choice';
import { TextAreaField } from '@/components/ui/Field';
import { homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { dubaiToday } from '@/lib/api/dubai';
import { catalogServiceDuration, formatCatalogServiceDiscount, formatCatalogServiceTotal } from '@/lib/catalog-service-price';
import type { BookingRecordRequest } from '@/lib/contracts/booking-record';
import { updateBookingServices } from '@/lib/contracts/booking-services';
import type { CatalogLocale, CatalogServicesResponse } from '@/lib/contracts/catalog';
import { readAttribution } from '@/lib/lp/attr';
import { LANDING_BOOKING_DISCOUNT, LANDING_BOOKING_STAFF } from '@/lib/lp/booking';
import { newKey } from '@/lib/lp/lead';
import { LandingDetails, type LandingChip } from './LandingDetails';
import { LandingPendingActions } from './LandingPendingActions';

type LandingRequest = Extract<BookingRecordRequest, { source: 'lp' }>;
type Notice = ReturnType<typeof bookingRejectionNotice>;
type Step = 'service' | 'time' | 'details';
type Catalog = CatalogServicesResponse['data'];

export function LandingBookingFlow({ id, active, locale, contact, chips, privacyHref, waMessage, attempt, onBack, onContactRejected, onCreated }: {
  id: string; active: boolean; locale: CatalogLocale; contact: LandingRequest['contact']; chips: LandingChip[];
  privacyHref: string; waMessage: string; attempt: BookingAttempt;
  onBack: () => void; onContactRejected: (field: 'phone' | 'fullname' | 'email') => void;
  onCreated: (eventId: string) => void;
}) {
  const t = useTranslations();
  const [step, setStep] = useState<Step>('service');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalog, setCatalog] = useState<{ attempt: number; locale: CatalogLocale; data: Catalog | null }>();
  const [selected, setSelected] = useState<number[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [datetime, setDatetime] = useState<string | null>(null);
  const [condition, setCondition] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const { busy: sending, stored, book, check } = attempt;
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const data = catalog?.attempt === catalogAttempt && catalog.locale === locale ? catalog.data : undefined;
  const services = data?.services.filter(({ id }) => !removed.includes(id)) ?? [];
  const selectedServices = services.filter(({ id }) => selected.includes(id));
  const serviceIds = selected.filter((id) => selectedServices.some((item) => item.id === id));
  const validSet = !!data && serviceIds.length > 0 && serviceIds.length === selected.length;
  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  const title = selectedServices.map((service) => homeServiceTitle(locale, service, translations)).join(' · ');
  const selection = { serviceIds, staffId: LANDING_BOOKING_STAFF, locale };
  const staff = useBookingOptions('staff', active && validSet ? bookingUrl('staff', { serviceIds, locale }) : null);
  const choosingWindow = active && step !== 'service' && staff.status === 'ready';
  const dates = useBookingOptions('dates', choosingWindow ? bookingUrl('dates', selection) : null);
  const available = new Set(dates.items);
  const times = useBookingOptions('times', choosingWindow && date && available.has(date) ? bookingUrl('times', { ...selection, date }) : null);
  const selectedSlot = times.items.find((slot) => slot.datetime === datetime);
  const windowSelected = !!selectedSlot;
  const priceLabels = { unknown: () => t('home.services.priceUnknown'), from: (price: string) => t('home.services.priceFrom', { price }) };
  const total = formatCatalogServiceTotal(selectedServices, locale, priceLabels, LANDING_BOOKING_DISCOUNT);
  const duration = catalogServiceDuration(selectedServices, selectedSlot?.durationSeconds);
  const pending = stored && stored.status !== 'created' ? stored : null;
  const uncertain = pending && !sending ? pending.status : null;
  const feedback = uncertain ?? notice;

  useEffect(() => {
    const controller = new AbortController();
    getBookingCatalog(locale, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setCatalog({ attempt: catalogAttempt, locale, data: result }); },
      () => { if (!controller.signal.aborted) setCatalog({ attempt: catalogAttempt, locale, data: null }); },
    );
    return () => controller.abort();
  }, [locale, catalogAttempt]);
  useEffect(() => { if (active) heading.current?.focus(); }, [active, step]);
  useEffect(() => { if (feedback) alert.current?.focus(); }, [feedback, step]);
  const removeServices = useCallback((ids: number[]) => {
    setRemoved((current) => [...new Set([...current, ...ids])]);
    setSelected((current) => current.filter((id) => !ids.includes(id)));
    setDate(null);
    setDatetime(null);
    setStep('service');
    setNotice('serviceUnavailable');
  }, []);
  const absentFromCatalog = data ? selected.filter((id) => !serviceIds.includes(id)) : [];
  const missing = [...absentFromCatalog, ...(staff.missing ?? []), ...(dates.missing ?? []), ...(times.missing ?? [])]
    .filter((id) => selected.includes(id));
  if (missing.length) removeServices(missing);

  function changeStep(next: Step) {
    setNotice(null);
    setStep(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (stored || sending || !validSet || !selectedSlot || staff.status !== 'ready') return;
    if (!consent) {
      setConsentError(true);
      document.getElementById(`${id}-consent`)?.focus();
      return;
    }
    setNotice(null);
    const idempotencyKey = newKey();
    const tags = readAttribution()?.utm;
    const utm = Object.fromEntries([
      ['utm_source', tags?.source], ['utm_medium', tags?.medium], ['utm_campaign', tags?.campaign],
    ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1])));
    finishBooking(await book({
      source: 'lp', contact, serviceIds, staffId: LANDING_BOOKING_STAFF, datetime: selectedSlot.datetime, locale,
      consent: true, idempotencyKey, ...(condition.trim() ? { condition: condition.trim() } : {}),
      ...(picked.length ? { details: picked } : {}), ...(Object.keys(utm).length ? { utm } : {}),
    }, { title, price: total === priceLabels.unknown() ? undefined : total }));
  }

  function finishBooking(result: BookingAttemptOutcome) {
    if (!result) return;
    if (result.status === 'created') {
      onCreated(result.attempt.idempotencyKey);
      return;
    }
    if (result.status !== 'rejected') return;
    const { code, fields } = result.error;
    const invalidContact = fields?.find((field) => field === 'phone' || field === 'fullname' || field === 'email');
    if (code === 'INVALID_FIELDS' && invalidContact) {
      setStep('service');
      onContactRejected(invalidContact);
      return;
    }
    if (code === 'SLOT_TAKEN' || code === 'STAFF_NOT_FOUND') {
      setDatetime(null);
      if (code === 'STAFF_NOT_FOUND') {
        staff.retry();
      }
      dates.retry();
      times.retry();
      setStep('time');
      setNotice('slotTaken');
    } else if (code === 'SERVICE_NOT_FOUND') {
      setDate(null);
      setDatetime(null);
      setCatalogAttempt((attempt) => attempt + 1);
      staff.retry();
      setStep('service');
      setNotice('serviceUnavailable');
    } else {
      setNotice(bookingRejectionNotice(code));
    }
  }

  if (!active) return null;
  const back = (action: () => void) => <button className="btn btn--wa" type="button" onClick={action}>{t('common.actions.back')}</button>;
  const retry = (action: () => void) => <button className="btn btn--wa" type="button" onClick={action}>{t('common.actions.retry')}</button>;
  const status = (resource: 'staff' | 'dates' | 'times', options: { status: BookingOptionsStatus; retry: () => void }) => {
    if (options.status === 'loading' || options.status === 'empty') return <p role="status">{t(`home.form.availability.${resource}.${options.status}`)}</p>;
    if (options.status === 'error') return <><p role="alert">{t(`home.form.availability.${resource}.error`)}</p>{retry(options.retry)}</>;
  };
  const categories = new Map(data?.categories.map(({ id, title }) => [id, title]));

  return (
    <div className="lp-form" id={id}>
      <section className="lp-booking-time" aria-labelledby={`${id}-step-title`} aria-busy={sending || undefined}>
        <h3 id={`${id}-step-title`} ref={heading} tabIndex={-1}>{step === 'service' ? t('booking.service.heading')
          : step === 'time' ? t('booking.time.heading') : t('lp.booking.detailsHeading')}</h3>
        {feedback && <p className="server-err" ref={alert} tabIndex={-1} role={uncertain ? 'status' : 'alert'}>{feedback === 'serviceUnavailable'
          ? t('booking.service.removed') : t(`home.form.feedback.${feedback}`)}</p>}
        {step === 'service' ? (
          <>
            {data === undefined && <p role="status">{t('home.form.availability.services.loading')}</p>}
            {data === null && <><p role="alert">{t('booking.service.loadError')}</p>{retry(() => setCatalogAttempt((n) => n + 1))}</>}
            {data && services.length === 0 && <p role="status">{t('booking.service.empty')}</p>}
            {services.length > 0 && <BookingServiceOptions name={`${id}-service`} selected={serviceIds} services={services.map((item) => {
              const discount = formatCatalogServiceDiscount(item, LANDING_BOOKING_DISCOUNT, locale, priceLabels);
              return {
                id: item.id, title: homeServiceTitle(locale, item, translations),
                categoryTitle: item.categoryId === null ? undefined : categories.get(item.categoryId),
                price: discount?.sale ?? priceLabels.unknown(), originalPrice: discount?.original,
                duration: item.durationMin === null ? null : t('home.services.duration', { minutes: item.durationMin }),
              };
            })} onSelect={(id, checked) => {
              setSelected((current) => updateBookingServices(current, id, checked));
              setDate(null);
              setDatetime(null);
              setNotice(null);
            }} />}
            <div className="lp-booking-actions">
              {back(onBack)}
              <button className="btn btn--p" type="button" disabled={!validSet || staff.status !== 'ready'} onClick={() => changeStep('time')}>{t('lp.form.submit')}</button>
            </div>
            {status('staff', staff)}
          </>
        ) : step === 'time' ? (
          <>
            <p>{[title, total, duration === null ? null : t(serviceIds.length > 1 && selectedSlot?.durationSeconds === undefined
              ? 'booking.service.durationEstimate' : 'home.services.duration', { minutes: duration }), t('booking.time.zoneNote')].filter(Boolean).join(' · ')}</p>
            {status('staff', staff)}
            {status('dates', dates)}
            {dates.status === 'ready' && <Calendar days={bookingCalendarDays(dubaiToday(), dates.items)} available={available} selected={date}
              onSelect={(day) => { if (day !== date) { setDate(day); setDatetime(null); setNotice(null); } }}
              label={t('booking.time.calendarLabel')} unavailableLabel={t('booking.time.dateUnavailable')} />}
            {status('times', times)}
            {times.status === 'ready' && <SlotPicker slots={times.items} selected={datetime} onSelect={setDatetime} labels={{
              morning: t('booking.time.partMorning'), day: t('booking.time.partDay'), evening: t('booking.time.partEvening'),
            }} />}
            <div className="lp-booking-actions">
              {back(() => changeStep('service'))}
              <button className="btn btn--p" type="button" disabled={!windowSelected} onClick={() => changeStep('details')}>{t('lp.booking.continue')}</button>
            </div>
          </>
        ) : (
          <form className="lp-booking-details" onSubmit={submit} noValidate>
            <fieldset disabled={sending || !!pending}>
              <p>{[title, total, duration === null ? null : t('home.services.duration', { minutes: duration }),
                selectedSlot && t('common.timeWithZone', { time: selectedSlot.time })].filter(Boolean).join(' · ')}</p>
              <TextAreaField id={`${id}-condition`} name="condition" label={t('forms.field.condition')} maxLength={1000}
                placeholder={t('forms.field.conditionPlaceholder')} value={condition} onChange={(event) => setCondition(event.target.value)}
                counterText={(count, max) => t('body3d.panel.noteCounter', { count, max })} />
              <Checkbox id={`${id}-consent`} name="consent" required checked={consent}
                error={consentError ? t('forms.error.consentRequired') : undefined}
                onChange={(event) => { setConsent(event.target.checked); setConsentError(false); }}>
                {t.rich('forms.consent.privacy', { privacy: (copy) => <a href={privacyHref} target="_blank" rel="noopener">{copy}</a> })}
              </Checkbox>
              <LandingDetails id={id} chips={chips} picked={picked}
                onToggle={(mark) => setPicked((current) => current.includes(mark) ? current.filter((x) => x !== mark) : [...current, mark])} />
              <div className="lp-booking-actions">
                {back(() => changeStep('time'))}
                <button className="btn btn--p" type="submit" disabled={!windowSelected}>{t('lp.booking.book')}</button>
              </div>
            </fieldset>
            {sending && <p role="status">{t('lp.booking.sending')}</p>}
            {uncertain && pending && <LandingPendingActions pending={pending} locale={locale} waMessage={waMessage}
              busy={sending} onCheck={async () => finishBooking(await check())} />}
          </form>
        )}
      </section>
    </div>
  );
}
