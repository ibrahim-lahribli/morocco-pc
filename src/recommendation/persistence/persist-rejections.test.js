'use strict';

/**
 * Unit tests for the OG-04 rejection writer and its input contract.
 *
 * Fake-client only, exactly like ./persist-ranked.test.js: no database is
 * touched. What these pin:
 *
 *   - the DML-only boundary (no BEGIN/COMMIT/ROLLBACK/SELECT/pool/clock), so
 *     the writer can only ever be driven inside the commit wrapper's
 *     transaction;
 *   - REJECT-ONLY filtering, including that a PASS/UNKNOWN verdict is skipped
 *     rather than written, which is the property that keeps UNKNOWN from being
 *     recorded as a rejection;
 *   - that a healthy pass (nothing rejected) issues ZERO statements;
 *   - NULL preservation: absent ids stay null in the params, never '' or 0;
 *   - every fail-fast path, and that no statement is issued when validation
 *     fails (a malformed diagnostic must never reach the database).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  persistRejections,
  INSERT_BUILD_REJECTION_SQL,
} = require('./persist-rejections');
const { validateRejections } = require('./validate-rejections');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const QUERY_ID = '00000000-0000-4000-8000-000000000912';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rejection(overrides = {}) {
  return {
    component_role: 'CPU',
    product_id: 'p-cpu-1',
    status: 'REJECT',
    // Engine 2D's field is `reason` (filter.js), not `reason_code`.
    reason: 'CPU_SOCKET_MISMATCH',
    ...overrides,
  };
}

function createClient() {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [] });
    },
  };
}

function rejectionOf(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof CandidateSelectionError,
      'expected CandidateSelectionError, got ' + error.constructor.name
    );
    return error;
  }
  assert.fail('expected a rejection');
  return null;
}

/** Async variant: persistRejections is an async function, so it returns a
 *  rejected promise rather than throwing synchronously. */
async function rejectionOfAsync(fn) {
  try {
    await fn();
  } catch (error) {
    assert.ok(
      error instanceof CandidateSelectionError,
      'expected CandidateSelectionError, got ' + error.constructor.name
    );
    return error;
  }
  assert.fail('expected a rejection');
  return null;
}

// --- happy path ------------------------------------------------------------

test('a REJECT verdict issues one parameterized INSERT and returns a UUID', async () => {
  const client = createClient();
  const result = await persistRejections({ client, queryId: QUERY_ID, rejections: [rejection()] });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].sql, INSERT_BUILD_REJECTION_SQL);
  assert.deepEqual(client.calls[0].params.slice(1), [
    QUERY_ID,
    'CPU',
    'p-cpu-1',
    null,
    null,
    null,
    'CPU_SOCKET_MISMATCH',
  ]);
  assert.equal(result.query_id, QUERY_ID);
  assert.equal(result.rejection_count, 1);
  assert.equal(result.build_rejection_ids.length, 1);
  assert.match(result.build_rejection_ids[0], UUID_V4_RE);
  // The returned id must be the id SENT to the database. When the INSERT
  // omitted the id column, Postgres applied gen_random_uuid() and every
  // returned value pointed at a row that did not exist.
  assert.equal(client.calls[0].params[0], result.build_rejection_ids[0]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.build_rejection_ids));
});

test('a partner pair and a variant are passed through; absent ids stay null', async () => {
  const client = createClient();
  await persistRejections({
    client,
    queryId: QUERY_ID,
    rejections: [
      rejection({
        component_role: 'GPU',
        product_id: 'p-gpu',
        product_variant_id: 'v-gpu',
        partner_product_id: 'p-case',
        partner_product_variant_id: 'v-case',
        reason: 'GPU_TOO_LONG',
      }),
    ],
  });
  assert.deepEqual(client.calls[0].params.slice(1), [
    QUERY_ID,
    'GPU',
    'p-gpu',
    'v-gpu',
    'p-case',
    'v-case',
    'GPU_TOO_LONG',
  ]);
  // NULL is never coerced to '' or 0 (AGENTS.md section 8).
  for (const value of client.calls[0].params) {
    assert.notEqual(value, '');
    assert.notEqual(value, 0);
  }
});

test('every REJECT is written, in input order, with a distinct id', async () => {
  const client = createClient();
  const result = await persistRejections({
    client,
    queryId: QUERY_ID,
    rejections: [
      rejection({ product_id: 'a', reason: 'CPU_SOCKET_MISMATCH' }),
      rejection({ product_id: 'b', reason: 'CPU_SOCKET_UNKNOWN' }),
      rejection({ product_id: 'c', reason: 'GPU_TOO_THICK' }),
    ],
  });
  assert.equal(client.calls.length, 3);
  assert.deepEqual(
    client.calls.map((c) => c.params[3]),
    ['a', 'b', 'c']
  );
  assert.deepEqual(
    client.calls.map((c) => c.params[7]),
    ['CPU_SOCKET_MISMATCH', 'CPU_SOCKET_UNKNOWN', 'GPU_TOO_THICK']
  );
  assert.equal(result.rejection_count, 3);
  assert.equal(new Set(result.build_rejection_ids).size, 3);
});

// --- the healthy case ------------------------------------------------------

test('a pass that rejected nothing writes ZERO statements', async () => {
  for (const rejections of [[], undefined, [rejection({ status: 'PASS', reason: null })]]) {
    const client = createClient();
    const result = await persistRejections({
      client,
      queryId: QUERY_ID,
      rejections: rejections === undefined ? [] : rejections,
    });
    assert.equal(client.calls.length, 0);
    assert.equal(result.rejection_count, 0);
    assert.deepEqual(result.build_rejection_ids, []);
    assert.ok(Object.isFrozen(result.build_rejection_ids));
  }
});

test('a real Engine 2D verdict shape is accepted verbatim (regression: `reason`, not `reason_code`)', () => {
  // This is the exact key set filter.js freezes on a candidate verdict. The
  // writer must read `reason`: the first implementation read `reason_code`,
  // which looked plausible and rejected ALL 101 real verdicts on the live
  // branch. Pin the real shape so the field name cannot drift again.
  const realVerdict = Object.freeze({
    product_id: 'p-gpu',
    product_variant_id: 'v-gpu',
    category: 'GPU',
    component_role: 'GPU',
    status: 'REJECT',
    reason: 'GPU_TOO_THICK',
    relationships: Object.freeze({}),
    unknown_pairwise_count: 0,
    compatibility_notes: Object.freeze([]),
  });
  assert.strictEqual(realVerdict.reason_code, undefined);
  const rows = validateRejections({ queryId: QUERY_ID, rejections: [realVerdict] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason_code, 'GPU_TOO_THICK');
  assert.equal(rows[0].product_variant_id, 'v-gpu');
});

test('PASS and UNKNOWN verdicts are skipped, never written', async () => {
  const client = createClient();
  const result = await persistRejections({
    client,
    queryId: QUERY_ID,
    rejections: [
      rejection({ product_id: 'p1', status: 'PASS', reason: null }),
      rejection({ product_id: 'p2', status: 'UNKNOWN', reason: 'GPU_DIMENSIONS_UNKNOWN' }),
      rejection({ product_id: 'p3', status: 'REJECT', reason: 'GPU_TOO_LONG' }),
    ],
  });
  assert.equal(result.rejection_count, 1);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].params[3], 'p3');
});

test('a verdict with no status field is treated as a rejection candidate', () => {
  // Engine 2D always sets `status`; an absent one is ambiguous, so the
  // conservative reading is "persist it" rather than silently dropping a
  // rejection whose shape drifted.
  const rows = validateRejections({
    queryId: QUERY_ID,
    rejections: [{ component_role: 'CPU', product_id: 'p1', reason: 'CPU_SOCKET_MISMATCH' }],
  });
  assert.equal(rows.length, 1);
});

// --- validation ------------------------------------------------------------

test('a malformed input is refused and issues NO statement', async () => {
  const bad = [
    { rejections: null },
    { rejections: 'nope' },
    { rejections: [null] },
    { rejections: ['nope'] },
    { rejections: [rejection({ component_role: undefined })] },
    { rejections: [rejection({ component_role: '' })] },
    { rejections: [rejection({ product_id: undefined })] },
    { rejections: [rejection({ product_id: 42 })] },
    { rejections: [rejection({ reason: undefined })] },
    { rejections: [rejection({ reason: '   ' })] },
    { rejections: [rejection({ product_variant_id: '' })] },
    {
      rejections: [rejection({ partner_product_id: 'p2' })],
    },
    {
      rejections: [rejection({ partner_product_variant_id: 'v2' })],
    },
  ];
  for (const args of bad) {
    const client = createClient();
    const error = await rejectionOfAsync(() =>
      persistRejections({ client, queryId: QUERY_ID, ...args })
    );
    assert.ok(error.code, 'error carries an error code');
    assert.ok(client.calls.length === 0, 'no statement was issued');
  }
});

test('queryId is required and must be a non-empty string', () => {
  rejectionOf(() => validateRejections({ queryId: undefined, rejections: [] }));
  rejectionOf(() => validateRejections({ queryId: null, rejections: [] }));
  rejectionOf(() => validateRejections({ queryId: '', rejections: [] }));
  rejectionOf(() => validateRejections({ queryId: 7, rejections: [] }));
});

test('rejections is required and must be an array', () => {
  const missing = rejectionOf(() => validateRejections({ queryId: QUERY_ID }));
  assert.equal(missing.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  const wrongType = rejectionOf(() => validateRejections({ queryId: QUERY_ID, rejections: {} }));
  assert.equal(wrongType.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('the offending entry is named in the error field', () => {
  const error = rejectionOf(() =>
    validateRejections({
      queryId: QUERY_ID,
      rejections: [rejection(), rejection({ product_id: undefined })],
    })
  );
  assert.equal(error.field, 'product_id');
});

test('the client contract is required and issues no statement', async () => {
  for (const client of [null, undefined, {}, 'nope', 42]) {
    await rejectionOfAsync(() =>
      persistRejections({ client, queryId: QUERY_ID, rejections: [rejection()] })
    );
  }
});

test('validateRejections does not mutate its input and returns frozen rows', () => {
  const input = [rejection()];
  const snapshot = JSON.stringify(input);
  const rows = validateRejections({ queryId: QUERY_ID, rejections: input });
  assert.equal(JSON.stringify(input), snapshot);
  assert.ok(Object.isFrozen(rows));
  assert.ok(Object.isFrozen(rows[0]));
});

// --- boundary --------------------------------------------------------------

test('boundary: DML only, no transaction control, no clock, no pool', () => {
  const source = fs.readFileSync(path.join(__dirname, 'persist-rejections.js'), 'utf8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(stripped.includes('client.query'));
  assert.ok(stripped.includes('$1'));
  const banned = [
    "require('pg')",
    'new Pool',
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'SELECT',
    '../orchestrator',
    '../assembly',
    '../scoring',
    '../retention',
    '../filtering',
    '../candidates/errors.js',
    '../offers',
  ];
  for (const token of banned) {
    assert.ok(!stripped.includes(token), 'no ' + token);
  }
  assert.ok(stripped.indexOf('Math.random') === -1);
  assert.ok(stripped.indexOf('Date.now') === -1);
});

test('boundary: the validator imports only the error vocabulary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'validate-rejections.js'), 'utf8');
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]).sort();
  assert.deepEqual(requires, ['../candidates/errors']);
});
