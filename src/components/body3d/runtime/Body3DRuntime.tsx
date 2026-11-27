'use client';
/** Lazy chunk: the persistent R3F canvas, rendered (via portal) into the host div owned by Body3DProvider. */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { useBody, useBodyStore } from '@/lib/body3d/store';
import { Scene, modelUrl } from './Scene';
import type { Body3DActiveSlot } from '../Body3DProvider';

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

export default function Body3DRuntime({ host, slot }: { host: HTMLDivElement; slot: Body3DActiveSlot | null }) {
  const store = useBodyStore();
  const mode = slot?.mode;
  // debug only: ?debug=nowebgl behaves like a device without WebGL 2 (checks of the hero / booking fallbacks)
  const [webgl] = useState(() => hasWebGL2() && new URLSearchParams(window.location.search).get('debug') !== 'nowebgl');
  // declarative DPR: the Canvas re-applies its dpr prop on re-render, so the quality fallback lives here, not in setDpr()
  const reduced = useBody((s) => s.quality === 'reduced');
  useEffect(() => {
    if (!mode) return;
    if (!webgl) {
      store.setStatus('unavailable');
      return;
    }
    const debug = new URLSearchParams(window.location.search).get('debug');
    if (debug === 'reduced' || debug === 'lowfps') store.setQuality('reduced');
    if (debug === 'lowfps' && mode === 'hero') store.setHeroLowFps();
  }, [webgl, mode, store]);
  if (!webgl) return null;
  return createPortal(
    <Canvas
      className="b3d-canvas"
      dpr={reduced ? [1, 1.5] : [1, 2]} // ТЗ: devicePixelRatio ≤ 2; FPS < 30 in the first 3 s → ≤ 1.5 (lead, R-3D-01)
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 45, near: 0.1, far: 100, position: [0, 0.9, 2.9] }}
      onCreated={({ gl, camera }) => {
        gl.toneMappingExposure = 1.5; // prototype: ACES Filmic (R3F default) + exposure 1.5
        camera.lookAt(0, 0.5, 0);
        window.__bm3d = { contextId: Math.random().toString(36).slice(2), frames: 0, model: () => store.get().model, url: modelUrl, quality: () => store.get().quality, dpr: () => gl.getPixelRatio() };
      }}
    >
      <Scene slot={slot} />
    </Canvas>,
    host,
  );
}
