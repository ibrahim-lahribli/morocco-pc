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
 *   - Each state has its OWN id, and `RECOMMENDATIONS_BY_ID` is the map the
 *     mock answers `GET /v1/recommendations/:id` from. That is what makes an
 *     SSR result page testable: the page fetches by the id in its URL, so the
 *     id IS the state selector once no browser is involved to set a header.
 */

export const CATALOG_VERSION = "9f0c5a1b2d3e4f5061728394a5b6c7d8";

/** Every recommendation id the mock serves. A real id is a UUID, so these are too. */
export const IDS = {
  /** POST 201's body: two builds, one verified and one indicative. */
  ok: "b6f1c0a5-0f2f-4f2a-9c0f-2b1f5f2f6a10",
  /** Three builds, all eight roles on the first — the board's drawn case. */
  threeBuilds: "3f5a1c7e-8b2d-4e6f-9a01-5c3d7e9f1a2b",
  /** One build: 1..N is a range (V13), not a layout of three. */
  oneBuild: "1d9e4b2c-6a3f-4c5d-8e7f-2b0a9c8d7e6f",
  /**
   * Every component is SEED_UNVERIFIED: the "démo" price state S12 adds. The
   * API's derived `price_status` cannot express it (it folds into "indicative"),
   * which is exactly why the third state is the client's to compute.
   */
  demo: "5b7e2f9a-4c1d-4a3e-9b8f-7d6c5b4a3928",
  /**
   * A rank-1 build that is INDICATIVE but not demo: one VERIFIED offer and one
   * SEED_UNVERIFIED placeholder. The API derives `price_status: "indicative"`,
   * and the client's third state does not apply — so the total may be shown,
   * and structured data still may not claim it (S19).
   */
  indicative: "6f2d9a41-3c8b-4e7d-9f15-8a2b6c4d0e93",
  /** A build carrying provisional `reasons[]` (CD-2) — the S13 panel. */
  withReasons: "8c4d1e7f-2b9a-4f6c-9d3e-5a1b7c8d9e0f",
  /** A total past the query budget — the bar's overflow state. */
  overBudget: "4c8d2e6f-1a3b-4d5e-9f7a-6b2c8d4e0f1a",
  /** A pass that assembled nothing, with a priced floor. */
  zeroBuild: "7a2b5c8d-3e4f-4a6b-8c9d-0e1f2a3b4c5d",
  /** The same, with a role missing: the floor is UNKNOWN, never 0. */
  zeroBuildNoFloor: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  /**
   * The same pass again with NO floor object at all — the GET-revisit shape of
   * a pass committed before CD-7 (`budget_floor` null, not merely unpriced).
   */
  zeroBuildFloorAbsent: "e9d8b7c6-5a4f-4e3d-9c2b-1a0f8e7d6c5b",
  /**
   * A read that FAILS with 429 rather than 503: the results page's throttled
   * state, which keeps the API's Retry-After as the countdown seconds (S14).
   */
  rateLimited: "00000000-0000-4000-8000-000000000429",
  /** Not served: the 404 the results page turns into its own 404. */
  missing: "00000000-0000-4000-8000-000000000404",
  /**
   * A read that FAILS with 503 rather than 404. The id may be perfectly valid
   * and the engine unavailable, and the results page must be able to tell the
   * two apart: the mock serves this one an error, not a body and not a 404.
   */
  unavailable: "00000000-0000-4000-8000-000000005030",
};
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

const COMPONENT_CPU_VALUE = {
  role: "CPU",
  product_id: "11111111-1111-4111-8111-111111111112",
  name: "Ryzen 5 5600G",
  slug: "ryzen-5-5600g",
  variant: null,
  price_used: 899,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999911",
};

/** The same part with NO store offer: the seed price the demo state is made of. */
const COMPONENT_CPU_SEED = {
  role: "CPU",
  product_id: "11111111-1111-4111-8111-111111111113",
  name: "Ryzen 5 5600G",
  slug: null,
  variant: null,
  price_used: 899,
  offer_class: "SEED_UNVERIFIED",
  store_offer_id: null,
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

const COMPONENT_GPU_HIGH = {
  role: "GPU",
  product_id: "22222222-2222-4222-8222-222222222223",
  name: "RTX 4070 12GB",
  slug: "rtx-4070-12gb",
  variant: "12GB",
  price_used: 4499,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999912",
};

const COMPONENT_RAM_VERIFIED = {
  role: "RAM",
  product_id: "33333333-3333-4333-8333-333333333331",
  name: "Kit DDR5 16 Go",
  slug: "kit-ddr5-16-go",
  variant: "2 × 8 Go",
  price_used: 349,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999903",
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

const COMPONENT_MOTHERBOARD = {
  role: "MOTHERBOARD",
  product_id: "44444444-4444-4444-8444-444444444444",
  name: "B650M",
  slug: "b650m",
  variant: null,
  price_used: 749,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999904",
};

const COMPONENT_SSD = {
  role: "SSD_BOOT",
  product_id: "55555555-5555-4555-8555-555555555555",
  name: "NVMe 1 To",
  slug: "nvme-1-to",
  variant: "1 To",
  price_used: 599,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999905",
};

const COMPONENT_PSU = {
  role: "PSU",
  product_id: "66666666-6666-4666-8666-666666666666",
  name: "Alimentation 650 W",
  slug: "alimentation-650-w",
  variant: "650 W",
  price_used: 599,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999906",
};

const COMPONENT_CASE = {
  role: "CASE",
  product_id: "77777777-7777-4777-8777-777777777777",
  name: "Boîtier moyen tour",
  slug: "boitier-moyen-tour",
  variant: null,
  price_used: 849,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999907",
};

const COMPONENT_COOLER = {
  role: "CPU_COOLER",
  product_id: "88888888-8888-4888-8888-888888888888",
  name: "Ventirad 120 mm",
  slug: "ventirad-120-mm",
  variant: null,
  price_used: 350,
  offer_class: "VERIFIED",
  store_offer_id: "99999999-9999-4999-8999-999999999908",
};

/**
 * A build whose `total_price` is DERIVED from its components, so the fixture
 * cannot describe a total its own parts contradict (the contract spec checks the
 * same invariant against the mock).
 */
function build({ rank, strategy_key, price_status, explanation, components }) {
  const total_price = components.reduce((sum, component) => sum + component.price_used, 0);
  return {
    rank,
    engine_version: ENGINE_VERSION,
    strategy_key,
    total_price,
    build_score: null,
    compatibility_status: "PASS",
    explanation,
    price_status,
    components,
  };
}

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
    id: IDS.ok,
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
 * Three builds with the category names the board draws, all eight roles on the
 * first: the card's component list is only proven against a full build. Rank 2
 * carries a SEED_UNVERIFIED part, so both price states appear in one response.
 */
export const RECOMMENDATION_THREE_BUILDS = baseResponse({
  id: IDS.threeBuilds,
  builds: [
    build({
      rank: 1,
      strategy_key: "BALANCED",
      price_status: "verified",
      explanation: "Configuration équilibrée : processeur récent et carte graphique dédiée.",
      components: [
        COMPONENT_CPU_VERIFIED,
        COMPONENT_GPU_VERIFIED,
        COMPONENT_RAM_VERIFIED,
        COMPONENT_MOTHERBOARD,
        COMPONENT_SSD,
        COMPONENT_PSU,
        COMPONENT_CASE,
        COMPONENT_COOLER,
      ],
    }),
    build({
      rank: 2,
      strategy_key: "VALUE",
      price_status: "indicative",
      explanation: "Configuration au meilleur prix : mémoire non vérifiée.",
      components: [
        COMPONENT_CPU_VALUE,
        COMPONENT_RAM_SEED,
        COMPONENT_MOTHERBOARD,
        COMPONENT_SSD,
        COMPONENT_PSU,
        COMPONENT_CASE,
        COMPONENT_COOLER,
      ],
    }),
    build({
      rank: 3,
      strategy_key: "PERFORMANCE",
      price_status: "verified",
      explanation: "Configuration performance : carte graphique plus puissante.",
      components: [
        COMPONENT_CPU_VERIFIED,
        COMPONENT_GPU_HIGH,
        COMPONENT_RAM_VERIFIED,
        COMPONENT_MOTHERBOARD,
        COMPONENT_SSD,
        COMPONENT_PSU,
        COMPONENT_CASE,
        COMPONENT_COOLER,
      ],
    }),
  ],
});

/** One build: the page must render one card, not three with two holes (V13). */
export const RECOMMENDATION_ONE_BUILD = baseResponse({
  id: IDS.oneBuild,
  builds: [RECOMMENDATION_THREE_BUILDS.builds[0]],
});

/**
 * Every price is a SEED_UNVERIFIED placeholder, so nothing in the pass is a
 * quote: the card must say "démo", not "indicatif" (V6, S12). The API's own
 * derived `price_status` is `indicative` for this build — the third state exists
 * only on the client, which is why the fixture is needed.
 */
export const RECOMMENDATION_DEMO = baseResponse({
  id: IDS.demo,
  budget_amount: 8000,
  budget_floor: { ...BUDGET_FLOOR_COMPLETE, budget_amount: 8000 },
  use_case: "OFFICE",
  builds: [
    build({
      rank: 1,
      strategy_key: "VALUE",
      price_status: "indicative",
      explanation: "Configuration au meilleur prix : tous les prix sont des estimations.",
      components: [COMPONENT_CPU_SEED, COMPONENT_RAM_SEED],
    }),
  ],
});

/**
 * A rank-1 INDICATIVE pass: one real offer, one placeholder. The page shows
 * the total and the Indicatif badge; the JSON-LD gate must emit nothing.
 */
export const RECOMMENDATION_INDICATIVE = baseResponse({
  id: IDS.indicative,
  budget_amount: 9000,
  budget_floor: { ...BUDGET_FLOOR_COMPLETE, budget_amount: 9000 },
  builds: [
    build({
      rank: 1,
      strategy_key: "BALANCED",
      price_status: "indicative",
      explanation: "Configuration équilibrée : mémoire non vérifiée.",
      components: [COMPONENT_CPU_VERIFIED, COMPONENT_RAM_SEED],
    }),
  ],
});

/**
 * A total PAST the query budget. The engine aims to stay inside the budget, so
 * this state is defensive rather than expected - but a persisted pass is not
 * re-derived against a new budget, and the page must not paint 114 % of a budget
 * as if it were fine.
 */
export const RECOMMENDATION_OVER_BUDGET = baseResponse({
  id: IDS.overBudget,
  budget_amount: 5000,
  budget_floor: { ...BUDGET_FLOOR_COMPLETE, budget_amount: 5000, within_budget: true },
  builds: [RECOMMENDATION_THREE_BUILDS.builds[0]],
});

/**
 * A pass that assembled nothing, with the floor still computed. `builds: []` is
 * a legitimate outcome (Decision 17.2), not an error.
 */
export const RECOMMENDATION_ZERO_BUILD = baseResponse({
  id: IDS.zeroBuild,
  budget_amount: 6000,
  // The floor repeats the response's budget (computeBudgetFloor copies it in).
  budget_floor: { ...BUDGET_FLOOR_COMPLETE, budget_amount: 6000, within_budget: true },
  reason: "EMPTY_CANDIDATE_POOL",
  builds: [],
});

/** Zero builds with an UNKNOWN floor: the UI must show copy, never a number. */
export const RECOMMENDATION_ZERO_BUILD_NO_FLOOR = baseResponse({
  id: IDS.zeroBuildNoFloor,
  budget_amount: 3000,
  budget_floor: BUDGET_FLOOR_INCOMPLETE,
  reason: "EMPTY_CANDIDATE_POOL",
  builds: [],
});

/**
 * A zero-build pass with NO floor object at all: `budget_floor` is null, the
 * GET-revisit shape of a pass the engine could not (or did not) compute a
 * floor for. The page must show the generic copy and invent no floor number
 * for a field the response does not carry (S14 scenario 2).
 */
export const RECOMMENDATION_ZERO_BUILD_FLOOR_ABSENT = baseResponse({
  id: IDS.zeroBuildFloorAbsent,
  budget_amount: 4000,
  budget_floor: null,
  reason: "EMPTY_CANDIDATE_POOL",
  builds: [],
});

/**
 * A build carrying `reasons[]` — the PROVISIONAL contract state S13 is built for.
 *
 * The field is not in contract v1.5 (CD-2): Decision 44's `deriveReasons()`
 * exists in the engine, but no route serves it yet, so the real API omits it and
 * the page falls back to `explanation`. The mock serves it on this id alone so
 * the reasons path is exercised end to end — the results page is server-
 * rendered, so a browser `page.route` cannot substitute a body here.
 *
 * The list is the engine's own `{ code, value }` shape, in Decision 44's
 * REASON_ORDER, plus one code this client does not know: an unknown code becomes
 * a generic line and must never reach the screen raw (S13 scenario 3).
 */
export const RECOMMENDATION_WITH_REASONS = baseResponse({
  id: IDS.withReasons,
  builds: [
    {
      ...RECOMMENDATION_THREE_BUILDS.builds[0],
      reasons: [
        { code: "STRATEGY", value: "BALANCED" },
        { code: "BUDGET_USED_PCT", value: 57.29333333333334 },
        { code: "GPU_SHARE", value: 0.3723 },
        { code: "DOMINANT_ROLE", value: "GPU" },
        { code: "BIOS_UPDATE_REQUIRED", value: ["1.2.3"] },
        { code: "UNKNOWN_SPEC", value: ["CPU_COOLER"] },
        {
          code: "INPUT_APPLIED",
          value: { use_case: "GAMING", resolution: "1440p", priority: 3, gpu_policy: null },
        },
        { code: "LIMITED_CATALOG", value: ["FEWER_THAN_THREE_DISTINCT_ARCHETYPES"] },
        { code: "FUTURE_REASON", value: "not-yet-known" },
      ],
    },
  ],
});

/**
 * The map the mock answers `GET /v1/recommendations/:id` from.
 *
 * An id that is not here is a 404, as the real API's is: a result id is a
 * durable reference, and a server that invented a body for one would hide the
 * page's own not-found path.
 */
export const RECOMMENDATIONS_BY_ID = {
  [IDS.ok]: RECOMMENDATION_OK,
  [IDS.threeBuilds]: RECOMMENDATION_THREE_BUILDS,
  [IDS.oneBuild]: RECOMMENDATION_ONE_BUILD,
  [IDS.demo]: RECOMMENDATION_DEMO,
  [IDS.indicative]: RECOMMENDATION_INDICATIVE,
  [IDS.withReasons]: RECOMMENDATION_WITH_REASONS,
  [IDS.overBudget]: RECOMMENDATION_OVER_BUDGET,
  [IDS.zeroBuild]: RECOMMENDATION_ZERO_BUILD,
  [IDS.zeroBuildNoFloor]: RECOMMENDATION_ZERO_BUILD_NO_FLOOR,
  [IDS.zeroBuildFloorAbsent]: RECOMMENDATION_ZERO_BUILD_FLOOR_ABSENT,
};

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
