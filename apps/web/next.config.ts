import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const nextConfig: NextConfig = {
  // apps/web is a standalone package with its own lockfile (OD4), inside a
  // larger repo that also has a root package-lock.json. Without this, Next.js
  // infers the REPO root as the workspace root and mis-roots output file
  // tracing. Pin it to this package's directory.
  outputFileTracingRoot: path.join(__dirname),
};

// next-intl resolves `next-intl/config` at build time by aliasing it to this
// file (S5). Without the plugin the alias points at a stub that throws
// "Couldn't find next-intl config file" — the default path is the same, but the
// alias has to be created by the plugin.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
