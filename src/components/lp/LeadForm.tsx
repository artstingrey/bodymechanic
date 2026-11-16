'use client';
/**
 * Landing lead form (lp-brief §2, task 01a1b325): name + «Телефон / WhatsApp» → «Подобрать время»; the
 * optional chips are folded after the button in «Уточнить (необязательно)», with the consent for the marks required only
 * when a chip is selected. Validation like the site (rules from lib/forms): aria-invalid + error text per field, a summary
 * role=alert for two or more errors, focus on the first error. One idempotency key per form (a double tap or a retry never
 * makes a second lead). The result replaces the form in place; trackLead gets the event id only.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PhoneField, TextField } from '@/components/ui/Field';
import { Checkbox } from '@/components/ui/Choice';
import { Icon } from '@/components/ui/Icon';
import { PrefilledLink } from '@/components/ui/PrefilledLink';
import { WHATSAPP_BASE, whatsappUrl } from '@/lib/config';
import { normalizePhone, rules } from '@/lib/forms/validate';
import { afterPress } from '@/lib/forms/useFieldErrors';
import { newKey, postLead } from '@/lib/lp/lead';
import { placementOf, trackFormError, trackLead } from '@/lib/lp/track';

type Err = { name?: string; phone?: string; details?: string };

export function LeadForm({ id, variant, chips, title, submitLabel, waMessage, privacyHref, cta = true }: {
  id: string; variant: 'a' | 'b'; chips: { id: string; label: string }[]; title?: string; submitLabel?: string;
  waMessage: string; privacyHref: string; /** marks the submit button for the sticky-CTA observer */ cta?: boolean;
}) {
  const t = useTranslations('lp');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [detailsConsent, setDetailsConsent] = useState(false);
  const [errors, setErrors] = useState<Err>({});
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [key] = useState(newKey);
  const form = useRef<HTMLFormElement>(null);
  const thanks = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const busy = useRef(false); // a second tap lands before React re-renders the busy state

  const phoneError = (value: string) => {
    const code = rules.phone(value);
    if (code === 'required') return tf('error.required');
    if (code) return t('error.phone');
  };

  const validatePhoneField = (value: string) => {
    const error = phoneError(value);
    const showError = () => setErrors((current) => ({ ...current, phone: error }));
    if (error) afterPress(showError);
    else showError();
  };

  const validate = (): Err => {
    const e: Err = {};
    if (rules.name(name)) e.name = t('error.name');
    const invalidPhone = phoneError(phone);
    if (invalidPhone) e.phone = invalidPhone;
    if (picked.length && !detailsConsent) e.details = t('error.consentDetails');
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy.current) return; // double tap
    const e = validate();
    setErrors(e); setAttempt((n) => n + 1);
    const first = (['name', 'phone', 'details'] as const).find((k) => e[k]);
    if (first) {
      trackFormError(Object.keys(e), placementOf(document.getElementById(id))); // lp_form_error: the type only (Frontend Builder)
      if (first === 'details') (document.getElementById(`${id}-details-box`) as HTMLDetailsElement | null)?.setAttribute('open', '');
      requestAnimationFrame(() => {
        if (Object.keys(e).length > 1) summary.current?.focus();
        else document.getElementById(`${id}-${first}`)?.focus();
      });
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

  const prefillWhatsApp = () => {
    const fields = form.current ? new FormData(form.current) : null;
    const contactName = String(fields?.get('name') ?? name).trim();
    const contactPhone = normalizePhone(String(fields?.get('phone') ?? phone));
    const includeDetails = fields?.has('detailsConsent') ?? detailsConsent;
    const details = includeDetails ? chips.filter(({ id }) => picked.includes(id)).map(({ label }) => label).join(', ') : '';
    return whatsappUrl([
      waMessage,
      contactName && t('form.whatsappMessage.name', { name: contactName }),
      contactPhone && t('form.whatsappMessage.phone', { phone: contactPhone }),
      details && t('form.whatsappMessage.details', { details }),
    ].filter(Boolean).join('\n'));
  };

  const whatsappLink = (full = false) => {
    const label = t('form.whatsapp');
    const props = { className: `btn btn--wa ${full ? 'btn--full' : 'btn--icon'}`, 'aria-label': full ? undefined : label, 'data-track': 'whatsapp' };
    const content = <><span className="wa"><Icon name="whatsapp" /></span>{full ? label : null}</>;
    if (variant === 'a') return <PrefilledLink href={WHATSAPP_BASE} full={prefillWhatsApp} {...props}>{content}</PrefilledLink>;
    return <a href={whatsappUrl(waMessage)} target="_blank" rel="noopener noreferrer" {...props}>{content}</a>;
  };

  if (status === 'done') {
    return (
      <div className="lp-form" id={id}>
        <div className="lp-thanks" role="status" tabIndex={-1} ref={thanks} data-lp-cta="">
          <h3>{t('result.title')}</h3>
          <p className="sub">{t('result.text')}</p>
          {whatsappLink(true)}
        </div>
      </div>
    );
  }

  const submitText = submitLabel ?? t('form.submit'); // R-LP-03 F-03: the consent names the button the visitor taps
  const errList = (['name', 'phone', 'details'] as const).filter((k) => errors[k]);
  const labels = { name: tf('field.name'), phone: t.has('error.field.phone') ? t('error.field.phone') : t('form.phone'), details: t.has('error.field.consentDetails') ? t('error.field.consentDetails') : t('form.details.toggle') };
  // «Проверьте поля: {fields}» (lp.error.summary, Market Analyst) — the field names are links, so the string is split at {fields}
  const [sumPre, sumPost] = t.has('error.summary') ? t('error.summary', { fields: '\u0000' }).split('\u0000') : [`${tf('error.summary')}: `, ''];
  return (
    <form className="lp-form" id={id} ref={form} noValidate onSubmit={submit} aria-busy={status === 'busy' || undefined}>
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
        <TextField id={`${id}-name`} name="name" label={tf('field.name')} placeholder={tf('field.namePlaceholder')} autoComplete="given-name" aria-required="true"
          value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }}
          onBlur={() => { if (attempt) setErrors((x) => ({ ...x, name: rules.name(name) ? t('error.name') : undefined })); }}
          error={errors.name} />
        <PhoneField id={`${id}-phone`} name="phone" label={t('form.phone')} placeholder={tf('field.phonePlaceholder')} required
          {...(!errors.phone && { 'aria-describedby': `${id}-phone-hint` })}
          value={phone}
          onChange={(e) => { setPhone(e.target.value); if (errors.phone) validatePhoneField(e.target.value); }}
          onBlur={(e) => validatePhoneField(e.target.value)}
          error={errors.phone} />
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
      <p className="resp">{t('form.phoneHint')}</p>{/* no WhatsApp icon here: two mentions on the first screen are enough (design audit 12) */}
      <details className="chips-d" id={`${id}-details-box`}>
        <summary>{t('form.details.toggle')}</summary>
        <fieldset className="chips">
          <legend>{t('form.details.hint')}</legend>
          <div className="row">
            {chips.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={picked.includes(c.id)}
                onClick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}>{c.label}</button>
            ))}
          </div>
          <Checkbox id={`${id}-details`} name="detailsConsent" checked={detailsConsent} error={errors.details}
            onChange={(e) => { setDetailsConsent(e.target.checked); if (errors.details) setErrors((x) => ({ ...x, details: undefined })); }}>
            {t('consent.details')}
          </Checkbox>
          <p className="note">{t('form.details.note')}</p>
        </fieldset>
      </details>
      <p className="fine">{t('form.privacyNote')}. {t.rich('consent.submit', { button: submitText, privacy: (c) => <a href={privacyHref} target="_blank" rel="noopener">{c}</a> })}.</p>
    </form>
  );
}
