/**
 * LOD rule (spike: ~55 % triangles, smaller textures): phones (< 768 px wide) and low-memory devices get the LOD1 models.
 * One rule for the 3D runtime (loader.modelUrl) and the hero poster's calibration — LOD1's front-view anchors differ from
 * LOD0's (male shoulder +2.2 %, chest −1.8 % of the poster height), so the poster publishes the anchors of the model that
 * will replace it (usePosterAnchors) and the index rows before any JS use the LOD1 set under LOD1_MQ (HeroAtlas). The
 * memory half has no CSS form: a low-memory tablet gets the LOD0 rows until the hydration (RC-5).
 */
export const LOD1_MQ = '(max-width: 767px)';

export const isLod1 = () =>
  window.matchMedia(LOD1_MQ).matches || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
