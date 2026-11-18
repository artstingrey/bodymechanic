'use client';
/**
 * Body scene inside the persistent canvas. Lights, camera limits and material look = the prototype (see spike report §4).
 * Input is handled on the canvas element (tap vs drag, double tap → reset, delayed marker placement, one-finger zoom tool).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { body, useBody, type Marker } from '@/lib/body3d/store';
import { ZONE_KEYS, keyToIndex } from '@/lib/body3d/zones';
import { computeZoneColours, FRAMING, loadModel, modelUrl, overlayMaterial, setReducedQuality, warmUp, type ModelEntry } from './loader';
import { anchorForZone, transferMarkers, zoneAtHit } from './transfer';
import { createZoneOutline, type OutlineMode } from './zoneOutline';
import { clearAnchors, projectAnchors } from './anchorsProjector';
import { bodyAnchors } from '@/lib/body3d/anchors';
import type { SlotMode } from '../Body3DProvider';
import { LAND_PHONE_MQ } from '@/lib/ui/media';
import { heroReveal } from '@/lib/body3d/heroIntro';
import { bindHeroDrag } from './heroDrag';

const CAM = { pos: new THREE.Vector3(0, 0.9, 2.9), target: new THREE.Vector3(0, 0.5, 0), minDist: 1.6, maxDist: 5.5, minPolar: 0.08 * Math.PI, maxPolar: 0.78 * Math.PI };
// DECISION (lead + art director, hi-fi hero): instead of a full turn the hero model sways ±20° around the front view
// (sine, 9 s) — the index call-outs keep their anchors; the pause button stops the sway (WCAG 2.2.2); reduced motion → still.
const SWAY = { amp: THREE.MathUtils.degToRad(20), period: 9, easeIn: 0.6 };
// After a drag the hero model returns to its resting yaw: reduced motion → instant.
const RETURN_MS = 500;
const TURN = 2 * Math.PI;
// A swipe from the centre can reach the back before the finger reaches the edge.
const TOUCH_HALF_TURN_WIDTH = 0.2;
// RC-4 (lead; FB + AD): short landscape phones (LAND_PHONE_MQ: SE 667×325, Moto G4 640×300), booking step 1 — the canvas
// is only 230–270 px high (AD's layout: the step row in the right column, the gender switch in the tools column, the model
// from 12 px), and at the default framing the body takes ≈ 72 % of it (105–123 px on main 6b101c5 with the old layout).
// The camera zooms in ×1.2 there (≈ 86 % by the red silhouette, the lead's «≈ 88 %») and the view moves down by 3.5 % of
// its height: the body's centre (y 0.43) sits below the camera's target (0.5), at ×1.2 the feet would touch the edge.
// Projection only (zoom + view offset as fractions — resize-safe): orbit distances, the zoom tool and the reset stay.
const LAND_ZOOM = 1.2;
const LAND_SHIFT = 0.035;
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x: number) => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; } return by((lo + hi) / 2); };
}
const easeReturn = cubicBezier(0.65, 0, 0.35, 1);
// rest pose for the anchors API (front view, steady under the sway): a camera at the start position + pivot without rotation
const restCam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
restCam.position.copy(CAM.pos); restCam.lookAt(CAM.target); restCam.updateMatrixWorld();
const restPivot = new THREE.Matrix4();
const easeReset = (k: number) => 1 - Math.pow(1 - k, 3);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const LOAD_TIMEOUT = 15000; // ТЗ §06: 15 s → offer the 2D mode

type Slot = { el: HTMLElement; mode: SlotMode } | null;

export function Scene({ slot }: { slot: Slot }) {
  const { gl, camera, scene, setFrameloop, invalidate } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const pivot = useRef<THREE.Group>(null);
  const [entry, setEntry] = useState<ModelEntry | null>(null);
  const entryRef = useRef<ModelEntry | null>(null);
  const model = useBody((s) => s.model);
  const tool = useBody((s) => s.tool);
  const autorotate = useBody((s) => s.autorotate);
  const markers = useBody((s) => s.markers);
  const resetSeq = useBody((s) => s.resetSeq);
  const mode2d = useBody((s) => s.mode2d);
  const loadSeq = useBody((s) => s.loadSeq); // «Повторить» after a load error (F-07)
  const quality = useBody((s) => s.quality);
  const dpr = useThree((s) => s.viewport.dpr); // follows setDpr (quality fallback) → outline stays 1.5 CSS px
  const mode = slot?.mode ?? null;
  const editable = mode === 'booking';


  // ---- load / switch model (marker transfer, warm-up of the other model in idle)
  useEffect(() => {
    let alive = true;
    const first = !entryRef.current;
    if (first) body.setStatus('loading', 0);
    const timer = window.setTimeout(() => { if (alive && body.get().status === 'loading') body.setStatus('timeout'); }, LOAD_TIMEOUT);
    loadModel(gl, model, (f) => body.setProgress(f)).then(async (next) => {
      if (!alive) return;
      const prev = entryRef.current;
      if (prev === next) return;
      await warmUp(gl, next, camera, scene);
      if (!alive || !pivot.current) return;
      if (prev) pivot.current.remove(prev.root);
      pivot.current.position.y = FRAMING[next.gender].y;
      pivot.current.add(next.root);
      pivot.current.updateMatrixWorld(true);
      if (prev && body.get().markers.length) {
        const { kept, dropped } = transferMarkers(pivot.current, prev, next, body.get().markers);
        body.replaceMarkers(kept, { model: next.gender, dropped });
      }
      entryRef.current = next;
      setEntry(next);
      if (first) { body.setStatus('ready', 1); body.announceLoaded(); }
      // prefetch + warm the other model when idle (switch without network or GPU-upload hitch)
      const other = next.gender === 'male' ? 'female' : 'male';
      const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1500));
      window.setTimeout(() => idle(() => { loadModel(gl, other).then((e) => warmUp(gl, e, camera, scene)).catch(() => {}); }), 2500);
    }).catch(() => { if (alive && first) body.setStatus('error'); });
    return () => { alive = false; clearTimeout(timer); };
  }, [model, gl, camera, scene, loadSeq]);

  // ---- zone highlight (booking only). Normal quality: screen-space veil + outline (zoneOutline.ts, F-07 variant «а»);
  // reduced quality: per-vertex veil only, no outline (lead). Both read the same uMask.
  const outlineMode: OutlineMode = !editable || mode2d || !markers.length ? 'off' : quality === 'high' ? 'screen' : 'veil';
  // short landscape phones, booking: a tighter framing (LAND_ZOOM); everywhere else zoom 1
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const mq = window.matchMedia(LAND_PHONE_MQ);
    /* eslint-disable react-hooks/immutability -- the three.js camera is mutable by design (as in the frame loop) */
    const apply = () => {
      const on = mode === 'booking' && mq.matches;
      if (on) cam.setViewOffset(1, 1, 0, LAND_SHIFT, 1, 1); else cam.clearViewOffset();
      cam.zoom = on ? LAND_ZOOM : 1;
      cam.updateProjectionMatrix(); invalidate();
    };
    /* eslint-enable react-hooks/immutability */
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [camera, mode, invalidate]);
  const modeRef = useRef<OutlineMode>('off');
  const outline = useMemo(() => createZoneOutline(overlayMaterial.uniforms.uMask), []);
  useEffect(() => () => outline.dispose(), [outline]);
  useEffect(() => { if (entry) outline.setColours(entry.zoneColor); }, [entry, outline]); // dividers between neighbouring zones
  // three.js scene objects and uniforms are mutable by design (R3F pattern): mutate in an effect, not during render.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    modeRef.current = outlineMode;
    const mask = overlayMaterial.uniforms.uMask.value as Float32Array;
    mask.fill(0);
    if (editable) for (const m of markers) mask[keyToIndex(m.zoneId)] = 1;
    if (entry) for (const ov of entry.overlays) ov.visible = outlineMode === 'veil' && markers.some((m) => (ov.userData.keys as Set<number>).has(keyToIndex(m.zoneId)));
  }, [markers, entry, editable, outlineMode]);
  /* eslint-enable react-hooks/immutability */

  // ---- markers chosen from the zone list / 2D have no surface point → anchor them on the zone (disc on the body, not inside)
  const [bvhSeq, setBvhSeq] = useState(0);
  useEffect(() => { let alive = true; entry?.bvh.then(() => { if (alive) setBvhSeq((n) => n + 1); }); return () => { alive = false; }; }, [entry]);
  useEffect(() => {
    if (!entry?.bvhReady || !pivot.current) return; // dozens of rays per zone: wait for the BVH (built right after load)
    for (const m of markers) {
      if (m.normal) continue;
      const a = anchorForZone(pivot.current, entry, keyToIndex(m.zoneId));
      if (a) body.updateMarker(m.id, a);
    }
  }, [markers, entry, bvhSeq]);

  // ---- the frame: [mask pass] → scene → [veil + outline]. Priority 1 → R3F leaves rendering to us.
  useFrame(({ gl: r, scene: sc, camera: cam, size, invalidate: redraw }) => {
    // screen anchors for the art director's call-outs (lib/body3d/anchors) — only while subscribed
    if (mode && entryRef.current?.bvhReady && pivot.current && bodyAnchors.wanted()) {
      const rc = restCam, pc = cam as THREE.PerspectiveCamera;
      if (rc.aspect !== pc.aspect || rc.fov !== pc.fov || rc.zoom !== pc.zoom) { rc.fov = pc.fov; rc.aspect = pc.aspect; rc.zoom = pc.zoom; rc.near = pc.near; rc.far = pc.far; rc.updateProjectionMatrix(); }
      restPivot.makeTranslation(pivot.current.position.x, pivot.current.position.y, pivot.current.position.z);
      projectAnchors({ camera: cam, pivot: pivot.current, entry: entryRef.current, markers: body.get().markers, mode, width: size.width, height: size.height, rest: { camera: rc, pivot: restPivot } });
    }
    outline.render(r, sc, cam, modeRef.current === 'screen', dpr);
    if (window.__bm3d && !window.__bm3d.outline) { // gate probes
      window.__bm3d.outline = () => modeRef.current;
      window.__bm3d.anchors = { get: bodyAnchors.get, watch: () => { bodyAnchors.subscribe(() => {}); } };
      window.__bm3d.view = () => ({
        camera: cam.position.toArray(),
        target: (controls.current?.target ?? CAM.target).toArray(),
        zoom: (cam as THREE.PerspectiveCamera).zoom,
        yaw: pivot.current?.rotation.y ?? 0,
      });
      // zone under a client point and a fixed yaw of the model (front 0, back π) — M-01 checks of the marker numbers
      const pickRay = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean };
      pickRay.firstHitOnly = true;
      window.__bm3d.pick = (x: number, y: number) => {
        const cur = entryRef.current; if (!cur) return null;
        const rc = r.domElement.getBoundingClientRect();
        pickRay.setFromCamera(new THREE.Vector2(((x - rc.left) / rc.width) * 2 - 1, -((y - rc.top) / rc.height) * 2 + 1), cam);
        const hit = pickRay.intersectObjects(cur.meshes, false)[0];
        return hit ? ZONE_KEYS[zoneAtHit(hit)] ?? 'none' : null;
      };
      window.__bm3d.yaw = (rad: number) => { if (pivot.current) pivot.current.rotation.y = rad; redraw(); };
      // scripts/zone-colours.mjs: the zone colours of any model URL (recorded in zone-colours.json → no runtime cost)
      window.__bm3d.zoneColours = async (g: 'male' | 'female', url: string) => { const e = await loadModel(r, g, undefined, url); await e.bvh; return computeZoneColours(e); };
    }
  }, 1);
  // no page shows the model → anchors are meaningless (in the hero fallback the poster publishes them: usePosterAnchors)
  useEffect(() => { if (!slot) clearAnchors(); }, [slot]);

  // ---- pause rendering when the slot is off-screen, the tab is hidden, the host is parked or 2D mode is on (ТЗ §06)
  useEffect(() => {
    let onScreen = true;
    const apply = () => setFrameloop(slot && onScreen && !document.hidden && !mode2d ? 'always' : 'never');
    const io = slot ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; apply(); }) : null;
    if (slot && io) io.observe(slot.el);
    document.addEventListener('visibilitychange', apply);
    apply();
    return () => { io?.disconnect(); document.removeEventListener('visibilitychange', apply); };
  }, [slot, mode2d, setFrameloop]);

  // ---- booking reset (double tap / button / entry from the hero)
  type Anim = { t0: number; dur: number; ease: (k: number) => number; from: THREE.Vector3; fromT: THREE.Vector3; rotFrom: number; rotTo: number };
  const resetAnim = useRef<Anim | null>(null);
  const startAnim = useCallback((rotTo?: number) => {
    if (!controls.current || !pivot.current) return;
    const r = pivot.current.rotation.y;
    resetAnim.current = { t0: performance.now(), dur: 450, ease: easeReset, from: camera.position.clone(), fromT: controls.current.target.clone(), rotFrom: r, rotTo: rotTo ?? Math.round(r / TURN) * TURN };
  }, [camera]);
  useEffect(() => { if (editable && resetSeq) startAnim(); }, [editable, resetSeq, startAnim]);
  // the booking starts from the front view (the hero may have left the model mid-sway)
  useEffect(() => {
    if (editable) startAnim(0);
    return () => { resetAnim.current = null; };
  }, [editable, startAnim]);

  // ---- hero: the camera stays at the front; drag and sway share the model's vertical pivot.
  const hero = mode === 'hero' && !mode2d;
  const swayT = useRef(0);
  const dragYaw = useRef(0);
  const returning = useRef<{ t0: number; from: number } | null>(null);
  const dragging = useRef(false);
  useLayoutEffect(() => {
    if (!hero) return;
    camera.position.copy(CAM.pos);
    camera.lookAt(CAM.target);
    if (pivot.current) pivot.current.rotation.y = 0;
    swayT.current = 0;
    dragYaw.current = 0;
    returning.current = null;
    dragging.current = false;
    const canvas = gl.domElement;
    return bindHeroDrag(canvas, (dx, isTouch) => {
      dragging.current = true;
      returning.current = null; // continue from the yaw drawn in the most recent frame
      const halfTurnDistance = isTouch ? canvas.clientWidth * TOUCH_HALF_TURN_WIDTH : canvas.clientHeight / 2;
      dragYaw.current += Math.PI * dx / Math.max(1, halfTurnDistance);
    }, () => {
      dragging.current = false;
      if (reducedMotion()) dragYaw.current = 0;
      else returning.current = { t0: performance.now(), from: dragYaw.current - Math.round(dragYaw.current / TURN) * TURN };
    });
  }, [hero, camera, gl]);

  // ---- input on the canvas: taps, double tap, marker placement, one-finger zoom tool
  useEffect(() => {
    if (!editable) return;
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean };
    raycaster.firstHitOnly = true;
    let down: { x: number; y: number; t: number; id: number; lastY: number } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let pending = 0;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, lastY: e.clientY }; };
    const onMove = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id || body.get().tool !== 'zoom' || !controls.current) return;
      const dy = e.clientY - down.lastY; down.lastY = e.clientY;
      const off = camera.position.clone().sub(controls.current.target);
      camera.position.copy(controls.current.target).add(off.setLength(THREE.MathUtils.clamp(off.length() * Math.exp(dy * 0.006), CAM.minDist, CAM.maxDist)));
    };
    const place = (x: number, y: number) => {
      const cur = entryRef.current; if (!cur || !pivot.current) return;
      const r = el.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
      const hit = raycaster.intersectObjects(cur.meshes, false)[0];
      if (!hit || !hit.face) return;
      const key = ZONE_KEYS[zoneAtHit(hit)] ?? null;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (n.dot(raycaster.ray.direction) > 0) n.negate();
      n.transformDirection(new THREE.Matrix4().copy(pivot.current.matrixWorld).invert());
      const p = pivot.current.worldToLocal(hit.point.clone());
      body.addMarker({ zoneId: key, position: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] });
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
      down = null;
      if (moved > 6 || dt > 450) return; // a drag, not a tap
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { clearTimeout(pending); lastTap = null; body.resetView(); return; }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      // DECISION: a tap places the marker after 230 ms, so a double tap resets the view instead of adding a marker.
      // R-FINAL F-04 (lead): in ANY tool — the hints say «tap the model»; drags rotate (or zoom), a tap without a move marks
      const { clientX: x, clientY: y } = e; pending = window.setTimeout(() => place(x, y), 230);
    };
    const noDbl = (e: MouseEvent) => e.preventDefault();
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('dblclick', noDbl);
    return () => { clearTimeout(pending); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('dblclick', noDbl); };
  }, [gl, camera, editable]);

  // ---- quality fallback (lead, R-3D-01): MeshStandard here; DPR ≤ 1.5 via the Canvas dpr prop (Body3DRuntime).
  useEffect(() => { if (quality === 'reduced') setReducedQuality(); }, [quality]);

  // ---- FPS check during the first 3 s after the model is shown: < 20 → 2D (ТЗ 6.11), < 30 → reduced quality
  const fpsProbe = useRef<{ t0: number; frames: number } | null>(null);
  useEffect(() => { if (entry && !fpsProbe.current) fpsProbe.current = { t0: performance.now(), frames: 0 }; }, [entry]);

  useFrame((_, dt) => {
    const p = pivot.current;
    if (p && hero) {
      // RC-5 (lead): the sway clock runs from the reveal (lib/body3d/heroIntro — the model waits in the front pose under the
      // poster until the index intro is done), its amplitude eased in over SWAY.easeIn s (a sine starts at full speed,
      // 14°/s: the dots slid 2.4–3.4 px in the first frames after the swap)
      if (autorotate && !dragging.current && !returning.current) {
        if (heroReveal.isShown()) swayT.current += Math.min(dt, 0.1); else swayT.current = 0;
      }
      const motion = returning.current;
      if (motion) {
        const progress = Math.min(1, (performance.now() - motion.t0) / RETURN_MS);
        dragYaw.current = motion.from * (1 - easeReturn(progress));
        if (progress === 1) { dragYaw.current = 0; returning.current = null; }
      }
      const k = Math.min(1, swayT.current / SWAY.easeIn);
      p.rotation.y = dragYaw.current + SWAY.amp * k * k * (3 - 2 * k) * Math.sin(TURN * swayT.current / SWAY.period);
    }
    const ra = resetAnim.current;
    if (ra && controls.current && p) {
      const k = ra.dur > 0 ? Math.min(1, (performance.now() - ra.t0) / ra.dur) : 1, e = ra.ease(k);
      camera.position.lerpVectors(ra.from, CAM.pos, e);
      controls.current.target.lerpVectors(ra.fromT, CAM.target, e);
      p.rotation.y = ra.rotFrom + (ra.rotTo - ra.rotFrom) * e;
      if (k >= 1) resetAnim.current = null;
    }
    const probe = fpsProbe.current;
    if (probe && probe.frames >= 0) {
      probe.frames++;
      const el = performance.now() - probe.t0;
      if (el > 3000) {
        const fps = (probe.frames * 1000) / el;
        if (fps < 20) body.setMode2d('lowFps'); else if (fps < 30) body.setQuality('reduced');
        probe.frames = -1;
      }
    }
    if (window.__bm3d) window.__bm3d.frames += 1;
  });

  const lights = useMemo(() => [
    { p: [2.8, 3.4, 3.1] as const, i: 2.4, c: '#fffdf8' }, { p: [-3.4, 1.9, 2.7] as const, i: 1.6, c: '#f7fbff' }, { p: [0.8, 2.8, -3.4] as const, i: 1.1, c: '#fffaf6' },
  ], []);

  return (
    <>
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#ffffff', '#f1f3f5', 1.4]} position={[0, 2, 0]} />
      {lights.map((l, k) => <directionalLight key={k} position={l.p} intensity={l.i} color={l.c} />)}
      {editable && <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={0.07} enableRotate={tool !== 'zoom'}
        minDistance={CAM.minDist} maxDistance={CAM.maxDist} minPolarAngle={CAM.minPolar} maxPolarAngle={CAM.maxPolar} target={CAM.target}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }} />}
      <group ref={pivot}>
        {editable && markers.filter((m) => m.normal).map((m) => <Pin key={m.id} m={m} meshes={entry?.meshes} />)}
      </group>
    </>
  );
}

/**
 * Marker (README §12): the DOM disc .b3d-pin (accent disc, 3 px white ring, 1 px #26221F outline, white digit — tokens.css),
 * centred on the tapped point. A DOM label is not depth-tested, so it is hidden (data-back) by real occlusion (M-01):
 * its surface faces away from the camera (normal · view < 0.05), OR another part of the body lies between the camera and
 * the point (BVH ray; a hit in the same zone does not hide it — the anatomy is layered).
 */
const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3();
const pinRay = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean };
pinRay.firstHitOnly = true;
function Pin({ m, meshes }: { m: Marker; meshes?: THREE.Mesh[] }) {
  const g = useRef<THREE.Group>(null);
  const label = useRef<HTMLSpanElement>(null);
  useFrame(({ camera }) => {
    const grp = g.current, el = label.current;
    if (!grp?.parent || !el || !m.normal) return;
    _n.fromArray(m.normal).transformDirection(grp.parent.matrixWorld);
    grp.getWorldPosition(_p);
    _v.copy(camera.position).sub(_p);
    const dist = _v.length();
    let back = _n.dot(_v.normalize()) < 0.05;
    if (!back && meshes?.length && meshes[0].geometry.boundsTree) {
      pinRay.set(camera.position, _v.negate()); pinRay.far = dist - 0.005;
      const hit = pinRay.intersectObjects(meshes, false)[0];
      back = !!hit && zoneAtHit(hit) !== keyToIndex(m.zoneId);
    }
    if ((el.dataset.back === 'true') !== back) el.dataset.back = String(back);
  });
  return (
    <group ref={g} position={m.position}>
      <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <span ref={label} className="b3d-pin" data-n={m.n}>{m.n}</span>
      </Html>
    </group>
  );
}

declare global { interface Window { __bm3d?: { contextId: string; frames: number; model: () => string | null; url: (g: 'male' | 'female') => string; quality: () => string; dpr: () => number; outline?: () => string; anchors?: { get: typeof bodyAnchors.get; watch: () => void }; view?: () => { camera: number[]; target: number[]; zoom: number; yaw: number }; pick?: (x: number, y: number) => string | null; yaw?: (rad: number) => void; zoneColours?: (g: 'male' | 'female', url: string) => Promise<number[]> } } }
export { modelUrl };
