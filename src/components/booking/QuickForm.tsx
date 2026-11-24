'use client';

import { Fragment, useCallback, useRef, useState, useSyncExternalStore, type ChangeEvent, type FocusEvent, type ReactNode, type SubmitEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Choice';
import { PhoneField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorSummary } from '@/components/forms/ErrorSummary';
import { track } from '@/lib/analytics/track';
import { bookingDateFormat, bookingPartTime, receiptDuration, receiptTitle } from '@/lib/booking/receipt';
import type { BookingRecordErrorCode, BookingRecordRequest } from '@/lib/contracts/booking-record';
import { normalizeBookingServices } from '@/lib/contracts/booking-services';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { useFieldErrors } from '@/lib/forms/useFieldErrors';
import { collect, messageArgs, normalizePhone, requiredEmail, rules, type ErrorCode } from '@/lib/forms/validate';
import { QuickFormContext, type AvailabilityConflict } from './quick-form-context';
import { bookingRejectionNotice } from './booking-submit';
import { useBookingAttempt, type BookingAttemptOutcome } from './useBookingAttempt';

const subscribeToHydration = () => () => {};

type Notice = ReturnType<typeof bookingRejectionNotice>;
const conflict = (code: BookingRecordErrorCode): code is AvailabilityConflict =>
  code === 'SLOT_TAKEN' || code === 'STAFF_NOT_FOUND' || code === 'SERVICE_NOT_FOUND';

export function QuickForm({ children, enabled, locale }: { children: ReactNode; enabled: boolean; locale: CatalogLocale }) {
  const t = useTranslations();
  const { errors, field, submit, attempt } = useFieldErrors();
  const { stored, busy, book, check, clear } = useBookingAttempt('form', locale);
  const [availabilityBlocked, setAvailabilityBlocked] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const refresh = useRef<((reason: AvailabilityConflict) => void) | null>(null);
  const registerRefresh = useCallback((handler: (reason: AvailabilityConflict) => void) => {
    refresh.current = handler;
    return () => { if (refresh.current === handler) refresh.current = null; };
  }, []);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const pending = stored && stored.status !== 'created' ? stored : null;
  const uncertain = pending && !busy ? pending.status : null;
  const feedback = uncertain ?? notice;
  const locked = busy || !!pending;
  const fieldText = (id: string) => errors[id] ? t(`forms.error.${errors[id]}`, messageArgs(errors[id])) : undefined;
  const bind = (id: string, rule: (el: HTMLInputElement) => ErrorCode | null) => ({
    id, disabled: locked, error: fieldText(id),
    onBlur: (e: FocusEvent<HTMLInputElement>) => field(id, rule(e.currentTarget), !!e.currentTarget.value || id === 'qf-email' || id === 'qf-phone'),
    onChange: (e: ChangeEvent<HTMLInputElement>) => { if (errors[id]) field(id, rule(e.currentTarget)); },
  });
  const labels = {
    'qf-name': t('forms.field.name'), 'qf-phone': t('forms.field.phone'), 'qf-email': t('forms.field.email'),
    'qf-age': t('forms.field.age'), 'qf-service': t('forms.field.service'), 'qf-date': t('forms.field.datetime'),
    'qf-time': t('home.form.timeLabel'),
  };

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || !hydrated || busy || stored) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const str = (name: string) => String(data.get(name) ?? '');
    const serviceIds = normalizeBookingServices(undefined, data.getAll('service').map(Number));
    const datetime = str('datetime');
    const date = str('date');
    const age = form.elements.namedItem('age') as HTMLInputElement;
    setNotice(undefined);
    if (!submit(collect([
      ['qf-name', rules.name(str('name'))],
      ['qf-phone', rules.phone(str('phone'))],
      ['qf-email', requiredEmail(str('email'))],
      ['qf-age', rules.age(age.value, age.validity.badInput)],
      ['qf-service', serviceIds ? null : 'serviceRequired'],
      [date ? 'qf-time' : 'qf-date', serviceIds && !datetime ? 'datetimeRequired' : null],
      ['qf-consent', rules.filled(data.get('consent') === 'on', 'consentRequired')],
    ])) || !serviceIds || !datetime || availabilityBlocked) return;

    const idempotencyKey = globalThis.crypto?.randomUUID?.();
    if (!idempotencyKey) {
      setNotice('unavailable');
      return;
    }
    const staffId = Number(str('staff'));
    const email = str('email').trim();
    const condition = str('condition').trim();
    const input: BookingRecordRequest = {
      serviceIds, staffId, datetime, locale, consent: true, idempotencyKey,
      contact: { fullname: str('name').trim(), phone: normalizePhone(str('phone')), email },
      ...(age.value ? { age: Number(age.value) } : {}),
      ...(condition ? { condition } : {}),
    };
    finishBooking(await book(input, { title: str('serviceTitle'), price: str('servicePrice') || undefined }));
  }

  function finishBooking(result: BookingAttemptOutcome) {
    if (!result) return;
    if (result.status === 'created') {
      track('booking_success', { service_id: result.data.services.length === 1 ? result.data.services[0].id : undefined,
        staff_id: result.data.staff?.id ?? result.attempt.staffId, currency: 'AED', source: 'form' });
      return;
    }
    if (result.status === 'rejected') {
      const { code } = result.error;
      if (conflict(code)) refresh.current?.(code);
      setNotice(bookingRejectionNotice(code));
    }
  }

  if (stored?.status === 'created') {
    const data = stored;
    const format = bookingDateFormat(locale, 'long');
    const minutes = receiptDuration(data);
    const dateTime = format.format(new Date(data.datetime));
    return (
      <div className="qform" role="status">
        <h3 className="h3">{t('booking.done.title')}</h3>
        <dl className="qform__receipt">
          <dt>{data.parts ? t('booking.done.references') : t('booking.done.reference')}</dt>
          <dd>{data.parts ? data.parts.map(({ recordId }) => recordId).join(', ') : data.recordId}</dd>
          <dt>{labels['qf-service']}</dt><dd>{receiptTitle(data)}</dd>
          <dt>{t('booking.done.date')}</dt><dd>{t('common.timeWithZone', { time: dateTime })}</dd>
          {data.staff && !data.parts ? <><dt>{t('booking.done.specialist')}</dt><dd>{data.staff.name}</dd></> : null}
          {minutes !== undefined && <><dt>{t('booking.done.duration')}</dt><dd>{t('home.services.duration', { minutes })}</dd></>}
          {data.price && <><dt>{t('booking.review.total')}</dt><dd>{t('booking.service.estimate', { price: data.price })}</dd></>}
          {data.parts?.map((part) => {
            return (
              <Fragment key={part.recordId}>
                <dt>{part.title}</dt>
                <dd>
                  {t('common.timeWithZone', { time: bookingPartTime(part, format) })}
                  {part.staff ? <div>{part.staff.name}</div> : null}
                </dd>
              </Fragment>
            );
          })}
        </dl>
        <Button variant="text" type="button" onClick={clear}>{t('booking.draft.startOver')}</Button>
      </div>
    );
  }
  return (
    <form className="qform" noValidate method="post" onSubmit={handleSubmit}>
      <p className="cap">{t('common.requiredLegend')}</p>
      <ErrorSummary errors={errors} labels={labels} attempt={attempt} />
      <div className="row2">
        <TextField label={t('forms.field.name')} required name="name" maxLength={100} autoComplete="name" placeholder={t('forms.field.namePlaceholder')} {...bind('qf-name', (el) => rules.name(el.value))} />
        <PhoneField label={t('forms.field.phone')} required name="phone" maxLength={32} placeholder={t('forms.field.phonePlaceholder')} hint={t('forms.field.phoneHint')} {...bind('qf-phone', (el) => rules.phone(el.value))} />
      </div>
      <div className="row2">
        <TextField label={t('forms.field.email')} required name="email" type="email" maxLength={254} autoComplete="email" placeholder={t('forms.field.emailPlaceholder')}
          {...bind('qf-email', (el) => requiredEmail(el.value))} />
        <TextField label={t('forms.field.age')} name="age" type="number" inputMode="numeric" min={1} max={120} {...bind('qf-age', (el) => rules.age(el.value, el.validity.badInput))} />
      </div>
      <QuickFormContext.Provider value={{ locked, errors, clearError: (id) => field(id, null), registerRefresh, setAvailabilityBlocked }}>
        {children}
      </QuickFormContext.Provider>
      <TextAreaField label={t('forms.field.condition')} name="condition" disabled={locked} maxLength={1000} placeholder={t('forms.field.conditionPlaceholder')}
        counterText={(count, max) => t('body3d.panel.noteCounter', { count, max })} />
      <Checkbox required name="consent" id="qf-consent" disabled={locked} error={fieldText('qf-consent')}
        onChange={(event) => { if (event.target.checked) field('qf-consent', null); }}>{t.rich('forms.consent.privacy', { privacy: (c) => <Link href="/privacy">{c}</Link> })}</Checkbox>
      <p className="captcha cap" data-testid="captcha" role="status" hidden>{t('booking.review.captcha')}</p>
      <div className="acts">
        <Button type="submit" disabled={!enabled || !hydrated || locked || availabilityBlocked} loading={busy}
          loadingLabel={t('home.form.submitting')} aria-describedby={!enabled || feedback ? 'qf-submit-notice' : undefined}>{t('home.form.submit')}</Button>
        <ButtonLink href="/booking" variant="text">{t('home.form.showOn3d')}</ButtonLink>
      </div>
      {feedback ? (
        <div id="qf-submit-notice" role={uncertain ? 'status' : 'alert'}>
          <p>{t(`home.form.feedback.${feedback}`)}</p>
          {uncertain && pending?.attempt && (
            <Button variant="text" type="button" disabled={busy} onClick={async () => finishBooking(await check())}>{t('booking.done.checkStatus')}</Button>
          )}
          {notice === 'sms' || notice === 'prepayment' ?
            <ButtonLink href="/contacts" variant="text">{t('home.form.contactStudio')}</ButtonLink> : null}
        </div>
      ) : !enabled ? <p className="cap" id="qf-submit-notice">{t('home.form.submitUnavailable')}</p> : null}
    </form>
  );
}
