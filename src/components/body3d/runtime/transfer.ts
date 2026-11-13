/**
 * Marker transfer on M/F switch (ТЗ 6.1): keep a marker if its zone exists on the new model; project the
 * bbox-normalised point onto the first visible surface of the same zone along the stored normal; fallback —
 * nearest vertex of that zone, lifted to the surface. Ported from the spike (site/3d/viewer.js).
 */
import * as THREE from 'three';
import type { Marker } from '@/lib/body3d/store';
import { ZONE_KEYS, keyToIndex, baseOf, sideOf } from '@/lib/body3d/zones';
import VIEWS from '@/lib/body3d/zone-views.json';
import { positions, type ModelEntry } from './loader';

const ray = new THREE.Raycaster();

function zoneAtHit(hit: THREE.Intersection): number {
  const mesh = hit.object as THREE.Mesh, g = mesh.geometry, za = g.getAttribute('_zone'), pos = g.getAttribute('position') as THREE.BufferAttribute;
  if (!za || !hit.face) return 0;
  const local = mesh.worldToLocal(hit.point.clone()), v = new THREE.Vector3();
  let best = Infinity, key = 0;
  for (const idx of [hit.face.a, hit.face.b, hit.face.c]) { const d = v.fromBufferAttribute(pos, idx).distanceToSquared(local); if (d < best) { best = d; key = za.getX(idx); } }
  return key;
}
export { zoneAtHit };

/** Ray from outside along −normal (pivot space); returns the first visible hit if it lies in `zone`. */
function surfaceHit(pivot: THREE.Object3D, entry: ModelEntry, p: THREE.Vector3, n: THREE.Vector3, zone: number): THREE.Vector3 | null {
  pivot.updateMatrixWorld(true);
  const o = pivot.localToWorld(p.clone().addScaledVector(n, 0.25));
  const d = n.clone().transformDirection(pivot.matrixWorld).negate();
  ray.set(o, d); ray.far = 0.6;
  const hit = ray.intersectObjects(entry.meshes, false)[0];
  return hit && zoneAtHit(hit) === zone ? pivot.worldToLocal(hit.point.clone()) : null;
}

const bbox = (arrs: Float32Array[]) => { const b = new THREE.Box3(), v = new THREE.Vector3(); for (const a of arrs) for (let i = 0; i < a.length; i += 3) b.expandByPoint(v.set(a[i], a[i + 1], a[i + 2])); return b; };

/** `from`/`to` roots must be direct children of `pivot`; `to` must already be attached. */
export function transferMarkers(pivot: THREE.Object3D, from: ModelEntry, to: ModelEntry, markers: Marker[]): { kept: Marker[]; dropped: number } {
  const bf = bbox(positions(from)), bt = bbox(positions(to)), sf = bf.getSize(new THREE.Vector3()), st = bt.getSize(new THREE.Vector3());
  const mFrom = from.root.matrix.clone().invert(), mTo = to.root.matrix;
  const kept: Marker[] = []; let dropped = 0;
  for (const m of markers) {
    const zone = keyToIndex(m.zoneId);
    if (!to.present.has(zone)) { dropped++; continue; }
    const p = new THREE.Vector3(...m.position).applyMatrix4(mFrom);
    const t = new THREE.Vector3((p.x - bf.min.x) / sf.x, (p.y - bf.min.y) / sf.y, (p.z - bf.min.z) / sf.z);
    const target = new THREE.Vector3(bt.min.x + t.x * st.x, bt.min.y + t.y * st.y, bt.min.z + t.z * st.z);
    const n = new THREE.Vector3(...(m.normal ?? [0, 0, 1]));
    let out = surfaceHit(pivot, to, target.clone().applyMatrix4(mTo), n, zone);
    if (!out) {
      let best = Infinity; const bv = new THREE.Vector3();
      positions(to).forEach((a, mi) => {
        const za = to.meshes[mi].geometry.getAttribute('_zone');
        for (let i = 0, vi = 0; i < a.length; i += 3, vi++) {
          if (za.getX(vi) !== zone) continue;
          const dx = a[i] - target.x, dy = a[i + 1] - target.y, dz = a[i + 2] - target.z, d = dx * dx + dy * dy + dz * dz;
          if (d < best) { best = d; bv.set(a[i], a[i + 1], a[i + 2]); }
        }
      });
      const snapped = bv.applyMatrix4(mTo);
      out = surfaceHit(pivot, to, snapped, n, zone) ?? snapped;
    }
    kept.push({ ...m, position: [out.x, out.y, out.z] });
  }
  return { kept, dropped };
}

/**
 * Surface anchor of a zone (pivot space): rays aim at the zone's vertex centroid from the front, back and both sides; the
 * first visible hit inside the zone wins (null → none found). Used for markers chosen without a tap (zone list, 2D mode:
 * they arrive with position [0,0,0] and no normal) and for the screen anchors of the art director's call-outs.
 * Centroids of all zones are computed in ONE pass over the vertices and cached on the model entry.
 */
export type ZoneAnchor = { position: [number, number, number]; normal: [number, number, number] } | null;
const anchorCache = new WeakMap<ModelEntry, Map<number, ZoneAnchor>>();
const centroidCache = new WeakMap<ModelEntry, Map<number, THREE.Vector3>>();

function centroids(entry: ModelEntry): Map<number, THREE.Vector3> {
  const hit = centroidCache.get(entry); if (hit) return hit;
  const sum = new Map<number, { v: THREE.Vector3; n: number }>();
  positions(entry).forEach((a, mi) => {
    const za = entry.meshes[mi].geometry.getAttribute('_zone'); if (!za) return;
    for (let i = 0, vi = 0; i < a.length; i += 3, vi++) {
      const z = za.getX(vi); if (!z) continue;
      let e = sum.get(z); if (!e) sum.set(z, (e = { v: new THREE.Vector3(), n: 0 }));
      e.v.x += a[i]; e.v.y += a[i + 1]; e.v.z += a[i + 2]; e.n++;
    }
  });
  const out = new Map<number, THREE.Vector3>();
  sum.forEach((e, z) => out.set(z, e.v.divideScalar(e.n).applyMatrix4(entry.root.matrix))); // root → pivot space
  centroidCache.set(entry, out);
  return out;
}

/**
 * Surface points of a zone grouped by facing (pivot space): vertices whose normal looks to the front (+z), the sides
 * (±x), up (+y: tops, seen by the slightly raised front camera) or the back (−z), every 2nd vertex. Cached per model.
 */
type Facing = 'front' | 'up' | 'side' | 'back';
const facingCache = new WeakMap<ModelEntry, Map<number, Record<Facing, THREE.Vector3[]>>>();
const UP_FRONT = new THREE.Vector3(0, 0.6, 0.8); // the front-view camera looks slightly from above: tops (dorsum of the foot) count
function facingPoints(entry: ModelEntry): Map<number, Record<Facing, THREE.Vector3[]>> {
  const hit = facingCache.get(entry); if (hit) return hit;
  const out = new Map<number, Record<Facing, THREE.Vector3[]>>();
  const nm = new THREE.Matrix3(), n = new THREE.Vector3(), rel = new THREE.Matrix4();
  entry.root.updateMatrixWorld(true);
  entry.meshes.forEach((m, mi) => {
    const za = m.geometry.getAttribute('_zone'), nor = m.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!za || !nor) return;
    rel.copy(entry.root.matrixWorld).invert().multiply(m.matrixWorld).premultiply(entry.root.matrix); // mesh → pivot space
    nm.getNormalMatrix(rel);
    const pos = positions(entry)[mi];
    for (let i = 0; i < za.count; i += 2) {
      const z = za.getX(i); if (!z) continue;
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      const f: Facing = n.z > 0.55 ? 'front' : n.y > 0.55 ? 'up' : n.z < -0.55 ? 'back' : 'side';
      let rec = out.get(z); if (!rec) out.set(z, (rec = { front: [], up: [], side: [], back: [] }));
      rec[f].push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(entry.root.matrix));
    }
  });
  facingCache.set(entry, out);
  return out;
}

/**
 * cast along −d from outside the body at point q (pivot space); the hit must belong to `zone`, face the ray (n · d ≥ 0.35)
 * and, when given, its normal (pivot space, turned towards the ray origin) must pass `accept`.
 */
function castInto(pivot: THREE.Object3D, entry: ModelEntry, q: THREE.Vector3, d: THREE.Vector3, zone: number, accept?: (n: THREE.Vector3) => boolean): ZoneAnchor {
  const wd = d.clone().transformDirection(pivot.matrixWorld).negate();
  ray.set(pivot.localToWorld(q.clone().addScaledVector(d, 1.5)), wd); ray.far = 3;
  const hit = ray.intersectObjects(entry.meshes, false)[0];
  if (!hit?.face || zoneAtHit(hit) !== zone) return null;
  const p = pivot.worldToLocal(hit.point.clone());
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (n.dot(wd) > 0) n.negate();
  n.transformDirection(new THREE.Matrix4().copy(pivot.matrixWorld).invert());
  // no grazing hits (edge of the sole seen from the front…): the surface must clearly face the ray, else the number is
  // hidden at the first turn and a pair loses its symmetry (M-01)
  if (n.dot(d.clone().normalize()) < 0.35) return null;
  if (accept && !accept(n)) return null;
  return { position: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] };
}

/**
 * Zones drawn on the FRONT 2D silhouette (same zone map, lib/body3d/zone-views.json from site/design/body2d/svg) have a
 * front surface; the others (thoracic_spine, lumbar, gluteal, hamstrings, calves, shoulder_girdle) are back-only.
 * M-01: a back-only zone is never anchored from the front — the anatomy model has gaps between muscles, a front ray can
 * reach the INNER side of a back muscle, and the number then floats on the chest / in the groin, seen through the body.
 */
const views = VIEWS as unknown as Record<string, { front: string[]; back: string[] }>;
export const hasFrontSurface = (gender: string, key: string) => (views[gender]?.front ?? []).includes(key);

type Found = { anchor: NonNullable<ZoneAnchor>; dir: THREE.Vector3; rank: number } | null;
const F = new THREE.Vector3(0, 0, 1), B = new THREE.Vector3(0, 0, -1), UP_BACK = new THREE.Vector3(0, 0.6, -0.8);
const sideDir = (q: THREE.Vector3) => new THREE.Vector3(Math.sign(q.x) || 1, 0, 0);
const notFront = (n: THREE.Vector3) => n.z < 0.3;

/**
 * Anchor of a zone (N-07 + M-01). Zones with a front surface: front-facing points of the zone, nearest to their centroid
 * first, cast from the front; then tops (seen by the slightly raised camera), sides, back. Back-only zones: back first,
 * then tops from behind, sides — and never a point whose surface looks forward. `rank` = which group answered.
 */
function findAnchor(pivot: THREE.Object3D, entry: ModelEntry, zone: number): Found {
  pivot.updateMatrixWorld(true);
  const key = ZONE_KEYS[zone]; if (!key) return null;
  const pts = facingPoints(entry).get(zone);
  const front = hasFrontSurface(entry.gender, key);
  const accept = front ? undefined : notFront;
  const tryGroup = (list: THREE.Vector3[] | undefined, dirOf: (q: THREE.Vector3) => THREE.Vector3, rank: number): Found => {
    if (!list?.length) return null;
    const c = list.reduce((a, q) => a.add(q), new THREE.Vector3()).divideScalar(list.length);
    const sorted = [...list].sort((a, b) => a.distanceToSquared(c) - b.distanceToSquared(c));
    const step = Math.max(1, Math.floor(sorted.length / 48));
    for (let i = 0; i < sorted.length && i < 48 * step; i += step) {
      const dir = dirOf(sorted[i]);
      const a = castInto(pivot, entry, sorted[i], dir, zone, accept);
      if (a) return { anchor: a, dir, rank };
    }
    return null;
  };
  const legacy = (dirs: THREE.Vector3[]): Found => { // rays to the vertex centroid
    const c = centroids(entry).get(zone); if (!c) return null;
    for (const dir of dirs) { const a = castInto(pivot, entry, c, dir, zone, accept); if (a) return { anchor: a, dir, rank: 9 }; }
    return null;
  };
  const X = new THREE.Vector3(1, 0, 0), NX = new THREE.Vector3(-1, 0, 0);
  return front
    ? tryGroup(pts?.front, () => F, 0) ?? tryGroup(pts?.up, () => UP_FRONT, 1) ?? tryGroup(pts?.side, sideDir, 2) ?? tryGroup(pts?.back, () => B, 3) ?? legacy([F, X, NX, B])
    : tryGroup(pts?.back, () => B, 0) ?? tryGroup(pts?.up, () => UP_BACK, 1) ?? tryGroup(pts?.side, sideDir, 2) ?? legacy([B, X, NX]);
}

/**
 * Anchor of a zone, cached per model. Paired zones are solved together and kept SYMMETRIC: the side whose anchor came
 * from the better group is mirrored (x → −x, direction mirrored too) onto the other side when the mirrored ray lands on
 * that side's zone; otherwise each side keeps its own anchor.
 */
export function anchorForZone(pivot: THREE.Object3D, entry: ModelEntry, zone: number): ZoneAnchor {
  let cache = anchorCache.get(entry);
  if (!cache) anchorCache.set(entry, (cache = new Map()));
  if (cache.has(zone)) return cache.get(zone)!;
  const key = ZONE_KEYS[zone];
  if (!key || !sideOf(key)) { const f = findAnchor(pivot, entry, zone); cache.set(zone, f?.anchor ?? null); return f?.anchor ?? null; }
  const lz = keyToIndex(`${baseOf(key)}_l`), rz = keyToIndex(`${baseOf(key)}_r`);
  const fl = findAnchor(pivot, entry, lz), fr = findAnchor(pivot, entry, rz);
  const accept = hasFrontSurface(entry.gender, key) ? undefined : notFront;
  const mirror = (f: NonNullable<Found>, to: number) =>
    castInto(pivot, entry, new THREE.Vector3(-f.anchor.position[0], f.anchor.position[1], f.anchor.position[2]), new THREE.Vector3(-f.dir.x, f.dir.y, f.dir.z), to, accept);
  let al = fl?.anchor ?? null, ar = fr?.anchor ?? null;
  if (fl && (!fr || fl.rank <= fr.rank)) ar = mirror(fl, rz) ?? ar;
  else if (fr) al = mirror(fr, lz) ?? al;
  cache.set(lz, al); cache.set(rz, ar);
  return zone === lz ? al : ar;
}
