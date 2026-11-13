'use client';
/**
 * Hero A «Анатомический атлас» (site/design/hifi/hifi-hero.html): live 3D model + zone index 01–05 with tabular numbers,
 * DOM leader lines from the zone anchors to the index rows, crosshair on the active zone (knee).
 *
 * Contract with the 3D runtime (Frontend Builder, src/lib/body3d/anchors.ts), x/y in CSS px from the top-left of .b3d-slot:
 *  - index rows sit at the rest projection (restX/restY: front view, no sway) — they never float with the ±20° sway or a drag;
 *  - each leader line is a 1 px element: translate(anchor) rotate(θ) scaleX(length), from the live anchor to its fixed row;
 *  - visible=false (zone turned away) → anchor + line fade out in 200 ms, the row dims, the number stays;
 *  - load (RC-5, poster → 3D seam): the poster publishes the anchors at the hydration (usePosterAnchors), so the rows, dots
 *    and lines are placed on the POSTER; before any JS the rows already sit at the poster anchors (ROW_TOPS) → no jump at
 *    the hydration, none at the swap (the model's rest anchors = the poster within the calibration). The intro — dots pop
 *    in, lines draw (scaleX 0 → length), reticle settles, ≈ 0.6 s — plays once, on the poster, from the first anchors: CSS
 *    keyframes + one short rAF tween for the line lengths, no GSAP (it is fetched only after load + idle — the moment the
 *    3D runtime starts too, so a cached model could be ready before the lines; Hard Reviewer HM-04 counts them on the last
 *    poster frame). .atlas-ov[data-intro]: play → done (0.7 s). Interrupted by pointer / wheel / key (or skipped if they
 *    came first); reduced motion → 120 ms fade. The swap to the model redraws nothing — positions are plain transform
 *    writes, no React state per frame.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { bodyAnchors } from '@/lib/body3d/anchors';
import { useBody } from '@/lib/body3d/store';
import { heroIntro } from '@/lib/body3d/heroIntro';
import posterAnchors from '@/lib/body3d/poster-anchors.json';
import { zoneLabel } from '@/lib/body3d/zones';
import { Body3DSlot } from '@/components/body3d/Body3DSlot';
import { ModelSwitch, RotationToggle } from '@/components/body3d/HeroControls';
import { MQ, STAGGER } from '@/components/motion/tokens';

/**
 * Front-view zones; the client's left side is on the viewer's right. RC-7 (client: «the model is not centred»): the FIGURE
 * stands in the middle and the index is an anatomical atlas — each label on the side of its point: R = the viewer's right
 * (the client's left shoulder, knee, ankle), L = the viewer's left (chest, abdomen: on the midline, the left column balances
 * the three on the right).
 */
const ZONES = [
  { id: 'shoulder_joint_l', base: 'shoulder_joint', active: false, side: 'R' }, // lead decision R-CODE-01: short, visible from the front
  { id: 'chest', base: 'chest', active: false, side: 'L' },
  { id: 'abdomen', base: 'abdomen', active: false, side: 'L' },
  { id: 'knee_l', base: 'knee', active: true, side: 'R' },
  { id: 'ankle_l', base: 'ankle', active: false, side: 'R' },
] as const;
const MIN_ROW_GAP = 26; // px between index rows of the same side
/** the previous zone on the same side (the gap chain runs per column) */
const PREV_SAME_SIDE = ZONES.map((z, i) => { for (let j = i - 1; j >= 0; j--) if (ZONES[j].side === z.side) return j; return -1; });
const SLOT_TOP = 0.12; // the slot starts 0.12 × --sh above the stage (styles/sections.css)
/**
 * Row tops before any JS (static HTML, no hydration yet): the poster anchors of the default model (the poster fills the 3:4
 * slot, so y = v × --sh), with the same minimum gap as draw() → the rows do not move when the anchors arrive. Generated from
 * poster-anchors.json, i.e. from the same calibration as usePosterAnchors — one set per LOD of the model that replaces the
 * poster (lib/body3d/lod): --y (LOD0), --y1 (LOD1, phones: styles/sections.css under the same media query).
 */
const rowTops = (zones: Record<string, { v: number }>) => ZONES.reduce<string[]>((tops, z, i) => {
  const own = `calc(${(zones[z.id].v - SLOT_TOP).toFixed(4)} * var(--sh))`, prev = PREV_SAME_SIDE[i];
  tops.push(prev >= 0 ? `max(${own}, calc(${tops[prev]} + ${MIN_ROW_GAP}px))` : own);
  return tops;
}, []);
const ROW_TOPS = rowTops(posterAnchors.male.zones);
const ROW_TOPS_LOD1 = rowTops(posterAnchors['male@lod1'].zones);

export function HeroAtlas() {
  const t = useTranslations();
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    const slot = el?.querySelector<HTMLElement>('.b3d-slot');
    const reticle = el?.querySelector<HTMLElement>('.atlas-reticle');
    const index = el?.querySelector<HTMLElement>('.atlas-index');
    if (!el || !slot || !reticle || !index) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>('.atlas-index li'));
    const dots = Array.from(el.querySelectorAll<HTMLElement>('.atlas-dot'));
    const lines = Array.from(el.querySelectorAll<HTMLElement>('.atlas-line'));
    const reduce = matchMedia(MQ.reduce).matches;
    const prog = ZONES.map(() => ({ d: reduce ? 1 : 0 })); // per-line draw progress 0 → 1
    const ov = el.querySelector<HTMLElement>('.atlas-ov')!;
    let lastRest = '';
    let skip = false; // the visitor touched / scrolled / typed before the intro → show the overlay without it
    let raf = 0, doneTimer = 0;

    const draw = () => {
      const a = bodyAnchors.get();
      if (a.mode !== 'hero' || !a.zones.length) return;
      const sr = slot.getBoundingClientRect(), er = el.getBoundingClientRect();
      const ox = sr.left - er.left, oy = sr.top - er.top;
      const pts = ZONES.map((z) => a.zones.find((q) => q.zoneId === z.id));
      // rows at the rest projection (stable during the sway), keeping a minimum gap within each column
      if (pts.every(Boolean)) {
        const ys = pts.map((p) => oy + p!.restY);
        for (let i = 1; i < ys.length; i++) if (PREV_SAME_SIDE[i] >= 0) ys[i] = Math.max(ys[i], ys[PREV_SAME_SIDE[i]] + MIN_ROW_GAP);
        const key = ys.map(Math.round).join(',');
        if (key !== lastRest) { lastRest = key; rows.forEach((r, i) => { r.style.top = `${ys[i]}px`; }); }
      }
      // ≥ 768 the rows wait hidden until here (styles/sections.css): placed on the anchors of the model's LOD — set on the
      // first draw with anchors whatever came (a missing zone must not keep them hidden until the CSS failsafe)
      if (index.dataset.placed === undefined) index.dataset.placed = '';
      pts.forEach((p, i) => {
        const vis = p?.visible ? '1' : '0';
        dots[i].dataset.visible = lines[i].dataset.visible = vis;
        // R-CODE-02 MINOR: the row follows the FRONT view (restVisible), like its position — the sway (or the other leg
        // passing in front of the ankle on narrow screens) only hides the anchor and the line, the row does not blink
        rows[i].dataset.visible = p?.restVisible ? '1' : '0';
        if (!p) return;
        // the line stops 8 px before its label: the inner edge of its column (left edge on the right, right edge on the left)
        const r = rows[i], ix = index.offsetLeft + (ZONES[i].side === 'R' ? r.offsetLeft - 8 : r.offsetLeft + r.offsetWidth + 8);
        const x = ox + p.x, y = oy + p.y, ry = index.offsetTop + r.offsetTop;
        const dx = ix - x, dy = ry - y, len = Math.max(0, Math.hypot(dx, dy));
        dots[i].style.transform = `translate(${x}px, ${y}px)`;
        lines[i].style.transform = `translate(${x}px, ${y}px) rotate(${Math.atan2(dy, dx)}rad) scaleX(${len * prog[i].d})`;
        if (ZONES[i].active) { reticle.style.transform = `translate(${x}px, ${y}px)`; reticle.dataset.visible = vis; }
      });
      if (!el.dataset.drawn) { el.dataset.drawn = 'true'; play(); }
    };

    // the old GSAP timeline in CSS + rAF: dots pop at 0 (staggered, CSS), lines draw from 0.05 s (0.3 s each, staggered,
    // bm-out = easeOutQuint), the reticle settles at 0.32 s (CSS) → done at 0.7 s
    const end = () => { cancelAnimationFrame(raf); raf = 0; prog.forEach((p) => { p.d = 1; }); draw(); ov.dataset.intro = 'done'; heroIntro.done(); }; // → the model may show (RC-5)
    const play = () => {
      if (skip || heroIntro.isDone()) { end(); return; } // back on the home page with the model live: everything in place at once
      ov.dataset.intro = 'play';
      doneTimer = window.setTimeout(end, reduce ? 150 : 700);
      if (reduce) return;
      const t0 = performance.now(), stagger = STAGGER * 1000;
      const step = (now: number) => {
        let running = false;
        prog.forEach((p, i) => { const k = Math.min(1, Math.max(0, (now - t0 - 50 - i * stagger) / 300)); p.d = 1 - (1 - k) ** 5; running ||= k < 1; });
        draw();
        raf = running ? requestAnimationFrame(step) : 0;
      };
      raf = requestAnimationFrame(step);
    };
    const finish = () => { skip = true; if (ov.dataset.intro === 'play') { clearTimeout(doneTimer); end(); } };

    const off = bodyAnchors.subscribe(draw);
    draw();
    const ro = new ResizeObserver(() => { lastRest = ''; draw(); });
    ro.observe(el);
    window.addEventListener('pointerdown', finish, { passive: true });
    window.addEventListener('wheel', finish, { passive: true });
    window.addEventListener('keydown', finish);
    return () => {
      off(); ro.disconnect(); cancelAnimationFrame(raf); clearTimeout(doneTimer);
      window.removeEventListener('pointerdown', finish); window.removeEventListener('wheel', finish); window.removeEventListener('keydown', finish);
    };
  }, []);

  return (
    <div className="atlas">
      <div className="atlas-top">
        <ModelSwitch />
        <RotationToggle />
      </div>
      <div className="atlas-stage" ref={stage}>
        <Body3DSlot mode="hero" />
        <div className="atlas-ov" aria-hidden="true">
          {ZONES.map((z) => <span key={`l-${z.id}`} className="atlas-line" />)}
          {ZONES.map((z, i) => <span key={`d-${z.id}`} className="atlas-dot" style={{ '--i': i } as CSSProperties}><i /></span>)}
          <span className="atlas-reticle"><i><b /></i></span>
        </div>
        <ol className="atlas-index" aria-label={t('body3d.model.label')}>
          {ZONES.map((z, i) => (
            <li key={z.id} style={{ '--y': ROW_TOPS[i], '--y1': ROW_TOPS_LOD1[i] } as CSSProperties} data-side={z.side} data-active={z.active || undefined} aria-label={zoneLabel(t as never, z.id)}>
              <b className="tn">{String(i + 1).padStart(2, '0')}</b><span>{t(`body3d.zones.${z.base}`)}</span>
            </li>
          ))}
        </ol>
      </div>
      <HeroCap />
    </div>
  );
}

/**
 * The caption under the model (RC-6, lead + AD): while the model is on its way (idle → loading) it carries the loading status
 * — the badge that lay over the figure is gone from the hero (Body3DSlot) — and «drag to rotate» only once the model can be
 * dragged (the store's ready: the short hold under the poster until the intro ends shows the hint, not a lingering «100 %»).
 * Same one-line box for both texts (CLS 0: 19.5 px on 320–1024, RU / EN); tabular figures so the percent does not jitter;
 * aria-hidden while loading — the load is announced by LiveRegion, a second live text would be read twice. Its own
 * component: the progress ticks re-render this line only. The fallback poster hides it (sections.css).
 */
function HeroCap() {
  const t = useTranslations();
  const status = useBody((s) => s.status);
  const progress = useBody((s) => s.progress);
  const mode2d = useBody((s) => s.mode2d);
  const loading = !mode2d && (status === 'idle' || status === 'loading');
  // RC-7: the caption is centred — a text whose width changes would move its start (CLS 0.0003–0.0004 on tablets). Both texts
  // share one grid cell and only their visibility switches
  // the status keeps the width of its «100%» form (an invisible layer in the same cell) and starts at its left: the percent
  // sits right after the ellipsis with a plain space, and the start never moves as it grows (lead)
  return (
    <p className="cap" aria-hidden={loading || undefined} data-loading={loading || undefined}>
      <span className="cap__hint">{t('home.hero.hintRotate')}</span>
      <span className="cap__status">
        <span>{t('body3d.load.progress', { percent: Math.round(progress * 100) })}</span>
        <span className="cap__status-max">{t('body3d.load.progress', { percent: 100 })}</span>
      </span>
    </p>
  );
}
