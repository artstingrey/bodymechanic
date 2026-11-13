/**
 * Screen-space zone highlight (lead's decision on R-3D-01 F-07, variant «а»): white veil 50 % + 1.5 px outline #26221F
 * (README §12) drawn from a per-pixel mask of the selected zones instead of per-mesh vertex iso-lines.
 *
 *  1. Mask pass: the scene with an override material → render target at ≈ CSS-px resolution. The selection of the vertex
 *     zone (`_zone` → uMask) goes to one of 4 channels by the zone's «colour» (loader: adjacent zones get different
 *     colours). Depth-tested: an arm in front of the chest hides the chest; a zone spanning several meshes is ONE region.
 *  2. Blur pass: disc blur of the 4 channels (centre + 2 rings × 16) → smooth fields (rounds off the triangle steps).
 *     Selection (sum of the channels) is CLOSED first — dilate, then erode, radius 3 CSS px — and blurred on its own:
 *     holes up to ~6 px inside the selection (vessels / nerves in the armpit between chest and shoulder joint, N-06) are
 *     filled instead of getting their own little contours.
 *  3. Composite: selection = the closed, blurred sum. Veil where it is > 0.5; the outline only where it really CROSSES 0.5
 *     within the line width — mask blobs that never reach 0.5 after the blur (stray triangles, 3–5 px «islands»,
 *     R-APP-01 N-05) draw nothing. Inside the selection a thinner divider follows the 0.5 iso-line of each colour channel:
 *     two adjacent SELECTED zones stay two shapes, with the same smoothness as the outer contour.
 *
 * Cost: one extra depth-tested geometry pass at CSS-px resolution + five fullscreen passes, ONLY while a zone is selected on
 * /booking. In the reduced-quality mode (FPS < 30) the Scene skips this and keeps the per-vertex veil without a line.
 */
import * as THREE from 'three';
import { MASK_N } from './overlay';

export type OutlineMode = 'off' | 'screen' | 'veil';

const FULLSCREEN_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function createZoneOutline(uMask: THREE.IUniform<Float32Array>) {
  const uColour = { value: new Float32Array(MASK_N) };
  const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  const maskMaterial = new THREE.ShaderMaterial({
    uniforms: { uMask, uColour },
    vertexShader: /* glsl */ `
      attribute float _zone;
      uniform float uMask[${MASK_N}];
      uniform float uColour[${MASK_N}];
      varying vec4 vSel;
      void main() {
        int z = int(_zone + 0.5);
        float sel = (z > 0 && z < ${MASK_N}) ? uMask[z] : 0.0;
        float c = (z > 0 && z < ${MASK_N}) ? uColour[z] : 0.0;
        vSel = sel * vec4(step(abs(c - 0.0), 0.5), step(abs(c - 1.0), 0.5), step(abs(c - 2.0), 0.5), step(abs(c - 3.0), 0.5));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vSel;
      void main() { gl_FragColor = clamp(vSel, 0.0, 1.0); }`,
    side: THREE.DoubleSide,
  });

  const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false } as const;
  const maskRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: true });
  const fieldRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
  const tmpRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
  const selRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
  const rts = [maskRT, fieldRT, tmpRT, selRT];

  // morphology on the selection (sum of the 4 channels → .r): dilate (max) / erode (min) over a disc, 2 rings × 12
  const morph = (op: 'max' | 'min', sumInput: boolean) => new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null as THREE.Texture | null }, uTexel: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 3 } },
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex; uniform vec2 uTexel; uniform float uRadius;
      varying vec2 vUv;
      float v(vec2 o) { vec4 t = texture2D(uTex, vUv + o * uTexel); return ${sumInput ? 'min(t.r + t.g + t.b + t.a, 1.0)' : 't.r'}; }
      void main() {
        float acc = v(vec2(0.0));
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 0.5235988;
          vec2 d = vec2(cos(a), sin(a)) * uRadius;
          acc = ${op}(acc, ${op}(v(d), v(d * 0.5)));
        }
        gl_FragColor = vec4(acc, 0.0, 0.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const dilate = morph('max', true), erode = morph('min', false);

  const blur = new THREE.ShaderMaterial({
    uniforms: { uMaskTex: { value: maskRT.texture }, uTexel: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 2.5 } }, // N-06: closes slivers ≤ ~5 CSS px (armpits) and rounds the jugular-notch drop
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMaskTex; uniform vec2 uTexel; uniform float uRadius;
      varying vec2 vUv;
      vec4 m(vec2 o) { return texture2D(uMaskTex, vUv + o * uTexel); }
      void main() {
        // centre + 2 rings × 16 taps (dense enough for a 2.5-texel radius: no ring noise on the contour)
        vec4 s = m(vec2(0.0)) * 0.2;
        for (int i = 0; i < 16; i++) {
          float a = float(i) * 0.3926991;
          vec2 d = vec2(cos(a), sin(a)) * uRadius;
          s += m(d) * 0.03125 + m(d * 2.0) * 0.01875;
        }
        gl_FragColor = s;
      }`,
    depthTest: false,
    depthWrite: false,
  });

  const composite = new THREE.ShaderMaterial({
    uniforms: {
      uField: { value: fieldRT.texture },
      uSel: { value: tmpRT.texture }, // closed + blurred selection (.r)
      uScreen: { value: new THREE.Vector2(1, 1) },
      uVeil: { value: new THREE.Color('#ffffff') },
      uVeilAlpha: { value: 0.5 },
      uLine: { value: new THREE.Color(css('--zone-outline', '#26221F')) },
      uLineWidth: { value: 1.5 }, // device px; 1.5 × DPR every frame
    },
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D uField; uniform sampler2D uSel; uniform vec2 uScreen;
      uniform vec3 uVeil; uniform float uVeilAlpha; uniform vec3 uLine; uniform float uLineWidth;
      varying vec2 vUv;
      vec4 F(vec2 uv) { return texture2D(uField, uv); }
      float S(vec2 uv) { return min(texture2D(uSel, uv).r, 1.0); }
      // AA band around the 0.5 iso-line of x, only if x really crosses 0.5 among the neighbours (lo..hi)
      float iso(float x, float lo, float hi, float width) {
        float w = max(fwidth(x), 1e-4);
        return step(lo, 0.5) * step(0.5, hi) * (1.0 - smoothstep(width * 0.5 - 0.5, width * 0.5 + 0.5, abs(x - 0.5) / w));
      }
      void main() {
        vec2 o = (uLineWidth * 0.5 + 1.0) / uScreen;
        vec2 ox = vec2(o.x, 0.0), oy = vec2(0.0, o.y);
        vec4 c = F(vUv), a1 = F(vUv + ox), a2 = F(vUv - ox), a3 = F(vUv + oy), a4 = F(vUv - oy);
        float s = S(vUv), s1 = S(vUv + ox), s2 = S(vUv - ox), s3 = S(vUv + oy), s4 = S(vUv - oy);
        float w = max(fwidth(s), 1e-4);
        float fill = smoothstep(0.5 - w, 0.5 + w, s);
        float line = iso(s, min(min(min(s1, s2), min(s3, s4)), s), max(max(max(s1, s2), max(s3, s4)), s), uLineWidth);
        // dividers between adjacent selected zones: iso-lines of the colour channels, inside the selection only
        vec4 lo = min(min(min(a1, a2), min(a3, a4)), c), hi = max(max(max(a1, a2), max(a3, a4)), c);
        float dw = max(uLineWidth * 0.67, 1.0);
        float div = max(max(iso(c.r, lo.r, hi.r, dw), iso(c.g, lo.g, hi.g, dw)), max(iso(c.b, lo.b, hi.b, dw), iso(c.a, lo.a, hi.a, dw)));
        div *= smoothstep(0.75, 0.9, s) * 0.85;
        float ink = max(line, div);
        float alpha = max(fill * uVeilAlpha, ink);
        if (alpha < 0.01) discard;
        gl_FragColor = linearToOutputTexel(vec4(mix(uVeil, uLine, ink), alpha));
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  // one triangle covering the screen (no diagonal seam)
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(tri, composite);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const size = new THREE.Vector2();
  const clear = new THREE.Color();

  /** Renders the frame: [mask → field] → scene → [composite]. Called from a priority-1 useFrame (R3F stops auto-render). */
  function render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, screen: boolean, dpr: number) {
    if (screen) {
      gl.getDrawingBufferSize(size);
      const k = 1 / Math.max(1, dpr); // mask at ≈ CSS-px resolution
      const w = Math.max(1, Math.round(size.x * k)), h = Math.max(1, Math.round(size.y * k));
      if (maskRT.width !== w || maskRT.height !== h) for (const rt of rts) rt.setSize(w, h);
      const prevOverride = scene.overrideMaterial, prevBg = scene.background, prevAlpha = gl.getClearAlpha();
      gl.getClearColor(clear);
      gl.setClearColor(0x000000, 0);
      // 1) mask
      scene.overrideMaterial = maskMaterial;
      scene.background = null;
      gl.setRenderTarget(maskRT);
      gl.render(scene, camera);
      scene.overrideMaterial = prevOverride;
      scene.background = prevBg;
      // 2) smooth fields: colour channels (dividers) and the CLOSED selection (veil + outline)
      const pass = (m: THREE.ShaderMaterial, from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget, key: string) => {
        m.uniforms[key].value = from.texture; m.uniforms.uTexel.value.set(1 / w, 1 / h);
        quad.material = m; gl.setRenderTarget(to); gl.render(quadScene, quadCam);
      };
      pass(blur, maskRT, fieldRT, 'uMaskTex');
      pass(dilate, maskRT, tmpRT, 'uTex');
      pass(erode, tmpRT, selRT, 'uTex');
      pass(blur, selRT, tmpRT, 'uMaskTex');
      quad.material = composite;
      gl.setRenderTarget(null);
      gl.setClearColor(clear, prevAlpha);
      composite.uniforms.uScreen.value.copy(size);
      composite.uniforms.uLineWidth.value = 1.5 * dpr;
    }
    gl.render(scene, camera);
    if (screen) {
      const auto = gl.autoClear;
      gl.autoClear = false;
      gl.render(quadScene, quadCam);
      gl.autoClear = auto;
    }
  }

  /** per-model zone colours (loader.colourZones) */
  function setColours(c: Float32Array) { uColour.value.set(c.subarray(0, MASK_N)); }

  function dispose() { maskMaterial.dispose(); blur.dispose(); dilate.dispose(); erode.dispose(); composite.dispose(); tri.dispose(); for (const rt of rts) rt.dispose(); }
  return { render, setColours, dispose };
}
