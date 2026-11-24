'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, type ApiErrorKind } from '@/lib/api/errors';
import { equalBookingServices, normalizeBookingServices, validBookingId, type BookingStaff, type BookingTime } from '@/lib/contracts/booking-services';
import type { CatalogLocale } from '@/lib/contracts/catalog';

type Options = {
  staff: BookingStaff;
  dates: string;
  times: BookingTime;
};
export type BookingOptionsStatus = 'idle' | 'loading' | 'error' | 'empty' | 'ready';

export function bookingUrl(resource: keyof Options, { serviceIds, locale, staffId, date }: {
  serviceIds: readonly number[]; locale: CatalogLocale; staffId?: number; date?: string;
}) {
  const params = new URLSearchParams({ locale });
  serviceIds.forEach((id) => params.append('serviceIds', String(id)));
  if (staffId !== undefined) params.set('staffId', String(staffId));
  if (date) params.set('date', date);
  return `/api/booking/${resource}?${params}`;
}

export class BookingServicesUnavailable extends ApiError {
  constructor(readonly serviceIds: number[]) { super('server'); }
}

export async function getBookingOptions<K extends keyof Options>(resource: K, url: string, signal: AbortSignal): Promise<Options[K][]> {
  const query = new URL(url, 'https://booking.invalid').searchParams;
  const selected = query.getAll('serviceIds').map(Number);
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (response.status === 404) {
    const { error } = await response.json();
    const missing = normalizeBookingServices(undefined, error?.serviceIds);
    if (error?.code === 'SERVICE_NOT_FOUND' && missing?.every((id) => selected.includes(id))) {
      throw new BookingServicesUnavailable(missing);
    }
  }
  if (!response.ok) throw new ApiError(response.status === 429 ? 'rateLimit' : 'server');
  const body = await response.json() as { data?: Record<K, Options[K][]> & { serviceIds?: number[]; staffId?: number; date?: string } };
  const data = body.data;
  if (!data || !equalBookingServices(selected, data.serviceIds) || !Array.isArray(data[resource]) ||
    (resource !== 'staff' && data.staffId !== Number(query.get('staffId'))) ||
    (resource === 'times' && data.date !== query.get('date'))) throw new ApiError('server');
  if (resource === 'staff' && !(data[resource] as BookingStaff[]).every((staff) => staff && validBookingId(staff.id) && typeof staff.name === 'string')) {
    throw new ApiError('server');
  }
  if (resource === 'times') {
    const times = data[resource] as BookingTime[];
    const unique = new Map(times.map((slot) => [slot.datetime, slot]));
    return [...unique.values()].sort((a, b) => a.time.localeCompare(b.time)) as Options[K][];
  }
  return data[resource];
}

export function useBookingOptions<K extends keyof Options>(resource: K, url: string | null) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const request = useMemo(() => ({ url, attempt }), [url, attempt]);
  const [response, setResponse] = useState<{ request: typeof request; items?: Options[K][]; error?: ApiErrorKind; missing?: number[] }>();

  useEffect(() => {
    if (!request.url) return;
    const controller = new AbortController();
    async function load(url: string) {
      try {
        const items = await getBookingOptions(resource, url, controller.signal);
        if (!controller.signal.aborted) setResponse({ request, items });
      } catch (error) {
        if (!controller.signal.aborted) setResponse({ request, error: error instanceof ApiError ? error.kind : 'server',
          missing: error instanceof BookingServicesUnavailable ? error.serviceIds : undefined });
      }
    }
    void load(request.url);
    return () => controller.abort();
  }, [request, resource]);

  const current = url && response?.request === request ? response : undefined;
  const status: BookingOptionsStatus = !url ? 'idle' : !current ? 'loading' : current.error ? 'error' : current.items?.length ? 'ready' : 'empty';
  return { items: current?.items ?? [], status, retry, error: current?.error, missing: current?.missing };
}
