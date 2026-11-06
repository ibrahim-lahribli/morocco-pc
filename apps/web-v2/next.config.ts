import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

/**
 * V2 is a standalone package inside a larger repository that also has a root
 * package-lock.json. Without `outputFileTracingRoot`, Next infers the repo root
 * as the workspace root and mis-roots output file tracing. Pin it here.
 */
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  reactStrictMode: true,
};

/**
 * next-intl resolves `next-intl/config` at build time by aliasing it to this
 * file. The plugin has to create that alias, so the config cannot be consumed
 * without it.
 */
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
