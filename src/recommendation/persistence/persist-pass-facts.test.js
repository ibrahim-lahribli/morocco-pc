'use strict';

/**
 * Unit tests for the Decision 46 pass-facts writer and its input contract.
 *
 * Fake-client only, exactly like ./persist-ranked.test.js and
 * ./persist-rejections.test.js: no database is touched. What these pin:
 *
 *   - the DML-only boundary (no SELECT/BEGIN/COMMIT/ROLLBACK/pool/clock), so
 *     the writer can only ever be driven inside the commit wrapper's
 *     transaction, and - unlike its two siblings - that it is UPDATE-only (no
 *     INSERT, no DELETE, no UUID): the rows it touches already exist;
 *   - the exact Decision 46 statement text and the parameter shape of both
 *     UPDATEs, including the `rank = index + 1` alignment and the order (the
 *     query's floor first, then one result row per rank);
 *   - NULL preservation: an absent fact reaches the driver as null, never as
 *     '' or 0 (AGENTS.md section 8);
 *   - the rank ALIGNMENT: `strategyKeys.length` must equal the number of rows
 *     persistRanked just wrote, so a short array cannot silently leave rows NULL
 *     and a long one cannot fire UPDATEs that match nothing;
 *   - the fail-fast matrix, and that NO statement is issued when validation
 *     fails (validation precedes the first UPDATE);
 *   - replacement, not accumulation: the writer issues no INSERT and no DELETE,
 *     so re-committing the same pass converges on the same values by
 *     construction - the Decision 31 idempotency property, inherited from
 *     UPDATE rather than from a DELETE step.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  persistPassFacts,
  validatePassFacts,
  UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL,
  UPDATE_RECOMMENDATION_RESULT_FACTS_SQL,
} = require('./persist-pass-facts');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const QUERY_ID = '00000000-0000-4000-8000-000000000946';

/** Result rows exactly as persistRanked just wrote them: rank = index + 1. */
const sel = (n) => Object.freeze(
  Array.from({ length: n }, (_, i) => Object.freeze({ persisted_rank: i + 1 }))
);

/** The Decision 27 diagnostic shape the orchestrator returns. */
function floor(overrides = {}) {
  return {
    cheapest_total: 7693,
    within_budget: true,
    currency: 'MAD',
    ...overrides,
  };
}

function passFacts(overrides = {}) {
  return {
    budgetFloor: floor(),
    engineVersion: 'launch-v2@1.1.0',
    strategyKeys: ['BALANCED', 'PERFORMANCE', 'VALUE'],
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

/** persistPassFacts is async, so a validation failure is a rejected promise. */
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

// --- 1. the statements themselves -------------------------------------------

test('persist-pass-facts: the two statement constants are the exact Decision 46 strings', () => {
  assert.equal(
    UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL,
    'UPDATE recommendation_query SET budget_floor = $2 WHERE id = $1'
  );
  assert.equal(
    UPDATE_RECOMMENDATION_RESULT_FACTS_SQL,
    'UPDATE recommendation_result SET engine_version = $1, strategy_key = $2 '
      + 'WHERE recommendation_query_id = $3 AND rank = $4'
  );
});

// --- 2. the happy path: statements, order, params ----------------------------

test('persist-pass-facts: floor first, then one result row per rank with rank = index + 1', async () => {
  const client = createClient();
  const facts = passFacts();

  const out = await persistPassFacts({ client, queryId: QUERY_ID, selected: sel(3), passFacts: facts });

  assert.deepEqual(
    client.calls.map((call) => call.sql),
    [
      UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL,
      UPDATE_RECOMMENDATION_RESULT_FACTS_SQL,
      UPDATE_RECOMMENDATION_RESULT_FACTS_SQL,
      UPDATE_RECOMMENDATION_RESULT_FACTS_SQL,
    ]
  );

  // The floor row: [queryId, floor object] - the object is passed THROUGH (the
  // driver JSON-encodes a plain object for jsonb; stringifying here would
  // double-encode it).
  assert.deepEqual(client.calls[0].params, [QUERY_ID, facts.budgetFloor]);

  // Each result row: [engineVersion, strategyKey, queryId, rank], ranks 1..3 in
  // the SAME order as the input array - the caller's rank alignment, as pinned
  // by the seam test in orchestrator/full-run.test.js.
  assert.deepEqual(client.calls[1].params, ['launch-v2@1.1.0', 'BALANCED', QUERY_ID, 1]);
  assert.deepEqual(client.calls[2].params, ['launch-v2@1.1.0', 'PERFORMANCE', QUERY_ID, 2]);
  assert.deepEqual(client.calls[3].params, ['launch-v2@1.1.0', 'VALUE', QUERY_ID, 3]);

  // Honest return: statement counts, not a claim that a row matched (a SELECT
  // is banned here, so the writer cannot know).
  assert.deepEqual(out, {
    query_id: QUERY_ID,
    floor_update_issued: true,
    result_updates_issued: 3,
  });
  assert.ok(Object.isFrozen(out));
});

test('persist-pass-facts: a zero-build pass writes the floor and no result rows', async () => {
  const client = createClient();
  const out = await persistPassFacts({
    client,
    queryId: QUERY_ID,
    selected: [],
    passFacts: passFacts({ strategyKeys: [] }),
  });

  assert.deepEqual(client.calls.map((call) => call.sql), [UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL]);
  assert.equal(out.result_updates_issued, 0);
  assert.equal(out.floor_update_issued, true);
});

// --- 3. NULL is a value, never '' or 0 --------------------------------------

test('persist-pass-facts: absent facts reach the driver as null, never "" or 0', async () => {
  const client = createClient();
  const out = await persistPassFacts({
    client,
    queryId: QUERY_ID,
    selected: sel(2),
    passFacts: { budgetFloor: null, engineVersion: null, strategyKeys: [null, 'VALUE'] },
  });

  assert.strictEqual(client.calls[0].params[1], null);
  assert.deepEqual(client.calls[1].params, [null, null, QUERY_ID, 1]);
  assert.deepEqual(client.calls[2].params, [null, 'VALUE', QUERY_ID, 2]);
  assert.equal(out.result_updates_issued, 2);
});

// --- 4. replacement, not accumulation ---------------------------------------

test('persist-pass-facts: re-committing the same pass issues the same statements (no INSERT, no DELETE)', async () => {
  const first = createClient();
  const second = createClient();
  const facts = passFacts();

  await persistPassFacts({ client: first, queryId: QUERY_ID, selected: sel(3), passFacts: facts });
  await persistPassFacts({ client: second, queryId: QUERY_ID, selected: sel(3), passFacts: facts });

  // Identical statement stream: an UPDATE converges by construction, so a
  // second commit of the same pass cannot duplicate or accumulate anything.
  assert.deepEqual(
    second.calls.map((call) => [call.sql, call.params]),
    first.calls.map((call) => [call.sql, call.params])
  );
  for (const call of first.calls) {
    assert.ok(!/INSERT|DELETE|TRUNCATE/.test(call.sql), 'the writer must never INSERT or DELETE');
  }

  // A changed fact REPLACES the stored one: same statement, new param.
  const changed = createClient();
  await persistPassFacts({
    client: changed,
    queryId: QUERY_ID,
    selected: sel(3),
    passFacts: passFacts({ engineVersion: 'launch-v2@1.2.0' }),
  });
  assert.equal(changed.calls[1].params[0], 'launch-v2@1.2.0');
  assert.equal(changed.calls[1].params[3], 1);
});

// --- 5. fail fast, before any statement -------------------------------------

test('persist-pass-facts: a client without query() is rejected before any statement', async () => {
  for (const bad of [null, {}, 'client', { query: 1 }]) {
    const error = await rejectionOfAsync(() =>
      persistPassFacts({ client: bad, queryId: QUERY_ID, selected: sel(3), passFacts: passFacts() })
    );
    assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
    assert.equal(error.field, 'client');
  }
});

test('persist-pass-facts: a malformed queryId is rejected before any statement', async () => {
  for (const bad of [undefined, null, '', 42, {}]) {
    const client = createClient();
    const error = await rejectionOfAsync(() =>
      persistPassFacts({ client, queryId: bad, selected: sel(3), passFacts: passFacts() })
    );
    assert.ok(
      error.code === ERROR_CODES.MISSING_REQUIRED_FIELD || error.code === ERROR_CODES.INVALID_FIELD_VALUE,
      'unexpected code ' + error.code
    );
    assert.equal(error.field, 'queryId');
    assert.equal(client.calls.length, 0);
  }
});

test('persist-pass-facts: the passFacts contract fails fast and issues no statement', async () => {
  const cases = [
    // [label, passFacts, expected code, expected field]
    ['undefined', undefined, ERROR_CODES.MISSING_REQUIRED_FIELD, 'passFacts'],
    ['null', null, ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts'],
    ['an array', [], ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts'],
    ['a string', 'facts', ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts'],
    ['no budgetFloor', { engineVersion: 'v', strategyKeys: [] }, ERROR_CODES.MISSING_REQUIRED_FIELD, 'passFacts.budgetFloor'],
    ['a string budgetFloor', passFacts({ budgetFloor: 'floor' }), ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts.budgetFloor'],
    ['no engineVersion', { budgetFloor: floor(), strategyKeys: [] }, ERROR_CODES.MISSING_REQUIRED_FIELD, 'passFacts.engineVersion'],
    ['a blank engineVersion', passFacts({ engineVersion: '   ' }), ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts.engineVersion'],
    ['no strategyKeys', { budgetFloor: floor(), engineVersion: 'v' }, ERROR_CODES.MISSING_REQUIRED_FIELD, 'passFacts.strategyKeys'],
    ['non-array strategyKeys', passFacts({ strategyKeys: 'BALANCED' }), ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts.strategyKeys'],
    ['an undefined strategy key', passFacts({ strategyKeys: ['BALANCED', undefined] }), ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts.strategyKeys[1]'],
    ['a blank strategy key', passFacts({ strategyKeys: [''] }), ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts.strategyKeys[0]'],
    // The alignment half the writer CAN check: one key per persisted row.
    ['fewer keys than rows', passFacts({ strategyKeys: ['BALANCED'] }), ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts.strategyKeys'],
    ['more keys than rows', passFacts({ strategyKeys: ['BALANCED', 'PERFORMANCE', 'VALUE', 'EXTRA'] }), ERROR_CODES.INVALID_FIELD_VALUE, 'passFacts.strategyKeys'],
  ];

  for (const [label, value, code, field] of cases) {
    const client = createClient();
    const error = await rejectionOfAsync(() =>
      persistPassFacts({ client, queryId: QUERY_ID, selected: sel(3), passFacts: value })
    );
    assert.equal(error.code, code, label + ': wrong code');
    assert.equal(error.field, field, label + ': wrong field');
    // The whole point of validating before the first UPDATE: a malformed
    // diagnostic must not reach the database at all.
    assert.equal(client.calls.length, 0, label + ': issued a statement');
  }
});

test('persist-pass-facts: a missing or non-array selected is rejected before any statement', async () => {
  for (const missing of [undefined, null, {}, 'rows', 3]) {
    const client = createClient();
    const error = await rejectionOfAsync(() =>
      persistPassFacts({ client, queryId: QUERY_ID, selected: missing, passFacts: passFacts() })
    );
    assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
    assert.equal(error.field, 'selected');
    assert.equal(client.calls.length, 0);
  }
});

test("persist-pass-facts: the error names both counts when strategyKeys and the rows disagree", async () => {
  const client = createClient();
  const error = await rejectionOfAsync(() =>
    persistPassFacts({
      client,
      queryId: QUERY_ID,
      selected: sel(3),
      passFacts: passFacts({ strategyKeys: ['BALANCED'] }),
    })
  );
  assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(error.field, 'passFacts.strategyKeys');
  // Both numbers are in the message, so the diagnosis needs no source dive.
  assert.ok(error.message.includes('has 1 entries'), error.message);
  assert.ok(error.message.includes('persisted 3 result row(s)'), error.message);
  assert.equal(client.calls.length, 0);
});

// --- 6. purity ---------------------------------------------------------------

test('persist-pass-facts: the input is never mutated and the normalized facts are frozen', () => {
  const input = passFacts({ strategyKeys: ['BALANCED', null] });
  const before = JSON.stringify(input);

  const facts = validatePassFacts(input);

  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(facts));
  assert.ok(Object.isFrozen(facts.strategyKeys));
  // A defensive copy: mutating the caller's array afterwards cannot change the
  // normalized facts (and is what stops the writer reading a moving target).
  input.strategyKeys.push('VALUE');
  assert.equal(facts.strategyKeys.length, 2);
});

// --- 7. boundary -------------------------------------------------------------

test('boundary: DML only, UPDATE-only, no transaction control, no clock, no pool', () => {
  const source = fs.readFileSync(path.join(__dirname, 'persist-pass-facts.js'), 'utf8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  assert.ok(stripped.includes('client.query'));
  assert.ok(stripped.includes('$1'));

  for (const token of [
    "require('pg')",
    'new Pool',
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'SELECT',
    'INSERT',
    'DELETE',
    'TRUNCATE',
    'RETURNING',
    'randomUUID',
    'Math.random',
    'Date.now',
    '../orchestrator',
    '../assembly',
    '../scoring',
    '../retention',
    '../filtering',
    '../offers',
    '../candidates/errors.js',
  ]) {
    assert.ok(!stripped.includes(token), 'must not contain ' + token);
  }

  // The rows already exist by the time this writer runs, so it is UPDATE-only:
  // no id is minted and no row is created or removed.
  assert.equal((stripped.match(/UPDATE /g) || []).length, 2);
});

test('boundary: the writer imports only the error vocabulary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'persist-pass-facts.js'), 'utf8');
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]).sort();
  assert.deepEqual(requires, ['../candidates/errors']);
});
