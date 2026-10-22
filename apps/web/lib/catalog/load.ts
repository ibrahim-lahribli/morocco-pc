/**
 * lib/catalog/load.ts — where a component page's data comes from (S17).
 *
 * Two reads, and they have different shapes on purpose:
 *
 * 1. **The product itself** comes from `GET /v1/catalog/products/:slug` (CD-5,
 *    contract v1.5), read on the server with `next.revalidate`. A component page
 *    is public, cached catalogue data — not one person's pass — so it belongs in
 *    the same ISR class as a preset page, not the `no-store` class of
 *    `/config/[id]`.
 *    A 404 is the ordinary "this slug names nothing" outcome and becomes the
 *    locale's styled 404; EVERY OTHER failure propagates, so a failed
 *    revalidation keeps the last good page instead of replacing a product with an
 *    error. That is S16's rule, for the same reason.
 *
 * 2. **The product's appearances in builds** are DERIVED, not fetched: the
 *    contract has no "where is this part used" endpoint, and inventing one would
 *    be a new API surface for a page whose links are the point. Instead the
 *    loader walks the presets the site already knows about (`presetsForBuild()` —
 *    the committed fixtures, plus the ribbon when an API base is configured),
 *    reads each one through the SAME request-memoized loader the preset pages
 *    use, and keeps the builds whose components carry this product's slug.
 *
 *    Consequences worth naming: an appearance is therefore "a build on a preset
 *    page we serve" — narrower than "every build the engine ever assembled", and
 *    that is the honest claim a fixture-driven site can make. A component with no
 *    slug (the contract allows null) can never match, so a fixture component
 *    without identity contributes no appearance rather than a guess. The work is
 *    N preset reads per component page, all cached for the revalidation window and
 *    request-memoized here, so it is a build-time/ISR cost, never a per-visitor
 *    one.
 */
import { cache } from "react";

import {
  ApiError,
  getCatalogProductForServer,
  isApiConfigured,
  listCatalogProductsForServer,
  type CatalogListResponse,
  type CatalogProductResponse,
} from "../api/client";
import { componentIndexable } from "./model";
import { loadPresetCached, presetsForBuild } from "../presets/load";
import { orderBuilds } from "../result/model";

/** The page's own cache lifetime — the preset interval, for the same reason. */
export const CATALOG_REVALIDATE_SECONDS = 3600;
/** A request may wait this long before the page fails and ISR keeps its copy. */
const REQUEST_TIMEOUT_MS = 5000;

export type CatalogOutcome =
  | { kind: "ok"; product: CatalogProductResponse }
  | { kind: "missing" };

/** One preset page on which this product appears, at one rank. */
export interface Appearance {
  /** The preset's budget — the number that page promises (and links by). */
  budget: number;
  /** The preset slug, so the page links the page rather than rebuilding a URL. */
  slug: string;
  /** The build's rank on that page: 1 is the card the eye lands on. */
  rank: number;
  /** The build's total, or null when the pass recorded none. */
  total: number | null;
}

/**
 * One catalogue product, or `missing`. Never throws for a 404 (see rule 1).
 */
export async function loadCatalogProduct(slug: string): Promise<CatalogOutcome> {
  try {
    const product = await getCatalogProductForServer(slug, {
      revalidate: CATALOG_REVALIDATE_SECONDS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { kind: "ok", product };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return { kind: "missing" };
    throw cause;
  }
}

/** The request-scoped memo: `generateMetadata` and the body cost ONE read. */
export const loadCatalogProductCached = cache(loadCatalogProduct);

/** Keyset page size, and the hard stop, for the sitemap's catalogue walk. */
const LIST_PAGE_LIMIT = 100;
const LIST_PAGE_CAP = 20;

/**
 * The catalogue slugs whose pages may be indexed — S18's sitemap input.
 *
 * Three rules, and each one is a way the obvious shortcut lies:
 *
 *   1. **No API configured means no catalogue pages.** The component routes are
 *      ISR with an EMPTY param list: a build with no API renders none of them, so
 *      listing any would advertise URLs that 404. (A build that named an API gets
 *      the real list — this is the same "configured or nothing" rule `load.ts`
 *      states for the ribbon.)
 *   2. **The list is a CANDIDATE FILTER, not the verdict.** `GET
 *      /v1/catalog/products` carries one `offer_class` per product, while
 *      `componentIndexable()` requires every offer of the product to be VERIFIED.
 *      A product with one verified and one placeholder offer is indexable-looking
 *      in the list and is NOT indexable in fact, so each candidate is confirmed
 *      through the product read — the same predicate the page's `robots` tag and
 *      its JSON-LD gate use, so the sitemap cannot disagree with the page.
 *   3. **A failure lists FEWER pages, never a broken sitemap.** A dead list read
 *      returns `[]` (with a line naming the cause); a dead detail read skips that
 *      one slug. Throwing would either fail a build over an optional API or hand
 *      a crawler a 500, and a shorter sitemap is the honest degradation. The
 *      mechanism is therefore "only indexable pages", never "everything".
 *
 * Order is the API's keyset order (by slug), so two regenerations of an unchanged
 * catalogue emit the same document.
 */
export async function indexableComponentSlugs(): Promise<string[]> {
  if (!isApiConfigured()) return [];

  const candidates = new Set<string>();
  let cursor: string | null = null;
  let truncated = false;

  for (let page = 0; page < LIST_PAGE_CAP; page += 1) {
    let body: CatalogListResponse;
    try {
      body = await listCatalogProductsForServer(
        // `limit` is a STRING in the contract (a numeric pattern), not a number.
        { limit: String(LIST_PAGE_LIMIT), ...(cursor === null ? {} : { cursor }) },
        {
          revalidate: CATALOG_REVALIDATE_SECONDS,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (cause) {
      console.warn(
        "sitemap: catalogue list unavailable; no component pages listed",
        cause instanceof Error ? cause.message : cause,
      );
      return [];
    }

    for (const product of body.products) {
      if (product.has_offer && product.offer_class === "VERIFIED") {
        candidates.add(product.slug);
      }
    }

    if (body.next_cursor === null || body.next_cursor === "") break;
    cursor = body.next_cursor;
    if (page === LIST_PAGE_CAP - 1) truncated = true;
  }

  if (truncated) {
    console.warn(
      `sitemap: catalogue listing stopped after ${LIST_PAGE_CAP} pages; the sitemap is incomplete`,
    );
  }

  const slugs: string[] = [];
  for (const slug of candidates) {
    try {
      const outcome = await loadCatalogProductCached(slug);
      if (outcome.kind === "ok" && componentIndexable(outcome.product)) slugs.push(slug);
    } catch (cause) {
      console.warn(
        "sitemap: could not verify a catalogue product; leaving it out",
        slug,
        cause instanceof Error ? cause.message : cause,
      );
    }
  }
  return slugs;
}

/**
 * The preset builds that use this product, cheapest preset first.
 *
 * A preset that cannot be read is skipped rather than failing the component
 * page: the appearances are a convenience surface, and a page whose own product
 * WAS served must not disappear because a sibling preset is momentarily
 * unavailable.
 */
export async function componentAppearances(productSlug: string): Promise<Appearance[]> {
  const appearances: Appearance[] = [];

  for (const preset of await presetsForBuild()) {
    const outcome = await loadPresetCached(preset.slug);
    if (outcome.kind !== "ok") continue;

    for (const build of orderBuilds(outcome.page.recommendation.builds)) {
      const uses = build.components.some((component) => component.slug === productSlug);
      if (!uses) continue;
      appearances.push({
        budget: preset.budget,
        slug: preset.slug,
        rank: build.rank,
        total: build.total_price,
      });
    }
  }

  return appearances;
}

/** Same memo, so the body and its metadata never pay for two walks. */
export const componentAppearancesCached = cache(componentAppearances);
