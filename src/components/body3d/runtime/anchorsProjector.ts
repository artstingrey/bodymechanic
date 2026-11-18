/**
 * Projects zone anchors and markers to screen space for lib/body3d/anchors (art director's call-outs and crosshairs).
 * Runs on the render frame, only while somebody is subscribed; publishes only on change (≥ 0.5 px or visibility).
 * Visibility = surface faces the camera + inside the canvas + not hidden behind another body part (BVH ray to the point).
 */
import * as THREE from 'three';
import { bodyAnchors, type BodyAnchor, type BodyAnchors } from '@/lib/body3d/anchors';
import type { Marker } from '@/lib/body3d/store';
import { ZONE_KEYS, keyToIndex } from '@/lib/body3d/zones';
import type { ModelEntry } from './loader';
import { anchorForZone, zoneAtHit } from './transfer';

const world = new THREE.Vector3(), ndc = new THREE.Vector3(), nrm = new THREE.Vector3(), dir = new THREE.Vector3();
const rWorld = new THREE.Vector3(), rNrm = new THREE.Vector3(), rDir = new THREE.Vector3(), rNdc = new THREE.Vector3();
const ray = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean };
ray.firstHitOnly = true;
let lastSig = '';

interface Args {
  camera: THREE.Camera;
  pivot: THREE.Object3D;
  entry: ModelEntry;
  markers: Marker[];
  mode: NonNullable<BodyAnchors['mode']>;
  zoneIds?: ReadonlySet<string>;
  width: number;
  height: number;
  /** front-view rest pose: camera at its start position, pivot without rotation */
  rest: { camera: THREE.Camera; pivot: THREE.Matrix4 };
}

export function projectAnchors({ camera, pivot, entry, markers, mode, zoneIds, width, height, rest }: Args) {
  if (!bodyAnchors.wanted()) { lastSig = ''; return; }
  pivot.updateMatrixWorld();
  camera.updateMatrixWorld();
  const project = (id: string, zoneId: string, pos: readonly number[], normal: readonly number[], n?: number): BodyAnchor => {
    pivot.localToWorld(world.fromArray(pos));
    nrm.fromArray(normal).transformDirection(pivot.matrixWorld);
    dir.copy(camera.position).sub(world);
    const dist = dir.length();
    dir.divideScalar(dist);
    ndc.copy(world).project(camera);
    let visible = nrm.dot(dir) > 0.05 && ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    if (visible) { // occluded by ANOTHER part of the body (arm in front of the chest…); the anatomy is layered (fascia,
      // tendons a few mm above the anchor), so a hit that still belongs to the same zone does not hide it
      ray.set(camera.position, dir.negate());
      ray.far = dist - 0.005;
      const hit = ray.intersectObjects(entry.meshes, false)[0];
      visible = !hit || zoneAtHit(hit) === keyToIndex(zoneId);
    }
    // rest pose (front view): steady coordinates for the index rows
    rWorld.fromArray(pos).applyMatrix4(rest.pivot);
    rNrm.fromArray(normal).transformDirection(rest.pivot);
    rDir.copy((rest.camera as THREE.PerspectiveCamera).position).sub(rWorld).normalize();
    rNdc.copy(rWorld).project(rest.camera);
    const restVisible = rNrm.dot(rDir) > 0.05 && rNdc.z < 1 && Math.abs(rNdc.x) <= 1 && Math.abs(rNdc.y) <= 1;
    return {
      id, zoneId, ...(n === undefined ? {} : { n }), x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, visible,
      restX: ((rNdc.x + 1) / 2) * width, restY: ((1 - rNdc.y) / 2) * height, restVisible,
    };
  };

  const zones: BodyAnchor[] = [];
  for (const z of entry.present) {
    const key = ZONE_KEYS[z];
    if (!key || (zoneIds && !zoneIds.has(key))) continue;
    const a = anchorForZone(pivot, entry, z);
    if (a) zones.push(project(key, key, a.position, a.normal));
  }
  const marks = markers.filter((m) => m.normal).map((m) => project(m.id, m.zoneId, m.position, m.normal!, m.n));

  const sig = `${mode}|${width}x${height}|` + [...zones, ...marks].map((a) => `${a.id}:${Math.round(a.x * 2)}:${Math.round(a.y * 2)}:${a.visible ? 1 : 0}`).join(',');
  if (sig === lastSig) return;
  lastSig = sig;
  bodyAnchors.publish({ mode, width, height, zones, markers: marks });
}

export function clearAnchors() { lastSig = ''; bodyAnchors.clear(); }
