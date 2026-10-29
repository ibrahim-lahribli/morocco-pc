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
  /**
   * A RELATIVE `NEXT_PUBLIC_API_BASE_URL` makes this server the API's front door.
   *
   * The browser then calls the app's OWN origin (`/api/v1/...`) and Next forwards
   * the request to `API_BASE_URL` server-to-server, so a local `npm run dev` can
   * use a DEPLOYED API whose CORS policy does not list `http://localhost:3210`: no
   * cross-origin request is ever made. An ABSOLUTE public base - the documented
   * default - registers no rewrite at all, so a deployment that keeps
   * `API_BASE_URL` on an internal address exposes nothing new.
   *
   * `/api` is the prefix because next-intl's matcher already excludes `api/...`
   * (`proxy.ts`), so the locale proxy never redirects these requests.
   *
   * `next dev` reads this on every start. A production build BAKES the rewrites
   * (with the destination it resolved) into `.next/routes-manifest.json`, so a
   * deployment that uses a relative base rebuilds to move the target - and a
   * build made without one carries no proxy at all, which is why this file does
   * not change what `npm run build` and `npm test` ship.
   */
  async rewrites() {
    const publicBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    const target = process.env.API_BASE_URL;
    const base = typeof publicBase === "string" ? publicBase.replace(/\/+$/, "") : "";
    if (!base.startsWith("/") || target === undefined || target.trim() === "") {
      return [];
    }
    return [
      {
        source: `${base}/v1/:path*`,
        destination: `${target.trim().replace(/\/+$/, "")}/v1/:path*`,
      },
    ];
  },
};

// next-intl resolves `next-intl/config` at build time by aliasing it to this
// file (S5). Without the plugin the alias points at a stub that throws
// "Couldn't find next-intl config file" — the default path is the same, but the
// alias has to be created by the plugin.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const withMDX = createMDX({});

export default withNextIntl(withMDX(nextConfig));
