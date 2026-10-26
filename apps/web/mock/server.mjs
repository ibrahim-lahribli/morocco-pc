#!/usr/bin/env node
/**
 * apps/web/mock/server.mjs — the fixture mock API (S4).
 *
 * Zero dependencies, so it runs on the same Node as CI and needs no build. It
 * exists so the web work can be developed and TESTED without a deployed API —
 * which is the whole reason the frontend track is not blocked on the platform.
 *
 * State selection (query parameter, so a test can pick it per request):
 *
 *   POST /v1/recommendations
 *     ?state=ok                 201, two builds (one verified, one indicative)
 *     ?state=reused             200, `reused: true` (the dedupe path)
 *     ?state=zero-build         200, builds: [], floor present
 *     ?state=zero-build-no-floor 200, builds: [], floor UNKNOWN (null)
 *     ?state=slow[&delay=8000]  201 after a delay (the skeleton path)
 *     ?state=non-json           200 with an HTML body (a proxy page, not JSON)
 *     ?state=422 | 413 | 429 | 503
 *
 *   GET /v1/recommendations/:id   the fixture whose `id` matches, else 404
 *                                 (?state=404 forces the 404 for any id; the two
 *                                 reserved ids - unavailable (503) and rateLimited
 *                                 (429) - are error states an SSR page can select
 *                                 through the id alone)
 *   GET /v1/presets               ?state=ok | empty | 503
 *   GET /v1/catalog/products      ?state=ok | 503; `?role=` narrows by category
 *                                 (and an unknown role is a 422), like the API
 *   GET /v1/recommendations/:id/builds/:rank/swap-preview
 *                                 the swap ANSWER is chosen by the `product_id`
 *                                 (S24): rtx-4070 is a PASS, rx-7600 a FAIL, the
 *                                 Ti an UNKNOWN, kit-ddr5 not evaluable. The
 *                                 role and the GPU variant are validated as the
 *                                 API validates them; ?state=429|503 forces the
 *                                 error paths.
 *   POST /v1/recommendations/:id/builds/:rank/swap
 *                                 S24's COMMIT (contract v1.10, Decision 56).
 *                                 A PASS/UNKNOWN answer is a 201 carrying the
 *                                 preview's three facts plus `swapped`; a build
 *                                 whose fixture already names a swap is a 409
 *                                 SWAP_ALREADY_COMMITTED, and a FAIL scenario is
 *                                 a 409 SWAP_NOT_COMMITTABLE.
 *   GET /v1/catalog/products/:slug/price-history
 *                                 ?state=ok | 503 (an unknown slug is a 404; a
 *                                 known slug with no readings answers 200 with
 *                                 an EMPTY series, because "we have observed
 *                                 nothing" is an answer, not a miss)
 *   GET /v1/catalog/products/:slug ?state=ok | 404 (an unknown slug is a 404)
 *   GET /v1/meta/options          ?state=ok | 503
 *   GET /v1/health                always 200
 *
 * The same state can be sent as an `x-mock-state` header instead, and `delay`
 * works on any route. CORS is open (`*`): the mock is never deployed, and the
 * real CORS policy is proven on the API side (P2 Sprint 4).
 *
 * ## Slow catalogue mode (S18's sitemap budget)
 *
 * `MOCK_CATALOG_SLOW=1` swaps BOTH catalogue routes for a synthetic catalogue of
 * `MOCK_CATALOG_SLOW_SIZE` products (default 40), every one of them VERIFIED, and
 * makes each detail read wait `MOCK_CATALOG_SLOW_DELAY_MS` (default 1000). It is a
 * separate INSTANCE of this mock, not a per-request state: `/sitemap.xml`'s walk
 * reads the detail route without a query string, so a state a caller could only
 * set on one request cannot describe the walk. Three fixture products can never
 * reach a 15 s budget, and that is the whole reason this mode exists — it is what
 * `e2e/sitemap-budget.spec.ts` starts to hold `indexableComponentSlugs()` to its
 * bound instead of measuring it once by hand.
 */

import http from "node:http";

import {
  CATALOG_LIST_OK,
  CATALOG_PRODUCTS_BY_SLUG,
  CATALOG_VERSION,
  ENGINE_VERSION,
  DISCLAIMER,
  ERRORS,
  HEALTH_OK,
  IDS,
  META_OPTIONS,
  PRESETS_EMPTY,
  PRESETS_OK,
  PRICE_HISTORY_BY_SLUG,
  PRODUCT_IDS_BY_SLUG,
  RECOMMENDATIONS_BY_ID,
  RECOMMENDATION_OK,
  RECOMMENDATION_REUSED,
  RECOMMENDATION_ZERO_BUILD,
  RECOMMENDATION_ZERO_BUILD_NO_FLOOR,
  SWAP_PAIRS_BY_ROLE,
  SWAP_SCENARIO_BY_SLUG,
  VARIANTS_BY_SLUG,
} from "./fixtures.mjs";

const PORT = Number(process.env.MOCK_API_PORT || 3211);
const SLOW_DEFAULT_MS = 8000;

/** The slow catalogue: see the header. Off unless this instance was started for it. */
const CATALOG_SLOW = process.env.MOCK_CATALOG_SLOW === "1";
const CATALOG_SLOW_SIZE = Number(process.env.MOCK_CATALOG_SLOW_SIZE || 40);
const CATALOG_SLOW_DELAY_MS = Number(process.env.MOCK_CATALOG_SLOW_DELAY_MS || 1000);

/**
 * The synthetic catalogue, keyed by slug. Every product is VERIFIED and carries
 * one verified offer, so `componentIndexable()` says yes to all of them and the
 * only thing that can shorten a walk is the bound under test — a mixture of
 * classes would leave the spec unable to say why an entry is missing.
 *
 * Slugs are zero-padded (`produit-000`), so the keyset order the API promises is
 * also the numeric order, and a truncated walk reads as a prefix rather than a
 * scatter.
 */
const CATALOG_SLOW_PRODUCTS = CATALOG_SLOW
  ? Object.fromEntries(
      Array.from({ length: CATALOG_SLOW_SIZE }, (_, index) => {
        const slug = `produit-${String(index).padStart(3, "0")}`;
        const template = CATALOG_PRODUCTS_BY_SLUG["rtx-4060-8gb"];
        return [slug, { ...template, slug, display_name: `Produit ${slug}` }];
      }),
    )
  : {};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-mock-state",
  // Models the API (apps/api/src/app.js): a browser cannot read these
  // otherwise, so the 429 countdown and the 500 reference would look broken.
  "access-control-expose-headers": "retry-after,x-request-id",
};

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
    ...headers,
  });
  res.end(payload);
}

function stateOf(url, req) {
  return url.searchParams.get("state") ?? req.headers["x-mock-state"] ?? "ok";
}

function delayOf(url, state) {
  const requested = Number(url.searchParams.get("delay"));
  if (Number.isFinite(requested) && requested > 0) {
    return requested;
  }
  return state === "slow" ? SLOW_DEFAULT_MS : 0;
}

function sendError(res, kind) {
  const fixture = ERRORS[kind];
  send(res, fixture.status, fixture.body, fixture.headers);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

/**
 * The mock validates the two request rules the contract actually enforces, so a
 * client bug (a numeric string, an unknown field) is a 422 here too rather than
 * something only the real API would catch.
 */
function validateCreate(body) {
  const allowed = new Set(["budget_amount", "currency", "use_case", "resolution", "priority"]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return [{ field: unknown[0], message: "must NOT have additional properties" }];
  }
  if (typeof body.budget_amount !== "number" || !Number.isFinite(body.budget_amount) || body.budget_amount <= 0) {
    return [{ field: "budget_amount", message: "must be > 0" }];
  }
  if (typeof body.currency !== "string" || body.currency.length !== 3) {
    return [{ field: "currency", message: "must be exactly 3 characters" }];
  }
  if (typeof body.use_case !== "string" || body.use_case.length === 0) {
    return [{ field: "use_case", message: "must not be empty" }];
  }
  return [];
}

/**
 * The role -> product-category map the API itself applies (`engine.categoryForRole`,
 * read through the boundary). The mock restates it so `?role=GPU` cannot answer
 * with a CPU: a picker built against a mock that ignored the filter would look
 * correct and be wrong against the real catalogue.
 */
const CATEGORY_BY_ROLE = {
  CPU: "CPU",
  GPU: "GPU",
  MOTHERBOARD: "MOTHERBOARD",
  RAM: "MEMORY",
  SSD_BOOT: "STORAGE",
  SSD_SECONDARY: "STORAGE",
  PSU: "PSU",
  CASE: "CASE",
  CPU_COOLER: "COOLER",
};

/**
 * One swap preview (contract v1.8, Decision 55), built from the fixtures.
 *
 * The NUMBERS are derived the way the engine derives them - the build's recorded
 * total, less the part being replaced, plus the catalogue's own `from_price` -
 * so the card behind the panel and the panel itself cannot disagree. It is the
 * mock pretending to be the engine; the CLIENT still re-derives nothing.
 *
 * Returns `null` when the build or the product is not one this mock serves, so
 * the caller answers the API's own 404 rather than inventing a verdict.
 */
function swapPreviewBody({ recommendation, build, role, productId }) {
  const slug = Object.keys(PRODUCT_IDS_BY_SLUG).find(
    (candidate) => PRODUCT_IDS_BY_SLUG[candidate] === productId
  );
  if (slug === undefined) return null;
  const scenario = SWAP_SCENARIO_BY_SLUG[slug] ?? { status: "PASS" };
  const product = CATALOG_PRODUCTS_BY_SLUG[slug];

  const installed = build.components.find((component) => component.role === role) ?? null;
  const previous = installed === null ? null : installed.price_used;
  const offer = product.offers.length === 0 ? null : product.offers[0];
  const next = offer === null ? null : offer.price;
  const delta =
    offer === null || previous === null ? null : Number((next - previous).toFixed(2));
  const total =
    delta === null || typeof build.total_price !== "number"
      ? null
      : Number((build.total_price + delta).toFixed(2));
  const budgetAmount =
    typeof recommendation.budget_amount === "number" ? recommendation.budget_amount : null;

  // Not evaluable at all: ONE synthetic `eligibility` pair, no price, and a
  // FAIL that is a RESULT rather than an error (Decision 55 items 4 and 5).
  if (scenario.eligibility !== undefined) {
    return {
      compatibility: {
        status: "FAIL",
        pairs: [
          {
            check: "eligibility",
            role,
            partner_role: null,
            status: "FAIL",
            reason: scenario.eligibility,
            evidence: [],
          },
        ],
        unknown_pairwise_count: 0,
      },
      price: { previous, next: null, delta: null, offer_class: null, price_status: null },
      budget: { budget_amount: budgetAmount, total: null, delta: null, within_budget: null },
      catalog_version: CATALOG_VERSION,
      engine_version: ENGINE_VERSION,
    };
  }

  const relationships = SWAP_PAIRS_BY_ROLE[role] ?? [];
  const pairs = relationships.map((relationship, index) => {
    const status =
      scenario.failing !== undefined && index < scenario.failing
        ? "FAIL"
        : scenario.unknown !== undefined && index < scenario.unknown
          ? "UNKNOWN"
          : "PASS";
    return {
      check: relationship.check,
      role: relationship.role,
      partner_role: relationship.partner_role,
      status,
      reason: null,
      evidence: [],
    };
  });

  return {
    compatibility: {
      status: scenario.status,
      pairs,
      unknown_pairwise_count: pairs.filter((pair) => pair.status === "UNKNOWN").length,
    },
    price: {
      previous,
      next,
      delta,
      offer_class: offer === null ? null : offer.offer_class,
      price_status: offer === null ? null : offer.offer_class === "VERIFIED" ? "verified" : "indicative",
    },
    budget: {
      budget_amount: budgetAmount,
      total,
      delta,
      within_budget:
        total === null || budgetAmount === null ? null : total <= budgetAmount,
    },
    catalog_version: CATALOG_VERSION,
    engine_version: ENGINE_VERSION,
  };
}

/**
 * The frozen `GET /v1/catalog/products/:slug/price-history` body (contract v1.6).
 *
 * Built from the fixture's readings exactly as the API builds it from its rows:
 * the summary is DERIVED, so a fixture cannot disagree with its own points, and
 * the field names are the contract's (`points`, not a mock-only `observations`).
 * `change_amount` / `change_pct` need two readings — one observation is a fact,
 * not a trend — so the mock answers `null` for the same reason the API does.
 */
function priceHistoryBody(slug, points) {
  const prices = points.map((point) => Number(point.price));
  const first = prices.length > 0 ? prices[0] : null;
  const last = prices.length > 0 ? prices[prices.length - 1] : null;
  const hasTrend = prices.length >= 2;
  return {
    slug,
    currency: "MAD",
    points,
    observation_count: points.length,
    latest_price: last,
    min_price: prices.length > 0 ? Math.min(...prices) : null,
    max_price: prices.length > 0 ? Math.max(...prices) : null,
    change_amount: hasTrend ? Number((last - first).toFixed(2)) : null,
    change_pct:
      hasTrend && first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : null,
    disclaimer: DISCLAIMER,
  };
}

async function handle(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const state = stateOf(url, req);
  const delay = delayOf(url, state);
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const path = url.pathname;

  if (req.method === "GET" && path === "/v1/health") {
    send(res, 200, HEALTH_OK);
    return;
  }

  if (req.method === "GET" && path === "/v1/meta/options") {
    if (state === "503") return sendError(res, "unavailable");
    send(res, 200, META_OPTIONS);
    return;
  }

  if (req.method === "POST" && path === "/v1/recommendations") {
    if (state === "non-json") {
      // A 2xx that is not JSON must not read as a success.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...CORS_HEADERS });
      res.end("<html><body>proxy error</body></html>");
      return;
    }
    if (state === "422") return sendError(res, "validation");
    if (state === "413") return sendError(res, "tooLarge");
    if (state === "429") return sendError(res, "rateLimited");
    if (state === "503") return sendError(res, "unavailable");

    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "INVALID_JSON", message: "Body is not valid JSON" });
    }
    const problems = validateCreate(body);
    if (problems.length > 0) {
      return send(res, 422, {
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: problems,
      });
    }

    if (state === "reused") return send(res, 200, RECOMMENDATION_REUSED);
    if (state === "zero-build") return send(res, 200, RECOMMENDATION_ZERO_BUILD);
    if (state === "zero-build-no-floor") return send(res, 200, RECOMMENDATION_ZERO_BUILD_NO_FLOOR);
    return send(res, 201, RECOMMENDATION_OK);
  }

  // The id IS the state selector for a read: an SSR page has no browser left to
  // set a header or add a query parameter, so each fixture carries its own id.
  const recommendationMatch = path.match(/^\/v1\/recommendations\/([^/]+)$/);
  if (req.method === "GET" && recommendationMatch !== null) {
    if (state === "404") return sendError(res, "notFound");
    const id = decodeURIComponent(recommendationMatch[1]);
    if (id === IDS.unavailable) return sendError(res, "unavailable");
    if (id === IDS.rateLimited) return sendError(res, "rateLimited");
    const fixture = RECOMMENDATIONS_BY_ID[id];
    // An unknown id is a 404, as the real API's is: inventing a body for it
    // would hide the results page's own not-found path.
    if (fixture === undefined) return sendError(res, "notFound");
    send(res, 200, fixture);
    return;
  }

  if (req.method === "GET" && path === "/v1/presets") {
    if (state === "503") return sendError(res, "unavailable");
    if (state === "empty") return send(res, 200, PRESETS_EMPTY);
    send(res, 200, PRESETS_OK);
    return;
  }

  // S24: the swap preview (contract v1.8). The role is validated and the GPU
  // variant required exactly as the API does it, so a client that forgot the
  // variant fails here the same way it would in production.
  const swapMatch = path.match(/^\/v1\/recommendations\/([^/]+)\/builds\/([0-9]+)\/swap-preview$/);
  if (req.method === "GET" && swapMatch !== null) {
    if (state === "503") return sendError(res, "unavailable");
    if (state === "429") return sendError(res, "rateLimited");

    const recommendation = RECOMMENDATIONS_BY_ID[decodeURIComponent(swapMatch[1])];
    if (recommendation === undefined) return sendError(res, "notFound");
    const build = recommendation.builds.find((entry) => entry.rank === Number(swapMatch[2]));
    if (build === undefined) return sendError(res, "notFound");

    const role = url.searchParams.get("role") ?? "";
    if (!Object.prototype.hasOwnProperty.call(CATEGORY_BY_ROLE, role)) {
      return send(res, 422, {
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [
          { field: "role", message: "role must be one of: " + Object.keys(CATEGORY_BY_ROLE).join(", ") },
        ],
      });
    }
    const variantId = url.searchParams.get("product_variant_id");
    if (role === "GPU" && variantId === null) {
      return send(res, 422, {
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [
          {
            field: "product_variant_id",
            message: "a GPU swap must name product_variant_id: GPU candidates are variant-keyed",
          },
        ],
      });
    }
    if (role !== "GPU" && variantId !== null) {
      return send(res, 422, {
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ field: "product_variant_id", message: "product_variant_id is only accepted for role GPU" }],
      });
    }

    const body = swapPreviewBody({
      recommendation,
      build,
      role,
      productId: url.searchParams.get("product_id") ?? "",
    });
    if (body === null) {
      return send(res, 404, {
        error: "BUILD_NOT_EVALUABLE",
        message:
          "This build can no longer be evaluated: the persisted "
          + role
          + " pick is not a candidate in the live catalog",
      });
    }
    return send(res, 200, body, { "cache-control": "no-store" });
  }

  // S24: the swap COMMIT (contract v1.10, Decision 56).
  //
  // The mock has no database, so "committing" is a mutation of the SERVED
  // fixture - which is exactly what makes this useful: the badge, the replaced
  // component, the new total and the missing explanation are the SAME read path
  // the real API serves after a commit, so a spec can assert that a refresh
  // shows the stored swap rather than the panel's opinion of it. The three
  // refusals the screen can meet are reproduced too (already committed,
  // incompatible, not evaluable), because a mock that only ever says yes cannot
  // test an error state.
  const commitMatch = path.match(/^\/v1\/recommendations\/([^/]+)\/builds\/([0-9]+)\/swap$/);
  if (req.method === "POST" && commitMatch !== null) {
    if (state === "503") return sendError(res, "unavailable");
    if (state === "429") return sendError(res, "rateLimited");

    const recommendation = RECOMMENDATIONS_BY_ID[decodeURIComponent(commitMatch[1])];
    if (recommendation === undefined) return sendError(res, "notFound");
    const build = recommendation.builds.find((entry) => entry.rank === Number(commitMatch[2]));
    if (build === undefined) return sendError(res, "notFound");

    if (build.swapped !== null && build.swapped !== undefined) {
      return send(res, 409, {
        error: "SWAP_ALREADY_COMMITTED",
        message: "This build already carries a swap; a build holds one committed replacement",
      });
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "INVALID_JSON", message: "Body is not valid JSON" });
    }

    const role = typeof payload.role === "string" ? payload.role : "";
    if (!Object.prototype.hasOwnProperty.call(CATEGORY_BY_ROLE, role)) {
      return send(res, 422, {
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [
          { field: "role", message: "role must be one of: " + Object.keys(CATEGORY_BY_ROLE).join(", ") },
        ],
      });
    }
    const productId = typeof payload.product_id === "string" ? payload.product_id : "";
    const variantId =
      typeof payload.product_variant_id === "string" ? payload.product_variant_id : null;
    if (role === "GPU" && variantId === null) {
      return send(res, 422, {
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [
          {
            field: "product_variant_id",
            message: "a GPU swap must name product_variant_id: GPU candidates are variant-keyed",
          },
        ],
      });
    }
    if (role !== "GPU" && variantId !== null) {
      return send(res, 422, {
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ field: "product_variant_id", message: "product_variant_id is only accepted for role GPU" }],
      });
    }

    const preview = swapPreviewBody({ recommendation, build, role, productId });
    if (preview === null) {
      return send(res, 404, {
        error: "BUILD_NOT_EVALUABLE",
        message:
          "This build can no longer be evaluated: the persisted "
          + role
          + " pick is not a candidate in the live catalog",
      });
    }
    if (preview.compatibility.status === "FAIL") {
      return send(res, 409, {
        error: "SWAP_NOT_COMMITTABLE",
        message: "The replacement would not fit this build",
      });
    }

    // STATELESS ON PURPOSE. The suite runs with `fullyParallel`, and the SSR
    // read comes from a SECOND instance of this mock (port 3211) while the
    // browser's POST comes here (port 3000) - two processes, so a mutation
    // could never be observed by a refresh, and would leak between workers if
    // it could. The POST therefore only ANSWERS; the build that already carries
    // a swap is its own fixture (`IDS.swapped`), which is what makes the badge
    // and the missing explanation testable at all.
    return send(
      res,
      201,
      {
        ...preview,
        swapped: {
          role,
          committed_at: new Date().toISOString(),
          engine_version: ENGINE_VERSION,
        },
      },
      { "cache-control": "no-store" }
    );
  }

  if (req.method === "GET" && path === "/v1/catalog/products") {
    if (state === "503") return sendError(res, "unavailable");
    if (CATALOG_SLOW) {
      // One page: the walk's pagination is the listing's own behaviour, and the
      // bound under test is the CONFIRMATION phase, not the cursor loop.
      send(res, 200, {
        products: Object.values(CATALOG_SLOW_PRODUCTS).map((product) => ({
          slug: product.slug,
          display_name: product.display_name,
          category: product.category,
          from_price: product.offers[0].price,
          offer_class: product.offers[0].offer_class,
          has_offer: true,
        })),
        next_cursor: null,
      });
      return;
    }
    // The role filter the API applies: `?role=GPU` answers GPU rows only, and
    // an unknown role is the same 422 that names the vocabulary.
    const role = url.searchParams.get("role");
    if (role === null) {
      send(res, 200, CATALOG_LIST_OK);
      return;
    }
    const category = CATEGORY_BY_ROLE[role];
    if (category === undefined) {
      return send(res, 422, {
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [
          { field: "role", message: "role must be one of: " + Object.keys(CATEGORY_BY_ROLE).join(", ") },
        ],
      });
    }
    send(res, 200, {
      products: CATALOG_LIST_OK.products.filter((product) => product.category === category),
      next_cursor: null,
    });
    return;
  }

  // S25: one product's price history, on its OWN path so the product read
  // below keeps its one-segment shape. The series is selected by SLUG, not by
  // state, because the page reads this on the server: the slug is the only
  // thing a spec can choose from outside the Next process.
  //
  // The BODY is contract v1.6's frozen envelope, built by `priceHistoryBody`
  // from the fixture's readings — the mock once served a mock-only
  // `observations` key, and the S25 specs passed against a shape the API never
  // served.
  //
  // The path is matched by its two literal halves rather than by a pattern:
  // the middle is DATA (a slug), read as a slice and then checked for a
  // separator, so a deeper path is not mistaken for a product.
  const PRICE_HISTORY_PREFIX = "/v1/catalog/products/";
  const PRICE_HISTORY_SUFFIX = "/price-history";
  if (
    req.method === "GET" &&
    path.startsWith(PRICE_HISTORY_PREFIX) &&
    path.endsWith(PRICE_HISTORY_SUFFIX)
  ) {
    const rawSlug = path.slice(PRICE_HISTORY_PREFIX.length, -PRICE_HISTORY_SUFFIX.length);
    if (rawSlug.length > 0 && !rawSlug.includes("/")) {
      if (state === "503") return sendError(res, "unavailable");
      const slug = decodeURIComponent(rawSlug);
      const fixture = PRICE_HISTORY_BY_SLUG[slug];
      // A known product with no readings is a 200 carrying an empty series;
      // only a slug the mock does not serve is a miss.
      if (fixture === undefined) return sendError(res, "notFound");
      send(res, 200, priceHistoryBody(slug, fixture.points));
      return;
    }
  }

  const productMatch = path.match(/^\/v1\/catalog\/products\/([^/]+)$/);
  if (req.method === "GET" && productMatch !== null) {
    // S17: an unknown slug is a MISS, like the real API. This route used to
    // echo the requested slug back inside ONE fixture body, which made the
    // 404 path untestable and let a page render a product nothing serves.
    const slug = decodeURIComponent(productMatch[1]);
    const slowProduct = CATALOG_SLOW_PRODUCTS[slug];
    if (slowProduct !== undefined) {
      // The delay is what makes the budget observable: a walk that respected no
      // bound would finish all of these, and this spec would then fail on the
      // prefix rather than pass on a coincidence.
      await new Promise((resolve) => setTimeout(resolve, CATALOG_SLOW_DELAY_MS));
      send(res, 200, slowProduct);
      return;
    }
    const product = CATALOG_PRODUCTS_BY_SLUG[slug];
    if (state === "404" || product === undefined) return sendError(res, "notFound");
    send(res, 200, product);
    return;
  }

  send(res, 404, { error: "NOT_FOUND", message: `No mock route for ${req.method} ${path}` });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    send(res, 500, { error: "MOCK_FAILURE", message: error.message });
  });
});

server.on("error", (error) => {
  console.error(`mock-api: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`mock-api listening on http://localhost:${PORT} (states via ?state=)`);
});
