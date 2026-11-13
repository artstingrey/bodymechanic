'use client';
/**
 * Hero poster anchors: while the hero shows the poster — the model still loading (RC-5: no jump of the index at the handover)
 * or the fallback (lead's decision: no WebGL / FPS < 20 / timeout / load error) — the anchors for the hero index are published
 * from the POSTER instead of the 3D runtime, in the same format (lib/body3d/anchors),
 * so the call-outs keep working with no change on their side. x = restX (the poster IS the front view), no sway.
 * poster-anchors.json = anchor positions as fractions of the poster image, measured from the live front view
 * (scripts/poster-anchors.mjs — rerun when the posters or the models change); placed with the object-fit: contain rect.
 */
import { useLayoutEffect, type RefObject } from 'react';
import { bodyAnchors, type BodyAnchor } from '@/lib/body3d/anchors';
import type { Gender } from '@/lib/body3d/store';
import posterAnchors from '@/lib/body3d/poster-anchors.json';
import { isLod1 } from '@/lib/body3d/lod';

type PosterAnchors = { width: number; height: number; zones: Record<string, { u: number; v: number; visible: boolean }> };
// bundled (≈ 3 KB, the hero index imports it too for its pre-JS row tops), not fetched: the anchors are there at the
// hydration — RC-5, the index must not move after the first frame
const DATA = posterAnchors as unknown as Record<string, PosterAnchors | undefined>;

export function usePosterAnchors(slot: RefObject<HTMLDivElement | null>, active: boolean, model: Gender) {
  // a layout effect: published before the first paint after hydration, before the index's own effect draws
  useLayoutEffect(() => {
    const el = slot.current;
    if (!active || !el) return;
    let stop = () => {};
    {
      // the calibration of the model that will replace the poster: LOD1's anchors differ from LOD0's (lib/body3d/lod)
      const d = (isLod1() && DATA[`${model}@lod1`]) || DATA[model];
      if (!d) return;
      const img = el.querySelector<HTMLImageElement>('.b3d-poster img');
      const publish = () => {
        if (!img) return;
        const sr = el.getBoundingClientRect(), ir = img.getBoundingClientRect();
        if (!ir.width || !ir.height) return;
        const k = Math.min(ir.width / d.width, ir.height / d.height), w = d.width * k, h = d.height * k; // object-fit: contain
        const ox = ir.left - sr.left + (ir.width - w) / 2, oy = ir.top - sr.top + (ir.height - h) / 2;
        const zones: BodyAnchor[] = Object.entries(d.zones).map(([id, z]) => {
          const x = ox + z.u * w, y = oy + z.v * h;
          return { id, zoneId: id, x, y, visible: z.visible, restX: x, restY: y, restVisible: z.visible };
        });
        bodyAnchors.publish({ mode: 'hero', source: 'poster', width: sr.width, height: sr.height, zones, markers: [] });
      };
      publish();
      const ro = new ResizeObserver(publish); // also fires once right after observe → after the index has subscribed
      ro.observe(el);
      img?.addEventListener('load', publish);
      stop = () => { ro.disconnect(); img?.removeEventListener('load', publish); };
    }
    return () => { stop(); };
  }, [slot, active, model]);
}
