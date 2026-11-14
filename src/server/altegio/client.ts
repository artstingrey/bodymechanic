import 'server-only';

import { getAltegioConfig } from '../config';
import { AltegioError } from './errors';

const API_BASE = 'https://api.alteg.io/api/v1/';
const TIMEOUT_MS = 10_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function retryAfter(value: string | null) {
  if (value && /^\d+$/.test(value)) return String(Math.min(3600, Math.max(1, Number(value))));
  // The provider may send an HTTP-date instead of delay seconds.
  if (value && / GMT$/.test(value)) {
    const seconds = Math.ceil((Date.parse(value) - Date.now()) / 1000);
    if (Number.isFinite(seconds)) return String(Math.min(3600, Math.max(1, seconds)));
  }
  return '60';
}

/** path and operation are supplied by server code only. */
export async function altegioGet(operation: string, path: string): Promise<unknown> {
  const started = Date.now();
  let status: number | undefined;
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  try {
    const { partnerToken } = getAltegioConfig();
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Accept: 'application/vnd.api.v2+json',
        Authorization: `Bearer ${partnerToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
    status = response.status;
    if (!response.ok) {
      // Release the response stream without letting a cleanup failure mask the HTTP error.
      void response.body?.cancel().catch(() => {});
      if (status === 429) throw new AltegioError('rateLimited', retryAfter(response.headers.get('Retry-After')));
      throw new AltegioError('unavailable');
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.success !== true || !('data' in payload)) {
      throw new AltegioError('invalidResponse');
    }
    return payload.data;
  } catch (cause) {
    const error = cause instanceof AltegioError ? cause : new AltegioError(
      signal.aborted ? 'timeout' : cause instanceof SyntaxError ? 'invalidResponse' : 'unavailable',
    );
    console.warn('[altegio]', { operation, status, durationMs: Date.now() - started, code: error.response.code });
    throw error;
  }
}
