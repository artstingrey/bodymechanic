/**
 * Hero reveal (RC-5, lead: «the lines are drawn before ready»). The home hero shows the 3D model only once the index intro
 * has drawn its dots and lines on the POSTER: a cached model is ready in 0.3–0.6 s, the intro takes 0.7 s, and its lines
 * used to grow on after the swap (Hard Reviewer HM-04: the line ends moved 9–150 px). Failsafe: 1 s after ready the model
 * is shown anyway (an intro that never ran).
 *  - heroIntro: HeroAtlas → done() when its intro ends (played, reduced motion 150 ms, or skipped by a pointer / wheel / key;
 *    idempotent); Body3DSlot → done() when the hero mounts with the model already live (from /booking) — HeroAtlas then
 *    skips its intro (everything in place at once). Body3DSlot (hero mode only) holds the poster over the canvas and
 *    data-status at «loading» until done: data-status turns «ready» on the frame the poster starts to fade (the reveal).
 *  - heroReveal: Body3DSlot → the runtime (Scene): the sway clock runs from the reveal, not from ready — the model waits in
 *    the front pose under the poster (the poster IS the front view), so the dots do not jump at the swap.
 * Module state: one hero per page load; a later visit to the home page (client navigation) finds the intro done.
 * Debug only: ?debug=nointro — done() never fires (e2e: the failsafe).
 */
let introDone = false;
let revealOk = false; // the hero may show the model: one painted frame after the intro is done (or at once, see done())
let shown = false;
const subs = new Set<() => void>();
const blocked = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'nointro';

type RevealProbe = { introDoneAt?: number; readyAt?: number; shownAt?: number; late?: boolean };
// gate probe, read-only (e2e: the delay ready → shown)
const probe = (): RevealProbe => {
  const w = window as unknown as { __bmHeroReveal?: RevealProbe };
  return (w.__bmHeroReveal ??= {});
};

export const heroIntro = {
  /** now: no intro to wait for (the hero mounts with the model live) — the reveal at once, no poster frame in between */
  done(now = false) {
    if (introDone || blocked()) return;
    introDone = true;
    probe().introDoneAt = performance.now();
    const open = () => { revealOk = true; subs.forEach((f) => f()); };
    // the reveal one painted frame later: the poster's last frame shows the intro done (lead, HM-04 (c)) — end() sets
    // data-intro «done» and signals in the same task, the reveal would land in the same frame
    if (now) open(); else requestAnimationFrame(() => requestAnimationFrame(open));
  },
  /** HeroAtlas: the intro has run (or is not needed) */
  isDone: () => introDone,
  /** Body3DSlot: the model may be shown */
  canReveal: () => revealOk,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

export const heroReveal = {
  /** the hero model is on screen (Body3DSlot); the runtime starts its sway clock from here */
  isShown: () => shown,
  ready() { probe().readyAt ??= performance.now(); },
  show(late: boolean) {
    if (shown) return;
    shown = true;
    Object.assign(probe(), { shownAt: performance.now(), late });
  },
};

/** after this long past ready the hero shows the model even without the intro */
export const REVEAL_FAILSAFE_MS = 1000;
