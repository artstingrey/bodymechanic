'use client';

import { useCallback, useContext, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Field';
import { dubaiToday } from '@/lib/api/dubai';
import { catalogServiceDuration, formatCatalogServiceTotal } from '@/lib/catalog-service-price';
import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';
import { updateBookingServices } from '@/lib/contracts/booking-services';
import { QuickServicePicker } from './QuickServicePicker';
import { QuickFormContext, type AvailabilityConflict } from './quick-form-context';
import { getBookingCatalog } from './service-catalog';
import { useAsync } from './useAsync';
import { bookingUrl, useBookingOptions, type BookingOptionsStatus as Status } from './useBookingOptions';

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
      <p id={id} className="hint qform__option-status" tabIndex={-1} role="status">{message}</p>
      {status === 'error' ? (
        <Button variant="secondary" size="sm" aria-describedby={id} aria-disabled={pending || undefined} onClick={retry}>{retryLabel}</Button>
      ) : null}
    </>
  );
}

export function QuickBookingFields({ locale, services, loading = false }: {
  locale: CatalogLocale;
  services: CatalogService[] | null;
  loading?: boolean;
}) {
  const t = useTranslations();
  const form = useContext(QuickFormContext);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const restoreFocus = useRef(false);
  const focusWindow = useRef(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [pickedStaffId, setPickedStaffId] = useState(0);
  const [date, setDate] = useState('');
  const [datetime, setDatetime] = useState('');
  const catalog = services?.filter(({ id }) => !removed.includes(id)) ?? [];
  const serviceStatus: Status = loading ? 'loading' : services === null ? 'error' : catalog.length ? 'ready' : 'empty';
  const serviceIds = selected.filter((id) => catalog.some((item) => item.id === id));
  const selection = { serviceIds, locale };
  const validSet = serviceStatus === 'ready' && serviceIds.length > 0 && serviceIds.length === selected.length;
  const staff = useBookingOptions('staff', validSet ? bookingUrl('staff', selection) : null);
  const staffId = staff.status === 'ready' && staff.items.length === 1 ? staff.items[0].id : pickedStaffId;
  const staffValid = staff.status === 'ready' && (staffId === 0 || staff.items.some(({ id }) => id === staffId));
  const dates = useBookingOptions('dates', staffValid && staffId === pickedStaffId
    ? bookingUrl('dates', { ...selection, staffId }) : null);
  const times = useBookingOptions('times', dates.items.includes(date)
    ? bookingUrl('times', { ...selection, staffId, date }) : null);
  const staffCatalog = useAsync(staffValid && staffId > 0, (signal) => getBookingCatalog(locale, signal, staffId).catch(() => null),
    ['quick-staff-catalog', locale, staffId], true);
  const staffDetails = staffCatalog.status === 'ready' ? new Map(staffCatalog.data?.services.map((item) => [item.id, item])) : new Map<number, CatalogService>();
  const selectedServices = catalog.filter(({ id }) => serviceIds.includes(id)).map((item) => staffDetails.get(item.id) ?? item);
  const selectedSlot = times.items.find((slot) => slot.datetime === datetime);
  const price = formatCatalogServiceTotal(selectedServices, locale, {
    unknown: () => t('home.services.priceUnknown'),
    from: (price) => t('home.services.priceFrom', { price }),
  });
  const estimated = staffId > 0 && serviceIds.some((id) => !staffDetails.has(id)) && price !== t('home.services.priceUnknown');
  const duration = catalogServiceDuration(selectedServices, selectedSlot?.durationSeconds);
  const resetDate = useCallback(() => { setDate(''); setDatetime(''); }, []);
  const changeStaff = useCallback((id: number) => { setPickedStaffId(id); resetDate(); }, [resetDate]);
  const removeServices = useCallback((ids: number[]) => {
    setRemoved((current) => [...new Set([...current, ...ids])]);
    setSelected((current) => current.filter((id) => !ids.includes(id)));
    changeStaff(0);
  }, [changeStaff]);
  const absentFromCatalog = serviceStatus === 'ready' || serviceStatus === 'empty'
    ? selected.filter((id) => !serviceIds.includes(id)) : [];
  const missing = [...absentFromCatalog, ...(staff.missing ?? []), ...(dates.missing ?? []), ...(times.missing ?? [])]
    .filter((id) => selected.includes(id));
  if (missing.length) removeServices(missing);
  else if (staff.status === 'ready') {
    if (staffId !== pickedStaffId) changeStaff(staffId);
    else if (!staffValid) changeStaff(0);
  }
  const setAvailabilityBlocked = form?.setAvailabilityBlocked;
  const availabilityBlocked = selected.length > 0 && !selectedSlot;
  useEffect(() => {
    setAvailabilityBlocked?.(availabilityBlocked);
  }, [availabilityBlocked, setAvailabilityBlocked]);
  const registerRefresh = form?.registerRefresh;
  const { retry: retryStaff } = staff;
  const { retry: retryDates } = dates;
  const { retry: retryTimes } = times;

  useEffect(() => {
    if (!registerRefresh) return;
    return registerRefresh((reason: AvailabilityConflict) => {
      setDatetime('');
      if (reason === 'SLOT_TAKEN') {
        focusWindow.current = true;
        retryDates();
        retryTimes();
        return;
      }
      changeStaff(0);
      retryStaff();
      if (reason === 'SERVICE_NOT_FOUND') {
        router.refresh();
      } else {
        retryDates();
      }
    });
  }, [changeStaff, registerRefresh, retryDates, retryStaff, retryTimes, router]);

  useEffect(() => {
    if (!focusWindow.current || dates.status === 'loading' || times.status === 'loading' || dates.status === 'idle') return;
    focusWindow.current = false;
    const id = times.status === 'ready' ? 'qf-time' : dates.status === 'ready' ? 'qf-date' : 'qf-dates-status';
    document.getElementById(id)?.focus();
  }, [dates.status, times.status]);

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
          <QuickServicePicker label={t('forms.field.service')} placeholder={t('booking.service.heading')}
            selected={serviceIds} services={catalog} disabled={!!form?.locked || serviceStatus !== 'ready'}
            error={error('qf-service')} description={description('qf-service', 'services')}
            onChange={(id, checked) => {
              setSelected((current) => updateBookingServices(current, id, checked));
              changeStaff(0);
              form?.clearError('qf-service');
              clearTime();
            }} />
          {removed.length > 0 && <p className="hint" role="alert">{t('booking.service.removed')}</p>}
          {serviceIds.length > 0 && <p className="hint">{[
            estimated ? t('booking.service.estimate', { price }) : price,
            duration === null ? null : t(serviceIds.length > 1 && selectedSlot?.durationSeconds === undefined
              ? 'booking.service.durationEstimate' : 'home.services.duration', { minutes: duration }),
          ].filter(Boolean).join(' · ')}</p>}
          <input type="hidden" name="servicePrice" value={price === t('home.services.priceUnknown') ? '' : price} />
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
            disabled={form?.locked || !staffValid} aria-describedby="qf-staff-status"
            onChange={(event) => { changeStaff(Number(event.target.value)); clearTime(); }}>
            {staff.items.length !== 1 && <option value="0">{t('home.form.anyStaffOption')}</option>}
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
