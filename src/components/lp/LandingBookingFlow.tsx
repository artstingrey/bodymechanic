'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { BookingServiceOptions } from '@/components/booking/BookingServiceOptions';
import { bookingCalendarDays } from '@/components/booking/booking-availability';
import { bookingRejectionNotice, sendBooking } from '@/components/booking/booking-submit';
import { getBookingCatalog } from '@/components/booking/service-catalog';
import { bookingUrl, useBookingOptions, type BookingOptionsStatus } from '@/components/booking/useBookingOptions';
import { Calendar, SlotPicker } from '@/components/ui/Calendar';
import { Checkbox } from '@/components/ui/Choice';
import { TextAreaField } from '@/components/ui/Field';
import { homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { dubaiToday } from '@/lib/api/dubai';
import { formatCatalogServicePrice } from '@/lib/catalog-service-price';
import type { BookingRecordRequest } from '@/lib/contracts/booking-record';
import type { CatalogLocale, CatalogServicesResponse } from '@/lib/contracts/catalog';
import { readAttribution } from '@/lib/lp/attr';
import { LANDING_BOOKING_STAFF } from '@/lib/lp/booking';
import { newKey } from '@/lib/lp/lead';
import { LandingDetails, type LandingChip } from './LandingDetails';

type LandingRequest = Extract<BookingRecordRequest, { source: 'lp' }>;
type Notice = ReturnType<typeof bookingRejectionNotice> | 'processing' | 'unknown';
type Step = 'service' | 'time' | 'details';
type Catalog = CatalogServicesResponse['data'];

export function LandingBookingFlow({ id, active, locale, contact, chips, privacyHref, waHref, onBack, onContactRejected, onCreated }: {
  id: string; active: boolean; locale: CatalogLocale; contact: LandingRequest['contact']; chips: LandingChip[];
  privacyHref: string; waHref: string; onBack: () => void; onContactRejected: (field: 'phone' | 'fullname' | 'email') => void;
  onCreated: (datetime: string, service: string, eventId: string) => void;
}) {
  const t = useTranslations();
  const [step, setStep] = useState<Step>('service');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalog, setCatalog] = useState<{ attempt: number; data: Catalog | null }>();
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [datetime, setDatetime] = useState<string | null>(null);
  const [condition, setCondition] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sending, setSending] = useState(false);
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const data = catalog?.attempt === catalogAttempt ? catalog.data : undefined;
  const service = data?.services.find(({ id }) => id === serviceId);
  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  const title = service ? homeServiceTitle(locale, service, translations) : '';
  const selection = { serviceId: String(serviceId), staffId: String(LANDING_BOOKING_STAFF), locale };
  const choosingWindow = active && step !== 'service' && !!service;
  const dates = useBookingOptions('dates', choosingWindow ? bookingUrl('dates', selection) : null);
  const available = new Set(dates.items);
  const times = useBookingOptions('times', choosingWindow && date && available.has(date) ? bookingUrl('times', { ...selection, date }) : null);
  const windowSelected = !!datetime && times.items.some((slot) => slot.datetime === datetime);
  const uncertain = notice === 'processing' || notice === 'unknown';

  useEffect(() => {
    const controller = new AbortController();
    getBookingCatalog(locale, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setCatalog({ attempt: catalogAttempt, data: result }); },
      () => { if (!controller.signal.aborted) setCatalog({ attempt: catalogAttempt, data: null }); },
    );
    return () => controller.abort();
  }, [locale, catalogAttempt]);
  useEffect(() => { if (active) heading.current?.focus(); }, [active, step]);
  useEffect(() => { if (notice) alert.current?.focus(); }, [notice, step]);

  function changeStep(next: Step) {
    setNotice(null);
    setStep(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !service || !datetime) return;
    if (!consent) {
      setConsentError(true);
      document.getElementById(`${id}-consent`)?.focus();
      return;
    }
    locked.current = true;
    setNotice(null);
    setSending(true);
    const idempotencyKey = newKey();
    const tags = readAttribution()?.utm;
    const utm = Object.fromEntries([
      ['utm_source', tags?.source], ['utm_medium', tags?.medium], ['utm_campaign', tags?.campaign],
    ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1])));
    const result = await sendBooking({
      source: 'lp', contact, serviceId: service.id, staffId: LANDING_BOOKING_STAFF, datetime, locale,
      consent: true, idempotencyKey, ...(condition.trim() ? { condition: condition.trim() } : {}),
      ...(picked.length ? { details: picked } : {}), ...(Object.keys(utm).length ? { utm } : {}),
    });
    setSending(false);
    if (result.status === 'created') {
      onCreated(result.data.datetime, title, idempotencyKey);
      return;
    }
    if (result.status !== 'rejected') {
      setNotice(result.status);
      return;
    }
    locked.current = false;
    const { code, fields } = result.error;
    const invalidContact = fields?.find((field) => field === 'phone' || field === 'fullname' || field === 'email');
    if (code === 'INVALID_FIELDS' && invalidContact) {
      setStep('service');
      onContactRejected(invalidContact);
      return;
    }
    if (code === 'SLOT_TAKEN' || code === 'STAFF_NOT_FOUND') {
      setDatetime(null);
      times.retry();
      setStep('time');
      setNotice('slotTaken');
    } else if (code === 'SERVICE_NOT_FOUND') {
      setServiceId(null);
      setDate(null);
      setDatetime(null);
      setCatalogAttempt((attempt) => attempt + 1);
      setStep('service');
      setNotice('serviceUnavailable');
    } else {
      setNotice(bookingRejectionNotice(code));
    }
  }

  if (!active) return null;
  const back = (action: () => void) => <button className="btn btn--wa" type="button" onClick={action}>{t('common.actions.back')}</button>;
  const retry = (action: () => void) => <button className="btn btn--wa" type="button" onClick={action}>{t('common.actions.retry')}</button>;
  const status = (resource: 'dates' | 'times', options: { status: BookingOptionsStatus; retry: () => void }) => {
    if (options.status === 'loading' || options.status === 'empty') return <p role="status">{t(`home.form.availability.${resource}.${options.status}`)}</p>;
    if (options.status === 'error') return <><p role="alert">{t(`home.form.availability.${resource}.error`)}</p>{retry(options.retry)}</>;
  };
  const categories = new Map(data?.categories.map(({ id, title }) => [id, title]));

  return (
    <div className="lp-form" id={id}>
      <section className="lp-booking-time" aria-labelledby={`${id}-step-title`} aria-busy={sending || undefined}>
        <h3 id={`${id}-step-title`} ref={heading} tabIndex={-1}>{step === 'service' ? t('booking.service.heading')
          : step === 'time' ? t('booking.time.heading') : t('lp.booking.detailsHeading')}</h3>
        {notice && <p className="server-err" ref={alert} tabIndex={-1} role="alert">{t(`home.form.feedback.${notice}`)}</p>}
        {step === 'service' ? (
          <>
            {data === undefined && <p role="status">{t('home.form.availability.services.loading')}</p>}
            {data === null && <><p role="alert">{t('booking.service.loadError')}</p>{retry(() => setCatalogAttempt((n) => n + 1))}</>}
            {data?.services.length === 0 && <p role="status">{t('booking.service.empty')}</p>}
            {!!data?.services.length && <BookingServiceOptions name={`${id}-service`} selected={serviceId} services={data.services.map((item) => ({
              id: item.id, title: homeServiceTitle(locale, item, translations),
              categoryTitle: item.categoryId === null ? undefined : categories.get(item.categoryId),
              price: formatCatalogServicePrice(item, locale, { unknown: () => t('home.services.priceUnknown'), from: (price) => t('home.services.priceFrom', { price }) }),
              duration: item.durationMin === null ? null : t('home.services.duration', { minutes: item.durationMin }),
            }))} onSelect={(next) => { setServiceId(next); setDate(null); setDatetime(null); }} />}
            <div className="lp-booking-actions">
              {back(onBack)}
              <button className="btn btn--p" type="button" disabled={!service} onClick={() => changeStep('time')}>{t('lp.form.submit')}</button>
            </div>
          </>
        ) : step === 'time' ? (
          <>
            <p>{title} · {t('booking.time.zoneNote')}</p>
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
            <fieldset disabled={sending || uncertain}>
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
                <button className="btn btn--p" type="submit">{t('lp.booking.book')}</button>
              </div>
            </fieldset>
            {sending && <p role="status">{t('lp.booking.sending')}</p>}
            {uncertain && <a className="btn btn--wa" href={waHref} target="_blank" rel="noopener noreferrer" data-track="whatsapp">{t('lp.form.whatsapp')}</a>}
          </form>
        )}
      </section>
    </div>
  );
}
