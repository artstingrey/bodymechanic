'use client';
/**
 * Step 6 «Проверка» (ТЗ §07, R-APP-01 F-06): summary with «Изменить» per block (back to that step), price, Turnstile place
 * (demo token in the prototype), SMS code only when BOOKING_SMS_REQUIRED (off by the client's decision), confirm with
 * idempotencyKey; errors with «Повторить».
 */
import { zoneLabel } from '@/lib/body3d/zones';
import { BOOKING_SMS_REQUIRED } from '@/lib/config';
import { useServiceFacts } from '@/components/services/ServiceFacts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ErrorBox } from '../ui';
import type { Flow } from '../useBookingFlow';
import { Todo } from '@/components/ui/Todo';

export function StepReview({ flow }: { flow: Flow }) {
  const { t, sel, go, markers, service, staffName, when, captchaToken, code, setCode, codeSent, busy, error, confirm } = flow;
  const facts = useServiceFacts();
  const rows: [string, string, number][] = [
    [t('booking.review.areas'), markers.length ? markers.map((m) => zoneLabel(t, m.zoneId)).join('; ') : t('booking.review.noAreas'), 1],
    [t('booking.review.service'), service?.title ?? '—', 2],
    [t('booking.review.specialist'), sel.staffId ? staffName ?? '—' : t('booking.staff.any'), 3],
    [t('booking.review.datetime'), sel.datetime ? when(sel.datetime) : '—', 4],
    [t('booking.review.contacts'), [sel.contact.fullname.trim(), /\d{5}/.test(sel.contact.phone) ? sel.contact.phone.trim() : ''].filter(Boolean).join(' · ') || '—', 5], // the bare «+971» prefix is not a phone
  ];
  return (
    <section aria-labelledby="st6" className="bk-step bk-narrow">
      <h1 id="st6" tabIndex={-1} className="h2">{t('booking.review.heading')}</h1>
      <dl className="bk-review">
        {rows.map(([label, value, n]) => (
          <div key={label}>
            <dt>{label}</dt><dd>{value}</dd>
            <button type="button" className="btn btn--text btn--sm bk-edit" onClick={() => go(n)} aria-label={`${t('booking.review.edit')}: ${label}`}>{t('booking.review.edit')}</button>
          </div>
        ))}
        <div className="bk-total"><dt>{t('booking.review.total')}</dt><dd className="tn">{service ? facts.price(service) ?? '—' : '—'} <Badge>{facts.demo}</Badge></dd></div>
      </dl>
      <Todo as="p">{t('booking.review.paymentTodo')}</Todo>
      {/* Turnstile (stage 2: Cloudflare widget with NEXT_PUBLIC_TURNSTILE_SITE_KEY). Prototype: a demo token after a short check. */}
      <div className="captcha" data-testid="captcha" data-verified={captchaToken ? 'true' : undefined} role="status">
        <span className="captcha__box" aria-hidden="true">{captchaToken ? <Icon name="check" /> : <Icon name="loader" className="spin" />}</span>
        {t('booking.review.captcha')} <Badge>{t('prototype.demoBadge')}</Badge>
      </div>
      {BOOKING_SMS_REQUIRED && codeSent ? (
        <div className="sms field">
          <p role="status" className="hint">{t('booking.sms.sent', { phone: sel.contact.phone })}</p>
          <label htmlFor="bk-sms">{t('booking.sms.label')}</label>
          <div className="input"><input id="bk-sms" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
        </div>
      ) : null}
      {error && error !== 'slotTaken' ? <ErrorBox kind={error} onRetry={confirm} id="booking-error" /> : null}
      <div className="bk-actions">
        <Button variant="secondary" onClick={() => go(5)}>{t('common.actions.back')}</Button>
        <Button disabled={busy || !service || !sel.datetime || !captchaToken || (BOOKING_SMS_REQUIRED && codeSent && code.length < 4)} loading={busy}
          loadingLabel={t('booking.review.confirming')} onClick={confirm}>{t('booking.review.confirm')}</Button>
      </div>
    </section>
  );
}
