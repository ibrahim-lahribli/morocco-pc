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
 *   GET /v1/catalog/products      ?state=ok | 503
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
  ERRORS,
  HEALTH_OK,
  IDS,
  META_OPTIONS,
  PRESETS_EMPTY,
  PRESETS_OK,
  PRICE_HISTORY_BY_SLUG,
  RECOMMENDATIONS_BY_ID,
  RECOMMENDATION_OK,
  RECOMMENDATION_REUSED,
  RECOMMENDATION_ZERO_BUILD,
  RECOMMENDATION_ZERO_BUILD_NO_FLOOR,
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
    send(res, 200, CATALOG_LIST_OK);
    return;
  }

  // S25: one product's price history, on its OWN path so the product read
  // below keeps its one-segment shape. The series is selected by SLUG, not by
  // state, because the page reads this on the server: the slug is the only
  // thing a spec can choose from outside the Next process.
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
      const history = PRICE_HISTORY_BY_SLUG[slug];
      // A known product with no readings is a 200 carrying an empty series;
      // only a slug the mock does not serve is a miss.
      if (history === undefined) return sendError(res, "notFound");
      send(res, 200, history);
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
