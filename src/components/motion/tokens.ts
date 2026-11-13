/** Motion constants without GSAP (safe to import statically; GSAP itself is loaded lazily — R-CODE-01 F-04, JS budget). */
export const EASE = { out: 'bm-out', in: 'bm-in', io: 'bm-io', overshoot: 'bm-overshoot' } as const;
export const DUR = { press: 0.12, hover: 0.2, d1: 0.3, d2: 0.4, d3: 0.5, reduced: 0.12 } as const;
export const SEQUENCE_MAX = 1.2; // s, any choreography incl. hero load and hero → 3D
export const STAGGER = 0.04;
export const SHIFT = { s1: 12, s2: 24 } as const;
export const MQ = { full: '(prefers-reduced-motion: no-preference)', reduce: '(prefers-reduced-motion: reduce)' } as const;

/** Loads GSAP + plugins once (code-split chunk), after the first screen. */
export const loadMotion = () => import('./motion');
