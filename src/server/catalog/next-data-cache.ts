import 'server-only';

// unstable_cache owns the read, refresh and write per call. Keep the version-specific
// Next.js integration here so the catalog can coordinate that whole operation by key.
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import {
  getDraftModeProviderForCacheScope,
  willConsumerServerCache,
  workUnitAsyncStorage,
} from 'next/dist/server/app-render/work-unit-async-storage.external';
import type { CachedRouteKind, IncrementalCacheKind } from 'next/dist/server/response-cache';
import { after } from 'next/server';

const tags: string[] = [];

export function nextDataCache(revalidate: number) {
  const work = workAsyncStorage.getStore();
  const unit = workUnitAsyncStorage.getStore();
  const cache = work?.incrementalCache;
  if (!cache) throw new Error('Catalog requires a Next.js Data Cache context.');

  if (unit && 'revalidate' in unit && unit.type !== 'validation-client' && unit.type !== 'prerender-client') {
    unit.revalidate = Math.min(unit.revalidate, revalidate);
  }

  return {
    bypass: work.isDraftMode || work.isOnDemandRevalidate || cache.isOnDemandRevalidate || work.fetchCache === 'force-no-store',
    draft: work.isDraftMode,
    blocking: willConsumerServerCache(unit),
    load: <Result>(load: () => Promise<Result>) => workUnitAsyncStorage.run({
      type: 'unstable-cache',
      phase: 'render',
      consumerWillServerCache: true,
      implicitTags: unit?.implicitTags,
      draftMode: unit && getDraftModeProviderForCacheScope(work, unit),
      rootParams: undefined,
    }, load),
    async read(key: string) {
      return cache.get(await cache.generateSimpleCacheKey(key), {
        kind: 'FETCH' as IncrementalCacheKind.FETCH,
        revalidate,
        tags,
        softTags: unit?.implicitTags?.tags,
      });
    },
    async write(key: string, result: unknown) {
      await cache.set(await cache.generateSimpleCacheKey(key), {
        kind: 'FETCH' as CachedRouteKind.FETCH,
        data: { headers: {}, body: JSON.stringify(result), status: 200, url: '' },
        revalidate,
      }, { fetchCache: true, tags });
    },
    keepAlive(task: Promise<unknown>) {
      after(task);
    },
  };
}
