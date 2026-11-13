/**
 * Per-vertex zone veil — the REDUCED-quality highlight (FPS < 30): white veil 50 % on the model surface, no outline
 * (lead's decision on F-07). The normal path is the screen-space veil + outline in zoneOutline.ts, which shares uMask.
 * Selection is evaluated per vertex (`_zone` → uMask) and interpolated; the edge is the vSel = 0.5 iso-line (fwidth AA).
 */
import * as THREE from 'three';
import { ZONE_COUNT } from '@/lib/body3d/zones';

export const MASK_N = 48; // ≥ ZONE_COUNT (30)

export function createZoneOverlay() {
  if (ZONE_COUNT > MASK_N) throw new Error('zone mask too small');
  return new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: new Float32Array(MASK_N) },
      uVeil: { value: new THREE.Color('#ffffff') },
      uVeilAlpha: { value: 0.5 },
    },
    vertexShader: /* glsl */ `
      attribute float _zone;
      uniform float uMask[${MASK_N}];
      varying float vSel;
      void main() {
        int z = int(_zone + 0.5);
        vSel = (z > 0 && z < ${MASK_N}) ? uMask[z] : 0.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uVeil; uniform float uVeilAlpha;
      varying float vSel;
      void main() {
        float w = max(fwidth(vSel), 1e-4);
        float a = smoothstep(0.5 - w, 0.5 + w, vSel) * uVeilAlpha;
        if (a < 0.01) discard;
        gl_FragColor = linearToOutputTexel(vec4(uVeil, a));
      }`,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
}
