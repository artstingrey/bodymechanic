/*
 * BodyMechanic 3D spike — zone map (isomorphic: browser <script> and Node import).
 *
 * How a zoneId is obtained (see 3d-spike-report.html, section "Карта зон"):
 *   1. Every vertex of the model gets a zone index, baked offline into the GLB as the
 *      custom vertex attribute _ZONE (uint8). Runtime cost: zero. Raycast hit -> face ->
 *      nearest vertex -> zone index -> zone key (zoneId + side).
 *   2. Classification = mesh group (muscle meshes: torso / arm / leg) + anatomical
 *      landmarks taken from the ligament meshes (wrist, elbow, shoulder, hip, knee)
 *      + front/back relative to the local body mid-plane + side from the sign of X.
 *   3. Non-muscle meshes (bones, ligaments, vessels) copy the zone of the nearest
 *      muscle vertex, so a click on any visible surface gets the same answer as the muscle under it.
 *      Index 0 = outside the zones (the head) — same as the 2D silhouette.
 *      shin (front of the lower leg) became a zone on 2026-11-06 (client decision, README-CONTEXT «СПРАВОЧНИК ЗОН»);
 *      it is APPENDED to ZONES so every older index stays the same (shin_l = 30, shin_r = 31).
 *   4. The same code runs in the browser for un-baked (original) models.
 *
 * Coordinates: model faces +Z, up is +Y. Anatomical LEFT = +X (viewer's right in front view).
 * All rule thresholds are in fractions of body height H, measured from the soles (Y=0).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BMZones = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Единый справочник зон из site/README-CONTEXT.md (одни и те же zoneId в 3D, 2D-силуэте, текстах и мок-данных).
  // tz: 'base' = 9 базовых зон ТЗ, 'extra' = 8 дополнительных (ТЗ 6.4). Парные зоны: суффикс _l / _r = сторона КЛИЕНТА.
  const ZONES = [
    { id: 'neck_collar',     ru: 'Шейно-воротниковый отдел',   en: 'Neck & upper back', paired: false, tz: 'base',  color: '#e6194b' },
    { id: 'shoulder_girdle', ru: 'Плечевой пояс',              en: 'Shoulder girdle',   paired: true,  tz: 'base',  color: '#3cb44b' },
    { id: 'chest',           ru: 'Грудной отдел',              en: 'Chest',             paired: false, tz: 'base',  color: '#ffe119' },
    { id: 'abdomen',         ru: 'Брюшная полость',            en: 'Abdomen',           paired: false, tz: 'base',  color: '#f58231' },
    { id: 'thoracic_spine',  ru: 'Грудной отдел позвоночника', en: 'Thoracic spine',    paired: false, tz: 'extra', color: '#000075' },
    { id: 'lumbar',          ru: 'Поясничный отдел',           en: 'Lower back',        paired: false, tz: 'base',  color: '#911eb4' },
    { id: 'gluteal',         ru: 'Ягодичный отдел',            en: 'Glutes',            paired: true,  tz: 'base',  color: '#46f0f0' },
    { id: 'hip_joint',       ru: 'Тазобедренный сустав',       en: 'Hip joint',         paired: true,  tz: 'extra', color: '#9a6324' },
    { id: 'quadriceps',      ru: 'Передняя поверхность бедра', en: 'Front thigh',       paired: true,  tz: 'extra', color: '#4363d8' },
    { id: 'hamstrings',      ru: 'Задняя поверхность бедра',   en: 'Back of thigh',     paired: true,  tz: 'base',  color: '#f032e6' },
    { id: 'knee',            ru: 'Колено',                     en: 'Knee',              paired: true,  tz: 'extra', color: '#008080' },
    { id: 'calves',          ru: 'Икроножные мышцы',           en: 'Calves',            paired: true,  tz: 'base',  color: '#bcf60c' },
    { id: 'ankle',           ru: 'Голеностоп',                 en: 'Ankle',             paired: true,  tz: 'extra', color: '#ffd8b1' },
    { id: 'foot',            ru: 'Стопа',                      en: 'Foot',              paired: true,  tz: 'base',  color: '#fabebe' },
    { id: 'shoulder_joint',  ru: 'Плечевой сустав',            en: 'Shoulder joint',    paired: true,  tz: 'extra', color: '#800000' },
    { id: 'elbow_forearm',   ru: 'Локоть / предплечье',        en: 'Elbow / forearm',   paired: true,  tz: 'extra', color: '#aaffc3' },
    { id: 'hand',            ru: 'Кисть',                      en: 'Hand',              paired: true,  tz: 'extra', color: '#808000' },
    // added 2026-11-06 (client: runners) — keep LAST: indices of the zones above must not move
    { id: 'shin',            ru: 'Голень (передняя поверхность)', en: 'Shin',           paired: true,  tz: 'extra', color: '#ff6f00' },
  ];

  // Areas of the body outside the zones. Same treatment as the 2D silhouette (site/design/body2d):
  // the upper arm belongs to shoulder_joint; the head is not a zone → index 0 → the site shows body3d.hint.outOfZones.
  const UNZONED = { head: 'голова' };

  // Flat key list. Index 0 = no zone. Paired zones get _l and _r keys.
  const KEYS = [null];
  const KEY_INFO = [null];
  for (const z of ZONES) {
    if (z.paired) {
      for (const side of ['l', 'r']) { KEYS.push(z.id + '_' + side); KEY_INFO.push({ zone: z, side }); }
    } else { KEYS.push(z.id); KEY_INFO.push({ zone: z, side: null }); }
  }
  const KEY_INDEX = Object.fromEntries(KEYS.map((k, i) => [k, i]).filter(([k]) => k));

  // x in model space: the model faces +Z, so the client's LEFT side is +X.
  function keyOf(id, x) {
    if (UNZONED[id]) return 0;
    const z = ZONES.find((q) => q.id === id);
    return z.paired ? KEY_INDEX[id + '_' + (x >= 0 ? 'l' : 'r')] : KEY_INDEX[id];
  }

  function label(index, lang) {
    const info = KEY_INFO[index];
    if (!info) return lang === 'en' ? 'Outside the zones' : 'Вне справочника зон';
    const base = lang === 'en' ? info.zone.en : info.zone.ru;
    if (!info.side) return base;
    if (lang === 'en') return base + (info.side === 'l' ? ', left' : ', right');
    return base + (info.side === 'l' ? ', слева' : ', справа');
  }

  // Which mesh group drives the rules. Muscle meshes are identified by material name
  // (stable in both models); mesh names are NOT usable — every "L_*" mesh holds both sides.
  const MUSCLE_PART = { toroso: 'torso', face: 'torso', arm: 'arm', upleg: 'leg', lowerleg: 'leg' };

  // Fallback landmarks (fractions of H) if the ligament meshes are missing.
  const DEFAULT_LM = { wrist: 0.515, elbow: 0.642, shoulder: 0.793, hip: 0.505, knee: 0.276, clav: 0.827, chin: 0.874 };

  function landmarksFrom(meshes, minY, H) {
    const lm = Object.assign({}, DEFAULT_LM);
    const bb = (name) => {
      const m = meshes.find((q) => q.name === name);
      if (!m) return null;
      let lo = Infinity, hi = -Infinity;
      for (let i = 1; i < m.positions.length; i += 3) { const y = m.positions[i]; if (y < lo) lo = y; if (y > hi) hi = y; }
      return [(lo - minY) / H, (hi - minY) / H];
    };
    const mid = (b) => (b[0] + b[1]) / 2;
    let b;
    if ((b = bb('ligaments_wrist'))) lm.wrist = mid(b);
    if ((b = bb('ligaments_elbow'))) lm.elbow = mid(b);
    if ((b = bb('ligaments_shoulder'))) lm.shoulder = b[0];
    if ((b = bb('ligaments_femur'))) lm.hip = mid(b);
    if ((b = bb('ligaments_knee'))) lm.knee = mid(b);
    if ((b = bb('L_clavicle'))) lm.clav = b[1];
    return lm;
  }

  /**
   * meshes: [{ name, material, positions: Float32Array (xyz, model space, same frame for all meshes) }]
   * returns { zones: [Uint8Array per mesh], meta }
   */
  function classifyScene(meshes) {
    // ---- global frame
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const m of meshes) {
      const p = m.positions;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
    const H = maxY - minY, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const lm = landmarksFrom(meshes, minY, H);
    const N = (p, i, out) => { out.x = (p[i] - cx) / H; out.y = (p[i + 1] - minY) / H; out.z = (p[i + 2] - cz) / H; return out; };

    // ---- local mid-planes (front/back split): per part (torso / leg L / leg R), 100 Y bins
    const BINS = 100;
    const mk = () => ({ lo: new Float32Array(BINS).fill(Infinity), hi: new Float32Array(BINS).fill(-Infinity) });
    const planes = { torso: mk(), legL: mk(), legR: mk() };
    const q = { x: 0, y: 0, z: 0 };
    for (const m of meshes) {
      const part = MUSCLE_PART[m.material];
      if (part !== 'torso' && part !== 'leg') continue;
      const p = m.positions;
      for (let i = 0; i < p.length; i += 3) {
        N(p, i, q);
        const key = part === 'torso' ? 'torso' : (q.x >= 0 ? 'legL' : 'legR');
        const b = Math.max(0, Math.min(BINS - 1, Math.floor(q.y * BINS)));
        const P = planes[key];
        if (q.z < P.lo[b]) P.lo[b] = q.z; if (q.z > P.hi[b]) P.hi[b] = q.z;
      }
    }
    // fill empty bins from neighbours
    for (const P of Object.values(planes)) {
      for (let pass = 0; pass < 2; pass++) for (let b = 0; b < BINS; b++) {
        if (P.lo[b] !== Infinity) continue;
        const nb = [b - 1, b + 1].filter((k) => k >= 0 && k < BINS && P.lo[k] !== Infinity)[0];
        if (nb !== undefined) { P.lo[b] = P.lo[nb]; P.hi[b] = P.hi[nb]; }
      }
    }
    const zmid = (key, y) => { const P = planes[key]; const b = Math.max(0, Math.min(BINS - 1, Math.floor(y * BINS))); return P.lo[b] === Infinity ? 0 : (P.lo[b] + P.hi[b]) / 2; };

    // ---- rules
    const K = keyOf;
    // Same partition logic as the 2D silhouette (site/design/body2d/_src/geom.py):
    //  front: neck_collar above the clavicles, then chest / abdomen / hip_joint (no shoulder girdle in front);
    //  back: neck_collar (incl. upper trapezius), narrow central thoracic_spine strip + lateral shoulder_girdle
    //        down to the chest line, lumbar to the iliac line, gluteal below; hip_joint is a front-only zone.
    const CHEST_LINE = 0.635; // bottom of the pectorals = chest/abdomen (front) and thoracic/lumbar (back) border
    function classifyTorso(v) {
      const ax = Math.abs(v.x), front = v.z >= zmid('torso', v.y);
      if (v.y >= lm.chin + (front ? 0 : 0.012)) return K('head', v.x);
      if (front) {
        if (ax >= 0.088 && v.y >= 0.46 && v.y < 0.555) return K('hip_joint', v.x); // lateral hip, front half
        if (v.y >= lm.clav) return K('neck_collar', v.x);
        if (v.y >= CHEST_LINE) return K('chest', v.x);
        if (v.y >= 0.535) return K('abdomen', v.x);
        return ax >= 0.035 ? K('hip_joint', v.x) : K('abdomen', v.x);
      }
      // back
      if (v.y >= lm.clav - 0.03) return K('neck_collar', v.x);
      if (v.y >= CHEST_LINE) return ax < 0.032 ? K('thoracic_spine', v.x) : K('shoulder_girdle', v.x);
      if (v.y >= 0.535) return K('lumbar', v.x);
      return K('gluteal', v.x);
    }
    function classifyArm(v) {
      if (v.y < lm.wrist - 0.006) return K('hand', v.x);
      if (v.y < lm.elbow + 0.03) return K('elbow_forearm', v.x);
      return K('shoulder_joint', v.x); // the upper arm belongs to shoulder_joint (as in 2D)
    }
    function classifyLeg(v) {
      const ax = Math.abs(v.x);
      const front = v.z >= zmid(v.x >= 0 ? 'legL' : 'legR', v.y);
      const kneeLo = lm.knee - 0.042, kneeHi = lm.knee + 0.042;
      if (v.y >= kneeHi) {
        if (!front && v.y >= 0.455) return K('gluteal', v.x);
        if (front && ax >= 0.088 && v.y >= 0.46) return K('hip_joint', v.x);
        if (front && v.y >= lm.hip - 0.03) return K('hip_joint', v.x);
        return front ? K('quadriceps', v.x) : K('hamstrings', v.x);
      }
      if (v.y >= kneeLo) return K('knee', v.x);
      if (v.y >= 0.085) return front ? K('shin', v.x) : K('calves', v.x); // front of the lower leg = shin (zone since 2026-11-06)
      if (v.y < 0.034) return K('foot', v.x);
      // 0.034..0.085: ankle ring, unless the point is clearly on the dorsum of the foot (well in front of the ankle)
      const zAnkle = zmid(v.x >= 0 ? 'legL' : 'legR', 0.07);
      return v.z > zAnkle + 0.03 ? K('foot', v.x) : K('ankle', v.x);
    }

    // ---- pass 1: muscle meshes by rules
    const zones = meshes.map((m) => new Uint8Array(m.positions.length / 3));
    const grid = new Map(); // spatial hash of classified muscle vertices for pass 2
    const CELL = 0.02;
    const cellKey = (x, y, z) => ((Math.floor(x / CELL) + 512) * 1048576) + ((Math.floor(y / CELL) + 512) * 1024) + (Math.floor(z / CELL) + 512);
    meshes.forEach((m, mi) => {
      const part = MUSCLE_PART[m.material];
      if (!part) return;
      const p = m.positions, out = zones[mi];
      for (let i = 0, vi = 0; i < p.length; i += 3, vi++) {
        N(p, i, q);
        const z = part === 'arm' ? classifyArm(q) : part === 'leg' ? classifyLeg(q) : classifyTorso(q);
        out[vi] = z;
        if ((vi & 3) === 0) { // subsample for the lookup grid
          const k = cellKey(q.x, q.y, q.z);
          let arr = grid.get(k); if (!arr) grid.set(k, (arr = []));
          arr.push(q.x, q.y, q.z, z);
        }
      }
    });

    // ---- pass 2: everything else copies the nearest muscle vertex
    meshes.forEach((m, mi) => {
      if (MUSCLE_PART[m.material]) return;
      const p = m.positions, out = zones[mi];
      for (let i = 0, vi = 0; i < p.length; i += 3, vi++) {
        N(p, i, q);
        const gx = Math.floor(q.x / CELL), gy = Math.floor(q.y / CELL), gz = Math.floor(q.z / CELL);
        let best = Infinity, bz = 0; // bz may legitimately be 0 (unzoned head) → stop on "found", not on "non-zero"
        for (let r = 1; r <= 4 && best === Infinity; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
            const arr = grid.get(((gx + dx + 512) * 1048576) + ((gy + dy + 512) * 1024) + (gz + dz + 512));
            if (!arr) continue;
            for (let j = 0; j < arr.length; j += 4) {
              const ddx = arr[j] - q.x, ddy = arr[j + 1] - q.y, ddz = arr[j + 2] - q.z;
              const d = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d < best) { best = d; bz = arr[j + 3]; }
            }
          }
        }
        out[vi] = bz;
      }
    });

    return { zones, meta: { H, minY, cx, cz, landmarks: lm } };
  }

  // Debug / legend colour per key: zone colour, right side darker.
  function keyColor(index) {
    const info = KEY_INFO[index]; if (!info) return [0, 0, 0];
    const h = info.zone.color; const rgb = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return info.side === 'r' ? rgb.map((v) => v * 0.62) : rgb;
  }

  return { ZONES, UNZONED, KEYS, KEY_INFO, KEY_INDEX, MUSCLE_PART, label, classifyScene, keyOf, keyColor };
});
