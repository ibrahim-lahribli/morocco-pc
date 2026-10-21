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
 *   GET /v1/catalog/products/:slug ?state=ok | 404
 *   GET /v1/meta/options          ?state=ok | 503
 *   GET /v1/health                always 200
 *
 * The same state can be sent as an `x-mock-state` header instead, and `delay`
 * works on any route. CORS is open (`*`): the mock is never deployed, and the
 * real CORS policy is proven on the API side (P2 Sprint 4).
 */

import http from "node:http";

import {
  CATALOG_LIST_OK,
  CATALOG_PRODUCT_OK,
  ERRORS,
  HEALTH_OK,
  IDS,
  META_OPTIONS,
  PRESETS_EMPTY,
  PRESETS_OK,
  RECOMMENDATIONS_BY_ID,
  RECOMMENDATION_OK,
  RECOMMENDATION_REUSED,
  RECOMMENDATION_ZERO_BUILD,
  RECOMMENDATION_ZERO_BUILD_NO_FLOOR,
} from "./fixtures.mjs";

const PORT = Number(process.env.MOCK_API_PORT || 3211);
const SLOW_DEFAULT_MS = 8000;

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
    send(res, 200, CATALOG_LIST_OK);
    return;
  }

  const productMatch = path.match(/^\/v1\/catalog\/products\/([^/]+)$/);
  if (req.method === "GET" && productMatch !== null) {
    if (state === "404") return sendError(res, "notFound");
    send(res, 200, { ...CATALOG_PRODUCT_OK, slug: decodeURIComponent(productMatch[1]) });
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
