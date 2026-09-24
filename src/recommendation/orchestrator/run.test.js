'use strict';

// ---------------------------------------------------------------------------
// Decision 17 (src/recommendation/orchestrator/): focused tests for
// runRecommendation, the no-writes orchestrator.
//
// This file proves ONLY the wiring contract: the Decision 17.3 order, the value
// handed between stages (in particular that ONE Stage 1 result is the single
// pool/price source and that ONE filtering-context object reaches both
// filterCandidates and Engine 3), the single assessment load, retention inputs
// and outputs, the transaction timestamp, the failure short-circuits and the
// frozen result shape. Stage internals (2A/2B/2C/2D/3/4) are NOT re-tested
// here - see the sibling module tests.
//
// The database is a deterministic fake client (same engineering as
// src/recommendation/filtering/pipeline.test.js): SQL is routed by marker
// (longest marker first) and rows are scoped exactly like a parameterized
// `= ANY($1::uuid[])` statement. Collaborators are observed through the
// documented namespace-call seam (see run.js): a plain patch + restore, no
// mocking framework.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runRecommendation, SELECT_NOW_SQL } = require('./run');
const { runRecommendationSnapshot, BEGIN_SQL, ROLLBACK_SQL } = require('./snapshot');
const candidatesModule = require('../candidates');
const offersModule = require('../offers');
const filteringModule = require('../filtering');
const scoringModule = require('../scoring');
const retentionModule = require('../retention');
const assemblyModule = require('../assembly');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// ---------------------------------------------------------------------------
// Fixture ids and the one timestamp every assertion shares.
// NOW_ISO is deliberately far in the future so that a JS clock read would be
// immediately visible (see the nowMs test).
// ---------------------------------------------------------------------------

// Hex-only UUID-shaped ids: the Stage 1 price carrier validates store_id with
// an RFC-4122 regex, so fixture ids must be real hex (not 'uuuuuuuu-...').
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const V = (n) => '00000000-0000-4000-9000-' + String(n).padStart(12, '0');
const P = (n) => '11111111-1111-4111-8111-' + String(n).padStart(12, '0');

const QUERY_ID = U(901);
const MODEL_ID = U(902);
const STORE_ID = U(903);
const CPU_ID = U(1);
const ORPHAN_CPU_ID = U(11); // candidate row WITHOUT an offer -> Stage 1 drops it
const MB_ID = U(2);
const RAM_ID = U(3);
const GPU_ID = U(4);
const GPU_VARIANT_ID = V(1);
const PSU_ID = U(5);
const COOLER_ID = U(6);
const COOLER_ALT_ID = U(16);
const CASE_ID = U(7);
const SSD_ID = U(8);
const SOCKET_ID = P(1);
const PLATFORM_ID = P(1);
const FAMILY_ID = P(10);
const MEMORY_TYPE_ID = P(20);

const NOW_ISO = '2030-01-01T00:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const DAY_MS = 24 * 60 * 60 * 1000;

/** A complete Decision 3(a) configuration (all eight roles weighted). */
function makeConfiguration(overrides = {}) {
  return {
    version_note: 'orchestrator unit fixture',
    role_weights: {
      CPU: { PERFORMANCE: 0.4, VALUE: 0.3 },
      MOTHERBOARD: { QUALITY: 0.5, VALUE: 0.3 },
      RAM: { PERFORMANCE: 0.4, VALUE: 0.4 },
      GPU: { PERFORMANCE: 0.5, VALUE: 0.25 },
      PSU: { QUALITY: 0.5, EFFICIENCY: 0.3 },
      CASE: { QUALITY: 0.5, VALUE: 0.3 },
      CPU_COOLER: { THERMALS: 0.5, QUALITY: 0.3 },
      SSD_BOOT: { PERFORMANCE: 0.5, VALUE: 0.3 },
    },
    type_weights: {
      PERFORMANCE: 0.5, VALUE: 0.25, QUALITY: 0.25, EFFICIENCY: 0.3, THERMALS: 0.5,
    },
    neutral_baseline: 50,
    no_evidence_penalty: 10,
    unknown_compat_penalty: 5,
    confidence_multipliers: {
      CONFIRMED: 1, HIGH: 0.8, MEDIUM: 0.6, LOW: 0.3, UNVERIFIED: 0,
    },
    staleness: { max_age_days: 180, per_day_decay: 0.005 },
    candidate_caps: { top_k_per_role: 5, max_builds_per_query: 25 },
    gpu_required_use_cases: ['GAMING', 'WORKSTATION'],
    ...overrides,
  };
}

const PRICE_BY_PRODUCT = {
  [CPU_ID]: 1800,
  [MB_ID]: 1500,
  [RAM_ID]: 700,
  [GPU_ID]: 3200,
  [PSU_ID]: 650,
  [CASE_ID]: 900,
  [COOLER_ID]: 350,
  [SSD_ID]: 800,
};
const CHEAPEST_BUILD_TOTAL = 9900;

function offerRow(index, productId, price, variantId = null) {
  return {
    id: U(500 + index),
    store_id: STORE_ID,
    product_id: productId,
    product_variant_id: variantId,
    price,
    currency: 'MAD',
    availability: 'IN_STOCK',
    last_checked_at: new Date(NOW_MS - DAY_MS),
    price_checked_at: new Date(NOW_MS),
  };
}

function defaultOffers(extra = []) {
  const rows = Object.keys(PRICE_BY_PRODUCT).map((productId, index) =>
    offerRow(
      index,
      productId,
      PRICE_BY_PRODUCT[productId],
      productId === GPU_ID ? GPU_VARIANT_ID : null
    )
  );
  return rows.concat(extra);
}

function assessmentRow(productId, assessmentType, score, confidence) {
  return {
    product_id: productId,
    assessment_type: assessmentType,
    score,
    confidence,
    assessed_at: NOW_MS - 10 * DAY_MS,
    loaded_at: new Date(NOW_MS),
  };
}

function defaultAssessments(extra = []) {
  return [
    assessmentRow(CPU_ID, 'PERFORMANCE', 80, 'HIGH'),
    assessmentRow(CPU_ID, 'VALUE', 60, 'MEDIUM'),
    assessmentRow(MB_ID, 'QUALITY', 70, 'MEDIUM'),
    assessmentRow(RAM_ID, 'PERFORMANCE', 65, 'HIGH'),
    assessmentRow(GPU_ID, 'PERFORMANCE', 85, 'HIGH'),
    assessmentRow(PSU_ID, 'QUALITY', 75, 'MEDIUM'),
    assessmentRow(CASE_ID, 'QUALITY', 70, 'MEDIUM'),
    assessmentRow(COOLER_ID, 'THERMALS', 76, 'HIGH'),
    assessmentRow(SSD_ID, 'PERFORMANCE', 70, 'HIGH'),
    ...extra,
  ];
}
// ---------------------------------------------------------------------------
// Fake database (routed by SQL marker, longest first) + observation helpers.
// ---------------------------------------------------------------------------

/** Emulate `= ANY($1::uuid[])` scoping: rows outside the id list never surface. */
function scopeRowsByParams(rows, params) {
  const idList = Array.isArray(params) && Array.isArray(params[0]) ? params[0] : null;
  if (!idList) return rows;
  const ids = new Set(idList);
  return rows.filter((row) => Object.values(row).some((value) => ids.has(value)));
}

function baseRoutes(overrides = {}) {
  const configuration = makeConfiguration(overrides.configuration);
  const candidateCaps = overrides.caps
    ? { ...configuration.candidate_caps, ...overrides.caps }
    : undefined;
  return {
    'FROM recommendation_query': overrides.queryRows || [overrides.queryRow || {
      id: QUERY_ID,
      budget_amount: '12000.00',
      currency: 'MAD',
      use_case: 'GAMING',
      scoring_model_id: MODEL_ID,
    }],
    'FROM scoring_model': [{
      id: MODEL_ID,
      name: 'orchestrator-unit-fixture',
      version: '1.0.0',
      description: 'Decision 17 orchestrator unit fixture',
      configuration: candidateCaps
        ? { ...configuration, candidate_caps: candidateCaps }
        : configuration,
      is_active: overrides.modelActive === undefined ? true : overrides.modelActive,
      created_at: new Date(NOW_MS),
      updated_at: new Date(NOW_MS),
    }],
    // Unique to the Engine 2B ambiguity guard (longest-marker routing: it also
    // contains 'FROM motherboard_spec', which must NOT win).
    'count(*) AS category_count': [],
    'EXISTS (SELECT 1 FROM cpu_spec': [
      { product_id: CPU_ID, product_variant_id: null },
      { product_id: ORPHAN_CPU_ID, product_variant_id: null },
    ],
    'EXISTS (SELECT 1 FROM motherboard_spec': [{ product_id: MB_ID, product_variant_id: null }],
    'EXISTS (SELECT 1 FROM ram_spec': [{ product_id: RAM_ID, product_variant_id: null }],
    'EXISTS (SELECT 1 FROM ssd_spec': [{ product_id: SSD_ID, product_variant_id: null }],
    'EXISTS (SELECT 1 FROM psu_spec': [{ product_id: PSU_ID, product_variant_id: null }],
    'EXISTS (SELECT 1 FROM case_spec': [{ product_id: CASE_ID, product_variant_id: null }],
    'EXISTS (SELECT 1 FROM cooler_spec': overrides.coolerCandidates
      || [{ product_id: COOLER_ID, product_variant_id: null }],
    'JOIN gpu_board_spec s ON': [{ product_id: GPU_ID, product_variant_id: GPU_VARIANT_ID }],
    'FROM store_offer': overrides.offers || defaultOffers(),
    'FROM cpu_spec': [
      { product_id: CPU_ID, socket_id: SOCKET_ID, product_family_id: FAMILY_ID, integrated_gpu_present: true },
      { product_id: ORPHAN_CPU_ID, socket_id: SOCKET_ID, product_family_id: FAMILY_ID, integrated_gpu_present: false },
    ],
    'FROM motherboard_spec': [{
      product_id: MB_ID, socket_id: SOCKET_ID, form_factor: 'ATX', memory_type_id: MEMORY_TYPE_ID,
    }],
    'FROM ram_spec': [{ product_id: RAM_ID, memory_type_id: MEMORY_TYPE_ID }],
    'FROM cooler_spec': overrides.coolerSpecs || [{ product_id: COOLER_ID, cooling_type: 'AIR' }],
    'FROM case_spec': [{
      product_id: CASE_ID, max_gpu_length_mm: 360, max_gpu_thickness_slots: 3,
    }],
    'FROM psu_spec': [{
      product_id: PSU_ID, rated_wattage: 850, connector_24pin_atx: true,
      connector_eps_count: 2, connector_pcie_8pin: 2, connector_12vhpwr: 0, connector_sata: 4,
    }],
    'FROM gpu_board_spec': [{
      product_variant_id: GPU_VARIANT_ID, length_mm: 300, width_slots: '2.50',
      required_power_connectors: { pcie_8pin: 1 }, recommended_psu_watts: 650,
    }],
    'FROM cpu_motherboard_support': [{
      id: 'cm-1', motherboard_product_id: MB_ID, cpu_product_id: CPU_ID,
      cpu_product_family_id: null, support_status: 'PASS', min_bios_version: null,
    }],
    'FROM cooler_socket_support': overrides.coolerSocket || [{
      id: 'cs-1', cooler_product_id: COOLER_ID, socket_id: SOCKET_ID, support_status: 'PASS',
    }],
    'FROM case_motherboard_form_factor': [{
      id: 'cff-1', case_product_id: CASE_ID, form_factor: 'ATX',
    }],
    'FROM case_radiator_support': [],
    'FROM platform_memory_support': [{
      platform_id: PLATFORM_ID, memory_type_id: MEMORY_TYPE_ID,
    }],
    'FROM platform': [{ id: PLATFORM_ID, socket_id: SOCKET_ID }],
    'FROM component_assessment': overrides.assessments || defaultAssessments(),
  };
}

/** Recording fake client: every statement is kept in call order. */
function createDb(options = {}) {
  const calls = [];
  const entries = Object.entries(baseRoutes(options.routes))
    .map(([marker, rows]) => ({ marker, rows }))
    .sort((a, b) => b.marker.length - a.marker.length);

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === SELECT_NOW_SQL) {
        const rows = Object.prototype.hasOwnProperty.call(options, 'nowRows')
          ? options.nowRows
          : [{ now: new Date(NOW_MS) }];
        return { rows };
      }
      if (sql === BEGIN_SQL || sql === ROLLBACK_SQL || sql === 'COMMIT') {
        return { rows: [] };
      }
      for (const entry of entries) {
        if (sql.includes(entry.marker)) {
          return { rows: scopeRowsByParams(entry.rows, params) };
        }
      }
      throw new Error('unexpected query in the orchestrator fixture: ' + sql);
    },
  };
}

/**
 * Patch one collaborator namespace property (the seam run.js documents).
 * `calls[i].result` is the return value (a promise for async collaborators).
 */
function spyOn(namespace, name, impl) {
  const original = namespace[name];
  const calls = [];
  namespace[name] = function spy(...args) {
    const record = { args, result: null };
    calls.push(record);
    record.result = impl ? impl(args, calls, original) : original.apply(namespace, args);
    return record.result;
  };
  return {
    calls,
    restore() {
      namespace[name] = original;
    },
  };
}

/** Install several spies, run `body`, always restore. */
async function withSpies(specs, body) {
  const spies = {};
  for (const spec of specs) {
    spies[spec.key] = spyOn(spec.namespace, spec.name);
  }
  try {
    return await body(spies);
  } finally {
    for (const key of Object.keys(spies)) {
      spies[key].restore();
    }
  }
}

/**
 * Engine 2D context-loader queries: id-array scoped AND reading a Layer 1 spec /
 * compatibility / platform table. Stage 1 (store_offer) and the assessment load
 * are also id-array scoped, so both are excluded explicitly; the Engine 2B
 * candidate queries and its ambiguity guard are unscoped (params []).
 */
const CONTEXT_MARKERS = [
  'FROM cpu_spec', 'FROM motherboard_spec', 'FROM ram_spec', 'FROM cooler_spec',
  'FROM case_spec', 'FROM psu_spec', 'FROM gpu_board_spec',
  'FROM cpu_motherboard_support', 'FROM cooler_socket_support',
  'FROM case_motherboard_form_factor', 'FROM case_radiator_support',
  'FROM platform_memory_support', 'FROM platform',
];
function isContextQuery(call) {
  if (!Array.isArray(call.params) || !Array.isArray(call.params[0])) return false;
  if (call.sql.includes('FROM store_offer') || call.sql.includes('FROM component_assessment')) {
    return false;
  }
  return CONTEXT_MARKERS.some((marker) => call.sql.includes(marker));
}

const countCalls = (calls, predicate) => calls.filter(predicate).length;
const indexOfCall = (calls, predicate) => calls.findIndex(predicate);

/** Strip block and line comments so a source assertion cannot self-match docs. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
// ---------------------------------------------------------------------------
// 1. Result shape, freezing and the one build the fixture can assemble.
// ---------------------------------------------------------------------------

test('runRecommendation: one pass returns the frozen Decision 17.2 shape', async () => {
  const db = createDb();
  const result = await runRecommendation({ db, queryId: QUERY_ID });

  assert.deepEqual(Object.keys(result), [
    'query_id',
    'scoring_model_id',
    'builds',
    'budget_amount',
    'currency',
    'build_contributions',
  ]);
  assert.equal(result.query_id, QUERY_ID);
  assert.equal(result.scoring_model_id, MODEL_ID);
  assert.equal(result.budget_amount, 12000);
  assert.equal(result.currency, 'MAD');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.builds));
  assert.equal(result.builds.length, 1);
  assert.ok(Object.isFrozen(result.build_contributions));
  assert.equal(result.build_contributions.length, result.builds.length);
  assert.ok(Array.isArray(result.build_contributions[0]));
});

test('each build is the Engine 3 build plus exactly one build_score field', async () => {
  const db = createDb();
  await withSpies([{ key: 'assembly', namespace: assemblyModule, name: 'assembleBuildsForRecommendation' }], async (spies) => {
    const out = await runRecommendation({ db, queryId: QUERY_ID });
    const engine3 = spies.assembly.calls[0].result;

    assert.equal(out.builds.length, engine3.builds.length);
    for (let index = 0; index < out.builds.length; index += 1) {
      const build = out.builds[index];
      const source = engine3.builds[index];
      assert.deepEqual(
        Object.keys(build).sort(),
        ['build_score', 'components', 'currency', 'total_price', 'unknown_pairwise_count']
      );
      assert.equal(build.components, source.components);
      assert.equal(build.total_price, source.total_price);
      assert.equal(build.currency, source.currency);
      assert.equal(build.unknown_pairwise_count, source.unknown_pairwise_count);
      assert.equal(build.total_price, CHEAPEST_BUILD_TOTAL);
      assert.equal(typeof build.build_score, 'number');
      assert.ok(build.build_score >= 0 && build.build_score <= 100);
      assert.ok(Object.isFrozen(build));
      assert.ok(Object.isFrozen(source));
    }
  });
});

test('build_score is the index-aligned computeBuildScores value for the same model, assessments and nowMs', async () => {
  const db = createDb();
  await withSpies([
    { key: 'model', namespace: scoringModule, name: 'loadScoringModel' },
    { key: 'assessment', namespace: scoringModule, name: 'loadComponentAssessments' },
    { key: 'assembly', namespace: assemblyModule, name: 'assembleBuildsForRecommendation' },
    { key: 'buildScores', namespace: scoringModule, name: 'computeBuildScores' },
  ], async (spies) => {
    const out = await runRecommendation({ db, queryId: QUERY_ID });
    const model = await spies.model.calls[0].result;
    const assessmentResult = await spies.assessment.calls[0].result;
    const engine3 = spies.assembly.calls[0].result;
    const scored = await spies.buildScores.calls[0].result;

    const independent = scoringModule.computeBuildScores({
      builds: engine3.builds,
      assessments: assessmentResult.assessments,
      configuration: model.configuration,
      nowMs: NOW_MS,
    });
    assert.deepEqual(scored, independent);
    assert.deepEqual(scored.scores.map((entry) => entry.build_index), [0]);
    for (let index = 0; index < out.builds.length; index += 1) {
      assert.equal(out.builds[index].build_score, independent.scores[index].build_score);
    }
  });
});

test('build_contributions is the index-aligned computeBuildScoreContributions value (Decision 22 item 1)', async () => {
  const db = createDb();
  await withSpies([
    { key: 'model', namespace: scoringModule, name: 'loadScoringModel' },
    { key: 'assessment', namespace: scoringModule, name: 'loadComponentAssessments' },
    { key: 'assembly', namespace: assemblyModule, name: 'assembleBuildsForRecommendation' },
    { key: 'contributions', namespace: scoringModule, name: 'computeBuildScoreContributions' },
  ], async (spies) => {
    const out = await runRecommendation({ db, queryId: QUERY_ID });
    const model = await spies.model.calls[0].result;
    const assessmentResult = await spies.assessment.calls[0].result;
    const engine3 = spies.assembly.calls[0].result;
    const recorded = await spies.contributions.calls[0].result;

    const independent = scoringModule.computeBuildScoreContributions({
      builds: engine3.builds,
      assessments: assessmentResult.assessments,
      configuration: model.configuration,
      nowMs: NOW_MS,
    });
    assert.deepEqual(recorded, independent);
    assert.equal(out.build_contributions.length, out.builds.length);
    for (let index = 0; index < out.builds.length; index += 1) {
      assert.deepEqual(out.build_contributions[index], independent.contributions[index]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The transaction timestamp (Decision 17.2 / G4).
// ---------------------------------------------------------------------------

test('nowMs is the transaction timestamp: the second statement, threaded into both scoring steps', async () => {
  const db = createDb();
  await withSpies([
    { key: 'candidateScores', namespace: scoringModule, name: 'computeCandidateScores' },
    { key: 'buildScores', namespace: scoringModule, name: 'computeBuildScores' },
  ], async (spies) => {
    await runRecommendation({ db, queryId: QUERY_ID });

    assert.equal(SELECT_NOW_SQL, 'SELECT CURRENT_TIMESTAMP AS now');
    assert.equal(db.calls[0].sql.includes('FROM recommendation_query'), true);
    assert.equal(db.calls[1].sql, SELECT_NOW_SQL);

    const candidateArgs = spies.candidateScores.calls[0].args[0];
    const buildArgs = spies.buildScores.calls[0].args[0];
    assert.equal(candidateArgs.nowMs, NOW_MS);
    assert.equal(buildArgs.nowMs, NOW_MS);
    // The fixture timestamp is 2030: this cannot be a JS clock read.
    assert.ok(Math.abs(Date.now() - NOW_MS) > DAY_MS);
  });
});

test('an unusable transaction timestamp fails fast and no later stage runs', async () => {
  const noRow = createDb({ nowRows: [] });
  await assert.rejects(runRecommendation({ db: noRow, queryId: QUERY_ID }), (error) =>
    error instanceof CandidateSelectionError
      && error.code === ERROR_CODES.MISSING_REQUIRED_FIELD
      && error.field === 'now');
  assert.equal(noRow.calls.length, 2);

  const unparseable = createDb({ nowRows: [{ now: 'not-a-timestamp' }] });
  await assert.rejects(runRecommendation({ db: unparseable, queryId: QUERY_ID }), (error) =>
    error instanceof CandidateSelectionError
      && error.code === ERROR_CODES.INVALID_FIELD_VALUE
      && error.field === 'now');
  assert.equal(unparseable.calls.length, 2);
});
// ---------------------------------------------------------------------------
// 3. Wiring order (recorded statements) and the loadCandidates -> 2C handoff.
// ---------------------------------------------------------------------------

test('the recorded statement order is the Decision 17.3 order, each loader exactly once', async () => {
  const db = createDb();
  await runRecommendation({ db, queryId: QUERY_ID });

  const queryIndex = indexOfCall(db.calls, (call) => call.sql.includes('FROM recommendation_query'));
  const nowIndex = indexOfCall(db.calls, (call) => call.sql === SELECT_NOW_SQL);
  const modelIndex = indexOfCall(db.calls, (call) => call.sql.includes('FROM scoring_model'));
  const offerIndex = indexOfCall(db.calls, (call) => call.sql.includes('FROM store_offer'));
  const assessmentIndex = indexOfCall(db.calls, (call) => call.sql.includes('FROM component_assessment'));
  const lastCandidateIndex = db.calls.reduce((last, call, index) => (
    call.sql.includes('EXISTS (SELECT 1 FROM') || call.sql.includes('JOIN gpu_board_spec s ON')
  ) ? index : last, -1);
  const contextIndexes = db.calls
    .map((call, index) => (isContextQuery(call) ? index : -1))
    .filter((index) => index !== -1);
  assert.ok(contextIndexes.length > 0, 'the Engine 2D context loader must query its tables');
  const firstContextIndex = contextIndexes[0];
  const lastContextIndex = contextIndexes[contextIndexes.length - 1];

  assert.equal(queryIndex, 0);
  assert.equal(nowIndex, 1);
  assert.equal(modelIndex, 2);
  assert.ok(modelIndex < lastCandidateIndex, 'the pinned model load precedes the candidate load');
  assert.ok(lastCandidateIndex < offerIndex, 'Engine 2B/2C run before Stage 1');
  assert.ok(offerIndex < firstContextIndex, 'Stage 1 runs before the Engine 2D context load');
  assert.ok(lastContextIndex < assessmentIndex, 'the filtering context is loaded before the assessments');
  assert.equal(assessmentIndex, db.calls.length - 1, 'the assessment load is the last statement');

  for (const needle of [
    'FROM recommendation_query', 'FROM scoring_model', 'FROM store_offer', 'FROM component_assessment',
  ]) {
    assert.equal(countCalls(db.calls, (call) => call.sql.includes(needle)), 1, needle + ' must run once');
  }
  assert.equal(countCalls(db.calls, (call) => call.sql === SELECT_NOW_SQL), 1);

  // No transaction control and no write statement ever leaves runRecommendation.
  assert.equal(
    countCalls(db.calls, (call) => /BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE/.test(call.sql)),
    0
  );
});

test('the 2C pool is built from the loadCandidates output: selectCandidatePool(loaded.input, loaded.candidates)', async () => {
  const db = createDb();
  await withSpies([
    { key: 'load', namespace: candidatesModule, name: 'loadCandidates' },
    { key: 'pool', namespace: candidatesModule, name: 'selectCandidatePool' },
  ], async (spies) => {
    await runRecommendation({ db, queryId: QUERY_ID });

    const loaded = await spies.load.calls[0].result;
    assert.equal(spies.load.calls.length, 1);
    assert.equal(spies.pool.calls.length, 1);
    const args = spies.pool.calls[0].args;
    assert.equal(args.length, 2);
    assert.equal(args[0], loaded.input);
    assert.equal(args[1], loaded.candidates);
  });
});

// ---------------------------------------------------------------------------
// 4. TRAP: Stage 1 result is the single pool / price source downstream.
// ---------------------------------------------------------------------------

test('Stage 1 output is the only pool the later stages receive (an offer-less candidate is dropped)', async () => {
  const db = createDb();
  await withSpies([
    { key: 'pool', namespace: candidatesModule, name: 'selectCandidatePool' },
    { key: 'offers', namespace: offersModule, name: 'selectOfferPrices' },
    { key: 'context', namespace: filteringModule, name: 'loadFilteringContext' },
    { key: 'filter', namespace: filteringModule, name: 'filterCandidates' },
    { key: 'candidateScores', namespace: scoringModule, name: 'computeCandidateScores' },
    { key: 'assessment', namespace: scoringModule, name: 'loadComponentAssessments' },
    { key: 'assembly', namespace: assemblyModule, name: 'assembleBuildsForRecommendation' },
  ], async (spies) => {
    const out = await runRecommendation({ db, queryId: QUERY_ID });

    const poolResult = spies.pool.calls[0].result;
    const offerResult = await spies.offers.calls[0].result;

    // The Engine 2C pool really does carry the offer-less candidate...
    assert.ok(poolResult.pool.some((candidate) => candidate.product_id === ORPHAN_CPU_ID));
    // ...and Stage 1 dropped it.
    assert.ok(!offerResult.pool.some((candidate) => candidate.product_id === ORPHAN_CPU_ID));
    assert.ok(offerResult.pool.length < poolResult.pool.length);
    // The carrier covers exactly the returned pool (the subset trap).
    for (const candidate of offerResult.pool) {
      const key = JSON.stringify([
        candidate.product_id, candidate.product_variant_id, candidate.component_role,
      ]);
      assert.ok(Object.prototype.hasOwnProperty.call(offerResult.prices, key));
    }

    // Every later stage received that exact object / pool.
    assert.equal(spies.context.calls[0].args[0], offerResult);
    assert.equal(spies.candidateScores.calls[0].args[0].candidates, offerResult.pool);
    assert.equal(spies.assessment.calls[0].args[0].includes(ORPHAN_CPU_ID), false);
    assert.equal(spies.assembly.calls[0].args[0].candidatePoolResult, offerResult);
    assert.equal(spies.assembly.calls[0].args[0].prices, offerResult.prices);

    // No context bucket, verdict or build component mentions the dropped candidate.
    const context = await spies.context.calls[0].result;
    for (const role of Object.keys(context.candidates)) {
      assert.ok(!context.candidates[role].some((candidate) => candidate.product_id === ORPHAN_CPU_ID));
    }
    const verdicts = spies.filter.calls[0].result.results;
    assert.equal(verdicts.some((verdict) => verdict.product_id === ORPHAN_CPU_ID), false);
    for (const build of out.builds) {
      assert.equal(build.components.some((c) => c.product_id === ORPHAN_CPU_ID), false);
    }
  });
});
// ---------------------------------------------------------------------------
// 5. ONE filtering context, ONE assessment load, covering both scoring steps.
// ---------------------------------------------------------------------------

test('one context object reaches filterCandidates and Engine 3; assessments load once for both scorers', async () => {
  const db = createDb();
  await withSpies([
    { key: 'context', namespace: filteringModule, name: 'loadFilteringContext' },
    { key: 'filter', namespace: filteringModule, name: 'filterCandidates' },
    { key: 'assessment', namespace: scoringModule, name: 'loadComponentAssessments' },
    { key: 'candidateScores', namespace: scoringModule, name: 'computeCandidateScores' },
    { key: 'buildScores', namespace: scoringModule, name: 'computeBuildScores' },
    { key: 'assembly', namespace: assemblyModule, name: 'assembleBuildsForRecommendation' },
  ], async (spies) => {
    const out = await runRecommendation({ db, queryId: QUERY_ID });

    // Loaded exactly once each.
    assert.equal(spies.context.calls.length, 1);
    assert.equal(spies.assessment.calls.length, 1);

    // The SAME context object (identity, not a copy) reaches both consumers.
    const context = await spies.context.calls[0].result;
    assert.equal(spies.filter.calls[0].args[0], context);
    assert.equal(spies.assembly.calls[0].args[0].filteringContext, context);

    // The SAME assessment map feeds STEP 2 and STEP 3.
    const assessmentResult = await spies.assessment.calls[0].result;
    assert.equal(spies.candidateScores.calls[0].args[0].assessments, assessmentResult.assessments);
    assert.equal(spies.buildScores.calls[0].args[0].assessments, assessmentResult.assessments);

    // The loaded product-id set is a superset of every product in a build.
    const loadedIds = spies.assessment.calls[0].args[0];
    assert.ok(loadedIds.length > 0);
    for (const build of out.builds) {
      for (const component of build.components) {
        assert.ok(loadedIds.includes(component.product_id), component.product_id + ' must be assessed-loaded');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Retention (Decision 12/14) inputs, source and Engine 3 handoff.
// ---------------------------------------------------------------------------

test("retention receives this run's filterCandidates output and its result replaces filterResult for Engine 3", async () => {
  const db = createDb();
  await withSpies([
    { key: 'model', namespace: scoringModule, name: 'loadScoringModel' },
    { key: 'filter', namespace: filteringModule, name: 'filterCandidates' },
    { key: 'candidateScores', namespace: scoringModule, name: 'computeCandidateScores' },
    { key: 'retention', namespace: retentionModule, name: 'retainTopKPerRole' },
    { key: 'assembly', namespace: assemblyModule, name: 'assembleBuildsForRecommendation' },
  ], async (spies) => {
    await runRecommendation({ db, queryId: QUERY_ID });

    const filterResult = spies.filter.calls[0].result;
    const candidateScores = spies.candidateScores.calls[0].result;
    const model = await spies.model.calls[0].result;
    const retentionArgs = spies.retention.calls[0].args[0];

    assert.equal(spies.retention.calls.length, 1);
    assert.equal(retentionArgs.filterResult, filterResult);
    assert.equal(retentionArgs.candidateScores, candidateScores);
    assert.equal(retentionArgs.topKPerRole, model.configuration.candidate_caps.top_k_per_role);
    assert.equal(retentionArgs.topKPerRole, 5);

    const retentionResult = spies.retention.calls[0].result;
    const assemblyArgs = spies.assembly.calls[0].args[0];
    assert.equal(assemblyArgs.filterResult, retentionResult);
    // Engine 3 receives the retention result itself (no re-wrapping, no copy):
    // assembly/pipeline.js reads filterResult.results, and Decision 12 Rule 6
    // keeps Engine 3's input contract untouched.
    assert.ok(Array.isArray(assemblyArgs.filterResult.results));
    for (const verdict of retentionResult.results) {
      assert.ok(filterResult.results.includes(verdict));
    }
  });
});

test('topKPerRole comes from candidate_caps: K=1 keeps one of two eligible coolers', async () => {
  const db = createDb({
    routes: {
      caps: { top_k_per_role: 1 },
      coolerCandidates: [
        { product_id: COOLER_ID, product_variant_id: null },
        { product_id: COOLER_ALT_ID, product_variant_id: null },
      ],
      coolerSpecs: [
        { product_id: COOLER_ID, cooling_type: 'AIR' },
        { product_id: COOLER_ALT_ID, cooling_type: 'AIR' },
      ],
      coolerSocket: [
        { id: 'cs-1', cooler_product_id: COOLER_ID, socket_id: SOCKET_ID, support_status: 'PASS' },
        { id: 'cs-2', cooler_product_id: COOLER_ALT_ID, socket_id: SOCKET_ID, support_status: 'PASS' },
      ],
      offers: defaultOffers([offerRow(50, COOLER_ALT_ID, 400)]),
    },
  });
  await withSpies([
    { key: 'retention', namespace: retentionModule, name: 'retainTopKPerRole' },
    { key: 'assembly', namespace: assemblyModule, name: 'assembleBuildsForRecommendation' },
  ], async (spies) => {
    const out = await runRecommendation({ db, queryId: QUERY_ID });

    assert.equal(spies.retention.calls[0].args[0].topKPerRole, 1);
    const coolers = spies.assembly.calls[0].args[0].filterResult.results
      .filter((entry) => entry.component_role === 'CPU_COOLER');
    assert.equal(coolers.length, 1);
    // The thermals-assessed cooler scores higher than the unassessed one.
    assert.equal(coolers[0].product_id, COOLER_ID);

    assert.equal(out.builds.length, 1);
    const buildCoolers = out.builds[0].components.filter((c) => c.component_role === 'CPU_COOLER');
    assert.equal(buildCoolers.length, 1);
    assert.equal(buildCoolers[0].product_id, COOLER_ID);
  });
});
// ---------------------------------------------------------------------------
// 7. Fail-fast short-circuits (Decision 17.4) and the zero-build outcome.
// ---------------------------------------------------------------------------

test('an unavailable scoring model fails at step 3: right after the timestamp, before any candidate work', async () => {
  const inactive = createDb({ routes: { modelActive: false } });
  await assert.rejects(runRecommendation({ db: inactive, queryId: QUERY_ID }), (error) =>
    error instanceof CandidateSelectionError
      && error.code === ERROR_CODES.SCORING_MODEL_UNAVAILABLE);
  assert.equal(inactive.calls.length, 3);
  assert.equal(inactive.calls[2].sql.includes('FROM scoring_model'), true);
});

test('a missing recommendation_query row fails after exactly one statement', async () => {
  const db = createDb({ routes: { queryRows: [] } });
  await assert.rejects(runRecommendation({ db, queryId: QUERY_ID }), (error) =>
    error instanceof CandidateSelectionError
      && error.code === ERROR_CODES.INVALID_INPUT
      && error.field === 'query_id');
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].sql.includes('FROM recommendation_query'), true);
});

test('zero builds is not an error: the pass runs to the end and returns frozen builds: []', async () => {
  const db = createDb({
    routes: {
      queryRow: {
        id: QUERY_ID,
        budget_amount: '500.00',
        currency: 'MAD',
        use_case: 'GAMING',
        scoring_model_id: MODEL_ID,
      },
    },
  });
  await withSpies([
    { key: 'assessment', namespace: scoringModule, name: 'loadComponentAssessments' },
    { key: 'assembly', namespace: assemblyModule, name: 'assembleBuildsForRecommendation' },
    { key: 'buildScores', namespace: scoringModule, name: 'computeBuildScores' },
  ], async (spies) => {
    const out = await runRecommendation({ db, queryId: QUERY_ID });

    assert.deepEqual(out.builds, []);
    assert.ok(Object.isFrozen(out.builds));
    // Every stage still ran: only Engine 3 found nothing to assemble.
    assert.equal(spies.assessment.calls.length, 1);
    assert.equal(spies.assembly.calls.length, 1);
    assert.equal(spies.assembly.calls[0].args[0].filterResult.results.length > 0, true);
    assert.deepEqual(spies.buildScores.calls[0].args[0].builds, []);
  });
});

// ---------------------------------------------------------------------------
// 8. Argument-object gate and loader-owned field errors.
// ---------------------------------------------------------------------------

test('the argument object is the only gate this boundary owns; field errors stay the loaders', async () => {
  await assert.rejects(runRecommendation(), (error) =>
    error instanceof CandidateSelectionError
      && error.code === ERROR_CODES.INVALID_INPUT
      && error.field === null);
  await assert.rejects(runRecommendation(null), (error) =>
    error instanceof CandidateSelectionError && error.code === ERROR_CODES.INVALID_INPUT);

  const noDb = createDb();
  await assert.rejects(runRecommendation({ queryId: QUERY_ID }), (error) =>
    error instanceof CandidateSelectionError
      && error.code === ERROR_CODES.INVALID_INPUT
      && error.field === 'db');
  assert.equal(noDb.calls.length, 0);

  const noId = createDb();
  await assert.rejects(runRecommendation({ db: noId }), (error) =>
    error instanceof CandidateSelectionError
      && error.code === ERROR_CODES.MISSING_REQUIRED_FIELD
      && error.field === 'query_id');
  assert.equal(noId.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 9. Determinism and the source-level wiring order (the pure stages are not
//    visible in recorded SQL, so their order is asserted on the source with
//    comments stripped - the module header documents the same order).
// ---------------------------------------------------------------------------

test('the same database state yields deeply equal results', async () => {
  const first = await runRecommendation({ db: createDb(), queryId: QUERY_ID });
  const second = await runRecommendation({ db: createDb(), queryId: QUERY_ID });
  assert.deepEqual(second, first);
});

test('run.js calls its collaborators in the Decision 17.3 order, each exactly once', () => {
  const source = stripComments(fs.readFileSync(path.join(__dirname, 'run.js'), 'utf8'));
  const sequence = [
    'query.loadQueryInput(',
    'await readTransactionTimestamp(',
    'scoring.loadScoringModel(',
    'candidates.loadCandidates(',
    'candidates.selectCandidatePool(',
    'offers.selectOfferPrices(',
    'filtering.loadFilteringContext(',
    'filtering.filterCandidates(',
    'scoring.loadComponentAssessments(',
    'scoring.computeCandidateScores(',
    'retention.retainTopKPerRole(',
    'assembly.assembleBuildsForRecommendation(',
    'scoring.computeBuildScores(',
    'scoring.computeBuildScoreContributions(',
  ];
  let cursor = -1;
  for (const needle of sequence) {
    const index = source.indexOf(needle);
    assert.ok(index > cursor, needle + ' must appear after the previous call site');
    assert.equal(source.indexOf(needle, index + 1), -1, needle + ' must appear exactly once');
    cursor = index;
  }

  assert.ok(source.includes('db.query(SELECT_NOW_SQL)'), 'the timestamp is read through the injected db');
  assert.equal(
    source.includes('filterCandidatesForRecommendation'),
    false,
    'Decision 17.3 forbids the B2-G helper: it hides the context Engine 3 needs'
  );
  assert.equal(source.includes('Date.now'), false, 'no JS clock is ever read');
});

// ---------------------------------------------------------------------------
// 10. The wrapper over the real pass (its own error semantics live in
//     snapshot.test.js).
// ---------------------------------------------------------------------------

test('runRecommendationSnapshot: BEGIN ... one real pass ... ROLLBACK, never COMMIT', async () => {
  const db = createDb();
  const out = await runRecommendationSnapshot(db, QUERY_ID);

  assert.equal(BEGIN_SQL, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(ROLLBACK_SQL, 'ROLLBACK');
  assert.equal(db.calls[0].sql, BEGIN_SQL);
  assert.equal(db.calls[db.calls.length - 1].sql, ROLLBACK_SQL);
  assert.equal(countCalls(db.calls, (call) => call.sql === BEGIN_SQL), 1);
  assert.equal(countCalls(db.calls, (call) => call.sql === ROLLBACK_SQL), 1);
  assert.equal(countCalls(db.calls, (call) => call.sql === 'COMMIT'), 0);
  assert.equal(out.query_id, QUERY_ID);
  assert.equal(out.builds.length, 1);
});
