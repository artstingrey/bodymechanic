'use client';
/**
 * 2D mode (ТЗ 6.10–6.11) + the always-available zone list.
 * Silhouettes: site/design/body2d (Brand Designer, R-2D-02) — M/F × front/back, inline SVG; markers, leader callouts and the
 * atlas crosshair by the ES module lib/body2d/body2d-callouts.mjs (one copy of the logic with the design demo).
 * Selection = the SAME markers as in 3D (body store, BookingDraft.markers): a 2D marker has the 3D number, 3D ↔ 2D keeps
 * everything. The module numbers by array index, so `selected[n − 1] = zoneId` and gaps / the other side of the body are
 * placeholders the module ignores (number stays). Zone states (aria-checked, hover / selected fill, focus ring) are the
 * host's job, as in the design demo. Layout: Web Art Director (panels, cards) — classes .b2d-* stay.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { body, useBody, type Marker } from '@/lib/body3d/store';
import { zoneLabel } from '@/lib/body3d/zones';
import { ALL_KEYS, toggleZone } from './ZoneChecklist';
import { Segmented } from '@/components/ui/Choice';
import { clearCache, crosshair, destroy, drawMarkers, layout } from '@/lib/body2d/body2d-callouts.mjs';



/** module input: index n − 1 → zone id; gaps and a second marker on the same zone → placeholders (ignored, number kept) */
function selectionOf(markers: Marker[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of [...markers].sort((a, b) => a.n - b.n)) { out[m.n - 1] = seen.has(m.zoneId) ? '__dup' : m.zoneId; seen.add(m.zoneId); }
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = '__gap';
  return out;
}

const svgText = new Map<string, Promise<string>>();
const loadSvg = (src: string) => { let p = svgText.get(src); if (!p) { p = fetch(src).then((r) => r.text()); svgText.set(src, p); } return p; };

function Silhouette({ src, label, selected, names, fontsEpoch }: { src: string; label: string; selected: string[]; names: Record<string, string>; fontsEpoch: number }) {
  const locale = useLocale() as 'ru' | 'en';
  const host = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [box, setBox] = useState(0);
  const live = useBody((s) => s.live);
  const handledSeq = useRef(live.seq);
  const hovId = useRef<string | null>(null);
  const focId = useRef<string | null>(null);
  const sel = useRef(selected);

  // load the svg once per source (inline, the module and the host need its DOM)
  useEffect(() => {
    let alive = true;
    let el: SVGSVGElement | null = null;
    loadSvg(src).then((html) => {
      if (!alive || !host.current) return;
      host.current.innerHTML = html;
      el = host.current.querySelector('svg');
      setSvg(el);
    }).catch(() => {});
    return () => { alive = false; if (el) destroy(el); };
  }, [src]);

  // the svg box decides full / compact / none
  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(([e]) => setBox(Math.round(e.contentRect.width)));
    ro.observe(host.current);
    return () => ro.disconnect();
  }, []);

  // accessible names in the page language (the files carry English defaults)
  useEffect(() => {
    if (!svg) return;
    svg.setAttribute('aria-label', label);
    const title = svg.querySelector('title'); if (title) title.textContent = label;
    svg.querySelectorAll<SVGPathElement>('.b2d-zone').forEach((z) => z.setAttribute('aria-label', names[z.dataset.zoneId!] ?? z.getAttribute('aria-label') ?? ''));
  }, [svg, label, names]);

  // states + callouts + markers on every change of the selection, language, box or fonts
  useLayoutEffect(() => {
    if (!svg) return;
    sel.current = selected;
    const on = new Set(selected);
    svg.querySelectorAll<SVGPathElement>('.b2d-zone').forEach((z) => {
      const id = z.dataset.zoneId!, checked = on.has(id);
      z.classList.toggle('is-selected', checked);
      z.setAttribute('aria-checked', String(checked));
      svg.querySelector(`[data-fx-for="${id}"]`)?.classList.toggle('is-selected', checked);
    });
    const ev = live.event;
    const justAdded = live.seq !== handledSeq.current && ev?.type === 'markerAdded' ? ev.zoneId : null;
    handledSeq.current = live.seq;
    layout(svg, selected, { names, locale, allowCompact: window.innerWidth >= 530 });
    drawMarkers(svg, selected, { justAdded });
    crosshair(svg, hovId.current || focId.current, selected);
  }, [svg, selected, names, locale, box, fontsEpoch, live]);

  // input: click / Enter / Space toggle; hover + keyboard focus → crosshair (never on a selected zone), focus ring
  useEffect(() => {
    const h = host.current;
    if (!h || !svg) return;
    const zoneOf = (el: EventTarget | null) => {
      const n = (el as Element | null)?.closest?.('[data-zone-id],[data-hit-for]') as HTMLElement | SVGElement | null;
      return n ? n.getAttribute('data-zone-id') || n.getAttribute('data-hit-for') : null;
    };
    const hover = (id: string | null) => {
      h.querySelectorAll('.is-hover').forEach((x) => x.classList.remove('is-hover'));
      hovId.current = id;
      if (id) { h.querySelector(`.b2d-zone[data-zone-id="${id}"]`)?.classList.add('is-hover'); h.querySelector(`[data-fx-for="${id}"]`)?.classList.add('is-hover'); }
      crosshair(svg, hovId.current || focId.current, sel.current);
    };
    const ring = (zone: SVGPathElement | null) => {
      svg.querySelectorAll('.b2d-focus-ring,.b2d-focus-halo').forEach((x) => x.remove());
      focId.current = zone?.dataset.zoneId ?? null;
      crosshair(svg, hovId.current || focId.current, sel.current);
      if (!zone) return;
      for (const c of ['b2d-focus-halo', 'b2d-focus-ring']) {
        const r = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        r.setAttribute('class', c); r.setAttribute('aria-hidden', 'true'); r.setAttribute('d', zone.getAttribute('d') ?? '');
        svg.appendChild(r);
      }
    };
    const onClick = (e: MouseEvent) => { const id = zoneOf(e.target); if (id) toggleZone(id); };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as Element;
      if ((e.key === 'Enter' || e.key === ' ') && el.classList?.contains('b2d-zone')) { e.preventDefault(); toggleZone((el as SVGPathElement).dataset.zoneId!); }
    };
    const onOver = (e: PointerEvent) => { if (e.pointerType !== 'touch') hover(zoneOf(e.target)); };
    const onLeave = () => hover(null);
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as SVGPathElement;
      if (!el.classList?.contains('b2d-zone')) return;
      let visible = true; try { visible = el.matches(':focus-visible'); } catch { /* old engines */ }
      if (visible) ring(el);
    };
    const onFocusOut = () => ring(null);
    h.addEventListener('click', onClick); h.addEventListener('keydown', onKey); h.addEventListener('pointerover', onOver);
    h.addEventListener('pointerleave', onLeave); h.addEventListener('focusin', onFocusIn); h.addEventListener('focusout', onFocusOut);
    return () => {
      h.removeEventListener('click', onClick); h.removeEventListener('keydown', onKey); h.removeEventListener('pointerover', onOver);
      h.removeEventListener('pointerleave', onLeave); h.removeEventListener('focusin', onFocusIn); h.removeEventListener('focusout', onFocusOut);
    };
  }, [svg]);

  return (
    <figure className="b2d-figure" data-callouts={svg?.dataset.callouts}>
      <div ref={host} className="b2d-stage" />
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}

export function Fallback2D() {
  const t = useTranslations();
  const model = useBody((s) => s.model);
  const reason = useBody((s) => s.mode2d);
  const markers = useBody((s) => s.markers);
  const selected = useMemo(() => selectionOf(markers), [markers]);
  const names = useMemo(() => Object.fromEntries(ALL_KEYS.map((k) => [k, zoneLabel(t, k)])), [t]);
  // label widths are measured with the web font: re-measure once it is ready
  const [fontsEpoch, setFontsEpoch] = useState(0);
  useEffect(() => { document.fonts?.ready.then(() => { clearCache(); setFontsEpoch((n) => n + 1); }); }, []);
  // < 600 px: one figure + «Спереди / Сзади» (lead's decision; layout CSS: Web Art Director, hidden ≥ 600 px)
  const [side, setSide] = useState<'front' | 'back'>('front');
  return (
    <section className="b2d-mode" aria-label={t('body3d.mode2d.badge')} data-testid="b2d">
      <p><span className="badge badge--dark">{t('body3d.mode2d.badge')}</span> {reason === 'noWebgl' ? t('body3d.mode2d.noWebgl') : reason === 'lowFps' ? t('body3d.mode2d.lowFps') : null}</p>
      <p>{t('body3d.mode2d.text')}</p>
      <Segmented className="b2d-side" label={t('body3d.mode2d.badge')} value={side} onChange={setSide}
        options={[{ value: 'front', label: t('body3d.list.groupFront') }, { value: 'back', label: t('body3d.list.groupBack') }]} />
      <div className="b2d-views" data-side={side}>
        {(['front', 'back'] as const).map((v) => (
          <Silhouette key={`${model}-${v}`} src={`/body2d/body-${model}-${v}.svg`} selected={selected} names={names} fontsEpoch={fontsEpoch}
            label={t('body3d.mode2d.diagramLabel', { side: t(v === 'front' ? 'body3d.zones.sideFront' : 'body3d.zones.sideBack') })} />
        ))}
      </div>
      {reason !== 'noWebgl' ? <button type="button" onClick={() => body.setMode2d(false)}>{t('body3d.mode2d.tryAgain')}</button> : null}
    </section>
  );
}
