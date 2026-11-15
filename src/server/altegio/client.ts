import 'server-only';

import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getAltegioConfig } from '../config';
import { AltegioError } from './errors';

const API_BASE = 'https://api.alteg.io/api/v1/';
const TIMEOUT_MS = 10_000;

export const bookingLanguages = { ru: 'ru-RU', en: 'en-US' } satisfies Record<CatalogLocale, string>;

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
async function requestAltegio<T>(operation: string, path: string, language: string,
  decode: (response: Response) => Promise<T>, body?: object): Promise<T> {
  const started = Date.now();
  let status: number | undefined;
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  try {
    const { partnerToken } = getAltegioConfig();
    const response = await fetch(`${API_BASE}${path}`, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: {
        Accept: 'application/vnd.api.v2+json',
        'Accept-Language': language,
        Authorization: `Bearer ${partnerToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal,
    });

    status = response.status;
    if (status === 429 || (!response.ok && (body === undefined || status >= 500))) {
      // Release the response stream without letting a cleanup failure mask the HTTP error.
      void response.body?.cancel().catch(() => {});
      const header = response.headers.get('Retry-After');
      const upstreamRetryAfter = header && (/^\d+$/.test(header) || (/ GMT$/.test(header) && Number.isFinite(Date.parse(header))))
        ? header : undefined;
      if (status === 429) throw new AltegioError('rateLimited', retryAfter(header), upstreamRetryAfter);
      throw new AltegioError('unavailable', undefined, upstreamRetryAfter, status);
    }

    return await decode(response);
  } catch (cause) {
    const error = cause instanceof AltegioError ? cause : new AltegioError(
      signal.aborted ? 'timeout' : cause instanceof SyntaxError ? 'invalidResponse' : 'unavailable',
    );
    console.warn('[altegio]', { operation, status, durationMs: Date.now() - started, code: error.response.code });
    throw error;
  }
}

export function altegioGet(operation: string, path: string, language: string, allowBareRecord = false): Promise<unknown> {
  return requestAltegio(operation, path, language, async (response) => {
    const payload: unknown = await response.json();
    if (allowBareRecord && isRecord(payload) && !('success' in payload)) return payload;
    if (!isRecord(payload) || payload.success !== true || !('data' in payload)) {
      throw new AltegioError('invalidResponse');
    }
    return payload.data;
  });
}

export function altegioPost(operation: 'book_check' | 'book_record', locationId: number, language: string, body: object) {
  return requestAltegio(operation, `${operation}/${locationId}`, language, async (response) => {
    const text = await response.text();
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch (error) {
        if (response.ok) throw error;
      }
    }
    return { status: response.status, payload, empty: !text.trim() };
  }, body);
}
