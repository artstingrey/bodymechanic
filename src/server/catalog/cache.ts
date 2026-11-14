import 'server-only';

import { unstable_cache } from 'next/cache';

export const PUBLIC_CATALOG_REVALIDATE_SECONDS = 14_400;

/** Shared policy for validated public services, categories, and future staff profiles. */
export function cachePublicCatalog<Args extends unknown[], Result>(
  key: string,
  load: (...args: Args) => Promise<Result>,
) {
  return unstable_cache(load, ['altegio-public', key], { revalidate: PUBLIC_CATALOG_REVALIDATE_SECONDS });
}
