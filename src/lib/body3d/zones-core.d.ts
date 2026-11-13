// Types for zones-core.js (copied from site/3d/zones.js by scripts/sync-assets.mjs; it is also the build-time classifier).
declare const core: {
  ZONES: { id: string; ru: string; en: string; paired: boolean; tz: 'base' | 'extra'; color: string }[];
  KEYS: (string | null)[];
  KEY_INDEX: Record<string, number>;
  KEY_INFO: ({ zone: { id: string; paired: boolean }; side: 'l' | 'r' | null } | null)[];
};
export default core;
