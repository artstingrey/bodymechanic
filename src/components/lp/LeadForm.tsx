'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PhoneField, TextField } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { whatsappUrl } from '@/lib/config';
import type { BookingRecordRequest } from '@/lib/contracts/booking-record';
import { normalizePhone, requiredEmail, rules } from '@/lib/forms/validate';
import { afterPress } from '@/lib/forms/useFieldErrors';
import { landingPhoneError } from '@/lib/lp/phone';
import { placementOf, trackFormError, trackLead } from '@/lib/lp/track';
import { isLocale } from '@/i18n/routing';
import { LandingBookingFlow } from './LandingBookingFlow';
import type { LandingChip } from './LandingDetails';

const errorOrder = ['name', 'phone', 'email'] as const;
type Err = Partial<Record<typeof errorOrder[number], string>>;

export function LeadForm({ id, variant, chips, waMessage, privacyHref, cta = true }: {
  id: string; variant: 'a' | 'b'; chips: LandingChip[];
  waMessage: string; privacyHref: string; /** marks the submit button for the sticky-CTA observer */ cta?: boolean;
}) {
  const t = useTranslations('lp');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Err>({});
  const [attempt, setAttempt] = useState(0);
  const [bookingContact, setBookingContact] = useState<BookingRecordRequest['contact'] | null>(null);
  const [bookingActive, setBookingActive] = useState(false);
  const [confirmation, setConfirmation] = useState<{ time: string; service: string } | null>(null);
  const thanks = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const focusError = useRef<keyof Err | 'summary' | null>(null);

  const phoneError = (value: string) => {
    const code = landingPhoneError(value);
    if (code === 'required') return tf('error.required');
    if (code) return t('error.phone');
  };

  const validatePhoneField = (value: string) => {
    const error = phoneError(value);
    const showError = () => setErrors((current) => ({ ...current, phone: error }));
    if (error) afterPress(showError);
    else showError();
  };

  const validateContacts = (contactName: string, contactPhone: string): Err => {
    const e: Err = {};
    if (rules.name(contactName)) e.name = t('error.name');
    const invalidPhone = phoneError(contactPhone);
    if (invalidPhone) e.phone = invalidPhone;
    const invalidEmail = requiredEmail(email);
    if (invalidEmail) e.email = tf(`error.${invalidEmail}`);
    return e;
  };

  const reportErrors = (nextErrors: Err) => {
    setErrors(nextErrors);
    const first = errorOrder.find((k) => nextErrors[k]);
    if (!first) return false;

    const errorFields = Object.keys(nextErrors);
    trackFormError(errorFields, placementOf(document.getElementById(id)));
    focusError.current = errorFields.length > 1 ? 'summary' : first;
    setAttempt((n) => n + 1);
    return true;
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (reportErrors(validateContacts(name, phone))) return;
    setBookingContact({ fullname: name.trim(), phone: normalizePhone(phone), email: email.trim() });
    setBookingActive(true);
  };

  useEffect(() => {
    const field = focusError.current;
    focusError.current = null;
    if (field === 'summary') summary.current?.focus();
    else if (field) document.getElementById(`${id}-${field}`)?.focus();
  }, [attempt, id]);
  useEffect(() => { if (confirmation) thanks.current?.focus(); }, [confirmation]);

  const waHref = whatsappUrl(waMessage);
  const whatsappLink = (full = false) => {
    const label = t('form.whatsapp');
    const props = { className: `btn btn--wa ${full ? 'btn--full' : 'btn--icon'}`, 'aria-label': full ? undefined : label, 'data-track': 'whatsapp' };
    const content = <><span className="wa"><Icon name="whatsapp" /></span>{full ? label : null}</>;
    return <a href={waHref} target="_blank" rel="noopener noreferrer" {...props}>{content}</a>;
  };

  if (confirmation) {
    return (
      <div className="lp-form" id={id}>
        <div className="lp-thanks" role="status" tabIndex={-1} ref={thanks} data-lp-cta="">
          <span className="lp-thanks__icon" aria-hidden="true"><Icon name="check" /></span>
          <h3>{t('booking.confirmed')}</h3>
          <p className="sub">{t('booking.resultTime', confirmation)}</p>
          {whatsappLink(true)}
        </div>
      </div>
    );
  }

  const errList = errorOrder.filter((k) => errors[k]);
  const labels = { name: tf('field.name'), phone: t.has('error.field.phone') ? t('error.field.phone') : t('form.phone'),
    email: tf('field.email') };
  // «Проверьте поля: {fields}» (lp.error.summary, Market Analyst) — the field names are links, so the string is split at {fields}
  const [sumPre, sumPost] = t.has('error.summary') ? t('error.summary', { fields: '\u0000' }).split('\u0000') : [`${tf('error.summary')}: `, ''];
  const contactForm = !bookingActive && (
    <form className="lp-form" id={id} noValidate onSubmit={submit}>
      {attempt && errList.length > 1 ? (
        // design audit 10: a short summary — «Проверьте отмеченные поля: Имя, Телефон» with links to the fields; the full texts
        // stay under the fields (aria-describedby), not repeated here
        <div key={attempt} className="form-errors" role="alert" tabIndex={-1} ref={summary}>
          <p>{sumPre}{errList.map((k, i) => (
            <span key={k}>{i ? ', ' : ''}<a href={`#${id}-${k}`} onClick={(e) => { e.preventDefault(); document.getElementById(`${id}-${k}`)?.focus(); }}>{labels[k]}</a></span>
          ))}{sumPost}</p>
        </div>
      ) : null}
      <div className="fields">
        <TextField id={`${id}-name`} name="name" label={tf('field.name')} placeholder={tf('field.namePlaceholder')} autoComplete="given-name" aria-required="true" maxLength={100}
          value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }}
          onBlur={() => { if (attempt) setErrors((x) => ({ ...x, name: rules.name(name) ? t('error.name') : undefined })); }}
          error={errors.name} />
        <PhoneField id={`${id}-phone`} name="phone" label={t('form.phone')} placeholder={tf('field.phonePlaceholder')} required maxLength={32}
          {...(!errors.phone && { 'aria-describedby': `${id}-phone-hint` })}
          value={phone}
          onChange={(e) => { setPhone(e.target.value); if (errors.phone) validatePhoneField(e.target.value); }}
          onBlur={(e) => validatePhoneField(e.target.value)}
          error={errors.phone} />
        <TextField id={`${id}-email`} className="lp-email" name="email" type="email" label={tf('field.email')}
          placeholder={tf('field.emailPlaceholder')} autoComplete="email" required maxLength={254}
          value={email} error={errors.email}
          onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((x) => ({ ...x, email: undefined })); }} />
      </div>
      <div className="acts">
        <button className="btn btn--p" type="submit" data-lp-cta={cta ? '' : undefined}>
          {t('booking.selectService')}<Icon name="arrow-right" />
        </button>
        {whatsappLink()}
      </div>
    </form>
  );
  return (
    <>
      {contactForm}
      {bookingContact && isLocale(locale) && (
        <LandingBookingFlow id={id} active={bookingActive} locale={locale} contact={bookingContact} chips={chips}
          waHref={waHref} privacyHref={privacyHref}
          onBack={() => {
            setBookingActive(false);
            requestAnimationFrame(() => document.getElementById(`${id}-name`)?.focus({ preventScroll: true }));
          }}
          onContactRejected={(field) => {
            setBookingActive(false);
            const contactErrors = { name: t('error.name'), phone: t('error.phone'), email: tf('error.emailInvalid') };
            const key = field === 'fullname' ? 'name' : field;
            reportErrors({ [key]: contactErrors[key] });
          }}
          onCreated={(datetime, service, eventId) => {
            const time = new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai', hourCycle: 'h23',
            }).format(new Date(datetime));
            setConfirmation({ time, service });
            trackLead({ eventId, variant, locale, placement: placementOf(document.getElementById(id)) });
          }} />
      )}
    </>
  );
}
