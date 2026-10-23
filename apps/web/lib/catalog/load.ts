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
 *
 * 3. **The price readings** (S25) are a read of their own path, and the one
 *    route here that contract v1.5 does not have — see `loadPriceHistory`.
 */
import { cache } from "react";

import {
  ApiError,
  getCatalogProductForServer,
  isApiConfigured,
  listCatalogProductsForServer,
  serverApiBaseUrl,
  type CatalogListResponse,
  type CatalogProductResponse,
} from "../api/client";
import { componentPageIndexable } from "./model";
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
 * How many product reads the confirmation phase may have in flight, and how long
 * the whole walk may take.
 *
 * `4` is chosen against the API, not against the catalogue. Both catalogue
 * routes are rate-limited to 120 requests a minute (`CATALOG_RATE_LIMIT`), so a
 * pool wide enough to finish a few hundred products quickly would spend the walk
 * collecting 429s. Four turns a cold read of ~100 products into 25 rounds of
 * latency instead of 100 — measured against a fake API that answers each detail
 * read in 200 ms, 40 products: 8.4 s for the same reads sequentially against
 * 2.2 s for the whole `/sitemap.xml` — while staying inside one minute's
 * allowance. The walk also STOPS at the first 429 rather than firing the rest of
 * the list into a limiter that is already refusing it.
 *
 * The budget bounds the WALL CLOCK, not the catalogue size: the walk stops
 * STARTING work at the deadline, and a read already in flight has its own
 * `REQUEST_TIMEOUT_MS`, so the worst case is this budget plus one timeout rather
 * than "however long 2 000 products happen to take". On a warm cache the budget
 * is irrelevant — every read under the walk is `revalidate`-cached.
 */
const DETAIL_CONCURRENCY = 4;
const SITEMAP_BUDGET_MS = 15_000;

/**
 * The catalogue slugs whose pages may be indexed — S18's sitemap input.
 *
 * Four rules, and each one is a way the obvious shortcut lies:
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
 *   4. **The work is BOUNDED.** The confirmation reads run four at a time inside
 *      ONE wall-clock budget shared with the listing pages, and the walk gives up
 *      on the first 429 instead of hammering a limiter (`confirmIndexable()`).
 *      Before that, a 2 000-product catalogue meant 2 000 sequential reads in a
 *      single request — the crawl times out, and the prettiest sitemap is the one
 *      nobody receives.
 *
 * Order is the API's keyset order (by slug) — the pool writes results by
 * POSITION, never by completion — so an unchanged catalogue emits the same
 * document. Only a truncated walk (budget or 429) can shorten it, and every
 * truncation is logged with the number of products left unverified.
 */
export async function indexableComponentSlugs(): Promise<string[]> {
  if (!isApiConfigured()) return [];

  const deadline = Date.now() + SITEMAP_BUDGET_MS;
  const candidates = new Set<string>();
  let cursor: string | null = null;
  let pageCapHit = false;
  let listingBudgetHit = false;

  for (let page = 0; page < LIST_PAGE_CAP; page += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      listingBudgetHit = true;
      break;
    }
    let body: CatalogListResponse;
    try {
      body = await listCatalogProductsForServer(
        // `limit` is a STRING in the contract (a numeric pattern), not a number.
        { limit: String(LIST_PAGE_LIMIT), ...(cursor === null ? {} : { cursor }) },
        {
          revalidate: CATALOG_REVALIDATE_SECONDS,
          // A page never waits longer than one request may, and never longer
          // than the walk has left.
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
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
    if (page === LIST_PAGE_CAP - 1) pageCapHit = true;
  }

  if (pageCapHit) {
    console.warn(
      `sitemap: catalogue listing stopped after ${LIST_PAGE_CAP} pages; the sitemap is incomplete`,
    );
  }
  if (listingBudgetHit) {
    console.warn(
      `sitemap: catalogue listing stopped at its ${SITEMAP_BUDGET_MS} ms budget; the sitemap is incomplete`,
    );
  }

  return confirmIndexable([...candidates], deadline);
}

/**
 * Confirm the candidate slugs with a small concurrency pool, in list order.
 *
 * Two properties this function exists to keep:
 *
 *   - **Order is the WALK's, not completion's.** A result is written into an
 *     array indexed by candidate POSITION and filtered at the end, so four reads
 *     landing in any order still emit the keyset order the sitemap's
 *     determinism depends on.
 *   - **The walk gives up instead of piling up.** No new read starts once the
 *     deadline has passed, and none starts after a worker has seen a 429: the
 *     catalogue route allows 120 requests a minute, so the honest answer to a
 *     rate limit is a SHORTER sitemap plus one warning naming how many products
 *     went unverified — not the rest of the list thrown at a closed door.
 *     Because workers consume indexes in order, giving up yields a PREFIX of the
 *     catalogue rather than a scatter, which is what makes a truncated document
 *     still readable as "the first N products, and a warning".
 *
 * One failing read (404, timeout, 5xx) costs that product alone, which is rule 3
 * of the walk; each skip is logged with its slug.
 */
async function confirmIndexable(
  candidates: readonly string[],
  deadline: number,
): Promise<string[]> {
  const indexable = new Array<boolean>(candidates.length).fill(false);
  let next = 0;
  let attempted = 0;
  let rateLimited = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= candidates.length) return;
      if (rateLimited || Date.now() >= deadline) return;
      const slug = candidates[index];
      attempted += 1;
      try {
        // The SAME predicate the product page hands to its `robots` tag, so the
        // listed set and the tag are one decision rather than two.
        indexable[index] = componentPageIndexable(await loadCatalogProductCached(slug));
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 429) rateLimited = true;
        console.warn(
          "sitemap: could not verify a catalogue product; leaving it out",
          slug,
          cause instanceof Error ? cause.message : cause,
        );
      }
    }
  };

  const workers = Math.min(DETAIL_CONCURRENCY, candidates.length);
  await Promise.all(Array.from({ length: workers }, worker));

  const skipped = candidates.length - attempted;
  if (rateLimited) {
    console.warn(
      `sitemap: the catalogue API rate-limited the walk; ${skipped} product(s) went unverified`,
    );
  } else if (skipped > 0) {
    console.warn(
      `sitemap: the catalogue walk hit its ${SITEMAP_BUDGET_MS} ms budget; ${skipped} product(s) went unverified`,
    );
  }

  return candidates.filter((_, index) => indexable[index]);
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

/**
 * One price reading for a catalogue product (S25).
 *
 * The two fields are the whole shape on purpose: a reading says WHEN a price was
 * seen and WHAT it was. Every label and sentence around it belongs to the page,
 * so a new language never needs a new fixture.
 */
export interface PriceObservation {
  /** The day the price was seen, ISO-8601 (`YYYY-MM-DD`), as served. */
  observed_at: string;
  /** The observed price in MAD — positive and finite, enforced on read. */
  price: number;
}

/** `/v1/catalog/products/:slug/price-history`. The slug is DATA, so it is encoded. */
function priceHistoryPath(slug: string): string {
  return `/v1/catalog/products/${encodeURIComponent(slug)}/price-history`;
}

/**
 * A reading, or null when the entry cannot be rendered honestly.
 *
 * `price` accepts a NUMBER or a numeric STRING because `pg` returns NUMERIC
 * columns as strings, and an endpoint forwarding that column would send exactly
 * such a string — the repo's other loaders coerce the same way. A reading with an
 * unparseable day, or a price that is not a finite positive number, is DROPPED: a
 * zero or a NaN would draw a point at a made-up height, and a missing day would
 * print an invalid date in both languages.
 */
function asPriceObservation(value: unknown): PriceObservation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.observed_at !== "string") return null;
  if (!Number.isFinite(Date.parse(record.observed_at))) return null;
  const rawPrice = record.price;
  if (typeof rawPrice !== "number" && typeof rawPrice !== "string") return null;
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { observed_at: record.observed_at, price };
}

/**
 * The price readings for one product, OLDEST FIRST (S25).
 *
 * Three limits worth stating, because each one is a place the obvious version
 * lies:
 *
 *   1. **This route is not in contract v1.5.** It is served today by the fixture
 *      mock alone. A 404 therefore means "no reading recorded" — an absent
 *      endpoint and an empty series are the same answer to the page, and neither
 *      is an error. The day the API grows the endpoint, the page gains real
 *      history without a change here.
 *   2. **Every other failure PROPAGATES.** A price series is data, not
 *      decoration: silently rendering a dead endpoint as "never observed" would
 *      print a false claim about the product's price. Throwing keeps the page's
 *      ISR rule intact — Next serves the last good copy instead of a rewritten
 *      history.
 *   3. **The result is SORTED here, once.** Ties break on price, so two readings
 *      on one day keep a stable order; the chart's axis and the summary's "since
 *      the first reading" both assume an order, and neither should inherit
 *      whatever order the server happened to send.
 *
 * Cached for the catalogue window and request-memoized, like its siblings.
 */
export async function loadPriceHistory(slug: string): Promise<PriceObservation[]> {
  let response: Response;
  try {
    response = await fetch(serverApiBaseUrl() + priceHistoryPath(slug), {
      headers: { accept: "application/json" },
      next: { revalidate: CATALOG_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "The price history could not be reached.",
      cause,
    });
  }

  if (response.status === 404) return [];
  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      code: `HTTP_${response.status}`,
      message: `The price history request failed with status ${response.status}`,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    // A 2xx that is not JSON is a proxy page, not a series.
    throw new ApiError({
      status: response.status,
      code: "UNKNOWN",
      message: "Expected a JSON price history",
      cause,
    });
  }

  const record =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const raw = record !== null && Array.isArray(record.observations) ? record.observations : [];
  const observations = raw.flatMap((entry) => {
    const parsed = asPriceObservation(entry);
    return parsed === null ? [] : [parsed];
  });
  observations.sort(
    (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at) || a.price - b.price,
  );
  return observations;
}

/** The request-scoped memo: a render reads the series exactly once. */
export const loadPriceHistoryCached = cache(loadPriceHistory);
/** What the compare page asks for: the products it could read, and the slugs it could not. */
export interface CompareSelection {
  products: CatalogProductResponse[];
  /** The slugs the URL named that this catalogue does not serve. */
  missing: string[];
}

/**
 * The selected products, in selection order (S23).
 *
 * A slug the catalogue no longer serves is DROPPED and reported, rather than
 * throwing the whole page away: a compare URL is a working document someone
 * shared, and one dead token must not cost the reader the comparison that still
 * exists. The page renders `missing` as a sentence and offers the picker to repair
 * the link. Every OTHER failure still propagates, so a dead API keeps the last good
 * copy — the same rule this file applies to the product page.
 */
export async function loadCompareProducts(slugs: readonly string[]): Promise<CompareSelection> {
  const outcomes = await Promise.all(slugs.map((slug) => loadCatalogProductCached(slug)));
  const products: CatalogProductResponse[] = [];
  const missing: string[] = [];

  outcomes.forEach((outcome, index) => {
    if (outcome.kind === "ok") products.push(outcome.product);
    else missing.push(slugs[index]);
  });

  return { products, missing };
}

/** Same memo: one render costs one read per slug, not two. */
export const loadCompareProductsCached = cache(loadCompareProducts);

/** How many keyset pages the picker will read before it stops. */
const PICKER_PAGE_CAP = 5;

/** One row of the compare picker — the list endpoint's own shape. */
export type CatalogueListItem = CatalogListResponse["products"][number];

/**
 * The catalogue, as the picker lists it (S23).
 *
 * Bounded on purpose: `GET /v1/catalog/products` is keyset-paginated, and a picker
 * that walked an unbounded catalogue would hold the page open for as long as the
 * catalogue is long. Five pages of a hundred is the documented ceiling; a longer
 * catalogue gives a shorter picker plus one warning, which is the same degradation
 * the sitemap walk makes.
 *
 * A failure returns what it has so far and logs, because the picker is an ADDITION
 * to a page whose real content is the comparison already in the URL: a sick list
 * endpoint must not 500 a comparison that is fine.
 */
export async function catalogueProductsForPicker(): Promise<CatalogueListItem[]> {
  const products: CatalogueListItem[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < PICKER_PAGE_CAP; page += 1) {
    let body: CatalogListResponse;
    try {
      body = await listCatalogProductsForServer(
        { limit: String(LIST_PAGE_LIMIT), ...(cursor === null ? {} : { cursor }) },
        {
          revalidate: CATALOG_REVALIDATE_SECONDS,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (cause) {
      console.warn(
        "compare: the catalogue list is unavailable; the picker is short",
        cause instanceof Error ? cause.message : cause,
      );
      return products;
    }

    products.push(...body.products);
    if (body.next_cursor === null || body.next_cursor === "") return products;
    cursor = body.next_cursor;
  }

  console.warn(
    `compare: the picker stopped after ${PICKER_PAGE_CAP} catalogue pages; some products are not offered`,
  );
  return products;
}

/** One read per render, like every other loader here. */
export const catalogueProductsForPickerCached = cache(catalogueProductsForPicker);
