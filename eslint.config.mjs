import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Scratch space (design demos, notes) — untracked, not shipped.
    ".context/**",
    // The launch-video composition is a standalone HyperFrames project, not app
    // source: its own toolchain validates it (`npx hyperframes check`).
    "brag-output/**",
  ]),
]);

export default eslintConfig;
