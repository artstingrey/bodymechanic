import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendor copies synced by scripts/sync-assets.mjs (Basis transcoder from three) and gate artefacts.
    "public/**",
    "src/lib/body2d/body2d-callouts.mjs", // vendor copy of the Brand Designer module (synced)
    "e2e/.results/**",
    "e2e/report/**",
  ]),
]);

export default eslintConfig;
