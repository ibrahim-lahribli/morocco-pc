/**
 * A deterministic local stand-in for the recommendation API.
 *
 * The homepage is data-bearing, so screenshots taken with an aborted API show
 * skeletons. When no API origin is reachable from this machine, this server
 * lets the REAL production build be captured over real HTTP — clearly labelled
 * as fixture data, never as production verification.
 *
 * It answers exactly the three reads the homepage makes and nothing else:
 * `GET /v1/meta/options`, `GET /v1/presets?use_case=…&currency=…` and
 * `GET /v1/recommendations/{id}`.
 *
 * Usage:
 *   node scripts/fixture-api.mjs            # port 3100
 *   FIXTURE_API_PORT=3200 node scripts/fixture-api.mjs
 */
import { createServer } from "node:http";

const PORT = Number(process.env.FIXTURE_API_PORT ?? 3100);
const LADDER = [5_000, 8_000, 12_000, 15_000];
const USE_CASES = ["GAMING", "OFFICE", "WORKSTATION"];
const SCORES = { GAMING: 72.5, OFFICE: 61.5, WORKSTATION: 50 };
const BADGES = { GAMING: "verified", OFFICE: "indicative", WORKSTATION: null };
const COMPONENTS = [
  ["CPU", "AMD Ryzen 5 5600"],
  ["GPU", "NVIDIA GeForce RTX 4060"],
  ["RAM", "32 Go DDR4 3200"],
  ["SSD_BOOT", "NVMe 1 To"],
];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,OPTIONS",
};

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", ...CORS });
  response.end(JSON.stringify(body));
}

function presets(useCase) {
  return {
    catalog_version: "fixture-v1",
    generated_at: null,
    presets: LADDER.map((budget_amount) => ({
      budget_amount,
      recommendation_id: `rec-${useCase}-${budget_amount}`,
      build_score: 60 + budget_amount / 1000,
      price_status: "verified",
    })),
  };
}

function detail(id) {
  const [, useCase = "GAMING", budget = "12000"] = id.split("-");
  const amount = Number(budget);

  return {
    id,
    budget_amount: amount,
    currency: "MAD",
    use_case: useCase,
    generated_at: null,
    catalog_version: "fixture-v1",
    disclaimer: "Prix indicatifs, non actualisés.",
    builds: [
      {
        rank: 1,
        total_price: amount - 500,
        build_score: SCORES[useCase] ?? 60,
        compatibility_status: "PASS",
        strategy_key: "BALANCED",
        explanation: `Trame ${useCase} servie par le moteur (données de fixture).`,
        price_status: BADGES[useCase] ?? null,
        components: COMPONENTS.map(([role, name]) => ({
          role,
          product_id: `${role.toLowerCase()}-fixture`,
          name,
          slug: `${role.toLowerCase()}-fixture`,
          variant: null,
          price_used: 1_999,
          offer_class: "SEED_UNVERIFIED",
          store_offer_id: null,
        })),
      },
    ],
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, CORS);
    response.end();
    return;
  }

  if (request.method !== "GET") {
    json(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  if (url.pathname === "/v1/meta/options") {
    json(response, 200, {
      use_cases: USE_CASES.map((value) => ({ value, label: value })),
      currencies: [{ value: "MAD", label: "Dirham marocain" }],
      resolutions: [{ value: "1080p", label: "1080p" }],
      priorities: [{ value: 3, label: "Équilibré" }],
      inputs_applied: ["use_case", "priority"],
    });
    return;
  }

  if (url.pathname === "/v1/presets") {
    const useCase = url.searchParams.get("use_case") ?? "";
    if (!USE_CASES.includes(useCase)) {
      json(response, 400, { error: "USE_CASE_INVALID", message: "unknown use case" });
      return;
    }
    json(response, 200, presets(useCase));
    return;
  }

  if (url.pathname.startsWith("/v1/recommendations/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    json(response, 200, detail(id));
    return;
  }

  json(response, 404, { error: "NOT_FOUND", message: `no ${url.pathname}` });
});

// No host argument: bind dual-stack, so both  (::1) and 127.0.0.1 reach it.
server.listen(PORT, () => {
  console.log(`fixture API listening on http://127.0.0.1:${PORT}`);
});
