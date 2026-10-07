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

const QUERY_ROW = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  budget_amount: '20000',
  currency: 'MAD',
  use_case: 'GAMING',
  created_at: new Date('2026-10-07T09:00:00.000Z'),
});

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

/** Two builds: b-1 all-SEED_UNVERIFIED, b-2 all-VERIFIED, plus a null component row. */
const SAMPLE_ROWS = [
  {
    rank: 1,
    explanation: 'Build 1: strongest score within budget.',
    result_created_at: new Date('2026-10-07T09:00:05.000Z'),
    build_candidate_id: 'b-1',
    total_price: '12000.00',
    build_score: '77.5',
    compatibility_status: 'PASS',
    component_id: 'c-1a',
    role: 'CPU',
    product_id: 'p-cpu',
    product_variant_id: null,
    selected_price: '1999.00',
    offer_class: 'SEED_UNVERIFIED',
    store_offer_id: 'so-cpu',
    product_name: 'Seed CPU Alpha',
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
    component_id: 'c-1b',
    role: 'GPU',
    product_id: 'p-gpu',
    product_variant_id: 'v-gpu',
    selected_price: '3200.00',
    offer_class: 'SEED_UNVERIFIED',
    store_offer_id: 'so-gpu',
    product_name: 'Seed GPU Beta',
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
    component_id: 'c-2a',
    role: 'CPU',
    product_id: 'p-cpu-2',
    product_variant_id: null,
    selected_price: '1499.00',
    offer_class: 'VERIFIED',
    store_offer_id: 'so-cpu-2',
    product_name: 'Seed CPU Gamma',
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
    component_id: null,
    role: null,
    product_id: null,
    product_variant_id: null,
    selected_price: null,
    offer_class: null,
    store_offer_id: null,
    product_name: null,
    variant_sku: null,
  },
];

const TEST_ENGINE_VERSION = 'test-sha';

function createRepositoryStub(overrides) {
  const state = { createCalls: [], readCalls: [] };
  const stub = {
    state,
    async selectActiveScoringModel() {
      return ACTIVE_MODEL;
    },
    async createRecommendationQuery(_client, input) {
      state.createCalls.push(input);
      return Object.freeze({ profileId: 'prof-1', queryId: QUERY_ROW.id });
    },
    async readRecommendationResult(_db, queryId) {
      state.readCalls.push(queryId);
      return { found: true, query: QUERY_ROW, rows: SAMPLE_ROWS };
    },
  };
  return Object.assign(stub, overrides || {});
}

function createEngineStub(runFullRun) {
  const calls = [];
  return {
    calls,
    async runFullRun(client, queryId) {
      calls.push(queryId);
      if (typeof runFullRun === 'function') {
        return runFullRun(client, queryId);
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
  QUERY_ROW,
  SAMPLE_BUDGET_FLOOR,
  SAMPLE_ROWS,
  TEST_ENGINE_VERSION,
  createRepositoryStub,
  createEngineStub,
  createPoolStub,
  createTestApp,
  validBody,
};
