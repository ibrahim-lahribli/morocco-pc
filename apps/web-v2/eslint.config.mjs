import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    // Generated from the API OpenAPI contract by `npm run gen:api-types`.
    "lib/api/schema.d.ts",
    // Supplied design references: static HTML mockups, not application source.
    "stitch_morocco_pc_builder_app/**",
  ]),
]);

export default eslintConfig;
