'use client';
/** Step 5 «Контакты» (ТЗ §07): name, phone (E.164), email, age, gender from the model, privacy consent. */
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Choice';
import { PhoneField, TextField } from '@/components/ui/Field';
import { Summary } from './Summary';
import { ErrorSummary } from '@/components/forms/ErrorSummary';
import { requiredEmail, rules } from '@/lib/forms/validate';
import { Loading } from '../ui';
import type { Flow } from '../useBookingFlow';

export function StepContacts({ flow }: { flow: Flow }) {
  const { t, sel, updateContact, go, model, contactErrors, contactAttempt, contactMsg, contactField,
    submitContacts, selectedDatetime } = flow;
  const c = sel.contact;
  // R-CODE-02 F-05: errors from the flow (lib/forms/validate); re-checked on blur, and on change once a field shows an error
  const live = (id: string, code: ReturnType<typeof rules.name>) => { if (contactErrors[id]) contactField(id, code); };
  const labels = { 'c-name': t('forms.field.name'), 'c-phone': t('forms.field.phone'), 'c-email': t('forms.field.email'), 'c-age': t('forms.field.age') };
  if (!selectedDatetime) return <section className="bk-main" aria-labelledby="st5">
    <h1 id="st5" tabIndex={-1} className="h2">{t('booking.contacts.heading')}</h1>
    <Loading label={t('common.state.loading')} />
  </section>;
  return (
    <div className="bk-step bk-grid">
      <Summary flow={flow} />
      <form aria-labelledby="st5" className="bk-main bk-form" noValidate
        onSubmit={(e) => { e.preventDefault(); submitContacts(); }}>
        <h1 id="st5" tabIndex={-1} className="h2">{t('booking.contacts.heading')}</h1>
        <p className="lead">{t('booking.contacts.lead')}</p>
        <p className="cap">{t('common.requiredLegend')}</p>
        <ErrorSummary errors={contactErrors} labels={labels} attempt={contactAttempt} />
        <div className="row2">
          <TextField label={t('forms.field.name')} required maxLength={100} autoComplete="name" placeholder={t('forms.field.namePlaceholder')} id="c-name" error={contactMsg('c-name')} value={c.fullname}
            onChange={(e) => { updateContact({ fullname: e.target.value }); live('c-name', rules.name(e.target.value)); }}
            onBlur={(e) => contactField('c-name', rules.name(e.target.value), !!e.target.value)} />
          <PhoneField label={t('forms.field.phone')} required maxLength={32} placeholder={t('forms.field.phonePlaceholder')} hint={t('forms.field.phoneHint')} id="c-phone" error={contactMsg('c-phone')} value={c.phone}
            onChange={(e) => { updateContact({ phone: e.target.value }); live('c-phone', rules.phone(e.target.value)); }}
            onBlur={(e) => contactField('c-phone', rules.phone(e.target.value))} />
        </div>
        <div className="row2">
          <TextField label={t('forms.field.email')} type="email" required maxLength={254} autoComplete="email" placeholder={t('forms.field.emailPlaceholder')} id="c-email" error={contactMsg('c-email')} value={c.email ?? ''}
            onChange={(e) => { updateContact({ email: e.target.value }); live('c-email', requiredEmail(e.target.value)); }}
            onBlur={(e) => contactField('c-email', requiredEmail(e.target.value), !!e.target.value)} />
          <TextField label={t('forms.field.age')} type="number" inputMode="numeric" min={1} max={120} id="c-age" error={contactMsg('c-age')} value={c.age ?? ''}
            onChange={(e) => { updateContact({ age: e.target.value ? Number(e.target.value) : undefined }); live('c-age', rules.age(e.target.value, e.target.validity.badInput)); }}
            onBlur={(e) => contactField('c-age', rules.age(e.target.value, e.target.validity.badInput), !!e.target.value || e.target.validity.badInput)} />
        </div>
        <p className="bk-gender"><b>{t('forms.field.gender')}:</b> {model === 'male' ? t('booking.contacts.genderMale') : t('booking.contacts.genderFemale')} <span className="hint">{t('forms.field.genderHint')}</span></p>
        <div>
          <Checkbox required id="c-consent" error={contactMsg('c-consent')} checked={c.consent}
            onChange={(e) => { updateContact({ consent: e.target.checked }); live('c-consent', rules.filled(e.target.checked, 'consentRequired')); }}>{t.rich('forms.consent.privacy', { privacy: (x) => <Link href="/privacy">{x}</Link> })}</Checkbox>
        </div>
        <div className="bk-actions">
          <Button variant="secondary" onClick={() => go(4)}>{t('common.actions.back')}</Button>
          <Button type="submit">{t('booking.contacts.next')}</Button>
        </div>
      </form>
    </div>
  );
}
