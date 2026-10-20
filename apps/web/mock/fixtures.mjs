/**
 * apps/web/mock/fixtures.mjs — every contract state the web app consumes.
 *
 * These are FIXTURES, not samples: each one is a whole response body a sprint
 * can render without a deployed API (S4's fixtures-first path). The shapes are
 * copied from `apps/api/src/contracts/*.js` and pinned end-to-end by
 * `e2e/api-contract.spec.ts`, which fails on a missing field, a wrong type, or
 * a state the client cannot reach.
 *
 * Conventions that matter:
 *   - `catalog_version` is 32 hex characters, as migration 021 and Decision 47
 *     require; a short or non-hex value would make a fixture pass while the real
 *     API's validation (and the client's type) disagrees.
 *   - `price_status` is DERIVED in the API, never stored. The verified build's
 *     components are all VERIFIED; the indicative one carries a SEED_UNVERIFIED
 *     component, and BOTH classes therefore appear in the fixtures (V6).
 *   - NULL is never 0: a missing price is `null`, a missing slug is `null`, and
 *     the zero-build floor with a missing role is `null` + `missing_roles`.
 *   - A build's `total_price` is the SUM of its `price_used` values (assembly
 *     computes it that way) and `budget_floor.budget_amount` is the response's
 *     own budget, because `computeBudgetFloor` copies the query budget in.
 *     Component lists are abbreviated to the roles each point needs to make
 *     (a real pass carries all eight), so the totals are those lists' sums.
 *   - `strategy_key` is a Decision 41 archetype: PERFORMANCE | BALANCED |
 *     VALUE. There is no `PRICE` key; the cheap build is `VALUE`.
 */

export const CATALOG_VERSION = "9f0c5a1b2d3e4f5061728394a5b6c7d8";
export const DISCLAIMER = "Prix indicatifs, non actualisés.";
export const GENERATED_AT = "2026-10-16T09:00:00.000Z";
export const ENGINE_VERSION = "mock-0.0.0";

export const META_OPTIONS = {
  use_cases: [
    { value: "GAMING", label: "Jeu" },
    { value: "OFFICE", label: "Bureau" },
    { value: "WORKSTATION", label: "Travail" },
  ],
  currencies: [{ value: "MAD", label: "Dirham marocain (MAD)" }],
  resolutions: [
    { value: "1080p", label: "Full HD (1080p)" },
    { value: "1440p", label: "QHD (1440p)" },
    { value: "2160p", label: "4K UHD (2160p)" },
  ],
  priorities: [
    { value: 1, label: "Prix d'abord" },
    { value: 3, label: "Équilibré" },
    { value: 5, label: "Performance d'abord" },
  ],
};

const COMPONENT_CPU_VERIFIED = {
  role: "CPU",
  product_id: "11111111-1111-4111-8111-111111111111",
  name: "Ryzen 5 7600",
  slug: "ryzen-5-7600",
  variant: null,
  price_used: 1899,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999901",
};

const COMPONENT_GPU_VERIFIED = {
  role: "GPU",
  product_id: "22222222-2222-4222-8222-222222222222",
  name: "RTX 4060 8GB",
  slug: "rtx-4060-8gb",
  variant: "8GB",
  price_used: 3200,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999902",
};

const COMPONENT_RAM_SEED = {
  role: "RAM",
  product_id: "33333333-3333-4333-8333-333333333333",
  name: "Kit DDR5 16 Go",
  slug: null,
  variant: null,
  price_used: 649,
  offer_class: "SEED_UNVERIFIED",
  store_offer_id: null,
};

/** A floor with every role priced: a buildable-ish minimum, not a promise. */
const BUDGET_FLOOR_COMPLETE = {
  cheapest_total: 4477,
  currency: "MAD",
  budget_amount: 15000,
  within_budget: true,
  cheapest_by_role: {
    CPU: 899,
    GPU: 3200,
    RAM: 349,
    MOTHERBOARD: 749,
    SSD_BOOT: 599,
    PSU: 599,
    CASE: 849,
    CPU_COOLER: 350,
  },
  missing_roles: [],
};

/** A floor with a role missing: `cheapest_total` and `within_budget` are NULL. */
const BUDGET_FLOOR_INCOMPLETE = {
  cheapest_total: null,
  currency: "MAD",
  budget_amount: 3000,
  within_budget: null,
  cheapest_by_role: { CPU: 899, GPU: 3200 },
  missing_roles: ["MOTHERBOARD", "RAM", "SSD_BOOT", "PSU", "CASE", "CPU_COOLER"],
};

function baseResponse(overrides) {
  return {
    id: "b6f1c0a5-0f2f-4f2a-9c0f-2b1f5f2f6a10",
    budget_amount: 15000,
    currency: "MAD",
    use_case: "GAMING",
    generated_at: GENERATED_AT,
    budget_floor: BUDGET_FLOOR_COMPLETE,
    engine_version: ENGINE_VERSION,
    catalog_version: CATALOG_VERSION,
    reused: false,
    reason: null,
    disclaimer: DISCLAIMER,
    served_by: { engine_version: ENGINE_VERSION },
    builds: [],
    ...overrides,
  };
}

/** POST 201: two builds, one VERIFIED (all components verified) and one indicative. */
export const RECOMMENDATION_OK = baseResponse({
  builds: [
    {
      rank: 1,
      engine_version: ENGINE_VERSION,
      strategy_key: "BALANCED",
      total_price: 5099,
      build_score: 61.25,
      compatibility_status: "PASS",
      explanation: "Configuration équilibrée : processeur récent et carte graphique dédiée.",
      price_status: "verified",
      components: [COMPONENT_CPU_VERIFIED, COMPONENT_GPU_VERIFIED],
    },
    {
      rank: 2,
      engine_version: ENGINE_VERSION,
      strategy_key: "VALUE",
      total_price: 2548,
      build_score: 48.9,
      compatibility_status: "PASS",
      explanation: "Configuration au meilleur prix : mémoire non vérifiée.",
      price_status: "indicative",
      components: [COMPONENT_CPU_VERIFIED, COMPONENT_RAM_SEED],
    },
  ],
});

/** POST 200 dedupe hit: same body shape, `reused: true`. The wizard must not refetch. */
export const RECOMMENDATION_REUSED = baseResponse({
  reused: true,
  builds: RECOMMENDATION_OK.builds,
});

/**
 * A pass that assembled nothing, with the floor still computed. `builds: []` is
 * a legitimate outcome (Decision 17.2), not an error.
 */
export const RECOMMENDATION_ZERO_BUILD = baseResponse({
  budget_amount: 6000,
  // The floor repeats the response's budget (computeBudgetFloor copies it in).
  budget_floor: { ...BUDGET_FLOOR_COMPLETE, budget_amount: 6000, within_budget: true },
  reason: "EMPTY_CANDIDATE_POOL",
  builds: [],
});

/** Zero builds with an UNKNOWN floor: the UI must show copy, never a number. */
export const RECOMMENDATION_ZERO_BUILD_NO_FLOOR = baseResponse({
  budget_amount: 3000,
  budget_floor: BUDGET_FLOOR_INCOMPLETE,
  reason: "EMPTY_CANDIDATE_POOL",
  builds: [],
});

/** GET 200 for the presets ribbon: `generated_at` null for an empty list. */
export const PRESETS_OK = {
  catalog_version: CATALOG_VERSION,
  generated_at: GENERATED_AT,
  presets: [
    {
      budget_amount: 6000,
      recommendation_id: "b6f1c0a5-0f2f-4f2a-9c0f-2b1f5f2f6a10",
      build_score: 61.25,
      price_status: "verified",
    },
    {
      budget_amount: 8000,
      recommendation_id: "c7f2d1b6-1a3b-4e5f-8d9e-3c2a6b7c8d91",
      build_score: null,
      price_status: null,
    },
  ],
};

export const PRESETS_EMPTY = {
  catalog_version: CATALOG_VERSION,
  generated_at: null,
  presets: [],
};

export const CATALOG_LIST_OK = {
  products: [
    {
      slug: "rtx-4060-8gb",
      display_name: "RTX 4060 8GB",
      category: "GPU",
      from_price: 3200,
      offer_class: "VERIFIED",
      has_offer: true,
    },
    {
      slug: "kit-ddr5-16-go",
      display_name: "Kit DDR5 16 Go",
      category: "MEMORY",
      from_price: null,
      offer_class: null,
      has_offer: false,
    },
  ],
  next_cursor: null,
};

export const CATALOG_PRODUCT_OK = {
  slug: "rtx-4060-8gb",
  display_name: "RTX 4060 8GB",
  category: "GPU",
  specs: { board_tgp_watts: 115, width_slots: 2, height_mm: 40 },
  offers: [{ price: 3200, currency: "MAD", offer_class: "VERIFIED" }],
  price_status: "verified",
  disclaimer: DISCLAIMER,
};

export const HEALTH_OK = { status: "ok", db: "ok", engine_version: ENGINE_VERSION };

/** Every error the client must map (S10 owns the copy, S4 owns the reaching). */
export const ERRORS = {
  validation: {
    status: 422,
    body: {
      error: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: [{ field: "budget_amount", message: "must be > 0" }],
      request_id: "req_fixture_422",
    },
  },
  tooLarge: {
    status: 413,
    body: { error: "PAYLOAD_TOO_LARGE", message: "Request body is larger than 10 KB" },
  },
  rateLimited: {
    status: 429,
    body: { error: "RATE_LIMITED", message: "Rate limit exceeded", request_id: "req_fixture_429" },
    headers: { "retry-after": "30" },
  },
  unavailable: {
    status: 503,
    body: {
      error: "SCORING_MODEL_UNAVAILABLE",
      message: "No active scoring model is configured",
    },
  },
  notFound: {
    status: 404,
    body: { error: "NOT_FOUND", message: "Unknown recommendation id" },
  },
};
