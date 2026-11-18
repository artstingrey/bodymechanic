'use client';
/**
 * Screen-space anchors of the body model — the contract between the 3D runtime (Frontend Builder) and the DOM call-outs /
 * crosshairs of the hero and booking step 1 (Web Art Director). README-CONTEXT «РАБОТА В ОДНОМ КОДЕ».
 *
 *  - zones:   one anchor per zone id present on the current model (`knee_l`, `chest`, …): a point on the visible surface of
 *             the zone (ray to the zone centroid from front / back / sides), the same point the zone-list marker uses;
 *  - markers: the numbered markers placed by the visitor (or chosen from the list), `n` = the number on the disc.
 *
 * x / y are CSS px relative to the top-left corner of the 3D slot (`.b3d-slot`, the canvas fills it). `visible` = the
 * surface faces the camera, the point is inside the canvas and not hidden behind another body part. restX / restY are the
 * same point in the front-view rest pose (steady under the hero sway and drags).
 * Updates: computed on the render frame, published only when something moved ≥ 0.5 px or a visibility flipped, and only
 * while somebody is subscribed (no subscribers → zero cost). Nothing is published while the canvas sleeps (off-screen,
 * hidden tab, 2D mode) — the last frame stays; `mode` is null when no page shows the model.
 */
import { useSyncExternalStore } from 'react';

export interface BodyAnchor {
  /** zone id (`knee_l`) for zone anchors, marker id for markers */
  id: string;
  zoneId: string;
  /** marker number (markers only) */
  n?: number;
  x: number;
  y: number;
  visible: boolean;
  /**
   * The same anchor in the REST pose — front view (no sway, camera at its start position), same canvas: steady
   * coordinates for things that must not float with the sway or a drag (the hero index rows). restVisible = faces the
   * camera and is inside the canvas in that pose (no occlusion test).
   */
  restX: number;
  restY: number;
  restVisible: boolean;
}

export interface BodyAnchors {
  /** increments on every publish */
  seq: number;
  mode: 'hero' | 'booking' | 'viewer' | null;
  /** 'poster' = published by the hero poster (usePosterAnchors: while the model loads, or the fallback); absent = the 3D runtime */
  source?: 'poster';
  /** canvas size in CSS px */
  width: number;
  height: number;
  zones: BodyAnchor[];
  markers: BodyAnchor[];
}

const EMPTY: BodyAnchors = { seq: 0, mode: null, width: 0, height: 0, zones: [], markers: [] };
let state: BodyAnchors = EMPTY;
const listeners = new Set<() => void>();

export const bodyAnchors = {
  get: (): BodyAnchors => state,
  /** Imperative subscription — preferred for per-frame DOM updates (write transforms, no React re-render). */
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
  /** @internal runtime → true while somebody listens (the runtime skips the work otherwise) */
  wanted: () => listeners.size > 0,
  /** @internal runtime only */
  publish(next: Omit<BodyAnchors, 'seq'>) { state = { ...next, seq: state.seq + 1 }; listeners.forEach((l) => l()); },
  /** @internal runtime only */
  clear() { if (state.mode !== null || state.zones.length || state.markers.length) bodyAnchors.publish({ ...EMPTY }); },
};

// gate probe, read-only, in BOTH hero modes (the 3D runtime's __bm3d.anchors does not exist while the poster fallback is up):
// the hero geometry test compares the 3D rest anchors with the poster ones
if (typeof window !== 'undefined') (window as unknown as { __bmAnchors?: unknown }).__bmAnchors = { get: bodyAnchors.get, watch: () => bodyAnchors.subscribe(() => {}) };

/** React hook — re-renders on every published change (fine for a few call-outs; for many, use bodyAnchors.subscribe). */
export function useBodyAnchors(): BodyAnchors {
  return useSyncExternalStore(bodyAnchors.subscribe, bodyAnchors.get, () => EMPTY);
}
