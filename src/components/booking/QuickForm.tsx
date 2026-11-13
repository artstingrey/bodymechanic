'use client';
/** «Начните с себя» (ТЗ §05.9): short booking without 3D; same POST /api/booking/record as the 3D flow (prefix [Сайт/форма]). */
import { useEffect, useState, type ChangeEvent, type FocusEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Choice';
import { PhoneField, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { dubaiToday } from '@/lib/api/dubai';
import { errorKind } from '@/lib/api/errors';
// the mock BFF (catalogue, rules, record) is loaded on first use, not with the home page's first screen
const api = () => import('@/lib/api');
import type { ApiErrorKind } from '@/lib/api/errors';
import { ErrorBox } from './ui';
import { track } from '@/lib/analytics/track';
import { readUtm } from '@/lib/analytics/utm';
import type { RecordResult, Slot } from '@/lib/api/types';
import { ErrorSummary } from '@/components/forms/ErrorSummary';
import { useFieldErrors } from '@/lib/forms/useFieldErrors';
import { collect, messageArgs, normalizePhone, rules, type ErrorCode } from '@/lib/forms/validate';
import type { Locale } from '@/i18n/routing';

export function QuickForm({ services }: { services: { id: number; title: string; price?: number | null }[] }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [result, setResult] = useState<RecordResult | null>(null);
  const [error, setError] = useState<ApiErrorKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `q${Date.now()}`));
  useEffect(() => { if (serviceId) api().then((a) => a.getDates(serviceId, 0)).then(setDates, (e) => setError(errorKind(e))); }, [serviceId]);
  useEffect(() => { if (serviceId && date) api().then((a) => a.getTimes(serviceId, 0, date)).then(setSlots, (e) => setError(errorKind(e))); }, [serviceId, date]);
  // R-CODE-02 F-05: own validation (noValidate) — field errors, focus on the first one, summary for several
  const v = useFieldErrors();
  const msg = (id: string) => (v.errors[id] ? t(`forms.error.${v.errors[id]}`, messageArgs(v.errors[id])) : undefined);
  const bind = (id: string, rule: (el: HTMLInputElement) => ErrorCode | null) => ({
    id, error: msg(id),
    onBlur: (e: FocusEvent<HTMLInputElement>) => v.field(id, rule(e.currentTarget), !!e.currentTarget.value),
    onChange: (e: ChangeEvent<HTMLInputElement>) => { if (v.errors[id]) v.field(id, rule(e.currentTarget)); },
  });
  const labels = {
    'qf-name': t('forms.field.name'), 'qf-phone': t('forms.field.phone'), 'qf-email': t('forms.field.email'), 'qf-age': t('forms.field.age'),
    'qf-service': t('forms.field.service'), 'qf-date': t('forms.field.datetime'), 'qf-time': t('forms.field.datetime'), // consents: the message alone names the checkbox
  };
  const check = (form: HTMLFormElement) => {
    const fd = new FormData(form), str = (k: string) => String(fd.get(k) ?? '');
    const age = form.elements.namedItem('age') as HTMLInputElement | null;
    return collect([
      ['qf-name', rules.name(str('name'))],
      ['qf-phone', rules.phone(str('phone'))],
      ['qf-email', rules.email(str('email'))],
      ['qf-age', rules.age(str('age'), age?.validity.badInput)],
      ['qf-service', rules.filled(serviceId, 'serviceRequired')],
      [date ? 'qf-time' : 'qf-date', date && str('datetime') ? null : 'datetimeRequired'],
      ['qf-consent', rules.filled(fd.get('consent') === 'on', 'consentRequired')],
    ]);
  };
  if (result) return <p role="status">{result.status === 'queued' ? t('booking.queued.message') : t('booking.done.title')}</p>;
  const submit = async (form: HTMLFormElement) => {
    if (!v.submit(check(form))) return;
    const fd = new FormData(form);
    setBusy(true); setError(null);
    try {
      // same POST /api/booking/record as the 3D flow (ТЗ §05.9); captcha: Turnstile at stage 2, demo token here
      const res = await (await api()).postRecord({
        draft: { model: 'male', markers: [], serviceIds: serviceId ? [serviceId] : [], staffId: 0, datetime: String(fd.get('datetime') || ''), locale, generalNote: String(fd.get('condition') || '') || undefined, utm: readUtm() },
        contact: { fullname: String(fd.get('name')).trim(), phone: normalizePhone(String(fd.get('phone'))), email: String(fd.get('email') || '').trim() || undefined, age: fd.get('age') ? Number(fd.get('age')) : undefined },
        captchaToken: 'demo-quick-form', idempotencyKey: key, source: 'form',
      });
      const svc = services.find((x) => x.id === serviceId);
      if (res.status === 'created') track('booking_success', { service_id: serviceId ?? 0, staff_id: 0, value: svc?.price ?? undefined, currency: 'AED', source: 'form' });
      setResult(res);
    } catch (e) { setError(errorKind(e)); track('booking_error', { reason: errorKind(e) }); }
    setBusy(false);
  };
  return (
    <form className="qform" noValidate onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
      <p className="cap">{t('common.requiredLegend')}</p>
      <ErrorSummary errors={v.errors} labels={labels} attempt={v.attempt} />
      <div className="row2">
        <TextField label={t('forms.field.name')} required name="name" autoComplete="name" placeholder={t('forms.field.namePlaceholder')} {...bind('qf-name', (el) => rules.name(el.value))} />
        <PhoneField label={t('forms.field.phone')} required name="phone" placeholder={t('forms.field.phonePlaceholder')} hint={t('forms.field.phoneHint')} {...bind('qf-phone', (el) => rules.phone(el.value))} />
      </div>
      <div className="row2">
        <TextField label={t('forms.field.email')} name="email" type="email" autoComplete="email" placeholder={t('forms.field.emailPlaceholder')} {...bind('qf-email', (el) => rules.email(el.value))} />
        <TextField label={t('forms.field.age')} name="age" type="number" inputMode="numeric" min={1} max={120} {...bind('qf-age', (el) => rules.age(el.value, el.validity.badInput))} />
      </div>
      <div className="row2">
        <SelectField label={t('forms.field.service')} required name="service" id="qf-service" error={msg('qf-service')} value={serviceId ?? ''}
          onChange={(e) => { setServiceId(Number(e.target.value) || null); setDate(''); if (v.errors['qf-service']) v.field('qf-service', rules.filled(e.target.value, 'serviceRequired')); }}>
          <option value="">{t('forms.field.servicePlaceholder')}</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </SelectField>
        <SelectField label={t('forms.field.staff')} name="staff" defaultValue="0"><option value="0">{t('home.form.anyStaffOption')}</option></SelectField>
      </div>
      <div className="row2">
        <SelectField label={t('forms.field.datetime')} required id="qf-date" error={msg('qf-date')} value={date} disabled={!dates.length}
          onChange={(e) => { setDate(e.target.value); if (v.errors['qf-date']) v.field('qf-date', e.target.value ? null : 'datetimeRequired'); }}>
          <option value="">{t('forms.field.datetimePlaceholder')}</option>
          {dates.map((d) => <option key={d} value={d}>{d === dubaiToday() ? `${d} · ${t('common.dubaiTime')}` : d}</option>)}
        </SelectField>
        <SelectField label={`${t('forms.field.datetime')} · ${t('common.dubaiTime')}`} hideLabel className="field--nolabel" name="datetime" required disabled={!slots.length}
          id="qf-time" error={msg('qf-time')} onChange={(e) => { if (v.errors['qf-time']) v.field('qf-time', e.target.value ? null : 'datetimeRequired'); }}>
          {slots.map((s) => <option key={s.datetime} value={s.datetime}>{t('common.timeWithZone', { time: s.time })}</option>)}
        </SelectField>
      </div>
      <TextAreaField label={t('forms.field.condition')} name="condition" maxLength={1000} placeholder={t('forms.field.conditionPlaceholder')}
        counterText={(count, max) => t('body3d.panel.noteCounter', { count, max })} />
      <Checkbox required name="consent" id="qf-consent" error={msg('qf-consent')}
        onChange={(e) => { if (v.errors['qf-consent']) v.field('qf-consent', rules.filled(e.target.checked, 'consentRequired')); }}>{t.rich('forms.consent.privacy', { privacy: (c) => <Link href="/privacy">{c}</Link> })}</Checkbox>
      <p className="captcha cap" data-testid="captcha" role="status">{t('booking.review.captcha')} <Badge>{t('prototype.demoBadge')}</Badge></p>
      {error ? <ErrorBox kind={error} /> : null}
      <div className="acts">
        <Button type="submit" disabled={busy} loading={busy} loadingLabel={t('home.form.submitting')}>{t('home.form.submit')}</Button>
        <ButtonLink href="/booking" variant="text">{t('home.form.showOn3d')}</ButtonLink>
      </div>
    </form>
  );
}
