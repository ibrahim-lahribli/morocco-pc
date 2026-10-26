'use strict';

/**
 * apps/api/test/helpers/stub.js - shared stubs for the DB-free API tests.
 *
 * NOT a `*.test.js` file, so `npm run test:api` does not discover it; it is
 * required by the suites that need it.
 *
 * The row fixtures deliberately mimic pg's WIRE shape rather than a friendly
 * one: every NUMERIC column is a STRING ('12000.00') and timestamps are Date
 * objects. That is the whole point - if the presenter ever stopped converting,
 * the contract test would catch a string where a number belongs, which a
 * hand-written "nice" fixture would have hidden.
 */

const ACTIVE_MODEL = Object.freeze({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  configuration: Object.freeze({ gpu_required_use_cases: ['GAMING', 'WORKSTATION'] }),
});

/**
 * The same shape, but declaring Decision 37 `use_case_profiles` - i.e. what
 * `launch-v2` looks like once seed 013 is applied. OFFICE appears ONLY here,
 * because OFFICE is exactly the use case the legacy `gpu_required_use_cases`
 * derivation could not offer (OG-38).
 */
const PROFILE_MODEL = Object.freeze({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  configuration: Object.freeze({
    gpu_required_use_cases: ['GAMING', 'WORKSTATION'],
    use_case_profiles: Object.freeze({
      GAMING: Object.freeze({ gpu_policy: 'REQUIRED', spend_targets: Object.freeze({ GPU: 0.38 }) }),
      WORKSTATION: Object.freeze({ gpu_policy: 'REQUIRED', spend_targets: Object.freeze({ GPU: 0.25 }) }),
      OFFICE: Object.freeze({ gpu_policy: 'IGPU_ALLOWED', spend_targets: Object.freeze({ CPU: 0.3 }) }),
    }),
  }),
});

const TEST_ENGINE_VERSION = 'test-sha';

/**
 * A stand-in for Decision 47's catalog digest: a fixed, well-formed 32-hex
 * value. Fixed on purpose - a stub that varied per call would make every
 * "identical request" test flaky, and the only property the API needs from it is
 * that it is a STRING it can compare and persist.
 */
const TEST_CATALOG_VERSION = '0123456789abcdef0123456789abcdef';

const SAMPLE_BUDGET_FLOOR = Object.freeze({
  cheapest_total: 4477,
  currency: 'MAD',
  budget_amount: 20000,
  within_budget: true,
  cheapest_by_role: Object.freeze({
    CPU: 899, MOTHERBOARD: 500, RAM: 400, PSU: 599, CASE: 849, CPU_COOLER: 350, SSD_BOOT: 599,
  }),
  missing_roles: Object.freeze([]),
});

/**
 * The query row as SELECT_QUERY_SQL returns it.
 *
 * `budget_floor` is an OBJECT, not a JSON string, because pg parses a jsonb
 * column before the presenter ever sees it - the same wire-shape discipline the
 * NUMERIC fixtures below follow in reverse. A string here would have let a
 * JSON.parse-on-an-object bug pass every test.
 */
const QUERY_ROW = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  budget_amount: '20000',
  currency: 'MAD',
  use_case: 'GAMING',
  // Stored since the Layer 4 schema existed; selected by SELECT_QUERY_SQL only
  // since Decision 52, which needs them to state each input's effect.
  resolution: '1440p',
  // 5, not 3: 3 IS the default archetype order, so it is provably NO_EFFECT for
  // `priority` (Decision 52) and a fixture at 3 could not cover the APPLIED path.
  priority: 5,
  created_at: new Date('2026-10-07T09:00:00.000Z'),
  budget_floor: SAMPLE_BUDGET_FLOOR,
  // The catalog version the pass recorded (migration 021 / Decision 47).
  catalog_version: TEST_CATALOG_VERSION,
  // The model the pass PINNED, and its configuration as the LEFT JOIN in
  // SELECT_QUERY_SQL returns it (a jsonb column pg has already parsed). The
  // ACTIVE_MODEL is the LEGACY shape on purpose: it is what the real shared
  // database serves, and its absence of `use_case_profiles` is the fact
  // `input_effects` must report as NO_EFFECT for resolution rather than invent
  // an effect for.
  scoring_model_id: ACTIVE_MODEL.id,
  configuration: ACTIVE_MODEL.configuration,
});

/**
 * Two builds: b-1 all-SEED_UNVERIFIED, b-2 all-VERIFIED, plus a null component
 * row. The per-result provenance facts (Decision 46) carry TEST_ENGINE_VERSION
 * and a DIFFERENT strategy key per rank, so a presenter that read one value for
 * both builds - or read the wrong row - cannot pass.
 */
const SAMPLE_ROWS = [
  {
    rank: 1,
    explanation: 'Build 1: strongest score within budget.',
    result_created_at: new Date('2026-10-07T09:00:05.000Z'),
    build_candidate_id: 'b-1',
    total_price: '12000.00',
    build_score: '77.5',
    compatibility_status: 'PASS',
    engine_version: TEST_ENGINE_VERSION,
    strategy_key: 'PERFORMANCE',
    component_id: 'c-1a',
    role: 'CPU',
    product_id: 'p-cpu',
    product_variant_id: null,
    selected_price: '1999.00',
    offer_class: 'SEED_UNVERIFIED',
    store_offer_id: 'so-cpu',
    product_name: 'CPU Alpha',
    product_slug: 'cpu-alpha',
    variant_sku: null,
  },
  {
    rank: 1,
    explanation: 'Build 1: strongest score within budget.',
    result_created_at: new Date('2026-10-07T09:00:05.000Z'),
    build_candidate_id: 'b-1',
    total_price: '12000.00',
    build_score: '77.5',
    compatibility_status: 'PASS',
    engine_version: TEST_ENGINE_VERSION,
    strategy_key: 'PERFORMANCE',
    component_id: 'c-1b',
    role: 'GPU',
    product_id: 'p-gpu',
    product_variant_id: 'v-gpu',
    selected_price: '3200.00',
    offer_class: 'SEED_UNVERIFIED',
    store_offer_id: 'so-gpu',
    product_name: 'GPU Beta',
    product_slug: 'gpu-beta',
    variant_sku: 'GPU-BETA-8G',
  },
  {
    rank: 2,
    explanation: 'Build 2: value pick.',
    result_created_at: new Date('2026-10-07T09:00:06.000Z'),
    build_candidate_id: 'b-2',
    total_price: '9800.50',
    build_score: '70',
    compatibility_status: 'PASS',
    engine_version: TEST_ENGINE_VERSION,
    strategy_key: 'VALUE',
    component_id: 'c-2a',
    role: 'CPU',
    product_id: 'p-cpu-2',
    product_variant_id: null,
    selected_price: '1499.00',
    offer_class: 'VERIFIED',
    store_offer_id: 'so-cpu-2',
    product_name: 'CPU Gamma',
    product_slug: 'cpu-gamma',
    variant_sku: null,
  },
  // LEFT-JOIN artifact: the candidate exists but this component row is null.
  {
    rank: 2,
    explanation: 'Build 2: value pick.',
    result_created_at: new Date('2026-10-07T09:00:06.000Z'),
    build_candidate_id: 'b-2',
    total_price: '9800.50',
    build_score: '70',
    compatibility_status: 'PASS',
    engine_version: TEST_ENGINE_VERSION,
    strategy_key: 'VALUE',
    component_id: null,
    role: null,
    product_id: null,
    product_variant_id: null,
    selected_price: null,
    offer_class: null,
    store_offer_id: null,
    product_name: null,
    product_slug: null,
    variant_sku: null,
  },
];

/**
 * The persisted rank-1 build as `readBuildForSwap` returns it, with pg's wire
 * shapes (NUMERIC as strings). CPU 1999 / GPU 3200 and a 12000 total are
 * DELIBERATELY the plan's worked example: a 3200 swap for the 1999 CPU is a
 * 1201 delta and a 13201 total, so an arithmetic regression shows up as a
 * number rather than as a shape.
 */
const SWAP_BUILD = Object.freeze({
  // Decision 56: the commit derives from a recommendation_result ROW, so the
  // read carries its id; the preview ignores it.
  result_id: 'r-result-1',
  rank: 1,
  total_price: '12000.00',
  budget_amount: '20000',
  catalog_version: TEST_CATALOG_VERSION,
  components: Object.freeze([
    Object.freeze({
      role: 'CPU',
      product_id: 'p-cpu',
      product_variant_id: null,
      selected_price: '1999.00',
      currency: 'MAD',
      store_id: 's-1',
      price_checked_at: '2026-10-01T00:00:00.000Z',
      offer_class: 'SEED_UNVERIFIED',
      store_offer_id: 'o-1',
    }),
    Object.freeze({
      role: 'GPU',
      product_id: 'p-gpu',
      product_variant_id: 'v-gpu',
      selected_price: '3200.00',
      currency: 'MAD',
      store_id: 's-2',
      price_checked_at: '2026-10-01T00:00:00.000Z',
      offer_class: 'SEED_UNVERIFIED',
      store_offer_id: 'o-2',
    }),
  ]),
});

/**
 * The engine's COMMIT answer (Decision 56) - the same three facts as a preview
 * plus the persisted link, shaped like the real `commitSwap` envelope.
 */
const SAMPLE_SWAP_COMMIT = Object.freeze({
  committed: true,
  reason: null,
  role: 'CPU',
  blocked_role: null,
  eligibility: null,
  compatibility: Object.freeze({
    status: 'PASS',
    pairs: Object.freeze([
      Object.freeze({
        check: 'cpu_motherboard',
        role: 'MOTHERBOARD',
        partner_role: 'CPU',
        status: 'PASS',
        reason: null,
        evidence: Object.freeze([]),
      }),
    ]),
    unknown_pairwise_count: 0,
  }),
  price: Object.freeze({ next: 3200, offer_class: 'SEED_UNVERIFIED' }),
  build: Object.freeze({
    build_candidate_id: 'b-derived-1',
    total_price: 13201,
    score: 71.5,
    compatibility_status: 'PASS',
    components: Object.freeze([]),
  }),
  swap: Object.freeze({
    role: 'CPU',
    product_id: 'p-cpu-2',
    product_variant_id: null,
    created_at: new Date('2026-10-25T12:00:00.000Z'),
    engine_version: 'test-deploy',
  }),
});

/**
 * The engine's preview answer: one PASS pair and a 3200 price. Shaped like the
 * real `evaluateSwapPreview` envelope, so a presenter that read a field the
 * engine does not produce fails here rather than in production.
 */
const SAMPLE_SWAP_PREVIEW = Object.freeze({
  evaluable: true,
  blocked_role: null,
  compatibility: Object.freeze({
    status: 'PASS',
    pairs: Object.freeze([
      Object.freeze({
        check: 'cpu_motherboard',
        role: 'MOTHERBOARD',
        partner_role: 'CPU',
        status: 'PASS',
        reason: null,
        evidence: Object.freeze([]),
      }),
    ]),
    unknown_pairwise_count: 0,
  }),
  price: Object.freeze({ next: 3200, offer_class: 'SEED_UNVERIFIED' }),
});

function createRepositoryStub(overrides) {
  const state = {
    createCalls: [],
    readCalls: [],
    swapReadCalls: [],
    findCalls: [],
    presetCalls: [],
    // Catalog call logs: the arguments matter as much as the rows, because the
    // keyset contract is "the cursor is forwarded verbatim, and the page query is
    // asked for limit + 1".
    catalogCalls: [],
    catalogDetailCalls: [],
  };
  const stub = {
    state,
    async selectActiveScoringModel() {
      return ACTIVE_MODEL;
    },
    // A MISS by default: the ordinary case, and the one a test that wants a HIT
    // has to opt into explicitly rather than inherit.
    async findReusableQuery(_db, key) {
      state.findCalls.push(key);
      return null;
    },
    async createRecommendationQuery(_client, input) {
      state.createCalls.push(input);
      return Object.freeze({ profileId: 'prof-1', queryId: QUERY_ROW.id });
    },
    async readRecommendationResult(_db, queryId) {
      state.readCalls.push(queryId);
      return { found: true, query: QUERY_ROW, rows: SAMPLE_ROWS };
    },
    // A MISS by default, for the same reason `readCatalogProduct` is: "no such
    // build" is the ordinary 404, and a test that wants a rank has to opt in.
    async readBuildForSwap(_db, queryId, rank) {
      state.swapReadCalls.push({ queryId, rank });
      return { found: false };
    },
    // An EMPTY ribbon by default: the ordinary case, and the one a test that
    // wants rows has to opt into explicitly rather than inherit.
    async selectPresets(_db, key) {
      state.presetCalls.push(key);
      return [];
    },
    // An EMPTY catalogue page by default, for the same reason.
    async selectCatalogProducts(_db, key) {
      state.catalogCalls.push(key);
      return [];
    },
    // A MISS by default: an unknown slug is the ordinary 404, and a test that
    // wants a product page has to opt into it.
    async readCatalogProduct(_db, key) {
      state.catalogDetailCalls.push(key);
      return { found: false };
    },
  };
  return Object.assign(stub, overrides || {});
}

function createEngineStub(runFullRun) {
  // The REAL module, never a copy of its rules: the vocabulary derivation is
  // a property of the engine (Decision 37), so a stub that re-implemented it
  // could agree with a test while the served API disagreed with itself.
  const realEngine = require('../../src/engine');
  const calls = [];
  return {
    calls,
    catalogCalls: [],
    swapCalls: [],
    useCaseVocabulary: realEngine.useCaseVocabulary,
    // The REAL multiplier table, forwarded for the same reason: `input_effects`
    // claims whether resolution moved the GPU target, and a stub with its own
    // copy could agree with a test while the API disagreed with retention.
    resolutionMultiplier: realEngine.resolutionMultiplier,
    // The catalog's role filter is the ENGINE's vocabulary (component_role ->
    // product_category), so the stub forwards the real derivation: a copy here
    // could agree with a test while the served API disagreed with itself.
    catalogRoles: realEngine.catalogRoles,
    categoryForRole: realEngine.categoryForRole,
    // The engine's digest is a real database read, so the unit suites stub it.
    // It is NOT copied from the engine: the value's only contract here is
    // "a 32-hex string", and a copy of the real statement would be a second
    // implementation of something these suites do not test.
    async catalogVersion(client) {
      this.catalogCalls.push(client);
      return TEST_CATALOG_VERSION;
    },
    // The third argument is FORWARDED, not swallowed: it is the deploy the
    // engine records on each result row (Decision 46), so a stub that dropped
    // it would make a test that inspects `engine_version` fail for a reason
    // that has nothing to do with the code under test.
    async runFullRun(client, queryId, engineVersion) {
      calls.push(queryId);
      if (typeof runFullRun === 'function') {
        return runFullRun(client, queryId, engineVersion);
      }
      return { budget_floor: SAMPLE_BUDGET_FLOOR };
    },
    // Decision 55: the role vocabulary and the argument envelope are the
    // ENGINE's (a copy here could agree with a test while the API disagreed with
    // itself), so the stub forwards the real derivation and only the ANSWER is
    // stubbed - it needs a database.
    swapPreviewRoles: realEngine.swapPreviewRoles,
    swapPreviewArgs: realEngine.swapPreviewArgs,
    async evaluateSwapPreviewSnapshot(client, args) {
      this.swapCalls.push({ client, args });
      return SAMPLE_SWAP_PREVIEW;
    },
    // Decision 56: same rule - the argument envelope and the one-swap read are
    // forwarded from the real engine (a copy here could agree with a test while
    // the API disagreed with itself); only the commit's ANSWER is stubbed.
    commitSwapArgs: realEngine.commitSwapArgs,
    commitCalls: [],
    async readCommittedSwap(_db, sourceResultId) {
      this.commitReads = this.commitReads || [];
      this.commitReads.push(sourceResultId);
      return { found: false };
    },
    async commitSwapInTransaction(client, args) {
      this.commitCalls.push({ client, args });
      return SAMPLE_SWAP_COMMIT;
    },
  };
}

function createPoolStub(options) {
  const opts = options || {};
  const client = {
    queries: [],
    released: false,
    async query(sql) {
      this.queries.push(sql);
      return { rows: [] };
    },
    release() {
      this.released = true;
    },
  };
  return {
    client,
    async query(sql) {
      if (opts.queryError) {
        throw new Error(opts.queryError);
      }
      return { rows: [{ ok: 1, sql }] };
    },
    async connect() {
      return client;
    },
    async end() {},
  };
}

/** Build an app with the standard test wiring: stub collaborators, no logger. */
function createTestApp(options) {
  const { buildApp } = require('../../src/app');
  const opts = options || {};
  return buildApp({
    pool: opts.pool === undefined ? createPoolStub() : opts.pool,
    repository: opts.repository || createRepositoryStub(),
    engine: opts.engine || createEngineStub(),
    engineVersion: opts.engineVersion || TEST_ENGINE_VERSION,
    // Forwarded, never defaulted: `undefined` is the production default (read
    // TRUST_PROXY from env), so a stub that passed `false` here would hide a
    // broken env path.
    trustProxy: opts.trustProxy,
    // Forwarded, never defaulted: `undefined` is the production default (a
    // no-op capture, i.e. monitoring off), so a stub must not impose its own
    // spy and make a "nothing was captured" test pass for the wrong reason.
    captureError: opts.captureError,
    env: Object.assign({ ENGINE_VERSION: TEST_ENGINE_VERSION, ALLOWED_ORIGINS: '' }, opts.env),
    logger: false,
  });
}

/** A valid POST body. */
function validBody(overrides) {
  return Object.assign({
    budget_amount: 20000,
    currency: 'MAD',
    use_case: 'GAMING',
  }, overrides || {});
}

module.exports = {
  ACTIVE_MODEL,
  PROFILE_MODEL,
  QUERY_ROW,
  SAMPLE_BUDGET_FLOOR,
  SAMPLE_ROWS,
  SWAP_BUILD,
  SAMPLE_SWAP_COMMIT,
  SAMPLE_SWAP_PREVIEW,
  TEST_ENGINE_VERSION,
  TEST_CATALOG_VERSION,
  createRepositoryStub,
  createEngineStub,
  createPoolStub,
  createTestApp,
  validBody,
};
