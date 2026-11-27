/**
 * Model loading for the body runtime (ported from the 3D spike, site/3d/viewer.js).
 * GLB: Meshopt geometry + KTX2 textures + baked `_ZONE` vertex attribute + baked prototype material tweak.
 * Module-level cache → a model is fetched and parsed once per page session, whatever route shows it.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import assets from '@/lib/body3d/assets.json';
import zoneColours from '@/lib/body3d/zone-colours.json';
import { createZoneOverlay, MASK_N } from './overlay';
import type { Gender } from '@/lib/body3d/store';
import { isLod1 } from '@/lib/body3d/lod';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Same framing as the prototype: body height in scene units and the group's Y offset. */
export const FRAMING: Record<Gender, { height: number; y: number }> = {
  male: { height: 18.4118 * 0.1, y: 0.43 },
  female: { height: 1.70137 * 1.07, y: 0.48 },
};

export interface ModelEntry {
  gender: Gender;
  url: string;
  root: THREE.Object3D;
  meshes: THREE.Mesh[];
  overlays: THREE.Mesh[];
  present: Set<number>; // zone indices that exist on this model
  posArrays?: Float32Array[]; // root-space vertex positions, computed lazily (marker transfer)
  warm?: boolean;
  bytes: number;
  reduced?: boolean;
  /** zone index → one of 4 «colours», adjacent zones differ (dividers between neighbouring selected zones, N-05) */
  zoneColor: Float32Array;
  /** resolves when every mesh has its BVH (built in short slices after the model is shown) — raycast-heavy work waits */
  bvh: Promise<void>;
  bvhReady: boolean;
}

/**
 * Embedded PNG / JPEG textures — in our models only the ~200-byte «PaletteBaseColor» of PaletteMaterial001–004 (left by
 * gltf-transform's palette step); every other texture is KTX2, which KTX2Loader parses straight from the buffer.
 * GLTFLoader loads such images through a blob: URL — fetch + createImageBitmap (ImageBitmapLoader: Chromium, Safari ≥ 17)
 * or an <img> (TextureLoader: Safari < 17) — and under heavy load WebKit failed that now and then: «THREE.GLTFLoader:
 * Couldn't load texture blob:…», the palette materials lost their colour (RC-2, the mobile:100 flake).
 * Here: decoded straight from the bytes the way GLTFLoader itself would — createImageBitmap with its options ({ premultiplyAlpha:
 * 'none' }) where it picks ImageBitmapLoader, an <img> on our own blob: URL where it picks TextureLoader (Safari < 17) — so
 * the model frame is pixel-identical (RC-3 check: iOS 18 path 0 px, Chrome = its run-to-run noise), one retry, then
 * GLTFLoader's own loader as the fallback; every failure logs its real error.
 * Counters on window.__bmTextures (e2e).
 */
export const textureStats = { decoded: 0, retried: 0, fellBack: 0, failed: 0 };
if (typeof window !== 'undefined') (window as unknown as { __bmTextures?: typeof textureStats }).__bmTextures = textureStats;

class EmbeddedImagePlugin implements GLTFLoaderPlugin {
  readonly name = 'BM_embedded_image';
  constructor(private readonly parser: GLTFParser) {}

  loadTexture(textureIndex: number): Promise<THREE.Texture> | null {
    const parser = this.parser;
    const json = parser.json;
    const td = json.textures[textureIndex];
    if (td.extensions && Object.keys(td.extensions).length) return null; // KTX2 (KHR_texture_basisu), WebP, AVIF: GLTFLoader's own plugins
    const src = json.images?.[td.source];
    if (!src || src.bufferView === undefined || !/^image\/(png|jpeg)$/.test(src.mimeType ?? '')) return null;
    const label = `«${src.name || td.name || `image ${td.source}`}»`;
    const standard = parser.textureLoader as THREE.Loader & { isImageBitmapLoader?: boolean; options?: ImageBitmapOptions };
    const load = (url: string, onLoad: (image: ImageBitmap | HTMLImageElement) => void, _progress: unknown, onError: (e: unknown) => void) => {
      parser.getDependency('bufferView', src.bufferView).then(async (bytes: ArrayBuffer) => {
        const blob = new Blob([bytes], { type: src.mimeType });
        // where GLTFLoader decodes through an <img> (Safari < 17: createImageBitmap ignores options there, and without them
        // the palette came out differently — 217 px, Δ 28 on the model frame), so do we: same pixels, our own blob: URL
        const viaImg = () => new Promise<HTMLImageElement>((resolve, reject) => {
          const u = URL.createObjectURL(blob); const img = new Image();
          img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
          img.onerror = () => { URL.revokeObjectURL(u); reject(new Error(`<img> could not decode ${src.mimeType} (${bytes.byteLength} B)`)); };
          img.src = u;
        });
        const decode = (): Promise<ImageBitmap | HTMLImageElement> => (standard.isImageBitmapLoader ? createImageBitmap(blob, standard.options) : viaImg());
        for (let attempt = 0; attempt < 2; attempt++) {
          let image: ImageBitmap | HTMLImageElement | null = null;
          try { image = await decode(); } catch (e) {
            if (attempt === 0) { textureStats.retried++; console.warn(`[body3d] texture ${label}: decoding failed, one retry —`, e); } else { textureStats.fellBack++; console.warn(`[body3d] texture ${label}: the retry failed too, GLTFLoader's own loader —`, e); }
          }
          if (image) { textureStats.decoded++; onLoad(image); return; }
        }
        // fallback: the standard path on the blob: URL GLTFLoader made (alive until this load settles)
        standard.load(url, (r: unknown) => onLoad((r as THREE.Texture).isTexture ? ((r as THREE.Texture).image as HTMLImageElement) : (r as ImageBitmap)), undefined, (e: unknown) => {
          textureStats.failed++; console.error(`[body3d] texture ${label}: could not be loaded —`, e); onError(e);
        });
      }, onError);
    };
    // isImageBitmapLoader: GLTFLoader wraps what we hand over in a Texture and applies flipY = false, the sampler, the
    // colour space — exactly as for its own loaders
    return parser.loadTextureImage(textureIndex, td.source, { isImageBitmapLoader: true, load } as unknown as THREE.Loader);
  }
}

let ktx2: KTX2Loader | null = null;
let gltfLoader: GLTFLoader | null = null;
const cache = new Map<string, Promise<ModelEntry>>();

export const overlayMaterial = createZoneOverlay();

function loaders(gl: THREE.WebGLRenderer) {
  if (!gltfLoader) {
    ktx2 = new KTX2Loader().setTranscoderPath(assets.transcoderPath).detectSupport(gl);
    gltfLoader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder).register((p) => new EmbeddedImagePlugin(p));
  }
  return { gltf: gltfLoader, ktx2: ktx2! };
}

/** LOD: phones and low-memory devices get LOD1 (lib/body3d/lod — the same rule picks the hero poster's calibration). */
export function modelUrl(gender: Gender): string {
  return assets.models[gender][isLod1() ? 'lod1' : 'lod0'];
}

export function loadModel(gl: THREE.WebGLRenderer, gender: Gender, onProgress?: (f: number) => void, url = modelUrl(gender)): Promise<ModelEntry> {
  const hit = cache.get(url);
  if (hit) return hit;
  const { gltf, ktx2: k } = loaders(gl);
  k.init(); // Basis transcoder (js+wasm) downloads in parallel with the GLB
  const p = gltf.loadAsync(url, (e) => { if (e.total) onProgress?.(e.loaded / e.total); })
    .then((g) => { const e = prepare(gender, url, g.scene, Number(g.parser.json?.asset?.extras?.bytes) || 0); if (reducedQuality) reduceMaterials(e); return e; });
  // the BVH of the model and (only if the precomputed table lacks it) the zone colours are built off the critical path
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

function prepare(gender: Gender, url: string, root: THREE.Object3D, bytes: number): ModelEntry {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = FRAMING[gender].height / size.y; // normalise by height → identical to the prototype framing
  root.scale.setScalar(s);
  root.position.set(-c.x * s, -c.y * s, -c.z * s);
  root.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [], overlays: THREE.Mesh[] = [], present = new Set<number>();
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const m of meshes) {
    const za = m.geometry.getAttribute('_zone');
    const keys = new Set<number>();
    if (za) for (let i = 0; i < za.count; i++) keys.add(za.getX(i));
    keys.forEach((k) => present.add(k));
    const ov = new THREE.Mesh(m.geometry, overlayMaterial);
    ov.raycast = () => {};
    ov.renderOrder = 2;
    ov.visible = false; // drawn only when one of its zones is selected
    ov.userData.keys = keys;
    m.add(ov);
    overlays.push(ov);
  }
  present.delete(0);
  const known = (zoneColours as unknown as Record<string, number[]>)[url.split('/').pop()!];
  const entry: ModelEntry = { gender, url, root, meshes, overlays, present, bytes, zoneColor: new Float32Array(MASK_N), bvh: Promise.resolve(), bvhReady: false };
  if (known) entry.zoneColor.set(known.slice(0, MASK_N));
  entry.bvh = buildBvh(entry).then(() => {
    entry.bvhReady = true;
    // zone-colours.json is regenerated with the models (scripts/zone-colours.mjs); a new model without it computes in idle
    if (!known) idle(() => entry.zoneColor.set(computeZoneColours(entry)));
  });
  return entry;
}

/**
 * Perf (R-FINAL, /booking TBT): the BVH of ~250 small meshes in slices of ≤ 30 ms with a yield between them — no long
 * task. Until it is ready raycasts fall back to the plain three.js raycast (a tap still works).
 */
const idle = (fn: () => void) => ((window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback?.(fn, { timeout: 1500 }) ?? window.setTimeout(fn, 1));
const yieldToMain = () => new Promise<void>((r) => {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) s.yield().then(r); else window.setTimeout(r, 0);
});
async function buildBvh(entry: ModelEntry) {
  await yieldToMain();
  let t0 = performance.now();
  for (const m of entry.meshes) {
    if (!m.geometry.boundsTree) computeBoundsTree.call(m.geometry);
    if (performance.now() - t0 > 30) { await yieldToMain(); t0 = performance.now(); }
  }
}

/** The zone colours of a loaded model (scripts/zone-colours.mjs records them for every model URL). */
export function computeZoneColours(entry: ModelEntry): number[] {
  return Array.from(colourZones(entry.root, entry.meshes));
}

/**
 * Performance fallback (lead, R-3D-01): KHR_materials_ior/specular make GLTFLoader create MeshPhysicalMaterial; on weak GPUs
 * (FPS < 30 in the first 3 s) every loaded and future model switches to MeshStandardMaterial (same maps and factors).
 * Together with DPR ≤ 1.5 (set by the runtime).
 */
let reducedQuality = false;
export function setReducedQuality() {
  if (reducedQuality) return;
  reducedQuality = true;
  for (const p of cache.values()) p.then(reduceMaterials).catch(() => {});
}
function reduceMaterials(entry: ModelEntry) {
  if (entry.reduced) return;
  entry.reduced = true;
  entry.warm = false; // new programs → compile again on warm-up
  for (const m of entry.meshes) {
    const old = m.material as THREE.MeshPhysicalMaterial;
    if (!old || !(old as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) continue;
    const std = new THREE.MeshStandardMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(std, old); // copies only the Standard part (maps, color, roughness, …)
    std.name = old.name;
    m.material = std;
    old.dispose(); // textures are shared with the new material and stay alive
  }
}

/**
 * 4-colouring of the zones for the highlight dividers (N-05). Two zones are neighbours when their vertices share 1.5 cm
 * cells facing the same way (normal bucket — front and back of a thin part are not neighbours); the edge weight is the
 * number of shared cells, so real borders weigh hundreds and chance contacts (hand near the hip) a few. Proximity on a
 * body is not planar, so a perfect 4-colouring may not exist: a seeded min-conflict search minimises the WEIGHT of
 * same-colour neighbours — the rare leftovers fall on weak contacts, where two selected zones simply share a contour.
 */
function colourZones(root: THREE.Object3D, meshes: THREE.Mesh[]): Float32Array {
  const CELL = 0.015;
  const cells = new Map<string, Set<number>>();
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  root.updateMatrixWorld(true);
  for (const m of meshes) {
    const za = m.geometry.getAttribute('_zone'), pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, nor = m.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!za) continue;
    for (let i = 0; i < za.count; i += 2) { // every 2nd vertex is plenty for adjacency
      const z = za.getX(i); if (!z) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (nor) n.fromBufferAttribute(nor, i).transformDirection(m.matrixWorld); else n.set(0, 0, 1);
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const b = ax >= ay && ax >= az ? (n.x > 0 ? 0 : 1) : ay >= az ? (n.y > 0 ? 2 : 3) : (n.z > 0 ? 4 : 5);
      const k = `${Math.floor(v.x / CELL)},${Math.floor(v.y / CELL)},${Math.floor(v.z / CELL)},${b}`;
      let set = cells.get(k); if (!set) cells.set(k, (set = new Set())); set.add(z);
    }
  }
  const W = new Map<number, Map<number, number>>();
  const link = (a: number, b: number) => { let m = W.get(a); if (!m) W.set(a, (m = new Map())); m.set(b, (m.get(b) ?? 0) + 1); };
  for (const [k, set] of cells) {
    const [x, y, z, b] = k.split(',').map(Number);
    const near = new Set(set);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) cells.get(`${x + dx},${y + dy},${z + dz},${b}`)?.forEach((q) => near.add(q));
    for (const a of set) for (const q of near) if (a !== q) { link(a, q); link(q, a); }
  }
  const nodes = [...W.keys()];
  let seed = 1234567; // deterministic → the same colours on every load
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const conflict = (c: Map<number, number>) => { let t = 0; for (const [a, m] of W) for (const [b, w] of m) if (a < b && c.get(a) === c.get(b)) t += w; return t; };
  let best = new Map<number, number>(), bestCost = Infinity;
  for (let run = 0; run < 200 && bestCost > 0; run++) {
    const c = new Map<number, number>(nodes.map((q) => [q, Math.floor(rnd() * 4)]));
    for (let it = 0; it < 40; it++) {
      let changed = false;
      for (const a of nodes) {
        const sum = [0, 0, 0, 0];
        for (const [b, w] of W.get(a)!) sum[c.get(b)!] += w;
        const pick = sum.indexOf(Math.min(...sum));
        if (sum[pick] < sum[c.get(a)!]) { c.set(a, pick); changed = true; }
      }
      if (!changed) break;
    }
    const k = conflict(c);
    if (k < bestCost) { bestCost = k; best = c; }
  }
  const colour = new Float32Array(MASK_N);
  for (const [z, c] of best) colour[z] = c;
  return colour;
}

/** Idle warm-up of a prefetched model: upload textures and compile shaders, so the switch has no hitch (spike §7). */
export async function warmUp(gl: THREE.WebGLRenderer, entry: ModelEntry, camera: THREE.Camera, scene: THREE.Scene) {
  if (entry.warm) return;
  entry.root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (mat) for (const t of [mat.map, mat.normalMap]) if (t) gl.initTexture(t);
  });
  await gl.compileAsync(entry.root, camera, scene);
  entry.warm = true;
}

/** Root-space positions of every mesh (for marker transfer between models). */
export function positions(entry: ModelEntry): Float32Array[] {
  if (entry.posArrays) return entry.posArrays;
  const rel = new THREE.Matrix4(), v = new THREE.Vector3();
  entry.posArrays = entry.meshes.map((m) => {
    rel.copy(entry.root.matrixWorld).invert().multiply(m.matrixWorld);
    const a = m.geometry.getAttribute('position') as THREE.BufferAttribute, out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(rel); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
    return out;
  });
  return entry.posArrays;
}
