'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Field';
import { dubaiToday } from '@/lib/api/dubai';
import type { CatalogLocale, CatalogService, CatalogStaffMember } from '@/lib/contracts/catalog';

type Service = Pick<CatalogService, 'id' | 'title'>;
type Options = {
  staff: Pick<CatalogStaffMember, 'id' | 'name'>;
  dates: string;
  times: { datetime: string; time: string };
};
type Status = 'idle' | 'loading' | 'error' | 'empty' | 'ready';

function bookingUrl(resource: keyof Options, params: Record<string, string>) {
  return `/api/booking/${resource}?${new URLSearchParams(params)}`;
}

function useBookingOptions<K extends keyof Options>(resource: K, url: string | null) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ url, attempt }), [url, attempt]);
  const [response, setResponse] = useState<{ request: typeof request; items: Options[K][] | null }>();

  useEffect(() => {
    if (!request.url) return;
    const controller = new AbortController();
    async function load(url: string) {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Booking options are unavailable');
        const body = await response.json() as { data?: Record<K, Options[K][]> };
        const items = body.data?.[resource];
        if (!Array.isArray(items)) throw new Error('Invalid booking options');
        if (!controller.signal.aborted) setResponse({ request, items });
      } catch {
        if (!controller.signal.aborted) setResponse({ request, items: null });
      }
    }
    void load(request.url);
    return () => controller.abort();
  }, [request, resource]);

  const items = response?.request === request ? response.items : undefined;
  const status: Status = !url ? 'idle' : items === undefined ? 'loading' : items === null ? 'error' : items.length ? 'ready' : 'empty';
  return { items: items ?? [], status, retry: () => setAttempt((value) => value + 1) };
}

function OptionStatus({ id, status, copy, retry, retryLabel, pending }: {
  id: string;
  status: Status;
  copy: Record<'loading' | 'error' | 'empty', string>;
  retry: () => void;
  retryLabel: string;
  pending?: boolean;
}) {
  const message = status === 'loading' || status === 'error' || status === 'empty'
    ? copy[pending ? 'loading' : status] : undefined;
  return (
    <>
      <p id={id} className="hint qform__option-status" role="status">{message}</p>
      {status === 'error' ? (
        <Button variant="secondary" size="sm" aria-describedby={id} aria-disabled={pending || undefined} onClick={retry}>{retryLabel}</Button>
      ) : null}
    </>
  );
}

export function QuickBookingFields({ locale, services, loading = false }: {
  locale: CatalogLocale;
  services: Service[] | null;
  loading?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const restoreFocus = useRef(false);
  const [service, setService] = useState('');
  const [staffId, setStaffId] = useState('0');
  const [date, setDate] = useState('');
  const [datetime, setDatetime] = useState('');
  const serviceId = services?.some(({ id }) => String(id) === service) ? service : '';
  const staff = useBookingOptions('staff', serviceId ? bookingUrl('staff', { serviceId, locale }) : null);
  const dates = useBookingOptions('dates', serviceId ? bookingUrl('dates', { serviceId, staffId, locale }) : null);
  const times = useBookingOptions('times', serviceId && dates.items.includes(date)
    ? bookingUrl('times', { serviceId, staffId, date, locale }) : null);
  const serviceStatus: Status = loading ? 'loading' : services === null ? 'error' : services.length ? 'ready' : 'empty';

  useEffect(() => {
    if (serviceStatus === 'ready' && restoreFocus.current) {
      if (document.activeElement === document.body) document.getElementById('qf-service')?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [serviceStatus]);

  const retryLabel = t('home.form.retry');
  const status = (resource: 'staff' | 'dates' | 'times', options: { status: Status; retry: () => void }) => (
    <OptionStatus id={`qf-${resource}-status`} {...options} retryLabel={retryLabel} copy={{
      loading: t(`home.form.availability.${resource}.loading`),
      empty: t(`home.form.availability.${resource}.empty`),
      error: t(`home.form.availability.${resource}.error`),
    }} />
  );
  const resetDate = () => { setDate(''); setDatetime(''); };

  return (
    <>
      <div className="row2">
        <div className="qform__choice">
          <SelectField label={t('forms.field.service')} required name="service" id="qf-service" value={serviceId}
            disabled={serviceStatus !== 'ready'} aria-describedby="qf-services-status"
            onChange={(event) => { setService(event.target.value); setStaffId('0'); resetDate(); }}>
            <option value="">{t('forms.field.servicePlaceholder')}</option>
            {services?.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
          </SelectField>
          <OptionStatus id="qf-services-status" status={serviceStatus} retryLabel={retryLabel} pending={refreshing}
            copy={{ loading: t('home.form.availability.services.loading'), empty: t('home.form.availability.services.empty'),
              error: t('home.form.availability.services.error') }}
            retry={() => {
              if (refreshing) return;
              restoreFocus.current = true;
              startRefresh(() => router.refresh());
            }} />
        </div>
        <div className="qform__choice">
          <SelectField label={t('forms.field.staff')} id="qf-staff" name="staff" value={staffId}
            disabled={staff.status !== 'ready'} aria-describedby="qf-staff-status"
            onChange={(event) => { setStaffId(event.target.value); resetDate(); }}>
            <option value="0">{t('home.form.anyStaffOption')}</option>
            {staff.items.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </SelectField>
          {status('staff', staff)}
        </div>
      </div>
      <div className="row2">
        <div className="qform__choice">
          <SelectField label={t('forms.field.datetime')} required id="qf-date" value={dates.items.includes(date) ? date : ''}
            disabled={dates.status !== 'ready'} aria-describedby="qf-dates-status"
            onChange={(event) => { setDate(event.target.value); setDatetime(''); }}>
            <option value="">{t('forms.field.datetimePlaceholder')}</option>
            {dates.items.map((day) => <option key={day} value={day}>{day === dubaiToday() ? `${day} · ${t('common.dubaiTime')}` : day}</option>)}
          </SelectField>
          {status('dates', dates)}
        </div>
        <div className="qform__choice">
          <SelectField label={t('home.form.timeLabel')} hideLabel className="field--nolabel" name="datetime" required id="qf-time"
            value={times.items.some((slot) => slot.datetime === datetime) ? datetime : ''}
            disabled={times.status !== 'ready'} aria-describedby="qf-times-status"
            onChange={(event) => setDatetime(event.target.value)}>
            <option value="">{t('home.form.timePlaceholder')}</option>
            {times.items.map((slot) => <option key={slot.datetime} value={slot.datetime}>{t('common.timeWithZone', { time: slot.time })}</option>)}
          </SelectField>
          {status('times', times)}
        </div>
      </div>
    </>
  );
}
