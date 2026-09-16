'use strict';

// ---------------------------------------------------------------------------
// Scoring model (Decision 11): focused tests for the pinned-ID loader.
//
// Scope: the exact query contract, exactly-one-query discipline, no discovery
// and no fallback, fail-fast missing/inactive handling, configuration failure
// mapping, deep freezing, and DB error propagation. The configuration contract
// itself is NOT re-tested here (see configuration.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadScoringModel, SELECT_SCORING_MODEL_SQL } = require('./load-scoring-model');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const MODEL_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = new Date('2026-01-01T09:00:00.000Z');
const UPDATED_AT = new Date('2026-03-15T09:00:00.000Z');

/** Complete, valid Decision 3(a) configuration built fresh on every call. */
function makeConfiguration(overrides = {}) {
  return {
    version_note: 'shape spec; every key REQUIRED, engine fails fast otherwise',
    role_weights: {
      CPU: { PERFORMANCE: 0.4, VALUE: 0.3 },
      GPU: { PERFORMANCE: 0.5, VALUE: 0.25 },
    },
    type_weights: { PERFORMANCE: 0.5, VALUE: 0.25, QUALITY: 0.25 },
    neutral_baseline: 50,
    no_evidence_penalty: 10,
    unknown_compat_penalty: 5,
    confidence_multipliers: {
      CONFIRMED: 1,
      HIGH: 0.8,
      MEDIUM: 0.6,
      LOW: 0.3,
      UNVERIFIED: 0,
    },
    staleness: { max_age_days: 180, per_day_decay: 0.005 },
    candidate_caps: { top_k_per_role: 5, max_builds_per_query: 25 },
    gpu_required_use_cases: ['GAMING', 'WORKSTATION'],
    ...overrides,
  };
}

/** A valid active scoring_model row exactly as the query would return it. */
function modelRow(overrides = {}) {
  return {
    id: MODEL_ID,
    name: 'baseline-v1',
    version: '1.0.0',
    description: 'first scoring model',
    configuration: makeConfiguration(),
    is_active: true,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

/** Fake pg-compatible client recording every call. */
function makeDb(rows = [], { error = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (error) {
        throw error;
      }
      return { rows: typeof rows === 'function' ? rows(sql, params) : rows };
    },
  };
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}

/** Assert a structured loader failure: code, field, and no DB detail leak. */
function assertUnavailable(error, message) {
  assert.ok(error instanceof CandidateSelectionError, message);
  assert.equal(error.code, ERROR_CODES.SCORING_MODEL_UNAVAILABLE, message);
  assert.equal(error.field, MODEL_ID, message);
  assert.ok(!error.message.includes('pg_'), message);
  assert.deepEqual(Object.keys(error.toJSON()), ['name', 'code', 'field', 'message']);
}

// ---------------------------------------------------------------------------
// Query contract (Decision 11 Rule 2)
// ---------------------------------------------------------------------------

const EXPECTED_SQL =
  'SELECT id, name, version, description, configuration, is_active, created_at, updated_at ' +
  'FROM scoring_model WHERE id = $1';

const DECISION_11_SQL = `
SELECT id, name, version, description, configuration,
       is_active, created_at, updated_at
  FROM scoring_model
 WHERE id = $1;
`;

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

test('the loader issues exactly the Decision 11 query', () => {
  assert.equal(typeof SELECT_SCORING_MODEL_SQL, 'string');
  assert.equal(SELECT_SCORING_MODEL_SQL, EXPECTED_SQL);
  assert.equal(normalizeSql(SELECT_SCORING_MODEL_SQL), normalizeSql(DECISION_11_SQL));
  assert.ok(SELECT_SCORING_MODEL_SQL.includes('FROM scoring_model'));
  assert.ok(SELECT_SCORING_MODEL_SQL.includes('WHERE id = $1'));
});

test('the pinned scoring_model_id is passed as the single query parameter', async () => {
  const db = makeDb([modelRow()]);
  await loadScoringModel(MODEL_ID, db);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [MODEL_ID]);
  assert.equal(db.calls[0].sql, SELECT_SCORING_MODEL_SQL);
});

test('the SQL does NOT fold eligibility into the lookup (no is_active = true)', () => {
  const lowered = SELECT_SCORING_MODEL_SQL.toLowerCase();
  assert.ok(!lowered.includes('is_active = true'));
  assert.ok(!lowered.includes('is_active=true'));
  assert.ok(!lowered.includes('and is_active'));
  assert.ok(!lowered.includes('order by'));
  assert.ok(!lowered.includes('limit'));
});

test('exactly one query is executed on every code path', async () => {
  const success = makeDb([modelRow()]);
  await loadScoringModel(MODEL_ID, success);
  assert.equal(success.calls.length, 1);

  const missing = makeDb([]);
  await rejectionOf(loadScoringModel(MODEL_ID, missing));
  assert.equal(missing.calls.length, 1);

  const inactive = makeDb([modelRow({ is_active: false })]);
  await rejectionOf(loadScoringModel(MODEL_ID, inactive));
  assert.equal(inactive.calls.length, 1);

  const invalid = makeDb([modelRow({ configuration: null })]);
  await rejectionOf(loadScoringModel(MODEL_ID, invalid));
  assert.equal(invalid.calls.length, 1);
});

// ---------------------------------------------------------------------------
// Resolution outcomes (Decision 11 Rules 1 + 5)
// ---------------------------------------------------------------------------

test('a missing pinned row fails fast with SCORING_MODEL_UNAVAILABLE', async () => {
  const db = makeDb([]);
  const error = await rejectionOf(loadScoringModel(MODEL_ID, db));
  assertUnavailable(error, 'a missing pinned model must fail fast');
});

test('an inactive pinned row fails fast with SCORING_MODEL_UNAVAILABLE', async () => {
  for (const notActive of [false, null, 0, 'true', undefined]) {
    const db = makeDb([modelRow({ is_active: notActive })]);
    const error = await rejectionOf(loadScoringModel(MODEL_ID, db));
    assertUnavailable(error, `is_active=${String(notActive)} must fail fast`);
  }
});

test('no discovery and no fallback query ever occurs', async () => {
  const missing = makeDb([]);
  await rejectionOf(loadScoringModel(MODEL_ID, missing));
  assert.equal(missing.calls.length, 1);
  assert.equal(missing.calls[0].sql, SELECT_SCORING_MODEL_SQL);

  const inactive = makeDb([modelRow({ is_active: false })]);
  await rejectionOf(loadScoringModel(MODEL_ID, inactive));
  assert.equal(inactive.calls.length, 1);
  assert.equal(inactive.calls[0].sql, SELECT_SCORING_MODEL_SQL);
});

test('only the exact supplied scoring_model_id is ever queried', async () => {
  const otherId = '22222222-2222-4222-8222-222222222222';
  const db = makeDb((sql, params) => (params[0] === MODEL_ID ? [modelRow()] : []));
  const model = await loadScoringModel(MODEL_ID, db);
  assert.equal(model.id, MODEL_ID);
  assert.notEqual(MODEL_ID, otherId);
  assert.deepEqual(db.calls[0].params, [MODEL_ID]);
});

// ---------------------------------------------------------------------------
// Configuration failure mapping (Decision 11 Rule 4) through the loader
// ---------------------------------------------------------------------------

test('configuration NULL is a missing required field named configuration', async () => {
  for (const absent of [null, undefined]) {
    const db = makeDb([modelRow({ configuration: absent })]);
    const error = await rejectionOf(loadScoringModel(MODEL_ID, db));
    assert.ok(error instanceof CandidateSelectionError);
    assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
    assert.equal(error.field, 'configuration');
  }
});

test('a non-object configuration is invalid input named configuration', async () => {
  for (const bad of [['GAMING'], 50, 'configuration', true]) {
    const db = makeDb([modelRow({ configuration: bad })]);
    const error = await rejectionOf(loadScoringModel(MODEL_ID, db));
    assert.ok(error instanceof CandidateSelectionError, String(bad));
    assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
    assert.equal(error.field, 'configuration');
  }
});

test('a missing top-level configuration key fails with its exact path', async () => {
  const configuration = makeConfiguration();
  delete configuration.role_weights;
  const db = makeDb([modelRow({ configuration })]);
  const error = await rejectionOf(loadScoringModel(MODEL_ID, db));
  assert.ok(error instanceof CandidateSelectionError);
  assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.equal(error.field, 'role_weights');
});

test('a missing nested configuration key fails with its exact nested path', async () => {
  const noTopK = makeConfiguration();
  delete noTopK.candidate_caps.top_k_per_role;
  const dbTopK = makeDb([modelRow({ configuration: noTopK })]);
  const errorTopK = await rejectionOf(loadScoringModel(MODEL_ID, dbTopK));
  assert.equal(errorTopK.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.equal(errorTopK.field, 'candidate_caps.top_k_per_role');

  const noDecay = makeConfiguration();
  delete noDecay.staleness.per_day_decay;
  const dbDecay = makeDb([modelRow({ configuration: noDecay })]);
  const errorDecay = await rejectionOf(loadScoringModel(MODEL_ID, dbDecay));
  assert.equal(errorDecay.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.equal(errorDecay.field, 'staleness.per_day_decay');
});

test('an unknown configuration key fails with its exact path', async () => {
  const topUnknown = makeConfiguration({ unexpected_key: 1 });
  const dbTop = makeDb([modelRow({ configuration: topUnknown })]);
  const errorTop = await rejectionOf(loadScoringModel(MODEL_ID, dbTop));
  assert.equal(errorTop.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(errorTop.field, 'unexpected_key');

  const nestedUnknown = makeConfiguration({
    candidate_caps: { top_k_per_role: 5, max_builds_per_query: 10, extra: 1 },
  });
  const dbNested = makeDb([modelRow({ configuration: nestedUnknown })]);
  const errorNested = await rejectionOf(loadScoringModel(MODEL_ID, dbNested));
  assert.equal(errorNested.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(errorNested.field, 'candidate_caps.extra');
});

test('a wrong-type configuration value fails with its exact path', async () => {
  const wrongWeight = makeConfiguration({ role_weights: { CPU: { PERFORMANCE: '0.4' } } });
  const dbWeight = makeDb([modelRow({ configuration: wrongWeight })]);
  const errorWeight = await rejectionOf(loadScoringModel(MODEL_ID, dbWeight));
  assert.equal(errorWeight.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(errorWeight.field, 'role_weights.CPU.PERFORMANCE');

  const wrongBaseline = makeConfiguration({ neutral_baseline: '50' });
  const dbBaseline = makeDb([modelRow({ configuration: wrongBaseline })]);
  const errorBaseline = await rejectionOf(loadScoringModel(MODEL_ID, dbBaseline));
  assert.equal(errorBaseline.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(errorBaseline.field, 'neutral_baseline');

  const wrongGpuList = makeConfiguration({ gpu_required_use_cases: 'GAMING' });
  const dbGpu = makeDb([modelRow({ configuration: wrongGpuList })]);
  const errorGpu = await rejectionOf(loadScoringModel(MODEL_ID, dbGpu));
  assert.equal(errorGpu.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(errorGpu.field, 'gpu_required_use_cases');
});

test('an out-of-range configuration value fails with its exact path', async () => {
  const outOfRangeBaseline = makeConfiguration({ neutral_baseline: 101 });
  const dbBaseline = makeDb([modelRow({ configuration: outOfRangeBaseline })]);
  const errorBaseline = await rejectionOf(loadScoringModel(MODEL_ID, dbBaseline));
  assert.equal(errorBaseline.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(errorBaseline.field, 'neutral_baseline');

  const zeroCap = makeConfiguration({
    candidate_caps: { top_k_per_role: 0, max_builds_per_query: 10 },
  });
  const dbCap = makeDb([modelRow({ configuration: zeroCap })]);
  const errorCap = await rejectionOf(loadScoringModel(MODEL_ID, dbCap));
  assert.equal(errorCap.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(errorCap.field, 'candidate_caps.top_k_per_role');

  const badMultiplier = makeConfiguration({ confidence_multipliers: { UNVERIFIED: 1.5 } });
  const dbMultiplier = makeDb([modelRow({ configuration: badMultiplier })]);
  const errorMultiplier = await rejectionOf(loadScoringModel(MODEL_ID, dbMultiplier));
  assert.equal(errorMultiplier.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(errorMultiplier.field, 'confidence_multipliers.UNVERIFIED');
});

test('no scoring-model error ever reuses INVALID_CANDIDATE or EMPTY_CANDIDATE_POOL', async () => {
  const db = makeDb([]);
  const error = await rejectionOf(loadScoringModel(MODEL_ID, db));
  assert.equal(error.code, ERROR_CODES.SCORING_MODEL_UNAVAILABLE);
  assert.notEqual(error.code, ERROR_CODES.INVALID_CANDIDATE);
  assert.notEqual(error.code, ERROR_CODES.EMPTY_CANDIDATE_POOL);
});

// ---------------------------------------------------------------------------
// Valid model: complete configuration, deep freezing, no caller mutation
// ---------------------------------------------------------------------------

test('a valid active model returns the complete metadata and configuration', async () => {
  const row = modelRow();
  const db = makeDb([row]);
  const model = await loadScoringModel(MODEL_ID, db);

  assert.deepEqual(Object.keys(model), [
    'id',
    'name',
    'version',
    'description',
    'configuration',
    'is_active',
    'created_at',
    'updated_at',
  ]);
  assert.equal(model.id, MODEL_ID);
  assert.equal(model.name, 'baseline-v1');
  assert.equal(model.version, '1.0.0');
  assert.equal(model.description, 'first scoring model');
  assert.equal(model.is_active, true);
  assert.equal(model.created_at, CREATED_AT);
  assert.equal(model.updated_at, UPDATED_AT);
  assert.deepEqual(model.configuration, row.configuration);
});

test('the returned model is deeply frozen and rejects writes', async () => {
  const db = makeDb([modelRow()]);
  const model = await loadScoringModel(MODEL_ID, db);

  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.configuration));
  assert.ok(Object.isFrozen(model.configuration.role_weights));
  assert.ok(Object.isFrozen(model.configuration.role_weights.CPU));
  assert.ok(Object.isFrozen(model.configuration.type_weights));
  assert.ok(Object.isFrozen(model.configuration.confidence_multipliers));
  assert.ok(Object.isFrozen(model.configuration.staleness));
  assert.ok(Object.isFrozen(model.configuration.candidate_caps));
  assert.ok(Object.isFrozen(model.configuration.gpu_required_use_cases));

  assert.throws(() => {
    model.name = 'mutated';
  });
  assert.throws(() => {
    model.configuration.candidate_caps.top_k_per_role = 99;
  });
});

test('the input DB row is not mutated and not frozen', async () => {
  const row = modelRow();
  const db = makeDb([row]);
  await loadScoringModel(MODEL_ID, db);

  assert.deepEqual(row, modelRow());
  assert.equal(Object.isFrozen(row), false);
  assert.equal(Object.isFrozen(row.configuration), false);
  assert.equal(Object.isFrozen(row.configuration.candidate_caps), false);
  assert.equal(Object.isFrozen(row.configuration.gpu_required_use_cases), false);
  assert.equal(Object.isFrozen(row.created_at), false);
  assert.equal(row.created_at, CREATED_AT);
});

// ---------------------------------------------------------------------------
// DB error propagation + loader-own input validation + module boundaries
// ---------------------------------------------------------------------------

test('PostgreSQL errors propagate unchanged and are not converted', async () => {
  const pgError = new Error('simulated connection failure');
  pgError.code = 'ECONNREFUSED';
  const db = makeDb([], { error: pgError });

  const error = await rejectionOf(loadScoringModel(MODEL_ID, db));
  assert.equal(error, pgError);
  assert.equal(error.code, 'ECONNREFUSED');
  assert.ok(!(error instanceof CandidateSelectionError));
  assert.notEqual(error.code, ERROR_CODES.SCORING_MODEL_UNAVAILABLE);
  assert.equal(db.calls.length, 1);
});

test('a missing or malformed pinned scoring_model_id is rejected without a query', async () => {
  const db = makeDb([modelRow()]);

  const missingId = await rejectionOf(loadScoringModel(null, db));
  assert.ok(missingId instanceof CandidateSelectionError);
  assert.equal(missingId.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.equal(missingId.field, 'scoring_model_id');

  const wrongType = await rejectionOf(loadScoringModel(42, db));
  assert.ok(wrongType instanceof CandidateSelectionError);
  assert.equal(wrongType.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(wrongType.field, 'scoring_model_id');

  const emptyId = await rejectionOf(loadScoringModel('', db));
  assert.ok(emptyId instanceof CandidateSelectionError);
  assert.equal(emptyId.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(emptyId.field, 'scoring_model_id');

  assert.equal(db.calls.length, 0);
});

test('a database client without query() is rejected without a query', async () => {
  const error = await rejectionOf(loadScoringModel(MODEL_ID, null));
  assert.ok(error instanceof CandidateSelectionError);
  assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
  assert.equal(error.field, 'db');
});

test('load-scoring-model.js keeps its source boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-scoring-model.js'), 'utf8');
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(required, ['../candidates/errors', './configuration']);

  const banned = [
    "require('pg')",
    'new Pool',
    'is_active = true',
    'AND is_active',
    'loadFilteringContext',
    'validateEngine3Input',
    'assembleBuilds',
    'selectOfferPrices',
    'createCandidate',
    'integrated_gpu_present',
    '../assembly',
    '../filtering',
    '../compatibility',
    '../offers',
  ];
  for (const token of banned) {
    assert.ok(!source.includes(token), `load-scoring-model.js must not contain ${token}`);
  }
});