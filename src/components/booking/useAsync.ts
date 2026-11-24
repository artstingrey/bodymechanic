'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorKind } from '@/lib/api';
import type { ApiErrorKind } from '@/lib/api/errors';
import { track } from '@/lib/analytics/track';
import { BookingServicesUnavailable } from './useBookingOptions';

/** Async data with loading / error / retry, without setState in the effect body (state is keyed by the request). */
export function useAsync<T>(enabled: boolean, load: (signal: AbortSignal) => Promise<T>, key: unknown[], refreshOnEntry = false) {
  const [nonce, setNonce] = useState(0);
  const serialized = JSON.stringify([...key, nonce]);
  const identity = useMemo(() => ({ serialized, enabled }), [serialized, enabled]);
  const k = refreshOnEntry ? identity : serialized;
  const [res, setRes] = useState<{ k: typeof k; data?: T; error?: ApiErrorKind; missing?: number[] }>({ k: '' });
  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    load(request.signal).then((data) => { if (!request.signal.aborted) setRes({ k, data }); }, (error: unknown) => {
      if (request.signal.aborted) return;
      const kind = errorKind(error);
      setRes({ k, error: kind, missing: error instanceof BookingServicesUnavailable ? error.serviceIds : undefined });
      track('booking_error', { reason: kind });
    });
    return () => request.abort();
    // `k` captures every input of `load` (the caller passes them in `key`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, enabled]);
  const status: 'idle' | 'loading' | 'error' | 'ready' = !enabled ? 'idle' : res.k !== k ? 'loading' : res.error ? 'error' : 'ready';
  return { status, data: res.k === k ? res.data : undefined, error: res.k === k ? res.error : undefined,
    missing: res.k === k ? res.missing : undefined, retry: useCallback(() => setNonce((n) => n + 1), []) };
}
