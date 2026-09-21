'use strict';

// ---------------------------------------------------------------------------
// Query input (Decision 10 / 17.1): loader contract tests.
//
// Scope: exact query contract, exactly-one-query discipline, Rule 1
// constant, Rule 2 fail-closed use_case via Engine 2A, strict plain-decimal
// NUMERIC-string budget conversion, ignored v1 columns, frozen output, row
// immutability, db/queryId validation, PG error propagation, source
// boundary. Fake pg-compatible clients only -- no DB, no migrations.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadQueryInput,
  SELECT_QUERY_INPUT_SQL,
  REQUIRED_ROLES,
} = require('./load-query-input');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const QUERY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MODEL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Decision 10 Rule 1 constant, canonical component_role order. */
const EXPECTED_ROLES = Object.freeze([
  'CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'PSU', 'CASE', 'CPU_COOLER', 'SSD_BOOT',
]);

/** A valid recommendation_query row exactly as the query would return it. */
function queryRow(overrides = {}) {
  return {
    id: QUERY_ID,
    budget_amount: 8000,
    currency: 'MAD',
    use_case: 'GAMING',
    scoring_model_id: MODEL_ID,
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

// ---------------------------------------------------------------------------
// Query contract (Decision 10 mapping + Decision 17.5/17.6 discipline)
// ---------------------------------------------------------------------------

const EXPECTED_SQL =
  'SELECT id, budget_amount, currency, use_case, scoring_model_id ' +
  'FROM recommendation_query WHERE id = $1';

test('the loader issues exactly the Decision 10/17.1 query', () => {
  assert.equal(typeof SELECT_QUERY_INPUT_SQL, 'string');
  assert.equal(SELECT_QUERY_INPUT_SQL, EXPECTED_SQL);
  assert.ok(SELECT_QUERY_INPUT_SQL.includes('FROM recommendation_query'));
  assert.ok(SELECT_QUERY_INPUT_SQL.includes('WHERE id = $1'));
});

test('the SQL selects only contract columns and ignores v1-ignored fields', () => {
  const lowered = SELECT_QUERY_INPUT_SQL.toLowerCase();
  for (const col of ['id', 'budget_amount', 'currency', 'use_case', 'scoring_model_id']) {
    assert.ok(lowered.includes(col), `SQL must select ${col}`);
  }
  for (const ignored of ['resolution', 'priority', 'recommendation_profile_id']) {
    assert.ok(!lowered.includes(ignored), `SQL must not select ${ignored}`);
  }
});

test('the SQL issues no transaction or clock statements', () => {
  const lowered = SELECT_QUERY_INPUT_SQL.toLowerCase();
  for (const banned of ['begin', 'commit', 'rollback', 'now()', 'current_timestamp', 'set transaction']) {
    assert.ok(!lowered.includes(banned), `SQL must not contain ${banned}`);
  }
});

test('REQUIRED_ROLES is the Decision 10 Rule 1 constant in canonical order', () => {
  assert.deepEqual([...REQUIRED_ROLES], [...EXPECTED_ROLES]);
  assert.deepEqual(
    [...REQUIRED_ROLES].sort(),
    ['CASE', 'CPU', 'CPU_COOLER', 'GPU', 'MOTHERBOARD', 'PSU', 'RAM', 'SSD_BOOT'].sort()
  );
  assert.ok(!REQUIRED_ROLES.includes('SSD_SECONDARY'));
  assert.ok(Object.isFrozen(REQUIRED_ROLES));
});

test('happy path returns the frozen { query_id, scoring_model_id, input } shape', async () => {
  const db = makeDb([queryRow()]);
  const out = await loadQueryInput(QUERY_ID, db);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].sql, SELECT_QUERY_INPUT_SQL);
  assert.deepEqual(db.calls[0].params, [QUERY_ID]);
  assert.deepEqual(Object.keys(out).sort(), ['input', 'query_id', 'scoring_model_id']);
  assert.equal(out.query_id, QUERY_ID);
  assert.equal(out.scoring_model_id, MODEL_ID);
  assert.deepEqual(out.input, {
    budget_amount: 8000,
    currency: 'MAD',
    use_case: 'GAMING',
    required_roles: [...EXPECTED_ROLES],
  });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.input));
  assert.ok(Object.isFrozen(out.input.required_roles));
});

test('NULL use_case fails closed via the Engine 2A contract', async () => {
  for (const useCase of [null, undefined]) {
    const db = makeDb([queryRow({ use_case: useCase })]);
    const error = await rejectionOf(loadQueryInput(QUERY_ID, db));
    assert.ok(error instanceof CandidateSelectionError, String(useCase));
    assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD, String(useCase));
    assert.equal(error.field, 'use_case', String(useCase));
    assert.equal(db.calls.length, 1);
  }
});

test('blank use_case fails closed with no default or normalization', async () => {
  for (const useCase of ['', '   ', '\t\n ']) {
    const db = makeDb([queryRow({ use_case: useCase })]);
    const error = await rejectionOf(loadQueryInput(QUERY_ID, db));
    assert.ok(error instanceof CandidateSelectionError, JSON.stringify(useCase));
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE, JSON.stringify(useCase));
    assert.equal(error.field, 'use_case', JSON.stringify(useCase));
    assert.equal(db.calls.length, 1);
  }
});

test('a missing query row fails fast with INVALID_INPUT', async () => {
  const db = makeDb([]);
  const error = await rejectionOf(loadQueryInput(QUERY_ID, db));
  assert.ok(error instanceof CandidateSelectionError);
  assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
  assert.equal(error.field, 'query_id');
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].sql, SELECT_QUERY_INPUT_SQL);
  assert.deepEqual(db.calls[0].params, [QUERY_ID]);
});

test('plain-decimal NUMERIC strings convert via Number()', async () => {
  for (const [raw, expected] of [['8000', 8000], ['8000.00', 8000], ['0.5', 0.5], ['007', 7]]) {
    const db = makeDb([queryRow({ budget_amount: raw })]);
    const out = await loadQueryInput(QUERY_ID, db);
    assert.equal(out.input.budget_amount, expected, JSON.stringify(raw));
    assert.equal(db.calls.length, 1);
  }
});

test('non-plain-decimal budget strings throw INVALID_FIELD_VALUE', async () => {
  const bad = ['', ' ', ' 8000 ', '8000 ', 'abc', 'Infinity', 'NaN',
    '0x10', '0b101', '0o17', '1e3', '+5', '-5', '.5', '5.', '8,000'];
  for (const raw of bad) {
    const db = makeDb([queryRow({ budget_amount: raw })]);
    const error = await rejectionOf(loadQueryInput(QUERY_ID, db));
    assert.ok(error instanceof CandidateSelectionError, JSON.stringify(raw));
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE, JSON.stringify(raw));
    assert.equal(error.field, 'budget_amount', JSON.stringify(raw));
    assert.equal(db.calls.length, 1);
  }
});

test('zero/negative/non-finite budgets fail closed', async () => {
  for (const raw of [0, -5, '0', '0.00', '-5', NaN, Infinity, -Infinity]) {
    const db = makeDb([queryRow({ budget_amount: raw })]);
    const error = await rejectionOf(loadQueryInput(QUERY_ID, db));
    assert.ok(error instanceof CandidateSelectionError, String(raw));
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE, String(raw));
    assert.equal(error.field, 'budget_amount', String(raw));
    assert.equal(db.calls.length, 1);
  }
});

test('missing/non-number budgets surface the Engine 2A contract', async () => {
  for (const raw of [null, undefined]) {
    const db = makeDb([queryRow({ budget_amount: raw })]);
    const error = await rejectionOf(loadQueryInput(QUERY_ID, db));
    assert.ok(error instanceof CandidateSelectionError, String(raw));
    assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD, String(raw));
    assert.equal(error.field, 'budget_amount', String(raw));
  }
  for (const raw of [true, {}, [8000]]) {
    const db = makeDb([queryRow({ budget_amount: raw })]);
    const error = await rejectionOf(loadQueryInput(QUERY_ID, db));
    assert.ok(error instanceof CandidateSelectionError, String(raw));
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE, String(raw));
    assert.equal(error.field, 'budget_amount', String(raw));
  }
});

test('extra row columns are ignored and never leak into the result', async () => {
  const row = {
    ...queryRow(),
    resolution: '1440p',
    priority: 2,
    recommendation_profile_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  };
  const db = makeDb([row]);
  const out = await loadQueryInput(QUERY_ID, db);
  assert.deepEqual(Object.keys(out).sort(), ['input', 'query_id', 'scoring_model_id']);
  assert.deepEqual(Object.keys(out.input).sort(), ['budget_amount', 'currency', 'required_roles', 'use_case']);
});

test('invalid queryId and db are rejected; bad queryId never queries', async () => {
  const db = makeDb([queryRow()]);
  for (const badId of [null, undefined]) {
    const error = await rejectionOf(loadQueryInput(badId, db));
    assert.ok(error instanceof CandidateSelectionError, String(badId));
    assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD, String(badId));
    assert.equal(error.field, 'query_id', String(badId));
  }
  for (const badId of [42, '', {}, [QUERY_ID]]) {
    const error = await rejectionOf(loadQueryInput(badId, db));
    assert.ok(error instanceof CandidateSelectionError, String(badId));
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE, String(badId));
    assert.equal(error.field, 'query_id', String(badId));
  }
  assert.equal(db.calls.length, 0);

  for (const badDb of [null, undefined, {}, { query: 42 }, 'db']) {
    const error = await rejectionOf(loadQueryInput(QUERY_ID, badDb));
    assert.ok(error instanceof CandidateSelectionError, String(badDb));
    assert.equal(error.code, ERROR_CODES.INVALID_INPUT, String(badDb));
    assert.equal(error.field, 'db', String(badDb));
  }
});

test('exactly one query on every path; pg errors propagate unchanged', async () => {
  const ok = makeDb([queryRow()]);
  await loadQueryInput(QUERY_ID, ok);
  assert.equal(ok.calls.length, 1);

  const missing = makeDb([]);
  await rejectionOf(loadQueryInput(QUERY_ID, missing));
  assert.equal(missing.calls.length, 1);

  const invalid = makeDb([queryRow({ use_case: null })]);
  await rejectionOf(loadQueryInput(QUERY_ID, invalid));
  assert.equal(invalid.calls.length, 1);

  const pgError = new Error('simulated connection failure');
  pgError.code = 'ECONNREFUSED';
  const failing = makeDb([], { error: pgError });
  const error = await rejectionOf(loadQueryInput(QUERY_ID, failing));
  assert.equal(error, pgError);
  assert.ok(!(error instanceof CandidateSelectionError));
  assert.equal(failing.calls.length, 1);
});

test('output is frozen and the input row is not mutated or frozen', async () => {
  const row = queryRow({ budget_amount: '8000' });
  const snapshot = queryRow({ budget_amount: '8000' });
  const db = makeDb([row]);
  const out = await loadQueryInput(QUERY_ID, db);

  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.input));
  assert.ok(Object.isFrozen(out.input.required_roles));
  assert.throws(() => { out.query_id = 'x'; });
  assert.throws(() => { out.input.currency = 'EUR'; });
  assert.throws(() => { out.input.required_roles.push('RAM'); });

  assert.deepEqual(row, snapshot);
  assert.equal(Object.isFrozen(row), false);
  assert.deepEqual([...REQUIRED_ROLES], ['CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'PSU', 'CASE', 'CPU_COOLER', 'SSD_BOOT']);
});

test('load-query-input.js keeps its source boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-query-input.js'), 'utf8');
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(required, ['../candidates/errors', '../candidates/input']);

  const banned = [
    "require('pg')",
    'new Pool',
    'loadScoringModel(',
    "require('./candidate')",
    "require('../candidates/candidate')",
    "require('./load-scoring-model')",
    "require('../offers",
    "require('../assembly",
    "require('../filtering",
    "require('../scoring",
    "require('../retention",
  ];
  for (const token of banned) {
    assert.ok(!source.includes(token), `load-query-input.js must not contain ${token}`);
  }
  // Transaction/clock discipline is asserted on the SQL constant above and on
  // every recorded db.query call (exactly-one-query tests): the loader text
  // documents the policy in words, so whole-source substring matching would
  // self-match its own comments.
  for (const stmt of ['begin', 'commit', 'rollback', 'now()', 'current_timestamp', 'set transaction']) {
    assert.ok(!SELECT_QUERY_INPUT_SQL.toLowerCase().includes(stmt), `SQL must not contain ${stmt}`);
  }
});



