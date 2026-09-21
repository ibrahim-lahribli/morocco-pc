'use strict';

// ---------------------------------------------------------------------------
// Decision 17.5 (src/recommendation/orchestrator/snapshot.js): the wrapper own
// transaction semantics.
//
// The pass itself is stubbed through the documented namespace seam
// (run.runRecommendation), so this file proves ONLY what the wrapper owns:
// BEGIN, exactly one end-of-transaction statement in every path, ROLLBACK on
// ANY thrown error (not just CandidateSelectionErrors), never COMMIT, and the
// error precedence. runRecommendation behaviour is covered by run.test.js.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runRecommendationSnapshot, BEGIN_SQL, ROLLBACK_SQL } = require('./snapshot');
const runModule = require('./run');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** Recording fake client; onQuery may make one statement fail. */
function createClient(options = {}) {
  const statements = [];
  return {
    statements,
    async query(sql) {
      statements.push(sql);
      if (typeof options.onQuery === 'function') {
        const outcome = options.onQuery(sql);
        if (outcome !== undefined) return outcome;
      }
      return { rows: [] };
    },
  };
}

/** Replace the orchestrator pass with a scripted stub (namespace seam). */
function stubPass(entries) {
  const calls = [];
  const original = runModule.runRecommendation;
  const queue = [...entries];
  runModule.runRecommendation = function stub(args) {
    calls.push(args);
    const entry = queue.shift() || {};
    if (entry.throw) return Promise.reject(entry.throw);
    return Promise.resolve(entry.result);
  };
  return {
    calls,
    restore() {
      runModule.runRecommendation = original;
    },
  };
}

async function withStubbedPass(entries, body) {
  const stub = stubPass(entries);
  try {
    return await body(stub);
  } finally {
    stub.restore();
  }
}

const QUERY_ID = '00000000-0000-4000-8000-000000000901';
const RAW_DB_ERROR = Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });

// ---------------------------------------------------------------------------
// 1. The transaction statements themselves.
// ---------------------------------------------------------------------------

test('snapshot: BEGIN_SQL and ROLLBACK_SQL are the exact Decision 17.5 statements', () => {
  assert.equal(BEGIN_SQL, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(ROLLBACK_SQL, 'ROLLBACK');
});

test('snapshot: BEGIN, the pass, then ROLLBACK - never COMMIT', async () => {
  const client = createClient();
  const sentinel = Object.freeze({ query_id: QUERY_ID, scoring_model_id: 'm', builds: [] });

  const out = await withStubbedPass([{ result: sentinel }], async (stub) => {
    const result = await runRecommendationSnapshot(client, QUERY_ID);
    // The pass receives the very same client object and the pinned id.
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].db, client);
    assert.equal(stub.calls[0].queryId, QUERY_ID);
    return result;
  });

  assert.equal(out, sentinel);
  assert.deepEqual(client.statements, [BEGIN_SQL, ROLLBACK_SQL]);
  assert.equal(client.statements.includes('COMMIT'), false);
});

// ---------------------------------------------------------------------------
// 2. ROLLBACK on ANY thrown error, with the pass error always winning.
// ---------------------------------------------------------------------------

test('snapshot: a CandidateSelectionError still ends the transaction and propagates unchanged', async () => {
  const client = createClient();
  const failure = new CandidateSelectionError(ERROR_CODES.INVALID_INPUT, 'no row', 'query_id');

  await withStubbedPass([{ throw: failure }], async () => {
    await assert.rejects(runRecommendationSnapshot(client, QUERY_ID), (error) => error === failure);
  });

  assert.deepEqual(client.statements, [BEGIN_SQL, ROLLBACK_SQL]);
});

test('snapshot: a raw PostgreSQL error (22P02) also rolls back - not only loader-mapped errors', async () => {
  const client = createClient();

  await withStubbedPass([{ throw: RAW_DB_ERROR }], async () => {
    await assert.rejects(runRecommendationSnapshot(client, QUERY_ID), (error) => error === RAW_DB_ERROR);
  });

  assert.deepEqual(client.statements, [BEGIN_SQL, ROLLBACK_SQL]);
});

test('snapshot: a failing ROLLBACK never masks the pass error', async () => {
  const client = createClient({
    onQuery(sql) {
      if (sql === ROLLBACK_SQL) throw new Error('connection terminated');
      return undefined;
    },
  });

  await withStubbedPass([{ throw: RAW_DB_ERROR }], async () => {
    await assert.rejects(runRecommendationSnapshot(client, QUERY_ID), (error) => error === RAW_DB_ERROR);
  });

  assert.deepEqual(client.statements, [BEGIN_SQL, ROLLBACK_SQL]);
});

test('snapshot: a failing ROLLBACK on a successful pass is surfaced', async () => {
  const client = createClient({
    onQuery(sql) {
      if (sql === ROLLBACK_SQL) throw new Error('connection terminated');
      return undefined;
    },
  });

  await withStubbedPass([{ result: { builds: [] } }], async () => {
    await assert.rejects(
      runRecommendationSnapshot(client, QUERY_ID),
      (error) => error.message === 'connection terminated'
    );
  });
});

// ---------------------------------------------------------------------------
// 3. BEGIN failure and the client contract.
// ---------------------------------------------------------------------------

test('snapshot: a failing BEGIN propagates with no ROLLBACK and no pass', async () => {
  const client = createClient({
    onQuery(sql) {
      if (sql === BEGIN_SQL) throw new Error('cannot begin');
      return undefined;
    },
  });

  await withStubbedPass([{ result: { builds: [] } }], async (stub) => {
    await assert.rejects(runRecommendationSnapshot(client, QUERY_ID), (error) => error.message === 'cannot begin');
    assert.equal(stub.calls.length, 0);
  });

  assert.deepEqual(client.statements, [BEGIN_SQL]);
});

test('snapshot: a client without query() is rejected before any statement', async () => {
  await withStubbedPass([{ result: { builds: [] } }], async (stub) => {
    for (const bad of [null, {}, 'client']) {
      await assert.rejects(runRecommendationSnapshot(bad, QUERY_ID), (error) =>
        error instanceof CandidateSelectionError
          && error.code === ERROR_CODES.INVALID_INPUT
          && error.field === 'client');
    }
    assert.equal(stub.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 4. Source boundary: the wrapper owns the transaction and nothing else.
// ---------------------------------------------------------------------------

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('snapshot.js keeps its source boundary (no DML, no COMMIT, no driver)', () => {
  const source = stripComments(fs.readFileSync(path.join(__dirname, 'snapshot.js'), 'utf8'));
  for (const token of [
    "require('pg')", 'new Pool', 'COMMIT', 'INSERT', 'UPDATE', 'DELETE',
    'filterCandidates', 'assembleBuilds', 'retainTopKPerRole', 'computeBuildScores',
  ]) {
    assert.ok(!source.includes(token), 'snapshot.js must not contain ' + token);
  }
  assert.ok(source.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.ok(source.includes("'ROLLBACK'"));
});