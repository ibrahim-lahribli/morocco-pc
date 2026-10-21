import type { NextConfig } from "next";
import createMDX from "@next/mdx";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const nextConfig: NextConfig = {
  // apps/web is a standalone package with its own lockfile (OD4), inside a
  // larger repo that also has a root package-lock.json. Without this, Next.js
  // infers the REPO root as the workspace root and mis-roots output file
  // tracing. Pin it to this package's directory.
  outputFileTracingRoot: path.join(__dirname),
  /**
   * S17: content/guides/*.mdx is imported as a component, so the MDX loader
   * has to be part of this package build. NO remark/rehype plugins: Turbopack
   * accepts plugin NAMES only (a JS function cannot cross into Rust), and a
   * guide is prose plus links — nothing here needs a transform.
   */
  pageExtensions: ["js", "jsx", "ts", "tsx", "mdx"],
};

// next-intl resolves `next-intl/config` at build time by aliasing it to this
// file (S5). Without the plugin the alias points at a stub that throws
// "Couldn't find next-intl config file" — the default path is the same, but the
// alias has to be created by the plugin.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const withMDX = createMDX({});

export default withNextIntl(withMDX(nextConfig));
