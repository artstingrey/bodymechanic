'use client';

import { Fragment, useCallback, useRef, useState, useSyncExternalStore, type ChangeEvent, type FocusEvent, type ReactNode, type SubmitEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Choice';
import { PhoneField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorSummary } from '@/components/forms/ErrorSummary';
import { track } from '@/lib/analytics/track';
import type { BookingRecordErrorCode, BookingRecordRequest } from '@/lib/contracts/booking-record';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { useFieldErrors } from '@/lib/forms/useFieldErrors';
import { collect, messageArgs, normalizePhone, rules, type ErrorCode } from '@/lib/forms/validate';
import { QuickFormContext, type AvailabilityConflict } from './quick-form-context';
import { sendQuickBooking, type CreatedBooking } from './quick-form-submit';

const subscribeToHydration = () => () => {};

const notices = {
  SLOT_TAKEN: 'slotTaken', STAFF_NOT_FOUND: 'staffUnavailable', SERVICE_NOT_FOUND: 'serviceUnavailable',
  PREPAYMENT_REQUIRED: 'prepayment', SMS_REQUIRED: 'sms', RATE_LIMITED: 'rateLimited', UPSTREAM_RATE_LIMITED: 'rateLimited',
  INVALID_FIELDS: 'invalidFields',
} as const satisfies Partial<Record<BookingRecordErrorCode, string>>;
type Notice = typeof notices[keyof typeof notices] | 'unavailable' | 'unknown' | 'processing';
const conflict = (code: BookingRecordErrorCode): code is AvailabilityConflict =>
  code === 'SLOT_TAKEN' || code === 'STAFF_NOT_FOUND' || code === 'SERVICE_NOT_FOUND';

export function QuickForm({ children, enabled, locale }: { children: ReactNode; enabled: boolean; locale: CatalogLocale }) {
  const t = useTranslations();
  const { errors, field, submit, attempt } = useFieldErrors();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [created, setCreated] = useState<{ data: CreatedBooking; serviceTitle: string }>();
  const activeAttempt = useRef(false);
  const refresh = useRef<((reason: AvailabilityConflict) => void) | null>(null);
  const registerRefresh = useCallback((handler: (reason: AvailabilityConflict) => void) => {
    refresh.current = handler;
    return () => { if (refresh.current === handler) refresh.current = null; };
  }, []);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const uncertain = notice === 'unknown' || notice === 'processing';
  const locked = busy || uncertain;
  const fieldText = (id: string) => errors[id] ? t(`forms.error.${errors[id]}`, messageArgs(errors[id])) : undefined;
  const emailRule = (value: string) => rules.filled(value.trim()) ?? rules.email(value);
  const bind = (id: string, rule: (el: HTMLInputElement) => ErrorCode | null) => ({
    id, disabled: locked, error: fieldText(id),
    onBlur: (e: FocusEvent<HTMLInputElement>) => field(id, rule(e.currentTarget), !!e.currentTarget.value || id === 'qf-email'),
    onChange: (e: ChangeEvent<HTMLInputElement>) => { if (errors[id]) field(id, rule(e.currentTarget)); },
  });
  const labels = {
    'qf-name': t('forms.field.name'), 'qf-phone': t('forms.field.phone'), 'qf-email': t('forms.field.email'),
    'qf-age': t('forms.field.age'), 'qf-service': t('forms.field.service'), 'qf-date': t('forms.field.datetime'),
    'qf-time': t('home.form.timeLabel'),
  };

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || !hydrated || activeAttempt.current || created) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const str = (name: string) => String(data.get(name) ?? '');
    const serviceId = Number(str('service'));
    const datetime = str('datetime');
    const date = str('date');
    const age = form.elements.namedItem('age') as HTMLInputElement;
    setNotice(undefined);
    if (!submit(collect([
      ['qf-name', rules.name(str('name'))],
      ['qf-phone', rules.phone(str('phone'))],
      ['qf-email', emailRule(str('email'))],
      ['qf-age', rules.age(age.value, age.validity.badInput)],
      ['qf-service', serviceId ? null : 'serviceRequired'],
      [date ? 'qf-time' : 'qf-date', serviceId && !datetime ? 'datetimeRequired' : null],
      ['qf-consent', rules.filled(data.get('consent') === 'on', 'consentRequired')],
    ]))) return;

    const idempotencyKey = globalThis.crypto?.randomUUID?.();
    if (!idempotencyKey) {
      setNotice('unavailable');
      return;
    }
    const staffId = Number(str('staff'));
    const email = str('email').trim();
    const condition = str('condition').trim();
    const input: BookingRecordRequest = {
      serviceId, staffId, datetime, locale, consent: true, idempotencyKey,
      contact: { fullname: str('name').trim(), phone: normalizePhone(str('phone')), email },
      ...(age.value ? { age: Number(age.value) } : {}),
      ...(condition ? { condition } : {}),
    };
    const service = form.elements.namedItem('service') as HTMLSelectElement;
    const serviceTitle = service.selectedOptions[0]?.label ?? '';
    activeAttempt.current = true;
    setBusy(true);

    const result = await sendQuickBooking(input);
    setBusy(false);
    if (result.status === 'processing' || result.status === 'unknown') {
      setNotice(result.status);
      return;
    }
    if (result.status === 'created') {
      setCreated({ data: result.data, serviceTitle });
      track('booking_success', { service_id: result.data.serviceId, staff_id: result.data.staff?.id ?? staffId, currency: 'AED', source: 'form' });
      return;
    }
    if (result.status === 'rejected') {
      activeAttempt.current = false;
      const { code } = result.error;
      if (conflict(code)) refresh.current?.(code);
      const copy: Partial<Record<BookingRecordErrorCode, Notice>> = notices;
      setNotice(copy[code] ?? 'unavailable');
    }
  }

  if (created) {
    const { data, serviceTitle } = created;
    const format = new Intl.DateTimeFormat(locale, {
      timeZone: 'Asia/Dubai', dateStyle: 'long', timeStyle: 'short', hourCycle: 'h23',
    });
    const dateTime = format.format(new Date(data.datetime));
    return (
      <div className="qform" role="status">
        <h3 className="h3">{t('booking.done.title')}</h3>
        <dl className="qform__receipt">
          <dt>{data.parts ? t('booking.done.references') : t('booking.done.reference')}</dt>
          <dd>{data.parts ? data.parts.map(({ recordId }) => recordId).join(', ') : data.recordId}</dd>
          <dt>{labels['qf-service']}</dt><dd>{serviceTitle}</dd>
          <dt>{t('booking.done.date')}</dt><dd>{t('common.timeWithZone', { time: dateTime })}</dd>
          {data.staff && !data.parts ? <><dt>{t('booking.done.specialist')}</dt><dd>{data.staff.name}</dd></> : null}
          {data.parts?.map((part) => {
            const start = new Date(part.datetime);
            const time = part.durationSeconds
              ? format.formatRange(start, new Date(start.getTime() + part.durationSeconds * 1000))
              : format.format(start);
            return (
              <Fragment key={part.recordId}>
                <dt>{part.title}</dt>
                <dd>
                  {t('common.timeWithZone', { time })}
                  {part.staff ? <div>{part.staff.name}</div> : null}
                </dd>
              </Fragment>
            );
          })}
        </dl>
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
          {...bind('qf-email', (el) => emailRule(el.value))} />
        <TextField label={t('forms.field.age')} name="age" type="number" inputMode="numeric" min={1} max={120} {...bind('qf-age', (el) => rules.age(el.value, el.validity.badInput))} />
      </div>
      <QuickFormContext.Provider value={{ locked, errors, clearError: (id) => field(id, null), registerRefresh }}>
        {children}
      </QuickFormContext.Provider>
      <TextAreaField label={t('forms.field.condition')} name="condition" disabled={locked} maxLength={1000} placeholder={t('forms.field.conditionPlaceholder')}
        counterText={(count, max) => t('body3d.panel.noteCounter', { count, max })} />
      <Checkbox required name="consent" id="qf-consent" disabled={locked} error={fieldText('qf-consent')}
        onChange={(event) => { if (event.target.checked) field('qf-consent', null); }}>{t.rich('forms.consent.privacy', { privacy: (c) => <Link href="/privacy">{c}</Link> })}</Checkbox>
      <p className="captcha cap" data-testid="captcha" role="status" hidden>{t('booking.review.captcha')} <Badge>{t('prototype.demoBadge')}</Badge></p>
      <div className="acts">
        <Button type="submit" disabled={!enabled || !hydrated || locked} loading={busy}
          loadingLabel={t('home.form.submitting')} aria-describedby={!enabled || notice ? 'qf-submit-notice' : undefined}>{t('home.form.submit')}</Button>
        <ButtonLink href="/booking" variant="text">{t('home.form.showOn3d')}</ButtonLink>
      </div>
      {notice ? (
        <div id="qf-submit-notice" role={uncertain ? 'status' : 'alert'}>
          <p>{t(`home.form.feedback.${notice}`)}</p>
          {notice === 'sms' || notice === 'prepayment' ?
            <ButtonLink href="/contacts" variant="text">{t('home.form.contactStudio')}</ButtonLink> : null}
        </div>
      ) : !enabled ? <p className="cap" id="qf-submit-notice">{t('home.form.submitUnavailable')}</p> : null}
    </form>
  );
}
