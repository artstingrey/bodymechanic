'use client';

import type { ChangeEvent, FocusEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Choice';
import { PhoneField, TextAreaField, TextField } from '@/components/ui/Field';
import { useFieldErrors } from '@/lib/forms/useFieldErrors';
import { messageArgs, rules, type ErrorCode } from '@/lib/forms/validate';

export function QuickForm({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { errors, field } = useFieldErrors();
  const bind = (id: string, rule: (el: HTMLInputElement) => ErrorCode | null) => ({
    id, error: errors[id] ? t(`forms.error.${errors[id]}`, messageArgs(errors[id])) : undefined,
    onBlur: (e: FocusEvent<HTMLInputElement>) => field(id, rule(e.currentTarget), !!e.currentTarget.value || id === 'qf-email'),
    onChange: (e: ChangeEvent<HTMLInputElement>) => { if (errors[id]) field(id, rule(e.currentTarget)); },
  });
  return (
    <form className="qform" noValidate onSubmit={(event) => event.preventDefault()}>
      <p className="cap">{t('common.requiredLegend')}</p>
      <div className="row2">
        <TextField label={t('forms.field.name')} required name="name" autoComplete="name" placeholder={t('forms.field.namePlaceholder')} {...bind('qf-name', (el) => rules.name(el.value))} />
        <PhoneField label={t('forms.field.phone')} required name="phone" placeholder={t('forms.field.phonePlaceholder')} hint={t('forms.field.phoneHint')} {...bind('qf-phone', (el) => rules.phone(el.value))} />
      </div>
      <div className="row2">
        <TextField label={t('forms.field.email')} required name="email" type="email" autoComplete="email" placeholder={t('forms.field.emailPlaceholder')}
          {...bind('qf-email', (el) => rules.filled(el.value.trim()) ?? rules.email(el.value))} />
        <TextField label={t('forms.field.age')} name="age" type="number" inputMode="numeric" min={1} max={120} {...bind('qf-age', (el) => rules.age(el.value, el.validity.badInput))} />
      </div>
      {children}
      <TextAreaField label={t('forms.field.condition')} name="condition" maxLength={1000} placeholder={t('forms.field.conditionPlaceholder')}
        counterText={(count, max) => t('body3d.panel.noteCounter', { count, max })} />
      <Checkbox required name="consent" id="qf-consent">{t.rich('forms.consent.privacy', { privacy: (c) => <Link href="/privacy">{c}</Link> })}</Checkbox>
      <p className="captcha cap" data-testid="captcha" role="status" hidden>{t('booking.review.captcha')} <Badge>{t('prototype.demoBadge')}</Badge></p>
      <div className="acts">
        <Button type="submit" disabled aria-describedby="qf-submit-notice">{t('home.form.submit')}</Button>
        <ButtonLink href="/booking" variant="text">{t('home.form.showOn3d')}</ButtonLink>
      </div>
      <p className="cap" id="qf-submit-notice">{t('home.form.submitUnavailable')}</p>
    </form>
  );
}
