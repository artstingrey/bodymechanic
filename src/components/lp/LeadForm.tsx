'use client';
/**
 * Landing contact form. Variant A continues to online booking. Variant B submits a lead,
 * with a separate consent when the visitor selects optional details. Validation follows the site: a summary
 * role=alert for two or more errors, focus on the first error. One idempotency key per form (a double tap or a retry never
 * makes a second lead). The result replaces the form in place; trackLead gets the event id only.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PhoneField, TextField } from '@/components/ui/Field';
import { Checkbox } from '@/components/ui/Choice';
import { Icon } from '@/components/ui/Icon';
import { whatsappUrl } from '@/lib/config';
import type { BookingRecordRequest } from '@/lib/contracts/booking-record';
import { normalizePhone, requiredEmail, rules } from '@/lib/forms/validate';
import { afterPress } from '@/lib/forms/useFieldErrors';
import { newKey, postLead } from '@/lib/lp/lead';
import { landingPhoneError } from '@/lib/lp/phone';
import { placementOf, trackFormError, trackLead } from '@/lib/lp/track';
import { isLocale } from '@/i18n/routing';
import { LandingBookingFlow } from './LandingBookingFlow';
import { LandingDetails } from './LandingDetails';

const errorOrder = ['name', 'phone', 'email', 'details'] as const;
type Err = Partial<Record<typeof errorOrder[number], string>>;

export function LeadForm({ id, variant, chips, title, submitLabel, waMessage, privacyHref, cta = true }: {
  id: string; variant: 'a' | 'b'; chips: { id: string; label: string }[]; title?: string; submitLabel?: string;
  waMessage: string; privacyHref: string; /** marks the submit button for the sticky-CTA observer */ cta?: boolean;
}) {
  const t = useTranslations('lp');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [detailsConsent, setDetailsConsent] = useState(false);
  const [errors, setErrors] = useState<Err>({});
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [key] = useState(newKey);
  const [bookingContact, setBookingContact] = useState<BookingRecordRequest['contact'] | null>(null);
  const [bookingActive, setBookingActive] = useState(false);
  const [confirmation, setConfirmation] = useState<{ time: string; service: string } | null>(null);
  const thanks = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const busy = useRef(false); // a second tap lands before React re-renders the busy state

  const phoneError = (value: string) => {
    const code = variant === 'a' ? landingPhoneError(value) : rules.phone(value);
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
    if (variant === 'a') {
      const invalidEmail = requiredEmail(email);
      if (invalidEmail) e.email = tf(`error.${invalidEmail}`);
    }
    return e;
  };

  const reportErrors = (nextErrors: Err) => {
    setErrors(nextErrors);
    setAttempt((n) => n + 1);
    const first = errorOrder.find((k) => nextErrors[k]);
    if (!first) return false;

    const errorFields = Object.keys(nextErrors);
    trackFormError(errorFields, placementOf(document.getElementById(id)));
    if (first === 'details') document.getElementById(`${id}-details-box`)?.setAttribute('open', '');
    requestAnimationFrame(() => {
      if (errorFields.length > 1) summary.current?.focus();
      else document.getElementById(`${id}-${first}`)?.focus();
    });
    return true;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy.current) return; // double tap
    const nextErrors = validateContacts(name, phone);
    if (variant === 'b' && picked.length && !detailsConsent) nextErrors.details = t('error.consentDetails');
    if (reportErrors(nextErrors)) return;
    if (variant === 'a') {
      setBookingContact({ fullname: name.trim(), phone: normalizePhone(phone), email: email.trim() });
      setBookingActive(true);
      return;
    }
    busy.current = true; setStatus('busy');
    try {
      await postLead({ name: name.trim(), phone: normalizePhone(phone), details: picked, detailsConsent, variant, locale, idempotencyKey: key });
      trackLead({ eventId: key, variant, locale, placement: placementOf(document.getElementById(id)) });
      setStatus('done'); // focus moves in the effect below, after «спасибо» is in the DOM (R-LP-03 M-02)
    } catch {
      trackFormError(['server'], placementOf(document.getElementById(id)));
      setStatus('error');
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => { if (status === 'done') thanks.current?.focus(); }, [status]);

  const waHref = whatsappUrl(waMessage);
  const whatsappLink = (full = false) => {
    const label = t('form.whatsapp');
    const props = { className: `btn btn--wa ${full ? 'btn--full' : 'btn--icon'}`, 'aria-label': full ? undefined : label, 'data-track': 'whatsapp' };
    const content = <><span className="wa"><Icon name="whatsapp" /></span>{full ? label : null}</>;
    return <a href={waHref} target="_blank" rel="noopener noreferrer" {...props}>{content}</a>;
  };

  if (status === 'done') {
    return (
      <div className="lp-form" id={id}>
        <div className="lp-thanks" role="status" tabIndex={-1} ref={thanks} data-lp-cta="">
          {confirmation && <span className="lp-thanks__icon" aria-hidden="true"><Icon name="check" /></span>}
          <h3>{confirmation ? t('booking.confirmed') : t('result.title')}</h3>
          <p className="sub">{confirmation ? t('booking.resultTime', confirmation) : t('result.text')}</p>
          {whatsappLink(true)}
        </div>
      </div>
    );
  }

  const submitText = variant === 'a' ? t('booking.selectService') : submitLabel ?? t('form.submit');
  const errList = errorOrder.filter((k) => errors[k]);
  const labels = { name: tf('field.name'), phone: t.has('error.field.phone') ? t('error.field.phone') : t('form.phone'),
    email: tf('field.email'), details: t.has('error.field.consentDetails') ? t('error.field.consentDetails') : t('form.details.toggle') };
  // «Проверьте поля: {fields}» (lp.error.summary, Market Analyst) — the field names are links, so the string is split at {fields}
  const [sumPre, sumPost] = t.has('error.summary') ? t('error.summary', { fields: '\u0000' }).split('\u0000') : [`${tf('error.summary')}: `, ''];
  const contactForm = !bookingActive && (
    <form className="lp-form" id={id} noValidate onSubmit={submit} aria-busy={status === 'busy' || undefined}>
      {title ? <h3 className="ftitle">{title}</h3> : null}
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
        <TextField id={`${id}-name`} name="name" label={tf('field.name')} placeholder={tf('field.namePlaceholder')} autoComplete="given-name" aria-required="true" maxLength={variant === 'a' ? 100 : undefined}
          value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }}
          onBlur={() => { if (attempt) setErrors((x) => ({ ...x, name: rules.name(name) ? t('error.name') : undefined })); }}
          error={errors.name} />
        <PhoneField id={`${id}-phone`} name="phone" label={t('form.phone')} placeholder={tf('field.phonePlaceholder')} required maxLength={variant === 'a' ? 32 : undefined}
          {...(!errors.phone && { 'aria-describedby': `${id}-phone-hint` })}
          value={phone}
          onChange={(e) => { setPhone(e.target.value); if (errors.phone) validatePhoneField(e.target.value); }}
          onBlur={(e) => validatePhoneField(e.target.value)}
          error={errors.phone} />
        {variant === 'a' && (
          <TextField id={`${id}-email`} className="lp-email" name="email" type="email" label={tf('field.email')}
            placeholder={tf('field.emailPlaceholder')} autoComplete="email" required maxLength={254}
            value={email} error={errors.email}
            onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((x) => ({ ...x, email: undefined })); }} />
        )}
      </div>
      <div className="acts">
        <button className="btn btn--p" type="submit" aria-busy={status === 'busy' || undefined} data-lp-cta={cta ? '' : undefined}>
          {submitText}{status === 'busy' ? <span className="spin" aria-hidden="true" /> : <Icon name="arrow-right" />}
        </button>
        {whatsappLink()}
      </div>
      {status === 'error' ? (
        <div className="server-err" role="alert">
          <p>{t('error.server')}</p>
        </div>
      ) : null}
      <p className="hint" id={`${id}-phone-hint`}>{tf('field.phoneHint')}</p>
      {variant === 'b' && <>
        <p className="resp">{t('form.phoneHint')}</p>
        <LandingDetails id={id} chips={chips} picked={picked}
          onToggle={(mark) => setPicked((items) => items.includes(mark) ? items.filter((item) => item !== mark) : [...items, mark])}>
          <Checkbox id={`${id}-details`} name="detailsConsent" checked={detailsConsent} error={errors.details}
            onChange={(e) => { setDetailsConsent(e.target.checked); if (errors.details) setErrors((x) => ({ ...x, details: undefined })); }}>
            {t('consent.details')}
          </Checkbox>
        </LandingDetails>
        <p className="fine">{t('form.privacyNote')}. {t.rich('consent.submit', { button: submitText, privacy: (c) => <a href={privacyHref} target="_blank" rel="noopener">{c}</a> })}.</p>
      </>}
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
            setStatus('done');
          }} />
      )}
    </>
  );
}
