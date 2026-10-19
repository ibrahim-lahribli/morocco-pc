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
  created_at: new Date('2026-10-07T09:00:00.000Z'),
  budget_floor: SAMPLE_BUDGET_FLOOR,
  // The catalog version the pass recorded (migration 021 / Decision 47).
  catalog_version: TEST_CATALOG_VERSION,
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

function createRepositoryStub(overrides) {
  const state = {
    createCalls: [],
    readCalls: [],
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
    useCaseVocabulary: realEngine.useCaseVocabulary,
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
  TEST_ENGINE_VERSION,
  TEST_CATALOG_VERSION,
  createRepositoryStub,
  createEngineStub,
  createPoolStub,
  createTestApp,
  validBody,
};
