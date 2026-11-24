import Image from 'next/image';
import manifest from '@/lib/visuals/manifest.json';

type Item = { id: string; set: string; aspect: string; focal: { x: number; y: number } };
const ITEMS = new Map((manifest.items as Item[]).map((it) => [`${it.set}/${it.id}`, it]));
/** service URL slugs are kebab-case (sports-infrared), manifest ids camelCase (sportsInfrared) */
const norm = (id: string) => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const masterWidth = Math.max(...manifest.widths);
export function Photo({ set, id: slug, alt, sizes, className, priority }: {
  set: 'services' | 'journal'; id: string; alt: string; sizes: string; className?: string;
  /** first row of a grid: true → eager; 'high' → eager + fetchpriority=high (the LCP image, R-FINAL F-03) */
  priority?: boolean | 'high';
}) {
  const it = ITEMS.get(`${set}/${norm(slug)}`);
  if (!it) return null;
  const [aw, ah] = it.aspect.split(':').map(Number);
  const src = manifest.path.replace('{set}', set).replace('{id}', it.id)
    .replace('{w}', String(masterWidth)).replace('{fmt}', 'webp');
  return (
    <Image className={className} src={src} width={masterWidth} height={Math.round((masterWidth * ah) / aw)} alt={alt} sizes={sizes}
      loading={priority ? 'eager' : 'lazy'} fetchPriority={priority === 'high' ? 'high' : undefined}
      style={{ objectPosition: `${it.focal.x}% ${it.focal.y}%` }} />
  );
}

export const hasPhoto = (set: 'services' | 'journal', id: string) => ITEMS.has(`${set}/${norm(id)}`);

/** Journal covers (final set 01–06, 16:9) for the demo articles, cycled by position. */
export const coverOf = (i: number) => { const id = String((i % 6) + 1).padStart(2, '0'); return ITEMS.has(`journal/${id}`) ? id : null; };
/** journal covers in .card-grid — two columns from 600 px since RC-3 V1 (VP) */
export const COVER_SIZES = '(min-width: 1920px) 460px, (min-width: 1440px) 420px, (min-width: 1024px) 31vw, (min-width: 600px) 46vw, 92vw';
