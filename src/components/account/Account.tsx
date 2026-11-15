'use client';
/**
 * «Мои записи» (ТЗ §09, R-APP-01 F-05): SMS login (mock, resend timer + 3 codes / 10 min), upcoming and past records,
 * cancel (modal with rules → DELETE; too_late → disabled + WhatsApp), reschedule (dates and times of THIS record → PATCH →
 * confirmation), «Записаться снова» (pre-filled booking), «Оставить отзыв». Structure only — visuals come from hi-fi.
 */
import { useEffect, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { calendarDays, cancelRecord, errorKind, getAccountRecords, getDates, getTimes, MIN_NOTICE_HOURS, postCode, rescheduleRecord, tooLate } from '@/lib/api';
import type { ApiErrorKind } from '@/lib/api/errors';
import type { AccountRecord, Slot } from '@/lib/api/types';
import { zoneLabel } from '@/lib/body3d/zones';
import { WHATSAPP_BASE, whatsappUrl } from '@/lib/config';
import { PrefilledLink } from '@/components/ui/PrefilledLink';
import { BookingLink } from '@/components/booking/BookingLink';
import { ErrorBox, Loading } from '@/components/booking/ui';
import { useAsync } from '@/components/booking/useBookingFlow';
import { track } from '@/lib/analytics/track';
import { PhoneField, TextField } from '@/components/ui/Field';
import { useFieldErrors } from '@/lib/forms/useFieldErrors';
import { collect, messageArgs, normalizePhone, rules } from '@/lib/forms/validate';
import type { Locale } from '@/i18n/routing';
import { Todo } from '@/components/ui/Todo';
import { useDialogBackCloses } from '@/lib/ui/useBackCloses';

function useWhen() {
  const t = useTranslations();
  const f = useFormatter();
  return (iso: string) => `${f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' })} · ${t('common.dubaiTime')}`;
}

/** Reschedule (ТЗ §09 SHOULD): steps 4–6 for this record — date, time, confirm → PATCH /api/account/records/:id. */
function Reschedule({ r, onDone, onClose }: { r: AccountRecord; onDone: (next: AccountRecord) => void; onClose: () => void }) {
  const t = useTranslations();
  const f = useFormatter();
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorKind | null>(null);
  const sid = r.serviceId ?? 101, staff = r.staffId ?? 0;
  const datesQ = useAsync<string[]>(true, () => getDates(sid, staff), ['rs-dates', r.id]);
  const timesQ = useAsync<Slot[]>(!!date, () => getTimes(sid, staff, date!), ['rs-times', r.id, date]);
  const available = new Set(datesQ.data ?? []);
  const day = (d: string) => f.dateTime(new Date(`${d}T12:00:00+04:00`), { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'Asia/Dubai' });
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  const submit = async () => {
    if (!slot) return;
    setBusy(true); setError(null);
    try { onDone(await rescheduleRecord(r, slot.datetime)); track('booking_reschedule'); } catch (e) { setError(errorKind(e)); }
    setBusy(false);
  };
  return (
    <section className="account-reschedule" aria-labelledby={`rs-${r.id}`}>
      <h3 id={`rs-${r.id}`} ref={titleRef} tabIndex={-1}>{t('account.reschedule.title')}</h3>
      <p>{t('account.reschedule.lead')}</p>
      <Todo as="p">{t('account.reschedule.minNotice', { hours: MIN_NOTICE_HOURS })}</Todo>
      {datesQ.status === 'loading' ? <Loading label={t('common.state.loading')} /> : null}
      {datesQ.status === 'error' && datesQ.error ? <ErrorBox kind={datesQ.error} onRetry={datesQ.retry} /> : null}
      {datesQ.status === 'ready' ? (
        <div role="group" aria-label={t('booking.time.calendarLabel')} className="dates">
          {calendarDays().map((d) => {
            const on = available.has(d);
            return <button key={d} type="button" aria-pressed={date === d} aria-disabled={!on || undefined} aria-label={on ? undefined : `${day(d)} — ${t('booking.time.dateUnavailable')}`}
              onClick={() => { if (on) { setDate(d); setSlot(null); } }}>{day(d)}</button>;
          })}
        </div>
      ) : null}
      {date ? (timesQ.status === 'loading' ? <Loading label={t('booking.time.searching')} />
        : timesQ.status === 'error' && timesQ.error ? <ErrorBox kind={timesQ.error} onRetry={timesQ.retry} />
        : (timesQ.data ?? []).length ? <div className="times">{(timesQ.data ?? []).map((s) => <button key={s.datetime} type="button" aria-pressed={slot?.datetime === s.datetime} onClick={() => setSlot(s)}>{s.time}</button>)}</div>
        : <p>{t('booking.time.noTimes')}</p>) : null}
      {slot ? <p role="status">{t('booking.time.selected', { date: day(slot.datetime.slice(0, 10)), time: t('common.timeWithZone', { time: slot.time }) })}</p> : null}
      {error ? <ErrorBox kind={error} onRetry={error === 'tooLate' ? undefined : submit} /> : null}
      <button type="button" onClick={onClose}>{t('common.actions.cancel')}</button>
      <button type="button" disabled={!slot || busy} onClick={submit}>{t('account.reschedule.confirm')}</button>
    </section>
  );
}

function RecordCard({ r: initial, past }: { r: AccountRecord; past?: boolean }) {
  const t = useTranslations();
  const when = useWhen();
  const [r, setR] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiErrorKind | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useDialogBackCloses(dialog); // Android «Back» closes the cancel dialog
  const late = !past && tooLate(r.datetime);
  useEffect(() => {
    const d = dialog.current; if (!d) return;
    const back = () => requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); });
    d.addEventListener('close', back);
    return () => d.removeEventListener('close', back);
  }, []);
  const active = r.status !== 'cancelled' && !past;

  const doCancel = async () => {
    setBusy(true); setError(null);
    try { await cancelRecord(r); track('booking_cancel'); setR({ ...r, status: 'cancelled' }); setNotice(t('account.cancel.success')); dialog.current?.close(); }
    catch (e) { setError(errorKind(e)); dialog.current?.close(); }
    setBusy(false);
  };
  return (
    <li className="card" data-testid="account-record" data-late={late || undefined}>
      <p>{when(r.datetime)}</p>
      <h3>{r.serviceTitle}</h3>
      <p>{r.staffName}</p>
      <p>{t('account.card.status')}: {t(`account.status.${r.status}`)}</p>
      <p>{t('account.card.areas')}: {r.zones.map((z) => zoneLabel(t, z)).join('; ')}</p>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <ErrorBox kind={error} onRetry={error === 'tooLate' ? undefined : doCancel} /> : null}
      {past ? (
        <p>
          {/* Ж-9: the service and the specialist are handed over at the click; the way out of the account is a full page load
              (PrivateBoundary), so the hand-over waits in the tab's storage */}
          <BookingLink preset={{ ...(r.serviceId ? { service: r.serviceId } : {}), ...(r.staffId ? { staff: r.staffId } : {}) }}>{t('common.actions.bookAgain')}</BookingLink>{' '}
          {/* review: the studio collects reviews in WhatsApp until the review link exists (TODO content) */}
          <PrefilledLink href={WHATSAPP_BASE} full={() => whatsappUrl(`${t('account.action.review')}: ${r.serviceTitle}, ${when(r.datetime)}`)}>{t('account.action.review')}</PrefilledLink>
        </p>
      ) : active ? (
        late ? (
          <div className="account-late">
            <p>{t('account.reschedule.unavailable')}</p>
            <button type="button" disabled>{t('account.reschedule.unavailableShort')}</button>{' '}
            <button type="button" disabled>{t('account.action.cancel')}</button>{' '}
            <PrefilledLink href={WHATSAPP_BASE} full={() => whatsappUrl(`${r.serviceTitle}, ${when(r.datetime)}`)}>{t('common.actions.writeWhatsapp')}</PrefilledLink>
          </div>
        ) : (
          <p>
            <button type="button" aria-expanded={rescheduling} onClick={() => { setRescheduling(true); setNotice(null); }}>{t('account.action.reschedule')}</button>{' '}
            <button type="button" onClick={(e) => { opener.current = e.currentTarget; setError(null); dialog.current?.showModal(); keepRef.current?.focus(); }}>{t('account.action.cancel')}</button>
          </p>
        )
      ) : null}
      {rescheduling ? (
        <Reschedule r={r} onClose={() => setRescheduling(false)}
          onDone={(next) => { setR(next); setRescheduling(false); setNotice(t('account.reschedule.success', { datetime: when(next.datetime) })); }} />
      ) : null}
      {/* native modal: focus inside, Esc closes, the focus returns to «Отменить запись» (A11Y, R-APP-01 F-04) */}
      <dialog ref={dialog} className="account-cancel" aria-labelledby={`cancel-${r.id}`}>
        <p id={`cancel-${r.id}`}><b>{t('account.cancel.title')}</b></p>
        <Todo as="p">{t('account.cancel.rules')}</Todo>
        <button type="button" disabled={busy} onClick={doCancel}>{t('account.cancel.confirm')}</button>
        <button type="button" ref={keepRef} onClick={() => dialog.current?.close()}>{t('account.cancel.keep')}</button>
      </dialog>
    </li>
  );
}

export function RecordView({ record }: { record: AccountRecord | null }) {
  const t = useTranslations();
  if (!record) return <p role="alert">{t('account.link.invalid')}</p>;
  return <><p>{t('account.sampleRecords')}</p><ul><RecordCard r={record} /></ul></>;
}

const SENT = 'bm.smsSent';
const RESEND_S = 60;

export function Account() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [phone, setPhone] = useState(''); // PhoneField puts «+971 » on focus
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [sentAt, setSentAt] = useState<number[]>([]);
  const [limit, setLimit] = useState(false);
  const [records, setRecords] = useState<{ upcoming: AccountRecord[]; past: AccountRecord[] } | null>(null);
  const [error, setError] = useState<ApiErrorKind | null>(null);
  useEffect(() => { if (!codeSent) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, [codeSent]);
  const wait = sentAt.length ? Math.max(0, RESEND_S - Math.floor((now - sentAt[sentAt.length - 1]) / 1000)) : 0;

  // ТЗ §08: no more than 3 codes per number in 10 minutes
  const send = async () => {
    const recent = (() => { try { return (JSON.parse(sessionStorage.getItem(SENT) || '[]') as number[]).filter((x) => Date.now() - x < 600_000); } catch { return []; } })();
    if (recent.length >= 3) { setLimit(true); return; }
    await postCode(normalizePhone(phone));
    const next = [...recent, Date.now()];
    try { sessionStorage.setItem(SENT, JSON.stringify(next)); } catch { /* ignore */ }
    setSentAt(next); setNow(Date.now()); setCodeSent(true); setLimit(false);
  };
  const login = async () => {
    setError(null);
    try { setRecords(await getAccountRecords(locale)); track('account_login'); } catch (e) { setError(errorKind(e)); }
  };

  // R-CODE-02 F-05: own validation (noValidate) — E.164 phone, then the code; error in the field, focus on it
  const v = useFieldErrors();
  const msg = (id: string) => { const c = v.errors[id]; return c ? t(`forms.error.${c}`, messageArgs(c)) : undefined; };
  const onSubmit = () => {
    const errs = codeSent ? collect([['acc-code', rules.filled(code)]]) : collect([['acc-phone', rules.phone(phone)]]);
    if (!v.submit(errs)) return;
    void (codeSent ? login() : send());
  };

  if (!records) {
    return (
      <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <p>{t('account.login.lead')}</p>
        <PhoneField id="acc-phone" label={t('forms.field.phone')} required placeholder={t('forms.field.phonePlaceholder')} hint={t('forms.field.phoneHint')}
          value={phone} disabled={codeSent} error={msg('acc-phone')} onPrefill={setPhone}
          onChange={(e) => { setPhone(e.target.value); if (v.errors['acc-phone']) v.field('acc-phone', rules.phone(e.target.value)); }}
          onBlur={(e) => { const c = rules.phone(e.target.value); v.field('acc-phone', c, c !== 'required'); }} />
        {codeSent ? (
          <>
            <p role="status">{t('account.login.codeNotice')}</p>
            <TextField id="acc-code" label={t('forms.field.code')} required inputMode="numeric" autoComplete="one-time-code" value={code} error={msg('acc-code')}
              onChange={(e) => { const x = e.target.value.replace(/\D/g, ''); setCode(x); if (v.errors['acc-code']) v.field('acc-code', rules.filled(x)); }} />
            <button type="button" className="link-button" disabled={wait > 0} onClick={() => void send()}>
              {wait > 0 ? t('booking.sms.resendIn', { seconds: wait }) : t('booking.sms.resend')}
            </button>
            <button type="button" className="link-button" onClick={() => { setCodeSent(false); setCode(''); }}>{t('account.login.changePhone')}</button>
          </>
        ) : null}
        {limit ? <p role="alert">{t('booking.sms.tooMany')}</p> : null}
        {error ? <ErrorBox kind={error} onRetry={login} /> : null}
        <button type="submit">{codeSent ? t('account.login.submit') : t('account.login.getCode')}</button>
      </form>
    );
  }
  return (
    <>
      <p>{t('account.sampleRecords')}</p>
      <section><h2>{t('account.upcoming.title')}</h2>{records.upcoming.length ? <ul>{records.upcoming.map((r) => <RecordCard key={r.id} r={r} />)}</ul> : <p>{t('account.upcoming.empty')}</p>}</section>
      <section><h2>{t('account.past.title')}</h2>{records.past.length ? <ul>{records.past.map((r) => <RecordCard key={r.id} r={r} past />)}</ul> : <p>{t('account.past.empty')}</p>}</section>
    </>
  );
}

/** /account/record/[id]/[hash] opened by link (no login, ТЗ §09 MUST): cancel and reschedule work the same way. */
export function RecordFromUrl() {
  const locale = useLocale() as Locale;
  const [rec, setRec] = useState<AccountRecord | null | undefined>(undefined);
  const [error, setError] = useState<ApiErrorKind | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const m = window.location.pathname.match(/\/account\/record\/([^/]+)\/([^/]+)/);
    getAccountRecords(locale).then(({ upcoming }) => setRec(m ? upcoming.find((r) => String(r.id) === m[1] && r.hash === m[2]) ?? null : null), (e) => setError(errorKind(e)));
  }, [locale, nonce]);
  if (error) return <ErrorBox kind={error} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />;
  return rec === undefined ? null : <RecordView record={rec} />;
}
