'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogStaffMember } from '@/lib/contracts/catalog';

type Options = {
  staff: Pick<CatalogStaffMember, 'id' | 'name'>;
  dates: string;
  times: { datetime: string; time: string };
};
export type BookingOptionsStatus = 'idle' | 'loading' | 'error' | 'empty' | 'ready';

export function bookingUrl(resource: keyof Options, params: Record<string, string>) {
  return `/api/booking/${resource}?${new URLSearchParams(params)}`;
}

export function useBookingOptions<K extends keyof Options>(resource: K, url: string | null) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
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
  const status: BookingOptionsStatus = !url ? 'idle' : items === undefined ? 'loading' : items === null ? 'error' : items.length ? 'ready' : 'empty';
  return { items: items ?? [], status, retry };
}
