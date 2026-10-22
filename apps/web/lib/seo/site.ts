/**
 * lib/seo/site.ts — where the crawl surface says this site lives (S18).
 *
 * One question, asked by four callers: sitemap.xml, robots.txt, every page's
 * `<link rel="canonical">` and its `hreflang` set. They must all answer with the
 * SAME origin, or a crawler is told two stories about one page. So the origin is
 * configuration (`NEXT_PUBLIC_SITE_URL`), read here and nowhere else.
 *
 * ## Why configuration, not the request
 *
 * The result page (S15) builds its share URL from the request's Host header, and
 * that is right for a preview of a URL a person is about to open. A canonical is
 * a different claim: it says "this is the address of this document, from now on",
 * and it is generated where the request may be a build, a preview deployment, an
 * internal SSR call from another service, or a health check. Deriving it from the
 * request is how a preview deployment ends up telling Google that production's
 * page is a duplicate of `preview-abc.vercel.app`. The request can also lie: Host
 * is caller-controlled. So the crawl surface takes its origin from configuration
 * and the share surface keeps its request origin, deliberately, and the two are
 * allowed to differ.
 *
 * ## What happens when it is not configured
 *
 * UNSET is the local default: `http://localhost:3210`, the port `npm run dev` and
 * `npm start` use, so a local crawl (the e2e suite included) is self-consistent
 * and no build depends on ambient state — the same rule `load.ts` applies to the
 * API base. A DEPLOYMENT MUST SET IT (for the build — see below); without it
 * every canonical advertises localhost, which is a configuration bug that is
 * visible in the HTML rather than hidden.
 *
 * MALFORMED is a throw, not a fallback: `NEXT_PUBLIC_SITE_URL=example.com` (no
 * scheme) or `https://example.com/fr` (a path, which would silently prefix every
 * canonical) fails the build with a sentence naming the variable. Falling back
 * to localhost there would ship the exact defect the variable exists to prevent,
 * and a build failure is one line to fix.
 *
 * ## BUILD time, not just request time
 *
 * Every page is prerendered or ISR, so its canonical and its `metadataBase` are
 * computed while `next build` runs and baked into the HTML; the two crawl routes
 * are `force-dynamic` and read the variable per REQUEST. Setting it only on the
 * server process therefore produces the exact split this file exists to prevent
 * — `/sitemap.xml` naming production while `/fr` still answers
 * `http://localhost:3210/fr`. Set it for the BUILD. That is also the
 * `NEXT_PUBLIC_*` convention, and `e2e/seo.spec.ts` cannot catch the split
 * because it builds and serves from one environment.
 *
 * ## hreflang: fr + ar + x-default (S20 closed V9)
 *
 * The rule is unchanged and it is the reason V9 stayed open for two sprints: a
 * `hreflang` must never name a route that 404s, because the annotation is a claim
 * that the pair is a translation of one document. S17 shipped French-only guides,
 * so the honest set was `fr` + `x-default`.
 *
 * S20 translated the guide bodies and made every remaining route bilingual, so
 * the set is now `fr`, `ar` and `x-default` — one entry per locale this app
 * actually serves, plus the default for anyone else. `e2e/seo.spec.ts` enforces
 * the precondition rather than trusting this comment: it FETCHES every annotated
 * URL and requires 200, so a future French-only page cannot ship an `ar`
 * alternate — the gate goes red on the 404.
 *
 * The URLs are ABSOLUTE even though `metadataBase` is set in the layout: an
 * absolute string cannot be resolved against the wrong base by a future refactor,
 * and the e2e spec compares it literally.
 */
import { localePath } from "../i18n/paths";

/** The variable a deployment sets to the site's public origin. */
export const SITE_URL_ENV = "NEXT_PUBLIC_SITE_URL";

/**
 * The origin used when the variable is unset: the app's own dev/start port
 * (`package.json` `dev`/`start`), so a local crawl is self-consistent.
 */
export const LOCAL_ORIGIN = "http://localhost:3210";

/**
 * The site's origin — scheme + host + optional port, never a path.
 *
 * Throws on a malformed value (see the header): a crawl surface built on a
 * guessed origin is the defect, so this refuses rather than degrades.
 */
export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env[SITE_URL_ENV];
  if (raw === undefined || raw.trim() === "") return LOCAL_ORIGIN;

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(
      `${SITE_URL_ENV} is not an absolute URL (${JSON.stringify(raw)}); expected e.g. https://morocco-pc.example`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${SITE_URL_ENV} must be http or https, not ${parsed.protocol}`);
  }
  // An ORIGIN, not a URL: a path would prefix every canonical ("/fr/fr"), and a
  // query or fragment cannot be part of an origin at all.
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error(`${SITE_URL_ENV} must be an origin with no path, query or fragment: ${raw}`);
  }
  return parsed.origin;
}

/** One absolute URL on this site. A path already starting with `/` is used as is. */
export function absoluteUrl(path: string, env: Record<string, string | undefined> = process.env): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${siteOrigin(env)}${clean === "/" ? "" : clean}`;
}

/** What a page hands to Next's `alternates` field. */
export interface PageAlternates {
  canonical: string;
  languages: Record<string, string>;
}

/** The app's locales, and its default — mirroring `i18n/routing.ts` as data. */
export const CONTENT_LOCALES = ["fr", "ar"] as const;
const DEFAULT_LOCALE = "fr";

/**
 * The hreflang set for one page, from its path WITHOUT a locale prefix: one
 * entry per locale (`localePath`, so there is exactly one prefixing rule), plus
 * `x-default` on the default locale.
 *
 * Shared by `pageAlternates()` and by the sitemap's per-entry `alternates`, so
 * the document and the HTML cannot advertise different pairs.
 */
export function localeAlternates(
  path: string,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of CONTENT_LOCALES) {
    languages[locale] = absoluteUrl(localePath(locale, path), env);
  }
  languages["x-default"] = languages[DEFAULT_LOCALE];
  return languages;
}

/**
 * The canonical + hreflang set for one page, from its LOCALE and its path
 * WITHOUT a locale prefix (`/`, `/configurer`, `/guides/budget-pc-gamer`).
 *
 * `localePath()` (S5) is the only thing that adds a prefix, so a page cannot
 * build a canonical with a second, subtly different rule. The canonical is the
 * page ITSELF — self-referencing is what makes two spellings of one address
 * converge — while the `hreflang` set names each locale's own URL (see the
 * header for why that is now legal).
 */
export function pageAlternates(
  locale: string,
  path: string,
  env: Record<string, string | undefined> = process.env,
): PageAlternates {
  return {
    canonical: absoluteUrl(localePath(locale, path), env),
    languages: localeAlternates(path, env),
  };
}
