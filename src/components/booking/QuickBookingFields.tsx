'use client';

import { useContext, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Field';
import { dubaiToday } from '@/lib/api/dubai';
import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';
import { QuickFormContext, type AvailabilityConflict } from './quick-form-context';
import { bookingUrl, useBookingOptions, type BookingOptionsStatus as Status } from './useBookingOptions';

type Service = Pick<CatalogService, 'id' | 'title'>;
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
  const form = useContext(QuickFormContext);
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
  const registerRefresh = form?.registerRefresh;
  const { retry: retryStaff } = staff;
  const { retry: retryDates } = dates;
  const { retry: retryTimes } = times;

  useEffect(() => {
    if (!registerRefresh) return;
    return registerRefresh((reason: AvailabilityConflict) => {
      setDatetime('');
      if (reason === 'SLOT_TAKEN') {
        retryTimes();
        return;
      }
      setDate('');
      setStaffId('0');
      if (reason === 'SERVICE_NOT_FOUND') {
        setService('');
        router.refresh();
      } else {
        retryStaff();
        retryDates();
      }
    });
  }, [registerRefresh, retryDates, retryStaff, retryTimes, router]);

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
  const error = (id: string) => {
    const code = form?.errors[id];
    return code ? t(`forms.error.${code}`) : undefined;
  };
  const description = (id: string, resource: Parameters<typeof bookingUrl>[0] | 'services') =>
    `${error(id) ? `${id}-err ` : ''}qf-${resource}-status`;
  const clearTime = () => {
    form?.clearError('qf-date');
    form?.clearError('qf-time');
  };

  return (
    <>
      <div className="row2">
        <div className="qform__choice">
          <SelectField label={t('forms.field.service')} required name="service" id="qf-service" value={serviceId}
            disabled={form?.locked || serviceStatus !== 'ready'} error={error('qf-service')} aria-describedby={description('qf-service', 'services')}
            onChange={(event) => { setService(event.target.value); setStaffId('0'); resetDate(); form?.clearError('qf-service'); clearTime(); }}>
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
            disabled={form?.locked || staff.status !== 'ready'} aria-describedby="qf-staff-status"
            onChange={(event) => { setStaffId(event.target.value); resetDate(); clearTime(); }}>
            <option value="0">{t('home.form.anyStaffOption')}</option>
            {staff.items.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </SelectField>
          {status('staff', staff)}
        </div>
      </div>
      <div className="row2">
        <div className="qform__choice">
          <SelectField label={t('forms.field.datetime')} required id="qf-date" name="date" value={dates.items.includes(date) ? date : ''}
            disabled={form?.locked || dates.status !== 'ready'} error={error('qf-date')} aria-describedby={description('qf-date', 'dates')}
            onChange={(event) => { setDate(event.target.value); setDatetime(''); clearTime(); }}>
            <option value="">{t('forms.field.datetimePlaceholder')}</option>
            {dates.items.map((day) => <option key={day} value={day}>{day === dubaiToday() ? `${day} · ${t('common.dubaiTime')}` : day}</option>)}
          </SelectField>
          {status('dates', dates)}
        </div>
        <div className="qform__choice">
          <SelectField label={t('home.form.timeLabel')} hideLabel className="field--nolabel" name="datetime" required id="qf-time"
            value={times.items.some((slot) => slot.datetime === datetime) ? datetime : ''}
            disabled={form?.locked || times.status !== 'ready'} error={error('qf-time')} aria-describedby={description('qf-time', 'times')}
            onChange={(event) => { setDatetime(event.target.value); form?.clearError('qf-time'); }}>
            <option value="">{t('home.form.timePlaceholder')}</option>
            {times.items.map((slot) => <option key={slot.datetime} value={slot.datetime}>{t('common.timeWithZone', { time: slot.time })}</option>)}
          </SelectField>
          {status('times', times)}
        </div>
      </div>
    </>
  );
}
