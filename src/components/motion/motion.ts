/**
 * The Body Mechanic · motion system (site/design/hifi/motion-spec.html, MO-03 final). One library: GSAP.
 * Bounds (README п.15): appearances 300–500 ms, shift 12–24 px, transform/opacity/clip-path only, no blur on text,
 * no layout animation, no parallax inside masks, sequences ≤ 1.2 s and interruptible, reduced motion = 120 ms fades.
 * This module is a lazy chunk (loadMotion() in ./tokens): GSAP never ships in the first-screen bundle (R-CODE-01 F-04).
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { CustomEase } from 'gsap/CustomEase';

let registered = false;
export function registerMotion() {
  if (registered || typeof window === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase);
  // easing tokens (tokens.css --e-*)
  CustomEase.create('bm-out', '.22,1,.36,1');
  CustomEase.create('bm-in', '.55,0,.75,.2');
  CustomEase.create('bm-io', '.65,0,.35,1');
  CustomEase.create('bm-overshoot', '.34,1.56,.64,1');
  gsap.defaults({ ease: 'bm-out', duration: 0.4 });
  registered = true;
}

import { DUR, EASE, MQ, STAGGER } from './tokens';
export { gsap };

/**
 * Scroll reveals for the current page. Markup contract (art director owns the attributes in page sections):
 *  - data-reveal            block: Y 16 px + opacity, 400 ms, 40 ms stagger per batch (motion-spec «Блоки и карточки»)
 *  - data-reveal="clip"     photo frame: clip-path inset 8% → 0, 500 ms; the photo inside never moves (motion-spec «Фото-блоки»)
 *  - data-split             H1/H2: SplitText lines with mask, Y 20 px + opacity, 400 ms, 60 ms step; reverted after (aria: auto)
 * Only elements below the first screen get a hidden start state — no flash on load, and without JS everything is visible.
 * Returns a cleanup (gsap.matchMedia revert) for route changes.
 */
export function mountReveals(root: ParentNode = document): () => void {
  // Automation (Playwright gate, reviewer screenshots) captures full pages without scrolling: never hide content there.
  if (typeof navigator !== 'undefined' && navigator.webdriver) return () => {};
  registerMotion();
  // printing (step 7 «PDF заявки» = print) must show everything that has not been revealed yet
  const showAll = () => gsap.set(root.querySelectorAll('[data-reveal], [data-split]'), { clearProps: 'opacity,transform,clipPath' });
  window.addEventListener('beforeprint', showAll);
  const mm = gsap.matchMedia();
  mm.add({ full: MQ.full, reduce: MQ.reduce }, (ctx) => {
    const reduce = !!ctx.conditions?.reduce;
    const fold = window.innerHeight * 0.92;
    const below = (el: Element) => el.getBoundingClientRect().top > fold;

    const blocks = gsap.utils.toArray<HTMLElement>(root.querySelectorAll('[data-reveal]:not([data-reveal="clip"])')).filter(below);
    if (blocks.length) {
      gsap.set(blocks, reduce ? { opacity: 0 } : { opacity: 0, y: 16 });
      ScrollTrigger.batch(blocks, {
        start: 'top 88%', once: true,
        onEnter: (els) => gsap.to(els, reduce
          ? { opacity: 1, duration: DUR.reduced, ease: 'none', overwrite: true }
          : { opacity: 1, y: 0, duration: DUR.d2, ease: EASE.out, stagger: STAGGER, overwrite: true, clearProps: 'transform' }),
      });
    }

    const frames = gsap.utils.toArray<HTMLElement>(root.querySelectorAll('[data-reveal="clip"]')).filter(below);
    if (frames.length && !reduce) {
      gsap.set(frames, { clipPath: 'inset(8% 8% 8% 8% round var(--r-photo))' });
      ScrollTrigger.batch(frames, {
        start: 'top 85%', once: true,
        onEnter: (els) => gsap.to(els, { clipPath: 'inset(0% 0% 0% 0% round var(--r-photo))', duration: DUR.d3, ease: EASE.out, stagger: STAGGER * 2, overwrite: true, clearProps: 'clipPath' }),
      });
    }

    const heads = gsap.utils.toArray<HTMLElement>(root.querySelectorAll('[data-split]')).filter(below);
    heads.forEach((el) => {
      if (reduce) {
        gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: DUR.reduced, ease: 'none', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
        return;
      }
      const split = SplitText.create(el, { type: 'lines', mask: 'lines', aria: 'auto' });
      gsap.from(split.lines, {
        y: 20, opacity: 0, duration: DUR.d2, ease: EASE.out, stagger: 0.06,
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        onComplete: () => split.revert(),
      });
    });
  });
  return () => { window.removeEventListener('beforeprint', showAll); mm.revert(); };
}
