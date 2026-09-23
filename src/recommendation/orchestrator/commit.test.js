'use strict';

// ---------------------------------------------------------------------------
// Decision 19.1 / 19.2 (src/recommendation/orchestrator/commit.js): the commit
// wrapper owns the write transaction's semantics.
//
// The writer is stubbed through the documented namespace seam
// (persistence.persistRanked), so this file proves ONLY what the wrapper owns:
// plain BEGIN (Decision 18-D9), the two guard SELECTs in order carrying the
// pinned query id, the writer invoked on the SAME client, COMMIT on success,
// ROLLBACK on ANY thrown error (guard fail-fast, writer error, failing COMMIT)
// and the error precedence (the transaction error always wins over a failing
// ROLLBACK). persistRanked behaviour is covered by persist-ranked.test.js.
//
// commit.js is deliberately NOT exported by the orchestrator barrel yet: this
// pass is independently testable first, the ./run wiring is a later step.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  runRecommendationCommit,
  BEGIN_SQL,
  COMMIT_SQL,
  ROLLBACK_SQL,
  LOCK_RECOMMENDATION_QUERY_SQL,
  EXISTING_BUILD_CANDIDATES_SQL,
} = require('./commit');
const persistenceModule = require('../persistence/persist-ranked');
const { ERROR_CODES, CandidateSelectionError } = require('../candidates/errors');

/**
 * Recording fake client. Default outcome = happy path (the query row exists
 * and has no persisted candidates); `options.onQuery` overrides per statement
 * with either a result object or a thrown error.
 */
function createClient(options = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (typeof options.onQuery === 'function') {
        const outcome = options.onQuery(sql, params);
        if (outcome !== undefined) return outcome;
      }
      if (sql === LOCK_RECOMMENDATION_QUERY_SQL) return { rows: [{ id: QUERY_ID }] };
      return { rows: [] };
    },
  };
}

/** Replace persistRanked with a scripted stub (module-namespace seam). */
function stubWriter(entries) {
  const calls = [];
  const original = persistenceModule.persistRanked;
  const queue = [...entries];
  persistenceModule.persistRanked = function stub(args) {
    calls.push(args);
    const entry = queue.shift() || {};
    if (entry.throw) return Promise.reject(entry.throw);
    return Promise.resolve(entry.result);
  };
  return {
    calls,
    restore() {
      persistenceModule.persistRanked = original;
    },
  };
}

async function withStubbedWriter(entries, body) {
  const stub = stubWriter(entries);
  try {
    return await body(stub);
  } finally {
    stub.restore();
  }
}

const sqlsOf = (client) => client.calls.map((call) => call.sql);
const snap = (value) => JSON.parse(JSON.stringify(value));

const QUERY_ID = '00000000-0000-4000-8000-000000000911';
/** The wrapper never inspects `selected`; the writer's contract covers it. */
const SELECTED = Object.freeze([{ persisted_rank: 1 }]);
const WRITTEN = Object.freeze({
  query_id: QUERY_ID,
  persisted_ranks: Object.freeze([1]),
  build_candidate_ids: Object.freeze(['bc-1']),
  recommendation_result_ids: Object.freeze(['rr-1']),
});
const GUARD_FAILURE = new CandidateSelectionError(ERROR_CODES.INVALID_INPUT, 'no row', 'query_id');
const RAW_DB_ERROR = Object.assign(
  new Error('insert or update on table "build_component" violates foreign key constraint'),
  { code: '23503' }
);
const CONNECTION_LOST = new Error('connection terminated');


// ---------------------------------------------------------------------------
// 1. The statements themselves.
// ---------------------------------------------------------------------------

test('commit: the transaction and guard statements are the exact Decision 19/18-D9 strings', () => {
  assert.equal(BEGIN_SQL, 'BEGIN');
  assert.equal(COMMIT_SQL, 'COMMIT');
  assert.equal(ROLLBACK_SQL, 'ROLLBACK');
  assert.equal(
    LOCK_RECOMMENDATION_QUERY_SQL,
    'SELECT id FROM recommendation_query WHERE id = $1 FOR UPDATE'
  );
  assert.equal(
    EXISTING_BUILD_CANDIDATES_SQL,
    'SELECT 1 FROM build_candidate WHERE recommendation_query_id = $1 LIMIT 1'
  );
});

test('commit: BEGIN, both guards with the pinned id, the writer, COMMIT - in that order', async () => {
  const client = createClient();
  const before = snap(SELECTED);

  const out = await withStubbedWriter([{ result: WRITTEN }], async (stub) => {
    const result = await runRecommendationCommit(client, QUERY_ID, SELECTED);
    assert.equal(stub.calls.length, 1);
    // The writer receives the very same client, the pinned id and selected.
    assert.equal(stub.calls[0].client, client);
    assert.equal(stub.calls[0].queryId, QUERY_ID);
    assert.equal(stub.calls[0].selected, SELECTED);
    return result;
  });

  assert.equal(out, WRITTEN);
  assert.deepEqual(sqlsOf(client), [
    BEGIN_SQL,
    LOCK_RECOMMENDATION_QUERY_SQL,
    EXISTING_BUILD_CANDIDATES_SQL,
    COMMIT_SQL,
  ]);
  // Both guards are parameterized with the pinned query id only.
  assert.deepEqual(client.calls[1].params, [QUERY_ID]);
  assert.deepEqual(client.calls[2].params, [QUERY_ID]);
  assert.equal(sqlsOf(client).includes(ROLLBACK_SQL), false);
  // Caller-owned input is never mutated.
  assert.deepEqual(snap(SELECTED), before);
});

test('commit: zero builds still runs the whole transaction and commits zero writes', async () => {
  const client = createClient();
  const empty = Object.freeze({
    query_id: QUERY_ID,
    persisted_ranks: Object.freeze([]),
    build_candidate_ids: Object.freeze([]),
    recommendation_result_ids: Object.freeze([]),
  });

  const out = await withStubbedWriter([{ result: empty }], async (stub) => {
    const result = await runRecommendationCommit(client, QUERY_ID, []);
    // Decision 18-D8: valid outcome, not an error - the writer is still called.
    assert.equal(stub.calls.length, 1);
    assert.deepEqual(stub.calls[0].selected, []);
    return result;
  });

  assert.equal(out, empty);
  assert.deepEqual(sqlsOf(client), [
    BEGIN_SQL,
    LOCK_RECOMMENDATION_QUERY_SQL,
    EXISTING_BUILD_CANDIDATES_SQL,
    COMMIT_SQL,
  ]);
});

// ---------------------------------------------------------------------------
// 2. The two guards: fail-fast, before any write (Decision 19.2).
// ---------------------------------------------------------------------------

test('commit: a nonexistent recommendation_query fails fast after guard 1 only', async () => {
  const client = createClient({
    onQuery(sql) {
      if (sql === LOCK_RECOMMENDATION_QUERY_SQL) return { rows: [] };
      return undefined;
    },
  });

  await withStubbedWriter([{ result: WRITTEN }], async (stub) => {
    await assert.rejects(
      runRecommendationCommit(client, QUERY_ID, SELECTED),
      (error) => error instanceof CandidateSelectionError
        && error.code === ERROR_CODES.INVALID_INPUT
        && error.field === 'query_id'
    );
    // Guard 2 is never reached and the writer is never called.
    assert.equal(stub.calls.length, 0);
  });

  // The transaction opened by BEGIN is still ended, so the caller's session is
  // left clean (no open transaction, no lingering row lock).
  assert.deepEqual(sqlsOf(client), [
    BEGIN_SQL,
    LOCK_RECOMMENDATION_QUERY_SQL,
    ROLLBACK_SQL,
  ]);
});

test('commit: already-persisted candidates are refused fail-fast (any row shape counts)', async () => {
  const client = createClient({
    onQuery(sql) {
      if (sql === EXISTING_BUILD_CANDIDATES_SQL) return { rows: [{ '?column?': 1 }] };
      return undefined;
    },
  });

  await withStubbedWriter([{ result: WRITTEN }], async (stub) => {
    await assert.rejects(
      runRecommendationCommit(client, QUERY_ID, SELECTED),
      (error) => error instanceof CandidateSelectionError
        && error.code === ERROR_CODES.INVALID_INPUT
        && error.field === 'query_id'
    );
    // No overwrite, no delete, no upsert: the writer is never called.
    assert.equal(stub.calls.length, 0);
  });

  assert.deepEqual(sqlsOf(client), [
    BEGIN_SQL,
    LOCK_RECOMMENDATION_QUERY_SQL,
    EXISTING_BUILD_CANDIDATES_SQL,
    ROLLBACK_SQL,
  ]);
});

// ---------------------------------------------------------------------------
// 3. ROLLBACK on ANY thrown error, with the transaction error always winning.
// ---------------------------------------------------------------------------

test('commit: a writer CandidateSelectionError rolls back and propagates unchanged', async () => {
  const client = createClient();

  await withStubbedWriter([{ throw: GUARD_FAILURE }], async () => {
    await assert.rejects(
      runRecommendationCommit(client, QUERY_ID, SELECTED),
      (error) => error === GUARD_FAILURE
    );
  });

  assert.deepEqual(sqlsOf(client), [
    BEGIN_SQL,
    LOCK_RECOMMENDATION_QUERY_SQL,
    EXISTING_BUILD_CANDIDATES_SQL,
    ROLLBACK_SQL,
  ]);
  assert.equal(sqlsOf(client).includes(COMMIT_SQL), false);
});

test('commit: a raw PostgreSQL writer error (23503) also rolls back - not only mapped errors', async () => {
  const client = createClient();

  await withStubbedWriter([{ throw: RAW_DB_ERROR }], async () => {
    await assert.rejects(
      runRecommendationCommit(client, QUERY_ID, SELECTED),
      (error) => error === RAW_DB_ERROR
    );
  });

  assert.deepEqual(sqlsOf(client), [
    BEGIN_SQL,
    LOCK_RECOMMENDATION_QUERY_SQL,
    EXISTING_BUILD_CANDIDATES_SQL,
    ROLLBACK_SQL,
  ]);
});

test('commit: a guard failure wins over a failing ROLLBACK', async () => {
  const client = createClient({
    onQuery(sql) {
      if (sql === ROLLBACK_SQL) throw CONNECTION_LOST;
      if (sql === LOCK_RECOMMENDATION_QUERY_SQL) return { rows: [] };
      return undefined;
    },
  });

  await withStubbedWriter([{ result: WRITTEN }], async () => {
    await assert.rejects(
      runRecommendationCommit(client, QUERY_ID, SELECTED),
      (error) => error instanceof CandidateSelectionError
        && error.code === ERROR_CODES.INVALID_INPUT
        && error.field === 'query_id'
    );
  });

  assert.deepEqual(sqlsOf(client), [BEGIN_SQL, LOCK_RECOMMENDATION_QUERY_SQL, ROLLBACK_SQL]);
});

test('commit: a writer error wins over a failing ROLLBACK', async () => {
  const client = createClient({
    onQuery(sql) {
      if (sql === ROLLBACK_SQL) throw CONNECTION_LOST;
      return undefined;
    },
  });

  await withStubbedWriter([{ throw: RAW_DB_ERROR }], async () => {
    await assert.rejects(
      runRecommendationCommit(client, QUERY_ID, SELECTED),
      (error) => error === RAW_DB_ERROR
    );
  });

  assert.deepEqual(sqlsOf(client), [
    BEGIN_SQL,
    LOCK_RECOMMENDATION_QUERY_SQL,
    EXISTING_BUILD_CANDIDATES_SQL,
    ROLLBACK_SQL,
  ]);
});

test('commit: a failing COMMIT rolls back and its error wins, even if ROLLBACK also fails', async () => {
  const client = createClient({
    onQuery(sql) {
      if (sql === COMMIT_SQL) throw RAW_DB_ERROR;
      if (sql === ROLLBACK_SQL) throw CONNECTION_LOST;
      return undefined;
    },
  });

  await withStubbedWriter([{ result: WRITTEN }], async () => {
    await assert.rejects(
      runRecommendationCommit(client, QUERY_ID, SELECTED),
      (error) => error === RAW_DB_ERROR
    );
  });

  // The failed COMMIT is never retried and COMMIT is issued exactly once.
  assert.deepEqual(sqlsOf(client), [
    BEGIN_SQL,
    LOCK_RECOMMENDATION_QUERY_SQL,
    EXISTING_BUILD_CANDIDATES_SQL,
    COMMIT_SQL,
    ROLLBACK_SQL,
  ]);
});

// ---------------------------------------------------------------------------
// 4. BEGIN failure and the client contract.
// ---------------------------------------------------------------------------

test('commit: a failing BEGIN propagates with no ROLLBACK and no writer call', async () => {
  const client = createClient({
    onQuery(sql) {
      if (sql === BEGIN_SQL) throw new Error('cannot begin');
      return undefined;
    },
  });

  await withStubbedWriter([{ result: WRITTEN }], async (stub) => {
    await assert.rejects(
      runRecommendationCommit(client, QUERY_ID, SELECTED),
      (error) => error.message === 'cannot begin'
    );
    assert.equal(stub.calls.length, 0);
  });

  assert.deepEqual(sqlsOf(client), [BEGIN_SQL]);
});

test('commit: a client without query() is rejected before any statement', async () => {
  await withStubbedWriter([{ result: WRITTEN }], async (stub) => {
    for (const bad of [null, {}, 'client', { query: 1 }]) {
      await assert.rejects(runRecommendationCommit(bad, QUERY_ID, SELECTED), (error) =>
        error instanceof CandidateSelectionError
          && error.code === ERROR_CODES.INVALID_INPUT
          && error.field === 'client');
    }
    assert.equal(stub.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 5. Source boundary: the wrapper owns the transaction and the two guards only.
// ---------------------------------------------------------------------------

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Comment-stripped commit.js source, read once for the boundary assertions. */
const SOURCE = stripComments(fs.readFileSync(path.join(__dirname, 'commit.js'), 'utf8'));

test('commit.js keeps its source boundary (no DML, no driver, no read pass)', () => {
  for (const token of [
    "require('pg')", "require('node:pg')", 'new Pool', 'new Client',
    'INSERT', 'DELETE', 'TRUNCATE', 'RETURNING',
    'CREATE TABLE', 'ALTER TABLE',
    // The read pass's transaction belongs to ./snapshot alone (Decision 17.5):
    // the write transaction is a plain BEGIN (Decision 18-D9).
    'BEGIN ISOLATION LEVEL', 'READ ONLY',
    './run', './snapshot',
    '../assembly', '../scoring', '../retention', '../filtering', '../query', '../offers',
  ]) {
    assert.ok(!SOURCE.includes(token), 'commit.js must not contain ' + token);
  }

  // The re-run guard's row lock is the ONLY UPDATE keyword in this module.
  assert.equal((SOURCE.match(/UPDATE/g) || []).length, 1);
  assert.ok(SOURCE.includes('FOR UPDATE'));
  assert.ok(SOURCE.includes("'SELECT id FROM recommendation_query WHERE id = $1 FOR UPDATE'"));
  assert.ok(
    SOURCE.includes("'SELECT 1 FROM build_candidate WHERE recommendation_query_id = $1 LIMIT 1'")
  );
  // The writer is reached through the namespace seam, on the same client.
  assert.ok(SOURCE.includes('persistence.persistRanked({ client, queryId, selected })'));
  assert.ok(SOURCE.includes('BEGIN_SQL'));
  assert.ok(SOURCE.includes("'BEGIN'"));
});

test('commit.js issues the guards before the writer and COMMIT after it', () => {
  const lock = SOURCE.indexOf('LOCK_RECOMMENDATION_QUERY_SQL, [queryId]');
  const existing = SOURCE.indexOf('EXISTING_BUILD_CANDIDATES_SQL, [queryId]');
  const writer = SOURCE.indexOf('persistence.persistRanked(');
  const commit = SOURCE.indexOf('client.query(COMMIT_SQL)');
  assert.ok(lock !== -1 && existing !== -1 && writer !== -1 && commit !== -1);
  assert.ok(lock < existing, 'guard 1 must precede guard 2');
  assert.ok(existing < writer, 'both guards must precede the writer');
  assert.ok(writer < commit, 'COMMIT must follow the writer');
  // ROLLBACK is the catch path only (it never follows a successful COMMIT in
  // source order as a happy-path statement).
  assert.ok(SOURCE.indexOf('client.query(ROLLBACK_SQL)') > commit);
});

test('commit.js imports exactly the error vocabulary and the writer module', () => {
  const requires = [...SOURCE.matchAll(/require\('([^']+)'\)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(requires, ['../candidates/errors', '../persistence/persist-ranked']);
});
