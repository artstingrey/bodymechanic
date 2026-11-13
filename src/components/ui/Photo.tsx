import manifest from '@/lib/visuals/manifest.json';

type Item = { id: string; set: string; aspect: string; focal: { x: number; y: number } };
const ITEMS = new Map((manifest.items as Item[]).map((it) => [`${it.set}/${it.id}`, it]));
/** service URL slugs are kebab-case (sports-infrared), manifest ids camelCase (sportsInfrared) */
const norm = (id: string) => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const url = (set: string, id: string, w: number, fmt: string) =>
  manifest.path.replace('{set}', set).replace('{id}', id).replace('{w}', String(w)).replace('{fmt}', fmt);

/**
 * Final illustrative photo (site/visuals/final, R-VIS-01; files + manifest synced by Frontend Builder): <picture> AVIF → WebP,
 * srcset 640 / 1280 / 2000, object-position = the manifest focal point. The 2000 master is an 8.5 % upscale — callers pass
 * `sizes` so it is fetched only on 2K / retina widths. Always shown with «Иллюстративное фото» (caption or alt) by the caller.
 */
export function Photo({ set, id: slug, alt, sizes, className, priority }: {
  set: 'services' | 'journal'; id: string; alt: string; sizes: string; className?: string;
  /** first row of a grid: true → eager; 'high' → eager + fetchpriority=high (the LCP image, R-FINAL F-03) */
  priority?: boolean | 'high';
}) {
  const it = ITEMS.get(`${set}/${norm(slug)}`);
  if (!it) return null;
  const id = it.id;
  const [aw, ah] = it.aspect.split(':').map(Number);
  const srcset = (fmt: string) => manifest.widths.map((w: number) => `${url(set, id, w, fmt)} ${w}w`).join(', ');
  // lead decision (ТЗ §11, old iOS): <source avif>, <source webp>, then <img src="…-640.jpg"> as the last resort;
  // until the JPEG set is published the <img> falls back to the WebP set
  const formats: string[] = manifest.formats;
  const jpg = formats.includes('jpg');
  const responsive = formats.filter((f) => f === 'avif' || f === 'webp');
  return (
    <picture className={className}>
      {responsive.map((f) => <source key={f} type={`image/${f}`} srcSet={srcset(f)} sizes={sizes} />)}
      <img src={jpg ? url(set, id, 640, 'jpg') : url(set, id, 1280, 'webp')} width={1280} height={Math.round((1280 * ah) / aw)} alt={alt}
        loading={priority ? 'eager' : 'lazy'} fetchPriority={priority === 'high' ? 'high' : undefined} decoding={priority === 'high' ? undefined : 'async'} style={{ objectPosition: `${it.focal.x}% ${it.focal.y}%` }} />
    </picture>
  );
}

export const hasPhoto = (set: 'services' | 'journal', id: string) => ITEMS.has(`${set}/${norm(id)}`);

/** Journal covers (final set 01–06, 16:9) for the demo articles, cycled by position. */
export const coverOf = (i: number) => { const id = String((i % 6) + 1).padStart(2, '0'); return ITEMS.has(`journal/${id}`) ? id : null; };
/** journal covers in .card-grid — two columns from 600 px since RC-3 V1 (VP) */
export const COVER_SIZES = '(min-width: 1920px) 460px, (min-width: 1440px) 420px, (min-width: 1024px) 31vw, (min-width: 600px) 46vw, 92vw';
