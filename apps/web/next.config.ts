import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // apps/web is a standalone package with its own lockfile (OD4), inside a
  // larger repo that also has a root package-lock.json. Without this, Next.js
  // infers the REPO root as the workspace root and mis-roots output file
  // tracing. Pin it to this package's directory.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
