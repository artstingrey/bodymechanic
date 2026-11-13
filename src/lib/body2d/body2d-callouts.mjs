/**
 * body2d-callouts.mjs
 * 2D body silhouette (style A "atlas"): numbered markers, callouts with leader lines, crosshair.
 * Dependency-free ES module. The only DOM it touches is the <svg class="b2d"> element you pass in
 * (it uses svg.ownerDocument, never window / document globals), so it works in any framework.
 *
 * Callout modes (decided by `mode: 'auto'` from the real size of the <svg> box, never from the viewport):
 *   full     "01  Zone name" in two label columns, figure scale >= 0.70 (stage from ~530 px)
 *   compact  short leader + only "01" at the edge, figure scale >= 0.55 (laptops, narrow stage); not used when allowCompact === false
 *   none     markers only (phones: pass allowCompact:false), viewBox "0 0 400 890"
 * Guarantees in full and compact mode: no leader comes closer than 16.5 css px to the centre of a foreign marker, labels never
 * run past the drawing box (measured text, viewBox widened to fit; otherwise the callouts are dropped), no label overlaps a marker
 * or another label.
 *
 * See README.md next to this file.
 */

const NS = "http://www.w3.org/2000/svg";

/** drawing height in viewBox units, the narrow ("none") viewBox is 0 0 400 FH */
export const FH = 890;
export const NARROW_VIEWBOX = `0 0 400 ${FH}`;
const LH = 16;          // label line height, css px
const RIMR = 14.5;      // marker outer radius, css px (disc 10 + ring 3 + outline)
const MAXLINE = 104;    // longest label line, css px
const MIN_DRAW_SCALE = 0.35; // forced 'full' / 'compact' still give up below this figure scale (box far too small)
const NUMGAP = 7;       // gap between "01" and the label text, css px
const CFG = {
  full:    { fx0: 38, fx1: 362, gap: 16, pad: 6, lead: 6, minScale: 0.70 },
  compact: { fx0: 46, fx1: 354, gap: 11, pad: 4, lead: 5, minScale: 0.55 },
};
export const DEFAULTS = { mode: "auto", allowCompact: true, locale: "en", names: null, guard: true };

// ------------------------------------------------------------------------------------------------------------------
// small DOM helpers
// ------------------------------------------------------------------------------------------------------------------
function el(doc, name, attrs, parent) {
  const e = doc.createElementNS(NS, name);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function drop(svg, selector) { svg.querySelectorAll(selector).forEach((n) => n.remove()); }
function zoneEl(svg, id) { return svg.querySelector('.b2d-zone[data-zone-id="' + id + '"]'); }

/** css px per viewBox unit (the SVG scales uniformly, "meet") */
export function figureScale(svg) {
  const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  if (!vb || !vb.width || !vb.height) return 1;
  return Math.min(r.width / vb.width, r.height / vb.height) || 1;
}

// ------------------------------------------------------------------------------------------------------------------
// text measurement and label metrics (cached per names-object or svg, and per locale)
// ------------------------------------------------------------------------------------------------------------------
const caches = new WeakMap();
let epoch = 0;          // bumped by clearCache(): every cached label metric becomes stale

function measurer(svg) {
  const doc = svg.ownerDocument;
  const g = el(doc, "g", { class: "b2d-measure", "aria-hidden": "true", opacity: "0" }, svg);
  return {
    width(str, cls) {
      const t = el(doc, "text", cls ? { class: cls } : null, g);
      t.textContent = str;
      const len = t.getComputedTextLength();
      g.removeChild(t);
      return len;
    },
    done() { svg.removeChild(g); },
  };
}

/** "Шейно-воротниковый отдел" -> ["Шейно-", "воротниковый", "отдел"] ; wraps by words and after hyphens, line <= MAXLINE px */
function wrapLabel(label, m) {
  const toks = [];
  label.split(" ").forEach((word, wi) => {
    (word.match(/[^-]+-?|-/g) || [word]).forEach((part, pi) => toks.push({ s: part, space: wi > 0 && pi === 0 }));
  });
  const lines = [];
  let cur = "";
  toks.forEach((k) => {
    const t = cur ? cur + (k.space ? " " : "") + k.s : k.s;
    if (cur && m.width(t) > MAXLINE) { lines.push(cur); cur = k.s; } else cur = t;
  });
  if (cur) lines.push(cur);
  return lines;
}

function labelOf(svg, id, names, locale) {
  if (names && names[id] != null) return String(names[id]);
  const z = zoneEl(svg, id);
  const fromSvg = z && (z.dataset[locale === "ru" ? "nameRu" : "nameEn"] || z.getAttribute("aria-label"));
  return fromSvg || id;
}

function metricsFor(svg, o) {
  const holder = o.names || svg;
  let byLocale = caches.get(holder);
  if (!byLocale) { byLocale = new Map(); caches.set(holder, byLocale); }
  const key = (o.locale || "") + "#" + epoch;
  let M = byLocale.get(key);
  if (M) return M;
  const ids = o.names ? Object.keys(o.names) : [...svg.querySelectorAll(".b2d-zone")].map((z) => z.dataset.zoneId);
  const m = measurer(svg);
  const lines = {};
  let textW = 0;
  const numW = m.width("00", "num");
  ids.forEach((id) => {
    const ls = wrapLabel(labelOf(svg, id, o.names, o.locale), m);
    lines[id] = ls;
    ls.forEach((s) => { textW = Math.max(textW, m.width(s)); });
  });
  m.done();
  const block = numW + NUMGAP;                       // "01" + gap, the indent of continuation lines
  M = {
    lines, numW, block, textW,
    need: {                                          // css px needed on each side of the figure region
      full: CFG.full.gap + block + textW + CFG.full.pad,
      compact: CFG.compact.gap + numW + CFG.compact.pad,
    },
  };
  byLocale.set(key, M);
  return M;
}

/** Forget all measured label widths. Call after web fonts finish loading (document.fonts.ready) or when the label strings change. */
export function clearCache() { epoch++; }

// ------------------------------------------------------------------------------------------------------------------
// view: mode + viewBox
// ------------------------------------------------------------------------------------------------------------------
function scaleFor(mode, W, H, M) {
  const c = CFG[mode];
  return Math.min(H / FH, (W - 2 * M.need[mode]) / (c.fx1 - c.fx0));
}

/**
 * Chooses the mode, sets viewBox and svg.dataset.callouts ('full' | 'compact' | 'none').
 * Returns { mode, scale, viewBox: {x, y, w, h} }.
 */
export function applyView(svg, options) {
  const o = { ...DEFAULTS, ...options };
  const r = svg.getBoundingClientRect(), W = r.width, H = r.height;
  let mode = "none", sc = 1, M = null;
  if (W > 0 && H > 0 && o.mode !== "none") {
    M = metricsFor(svg, o);
    const sf = scaleFor("full", W, H, M), sc2 = scaleFor("compact", W, H, M);
    if (o.mode === "full") mode = "full";
    else if (o.mode === "compact") mode = "compact";
    else if (sf >= CFG.full.minScale) mode = "full";
    else if (o.allowCompact !== false && sc2 >= CFG.compact.minScale) mode = "compact";
    if (mode !== "none") {
      sc = mode === "full" ? sf : sc2;
      if (sc < MIN_DRAW_SCALE) mode = "none";
    }
  }
  let vb = { x: 0, y: 0, w: 400, h: FH };
  if (mode !== "none") {
    const c = CFG[mode], w = W / sc;
    vb = { x: (c.fx0 + c.fx1) / 2 - w / 2, y: 0, w, h: FH };
  } else sc = Math.min(W / 400, H / FH) || 1;
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svg.dataset.callouts = mode;
  return { mode, scale: sc, viewBox: vb, metrics: M };
}

// ------------------------------------------------------------------------------------------------------------------
// leader routing
// ------------------------------------------------------------------------------------------------------------------
function segDist(a, b, c) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((c.x - a.x) * dx + (c.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y);
}
/** bad = foreign markers closer than R to the leader (hard rule); soft = comfort penalty below 28 px */
function polyScore(P, circles, R) {
  let n = 0, soft = 0;
  circles.forEach((c) => {
    let dm = 1e9;
    for (let i = 1; i < P.length; i++) dm = Math.min(dm, segDist(P[i - 1], P[i], c));
    if (dm < R) n++; else if (dm < 28) soft += (28 - dm) * 5;
  });
  return { n, soft };
}
function polyLen(P) { let l = 0; for (let i = 1; i < P.length; i++) l += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); return l; }
function segCross(a, b, c, e) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, e) < 0 && o(c, e, a) * o(c, e, b) < 0;
}
function polyCross(P, Q) {
  for (let i = 1; i < P.length; i++) for (let j = 1; j < Q.length; j++) if (segCross(P[i - 1], P[i], Q[j - 1], Q[j])) return true;
  return false;
}

/** candidate leaders from marker m to the label slot (E, ly): H = horizontal then short slant, D = slant then horizontal, S = straight */
function bestLeader(m, sd, E, ly, others, clear) {
  const rim = (tx, ty) => { const dx = tx - m.x, dy = ty - m.y, l = Math.hypot(dx, dy) || 1; return { x: m.x + dx / l * RIMR, y: m.y + dy / l * RIMR }; };
  const end = { x: E, y: ly }, cands = [], ks = [20, 32, 48, 70, 100];
  const add = (P, shape) => {
    let slope = 0;
    for (let i = 1; i < P.length; i++) {
      const dx = Math.abs(P[i].x - P[i - 1].x), dy = Math.abs(P[i].y - P[i - 1].y);
      if (dy > 0.5) slope = Math.max(slope, dy / Math.max(dx, 1));
    }
    const s = polyScore(P, others, clear);
    cands.push({ pts: P, bad: s.n, cost: polyLen(P) + shape + (slope > 1.2 ? (slope - 1.2) * 20 : 0) + s.n * 5000 + s.soft });
  };
  if (sd * (E - m.x) > RIMR + 1.5) {
    if (Math.abs(ly - m.y) < 0.6) add([rim(E, ly), end], 0);
    else {
      ks.forEach((k) => {
        const ex = E - sd * k;
        if (sd * (ex - m.x) < RIMR + 8) return;
        add([rim(ex, m.y), { x: ex, y: m.y }, end], 0);
        add([rim(ex, ly), { x: ex, y: ly }, end], 12);
      });
      add([rim(E, ly), end], 24);
    }
  }
  if (!cands.length) add([rim(E, ly), end], 40);
  cands.sort((p, q) => p.cost - q.cost);
  return cands[0];
}

/** best label slots for one column in the GIVEN order: dynamic programming over slots (no overlap between labels) */
function planOrder(grp, sd, geo, memo, all, clear, tag) {
  const n = grp.length;
  if (!n) return { cost: 0, bad: 0, out: [] };
  const E = sd === "R" ? geo.xR - geo.lead : geo.xL + geo.lead, step = 8, ns = Math.floor(geo.H / step) + 1, INF = 1e18;
  const cc = [], dp = [], bk = [];
  for (let i = 0; i < n; i++) {
    cc.push([]);
    const m = grp[i], h = m.h;
    for (let s = 0; s < ns; s++) {
      const ly = s * step;
      let v = null;
      if (ly - h / 2 >= 4 && ly + h / 2 <= geo.H - 4 && Math.abs(ly - m.y) <= 230) {
        const key = tag + m.id + sd + s;
        v = memo[key];
        if (!v) {
          v = bestLeader(m, sd === "R" ? 1 : -1, E, ly, all.filter((q) => q.id !== m.id), clear);
          v.cost += 0.5 * Math.abs(ly - m.y);
          memo[key] = v;
        }
      }
      cc[i].push(v);
    }
  }
  for (let i = 0; i < n; i++) {
    dp.push(new Array(ns).fill(INF));
    bk.push(new Array(ns).fill(-1));
    if (i === 0) { for (let s = 0; s < ns; s++) if (cc[0][s]) dp[0][s] = cc[0][s].cost; continue; }
    const sep = Math.ceil(((grp[i].h + grp[i - 1].h) / 2 + 10) / step);
    let best = INF, arg = -1;
    for (let s = 0; s < ns; s++) {
      const sp = s - sep;
      if (sp >= 0 && dp[i - 1][sp] < best) { best = dp[i - 1][sp]; arg = sp; }
      if (cc[i][s] && best < INF) { dp[i][s] = best + cc[i][s].cost; bk[i][s] = arg; }
    }
  }
  let bs = -1, bv = INF;
  for (let s = 0; s < ns; s++) if (dp[n - 1][s] < bv) { bv = dp[n - 1][s]; bs = s; }
  if (bs < 0) return { cost: INF, bad: 99, out: [] };
  const out = [];
  let s = bs, bad = 0;
  for (let i = n - 1; i >= 0; i--) {
    const v = cc[i][s];
    bad += v.bad;
    out.unshift({ m: grp[i], side: sd, ly: s * step, pts: v.pts });
    s = bk[i][s];
  }
  return { cost: bv, bad, out };
}

function countCross(items) {
  let x = 0;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (polyCross(items[i].pts, items[j].pts)) x++;
  return x;
}

/** label order of one column: by marker y, plus variants that swap neighbours whose markers sit at nearly the same height
 *  (two markers on one level can only be separated without crossing leaders if the farther one may take the outer slot) */
function planColumn(grp, sd, geo, memo, all, clear, tag) {
  const base = grp.slice().sort((a, b) => a.y - b.y || a.x - b.x), orders = [base], close = [];
  for (let i = 0; i + 1 < base.length; i++) if (Math.abs(base[i + 1].y - base[i].y) < 48) close.push(i);
  const swap = (ord, i) => { const c = ord.slice(); const t = c[i]; c[i] = c[i + 1]; c[i + 1] = t; return c; };
  close.forEach((i) => orders.push(swap(base, i)));
  for (let a = 0; a < close.length && orders.length < 24; a++)
    for (let b = a + 1; b < close.length && orders.length < 24; b++) if (close[b] > close[a] + 1) orders.push(swap(swap(base, close[a]), close[b]));
  let best = null;
  orders.forEach((ord, k) => {
    const r = planOrder(ord, sd, geo, memo, all, clear, tag);
    r.pen = r.cost + countCross(r.out) * 600;
    if (!best || r.pen < best.pen) best = r;
  });
  return best;
}

function planSides(mk, side, geo, memo, clear, tag) {
  let items = [], cost = 0, bad = 0;
  ["L", "R"].forEach((sd) => {
    const grp = mk.filter((m, i) => side[i] === sd);
    const r = planColumn(grp, sd, geo, memo, mk, clear, tag);
    cost += r.cost; bad += r.bad; items = items.concat(r.out);
  });
  const cross = countCross(items);
  const nl = items.filter((o) => o.side === "L").length;
  return { items, bad, cross, score: cost + cross * 600 + Math.abs(items.length - 2 * nl) * 5 };
}

function planCallouts(mk, geo) {
  let best = null;
  const tiers = [24, 21, 18, 16.5];
  const perfect = () => best && best.bad === 0 && best.cross === 0;
  for (let pass = 0; pass < 2 && !perfect(); pass++) {
    const ambiguous = pass ? 1e9 : 46, amb = [];
    mk.forEach((m, i) => { m.nat = m.x < geo.mid ? "L" : "R"; if (Math.abs(m.x - geo.mid) < ambiguous) amb.push(i); });
    amb.sort((a, b) => Math.abs(mk[a].x - geo.mid) - Math.abs(mk[b].x - geo.mid));
    const flip = amb.slice(0, pass ? 10 : 8);
    for (let ti = 0; ti < tiers.length && !perfect(); ti++) {
      const memo = {};
      for (let mask = 0; mask < (1 << flip.length); mask++) {
        const side = mk.map((m) => m.nat);
        flip.forEach((i, b) => { if ((mask >> b) & 1) side[i] = side[i] === "L" ? "R" : "L"; });
        const r = planSides(mk, side, geo, memo, tiers[ti], pass + "-" + ti + "-");
        r.score += r.bad * 5000;
        if (!best || r.score < best.score) best = r;
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------------------------
// public API
// ------------------------------------------------------------------------------------------------------------------
/**
 * Sets the view and draws the callouts for `selected` (zone ids in selection order; number = index + 1).
 * options: { mode: 'auto'|'full'|'compact'|'none', allowCompact: true, locale: 'ru'|'en', names: {zoneId: label}, guard: true }
 * Returns { mode, scale, viewBox, items: [{id, n, side, y, points, lines}], collisions: {markers, leaders}, clipped, dropped? }.
 * `dropped` ('no-room' | 'clipped') is set when the callouts could not be drawn without breaking a rule: the view then falls back to 'none'.
 */
export function layout(svg, selected, options) {
  const o = { ...DEFAULTS, ...options };
  const view = applyView(svg, o);
  drop(svg, ".b2d-callouts");
  const res = { mode: view.mode, scale: view.scale, viewBox: view.viewBox, items: [], collisions: { markers: 0, leaders: 0 }, clipped: false };
  if (view.mode === "none" || !selected || !selected.length) return res;

  const doc = svg.ownerDocument, M = view.metrics, cfg = CFG[view.mode], sc = view.scale, vb = view.viewBox;
  const mk = [];
  selected.forEach((id, i) => {
    const z = zoneEl(svg, id);
    if (!z) return;
    const lines = M.lines[id] || (M.lines[id] = linesFor(svg, labelOf(svg, id, o.names, o.locale)));
    mk.push({ n: i + 1, id, x: (+z.dataset.cx - vb.x) * sc, y: +z.dataset.cy * sc, h: view.mode === "full" ? lines.length * LH : LH, lines });
  });
  if (!mk.length) return res;
  const geo = { xL: (cfg.fx0 - vb.x) * sc - cfg.gap, xR: (cfg.fx1 - vb.x) * sc + cfg.gap, H: FH * sc, mid: ((cfg.fx0 + cfg.fx1) / 2 - vb.x) * sc, lead: cfg.lead };
  const plan = planCallouts(mk, geo);
  if (!plan || plan.bad >= 99) return giveUp(svg, o, res, "no-room");     // labels cannot be stacked in this box
  res.collisions = { markers: plan.bad, leaders: plan.cross };

  // the group lives in css px: translate to the viewBox origin and counter-scale
  const g = el(doc, "g", { class: "b2d-callouts", "aria-hidden": "true", transform: `translate(${vb.x},0) scale(${1 / sc})` });
  svg.insertBefore(g, svg.querySelector(".b2d-badges"));
  plan.items.sort((a, b) => a.m.n - b.m.n).forEach((a) => {
    const c = el(doc, "g", { class: "b2d-callout", "data-zone-id": a.m.id }, g), right = a.side === "R";
    const points = a.pts.map((q) => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 }));
    el(doc, "polyline", { class: "lead", points: points.map((q) => q.x + "," + q.y).join(" ") }, c);
    const tg = el(doc, "g", { transform: `translate(${right ? geo.xR : geo.xL},${a.ly})` }, c);
    const tx = el(doc, "text", { "text-anchor": right ? "start" : "end", "dominant-baseline": "middle" }, tg);
    const numStr = (a.m.n < 10 ? "0" : "") + a.m.n;
    if (view.mode === "compact") {
      const ts = el(doc, "tspan", { x: 0, dy: 0 }, tx);
      el(doc, "tspan", { class: "num" }, ts).textContent = numStr;
    } else {
      a.m.lines.forEach((ln, k) => {
        const ts = el(doc, "tspan", { x: right && k > 0 ? M.block : 0, dy: k === 0 ? -(a.m.lines.length - 1) * LH / 2 : LH }, tx);
        if (k === 0) {
          el(doc, "tspan", { class: "num" }, ts).textContent = numStr;
          el(doc, "tspan", { dx: NUMGAP }, ts).textContent = ln;
        } else ts.textContent = ln;
      });
    }
    res.items.push({ id: a.m.id, n: a.m.n, side: a.side, y: a.ly, points, lines: view.mode === "full" ? a.m.lines.slice() : [] });
  });

  // last line of defence: if any text still leaves the drawing box (font not ready, odd zoom) drop the callouts instead of clipping them
  if (o.guard) {
    const sr = svg.getBoundingClientRect();
    let bad = false;
    g.querySelectorAll("text").forEach((t) => {
      const q = t.getBoundingClientRect();
      if (q.left < sr.left - 0.5 || q.right > sr.right + 0.5 || q.top < sr.top - 0.5 || q.bottom > sr.bottom + 0.5) bad = true;
    });
    if (bad) { res.clipped = true; return giveUp(svg, o, res, "clipped"); }
  }
  return res;
}
/** callouts cannot be drawn without breaking a rule: remove them and go back to the plain markers-only view */
function giveUp(svg, o, res, reason) {
  drop(svg, ".b2d-callouts");
  const v = applyView(svg, { ...o, mode: "none" });
  res.mode = "none"; res.scale = v.scale; res.viewBox = v.viewBox; res.items = []; res.dropped = reason;
  res.collisions = { markers: 0, leaders: 0 };
  return res;
}
function linesFor(svg, label) {
  const m = measurer(svg);
  const ls = wrapLabel(label, m);
  m.done();
  return ls;
}

/**
 * Draws the numbered markers and the selection outlines (layers .b2d-badges and .b2d-sel-layer).
 * options: { justAdded: zoneId } plays the pop-in animation for that marker only.
 */
export function drawMarkers(svg, selected, options) {
  const doc = svg.ownerDocument, sc = figureScale(svg), justAdded = options && options.justAdded;
  const badges = svg.querySelector(".b2d-badges"), outlines = svg.querySelector(".b2d-sel-layer");
  if (badges) badges.textContent = "";
  if (outlines) outlines.textContent = "";
  (selected || []).forEach((id, i) => {
    const z = zoneEl(svg, id);
    if (!z) return;
    if (outlines) el(doc, "path", { class: "b2d-sel-outline", d: z.getAttribute("d") }, outlines);
    if (!badges) return;
    const g = el(doc, "g", { class: "b2d-badge", "data-px": z.dataset.cx + "," + z.dataset.cy, transform: `translate(${z.dataset.cx},${z.dataset.cy}) scale(${1 / sc})` }, badges);
    const gi = el(doc, "g", { class: "b2d-badge-in" + (id === justAdded ? " is-new" : "") }, g);
    [["b2d-b-outline", 14.5], ["b2d-b-ring", 12.5], ["b2d-b-disk", 10]].forEach((c) => el(doc, "circle", { class: c[0], r: c[1] }, gi));
    el(doc, "text", null, gi).textContent = String(i + 1);
  });
}

/**
 * Atlas crosshair at the anchor of a zone (hover / keyboard focus). Never drawn on a selected zone: it would cover the marker digit.
 * Returns true when a crosshair is on screen. Pass zoneId = null to remove it.
 */
export function crosshair(svg, zoneId, selected) {
  drop(svg, ".b2d-cross");
  if (!zoneId || (selected && selected.indexOf(zoneId) > -1)) return false;
  const z = zoneEl(svg, zoneId);
  if (!z) return false;
  const doc = svg.ownerDocument, sc = figureScale(svg);
  const g = el(doc, "g", { class: "b2d-cross", "aria-hidden": "true", transform: `translate(${z.dataset.cx},${z.dataset.cy}) scale(${1 / sc})` }, svg);
  [[-14, 0, -5, 0], [5, 0, 14, 0], [0, -14, 0, -5], [0, 5, 0, 14]].forEach((l) => el(doc, "line", { x1: l[0], y1: l[1], x2: l[2], y2: l[3] }, g));
  el(doc, "circle", { r: 2.5 }, g);
  return true;
}

/** Removes everything this module added to the svg and restores the narrow viewBox. Call it when the component unmounts. */
export function destroy(svg) {
  drop(svg, ".b2d-callouts, .b2d-cross, .b2d-measure");
  caches.delete(svg);
  delete svg.dataset.callouts;
  svg.setAttribute("viewBox", NARROW_VIEWBOX);
}
