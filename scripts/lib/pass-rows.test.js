'use strict';

// scripts/lib/pass-rows.test.js — the DB-free contract of the Layer 4 row
// bookkeeping shared by the role rehearsal and the production smoke test.
//
// The DELETE ORDER is the load-bearing part and is why this file exists: every FK
// back to `recommendation_query` is ON DELETE NO ACTION and the query's own FK
// points at `recommendation_profile`, so a wrong order raises a constraint
// violation mid-cleanup and leaves rows the golden harness preflight refuses to
// run behind. A fake client pins the order, the scoping and the round-trip count
// without a database; the live proof is the twice-green rehearsal in
// `docs/API.md`.

const test = require('node:test');
const assert = require('node:assert/strict');

const { DELETE_ORDER, LAYER4_TABLES, deletePassRows, layer4Counts, residueDrift } = require('./pass-rows');

/** A fake pg client that records what it was asked to run. */
function recordingClient(rowsPerStatement) {
  const calls = [];
  const client = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (Array.isArray(rowsPerStatement)) return { rows: rowsPerStatement, rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  return client;
}

test('the delete order covers all six tables exactly once, children first', () => {
  assert.deepEqual(
    DELETE_ORDER,
    ['build_rejection', 'recommendation_result', 'build_component', 'build_candidate', 'recommendation_query', 'recommendation_profile'],
    'the order IS the contract: children first, the query before its profile'
  );
  assert.equal(new Set(DELETE_ORDER).size, DELETE_ORDER.length);
  assert.deepEqual(DELETE_ORDER.slice().sort(), LAYER4_TABLES.slice().sort(), 'the same six tables, in a different order');
  // The parent really is last among the rows that reference it.
  assert.ok(DELETE_ORDER.indexOf('recommendation_query') < DELETE_ORDER.indexOf('recommendation_profile'));
  assert.equal(DELETE_ORDER[DELETE_ORDER.length - 1], 'recommendation_profile');
});

test('deletePassRows issues the deletes in dependency order, scoped to the one query', async () => {
  const client = recordingClient();
  const removed = await deletePassRows(client, { queryId: 'Q', profileId: 'P' });

  assert.equal(client.calls.length, DELETE_ORDER.length, 'one statement per table');
  for (let i = 0; i < DELETE_ORDER.length; i += 1) {
    const table = DELETE_ORDER[i];
    const call = client.calls[i];
    assert.match(call.sql, new RegExp('^DELETE FROM ' + table + '\\b'), 'statement ' + i + ' must delete from ' + table);
    // Every statement is scoped by a parameter — never interpolated — and the
    // build_component delete reaches its parent through a subselect, not a join
    // that would also match another pass's rows.
    if (table === 'recommendation_profile') {
      assert.deepEqual(call.params, ['P'], 'the profile is its own id, not the query id');
      assert.match(call.sql, /WHERE id = \$1::uuid$/);
    } else {
      assert.deepEqual(call.params, ['Q'], table + ' must be scoped to the one query id');
    }
    if (table === 'build_component') {
      assert.match(call.sql, /build_candidate_id IN \(SELECT id FROM build_candidate WHERE recommendation_query_id = \$1::uuid\)/);
    } else if (table !== 'recommendation_profile') {
      assert.match(call.sql, /WHERE (recommendation_query_id = \$1::uuid|id = \$1::uuid)/);
    }
  }
  assert.deepEqual(Object.keys(removed), DELETE_ORDER, 'the counts come back per table');
});

test('deletePassRows with no query id issues NOTHING (never a bare DELETE)', async () => {
  for (const ids of [{}, { queryId: null }, { queryId: '' }, null, undefined]) {
    const client = recordingClient();
    const removed = await deletePassRows(client, ids);
    assert.equal(client.calls.length, 0, 'no ids means no statements: a DELETE without a scope would be catastrophic here');
    assert.deepEqual(removed, {});
  }
  // A profile id alone is not a pass either.
  const client = recordingClient();
  await deletePassRows(client, { profileId: 'P' });
  assert.equal(client.calls.length, 0);
});

test('deletePassRows without a profile id simply skips that step', async () => {
  const client = recordingClient();
  await deletePassRows(client, { queryId: 'Q' });
  assert.equal(client.calls.length, DELETE_ORDER.length - 1);
  assert.ok(!client.calls.some((call) => /recommendation_profile/.test(call.sql)));
});

test('deletePassRows refuses a non-client, rather than silently doing nothing', async () => {
  await assert.rejects(() => deletePassRows({}, { queryId: 'Q' }), /pg-compatible client/);
  await assert.rejects(() => layer4Counts(null), /pg-compatible client/);
});

test('layer4Counts is ONE round trip over all six tables and returns numbers', async () => {
  const client = recordingClient([
    { table_name: 'recommendation_profile', n: 0 },
    { table_name: 'recommendation_query', n: 0 },
    { table_name: 'build_candidate', n: 0 },
    { table_name: 'build_component', n: 0 },
    { table_name: 'recommendation_result', n: 0 },
    { table_name: 'build_rejection', n: 0 },
  ]);
  const counts = await layer4Counts(client);
  assert.equal(client.calls.length, 1, 'one statement, not six');
  assert.equal((client.calls[0].sql.match(/UNION ALL/g) || []).length, LAYER4_TABLES.length - 1);
  assert.ok(client.calls[0].sql.endsWith('ORDER BY 1'), 'a deterministic row order');
  for (const table of LAYER4_TABLES) {
    assert.equal(counts[table], 0, table + ' must be present even at zero');
    assert.equal(typeof counts[table], 'number', 'counts are numbers, so a comparison is not a string comparison');
  }
});

test('residueDrift names every drifting table in either direction, and nothing when clean', () => {
  const clean = { recommendation_profile: 0, recommendation_query: 0, build_candidate: 0, build_component: 0, recommendation_result: 0, build_rejection: 0 };
  assert.deepEqual(residueDrift(clean, Object.assign({}, clean)), [], 'identical counts are not drift');
  assert.deepEqual(residueDrift(null, clean), [], 'an absent BEFORE reads as zero for every table');
  assert.deepEqual(residueDrift(clean, undefined), [], 'an absent AFTER reads as zero too');

  const grew = Object.assign({}, clean, { build_candidate: 1 });
  assert.deepEqual(residueDrift(clean, grew), [{ table: 'build_candidate', before: 0, after: 1 }]);
  // Both directions, and more than one table: a cleanup that overshot is also a
  // defect worth failing on.
  const mixed = Object.assign({}, clean, { build_candidate: 1, recommendation_query: -1 });
  assert.deepEqual(residueDrift(clean, mixed), [
    { table: 'recommendation_query', before: 0, after: -1 },
    { table: 'build_candidate', before: 0, after: 1 },
  ]);
  assert.deepEqual(residueDrift({ recommendation_query: '3' }, { recommendation_query: 3 }), [], 'a NUMERIC-string count compares equal to its number');
});
