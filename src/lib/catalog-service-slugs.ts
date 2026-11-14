const pinnedServices: ReadonlyMap<number, string> = new Map([
  [13982355, 'sports'],
  [13982356, 'classic'],
  [13982358, 'thai'],
  [13982379, 'sports-infrared'],
  [13982380, 'classic-infrared'],
  [13982351, 'full-complex'],
  [13983057, 'lfk-kinesio'],
]);
const serviceIdsBySlug: ReadonlyMap<string, number> = new Map(
  [...pinnedServices].map(([id, slug]) => [slug, id]),
);

export function catalogServiceSlug(id: number): string {
  return pinnedServices.get(id) ?? `service-${id}`;
}

export function catalogServiceId(slug: string): number | undefined {
  const pinnedId = serviceIdsBySlug.get(slug);
  if (pinnedId !== undefined) return pinnedId;

  const match = /^service-([1-9]\d*)$/.exec(slug);
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && catalogServiceSlug(id) === slug ? id : undefined;
}
