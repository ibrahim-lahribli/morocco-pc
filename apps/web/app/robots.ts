/**
 * app/robots.ts — `/robots.txt` (S18).
 *
 * Deliberately permissive: `Allow: /` and nothing disallowed.
 *
 * The one URL family a crawler might be expected to see blocked is
 * `/config/[id]`, and blocking it would be the wrong repair. A result page
 * already answers `noindex, follow` in its own HTML; a `Disallow` would hide
 * that tag from the crawler, which is the documented way to end up with a
 * URL-only entry in an index — the exact outcome the noindex is there to prevent.
 * `kit`, `format` and `tokens` are noindex for the same reason and are left
 * crawlable for the same reason. Nothing on this site needs a crawl budget rule
 * before it needs to be read correctly.
 *
 * `Sitemap:` is absolute and comes from `lib/seo/site.ts` — the same origin every
 * canonical uses. A robots file with a relative sitemap path is ignored by
 * crawlers, and one with a localhost origin is a deployment that forgot
 * `NEXT_PUBLIC_SITE_URL`.
 *
 * `force-dynamic`: the document is eight lines, and its only variable is
 * configuration. A build-time copy would freeze the origin of the BUILD
 * environment into the artifact, so a container built in CI and deployed with a
 * real site URL would advertise the wrong one forever.
 */
import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
