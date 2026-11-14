import 'server-only';

import { AltegioError } from '../altegio/errors';
import { nextDataCache } from './next-data-cache';

export const PUBLIC_CATALOG_REVALIDATE_SECONDS = 14_400;

const processState = globalThis as typeof globalThis & {
  bodyMechanicCatalogLoads?: Map<string, Promise<unknown> | number>;
};
// Next may bundle consumers separately. Share only pending work and retry deadlines.
const loads = processState.bodyMechanicCatalogLoads ??= new Map();

/** Shared policy for validated public services, categories, and future staff profiles. */
export function cachePublicCatalog<Args extends unknown[], Result>(
  key: string,
  load: (...args: Args) => Promise<Result>,
) {
  return async (...args: Args): Promise<Result> => {
    const cache = nextDataCache(PUBLIC_CATALOG_REVALIDATE_SECONDS);
    const loadKey = JSON.stringify(['altegio-public', key, args]);
    if (cache.draft) return cache.load(() => load(...args));

    const entry = cache.bypass ? null : await cache.read(loadKey);
    const previous = entry ? { data: JSON.parse(entry.value.data.body) as Result } : undefined;
    if (previous && !entry?.isStale) return previous.data;

    const current = loads.get(loadKey);
    if (typeof current === 'number') {
      const remaining = Math.ceil((current - performance.now()) / 1000);
      if (remaining > 0) {
        if (previous) return previous.data;
        throw new AltegioError('rateLimited', String(remaining));
      }
    } else if (current) {
      if (previous && !cache.blocking) return previous.data;
      // A versioned catalog key identifies a single loader and result type.
      return (current as Promise<Result>).catch((error: unknown) => {
        if (previous) return previous.data;
        throw error;
      });
    }

    const pending = Promise.resolve().then(async () => {
      if (!cache.bypass) {
        // A concurrent read can finish with an old value just after another load writes.
        const latest = await cache.read(loadKey);
        if (latest && !latest.isStale) return JSON.parse(latest.value.data.body) as Result;
      }
      const result = await cache.load(() => load(...args));
      await cache.write(loadKey, result);
      return result;
    }).catch((error: unknown) => {
      if (error instanceof AltegioError && error.response.code === 'UPSTREAM_RATE_LIMITED' && error.retryAfter) {
        const waitMs = Number(error.retryAfter) * 1000;
        const deadline = performance.now() + waitMs;
        loads.set(loadKey, deadline);
        setTimeout(() => {
          if (loads.get(loadKey) === deadline) loads.delete(loadKey);
        }, waitMs).unref();
      }
      throw error;
    }).finally(() => {
      if (loads.get(loadKey) === pending) loads.delete(loadKey);
    });
    loads.set(loadKey, pending);

    if (!previous) return pending;
    const refresh = pending.catch((error: unknown) => {
      // Transport and validation already log their own Altegio errors.
      if (!(error instanceof AltegioError)) console.error('[catalog] Unexpected error refreshing public data');
      return previous.data;
    });
    if (cache.blocking) return refresh;
    cache.keepAlive(refresh);
    return previous.data;
  };
}
