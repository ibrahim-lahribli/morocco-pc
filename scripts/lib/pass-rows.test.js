'use strict';

// scripts/lib/pass-rows.test.js — the DB-free contract of the Layer 4 row
// bookkeeping shared by the role rehearsal and the production smoke test.
//
// The DELETE ORDER is the load-bearing part and is why this file exists: every FK
// back to `recommendation_query` is ON DELETE NO ACTION and the query's own FK
// points at `recommendation_profile`, so a wrong order raises a constraint
// violation mid-cleanup and leaves rows the golden harness preflight refuses to
// run behind. `recommendation_swap` (023) holds FKs to BOTH the source result and
// the derived candidate, so it must be deleted before either — a swapped pass is
// otherwise undeletable, and a swapped pass is exactly what a crashed API probe
// leaves behind. A fake client pins the order, the scoping and the round-trip
// count without a database; the live proof is the twice-green rehearsal in
// `docs/API.md` and `apps/api/test/db/swap-commit.db.test.js`, which deletes a
// REAL swapped pass through `deletePassRows`.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DELETE_ORDER,
  LAYER4_TABLES,
  SWAP_TABLE,
  deletePassRows,
  deleteSwaps,
  layer4Counts,
  residueDrift,
} = require('./pass-rows');

/** The six tables that exist with or without 023. */
const SIX_FLAT_TABLES = [
  'build_rejection',
  'recommendation_result',
  'build_component',
  'build_candidate',
  'recommendation_query',
  'recommendation_profile',
];

/**
 * A fake pg client that records what it was asked to run.
 *
 * `swapPresent` answers the `to_regclass` probe (default true, i.e. a database at
 * 023+); `rowsPerStatement` lets a test answer a real SELECT.
 */
function recordingClient(options) {
  const opts = Array.isArray(options) ? { rows: options } : (options || {});
  const calls = [];
  const client = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/to_regclass/.test(sql)) {
        return { rows: [{ present: opts.swapPresent !== false }], rowCount: 0 };
      }
      if (Array.isArray(opts.rows)) return { rows: opts.rows, rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  return client;
}

test('the delete order covers the six Layer 4 tables plus the swap, children first', () => {
  assert.deepEqual(
    DELETE_ORDER,
    [SWAP_TABLE].concat(SIX_FLAT_TABLES),
    'the order IS the contract: the swap first, then children first, the query before its profile'
  );
  assert.equal(new Set(DELETE_ORDER).size, DELETE_ORDER.length);
  assert.deepEqual(
    DELETE_ORDER.slice().sort(),
    LAYER4_TABLES.concat([SWAP_TABLE]).sort(),
    'the six tables whose residue is compared, plus the swap, in a different order'
  );
  // The swap references the result and the derived candidate, so it cannot come
  // after either of them.
  assert.equal(DELETE_ORDER[0], SWAP_TABLE, 'the swap is deleted BEFORE every row it points at');
  assert.ok(DELETE_ORDER.indexOf(SWAP_TABLE) < DELETE_ORDER.indexOf('recommendation_result'));
  assert.ok(DELETE_ORDER.indexOf(SWAP_TABLE) < DELETE_ORDER.indexOf('build_candidate'));
  // The parent really is last among the rows that reference it.
  assert.ok(DELETE_ORDER.indexOf('recommendation_query') < DELETE_ORDER.indexOf('recommendation_profile'));
  assert.equal(DELETE_ORDER[DELETE_ORDER.length - 1], 'recommendation_profile');
});

test('deletePassRows deletes the swap FIRST, then the six tables in dependency order', async () => {
  const client = recordingClient();
  const removed = await deletePassRows(client, { queryId: 'Q', profileId: 'P' });

  // One presence probe, then one DELETE per table this database has.
  assert.equal(client.calls.length, DELETE_ORDER.length + 1, 'a probe plus one statement per table');
  assert.match(client.calls[0].sql, /to_regclass\('public\.recommendation_swap'\)/, 'the probe names the table');

  const swapCall = client.calls[1];
  assert.match(swapCall.sql, /^DELETE FROM recommendation_swap\b/, 'the swap delete is the first DELETE');
  assert.deepEqual(swapCall.params, [['Q']], 'and it is scoped to the one pass, by parameter');
  assert.match(swapCall.sql, /source_result_id IN \(SELECT id FROM recommendation_result WHERE recommendation_query_id = ANY\(\$1::uuid\[\]\)\)/);
  assert.match(swapCall.sql, /build_candidate_id IN \(SELECT id FROM build_candidate WHERE recommendation_query_id = ANY\(\$1::uuid\[\]\)\)/);

  for (let i = 0; i < DELETE_ORDER.length; i += 1) {
    const table = DELETE_ORDER[i];
    if (table === SWAP_TABLE) continue;
    const call = client.calls[i + 1];
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

test('deletePassRows still works on a database below 023: the swap step is SKIPPED, not fatal', async () => {
  const client = recordingClient({ swapPresent: false });
  const removed = await deletePassRows(client, { queryId: 'Q' });

  assert.equal(client.calls.length, SIX_FLAT_TABLES.length - 1 + 1, 'the probe plus the deletes that can run');
  assert.ok(
    !client.calls.some((call) => /^DELETE FROM recommendation_swap/.test(call.sql)),
    'never a statement against a table that does not exist (42P01 mid-cleanup)'
  );
  assert.deepEqual(
    Object.keys(removed),
    SIX_FLAT_TABLES.filter((table) => table !== 'recommendation_profile'),
    'the returned keys are the tables this database actually has'
  );
});

test('deleteSwaps accepts one id or an array, and never runs unscoped', async () => {
  const single = recordingClient();
  assert.deepEqual(await deleteSwaps(single, 'Q'), { present: true, deleted: 1 });
  assert.deepEqual(single.calls[1].params, [['Q']], 'a single id is wrapped, so one SQL shape serves both callers');

  const many = recordingClient();
  await deleteSwaps(many, ['A', 'B']);
  assert.deepEqual(many.calls[1].params, [['A', 'B']], 'an array passes through, still by parameter');

  for (const empty of [[], [null], [''], null, undefined]) {
    const client = recordingClient();
    const outcome = await deleteSwaps(client, empty);
    assert.deepEqual(outcome, { present: false, deleted: 0 }, 'no ids means no statement at all');
    assert.equal(client.calls.length, 0);
  }
});

test('deletePassRows with no query id issues NOTHING (never a bare DELETE)', async () => {
  for (const ids of [{}, { queryId: null }, { queryId: '' }, { profileId: 'P' }, null, undefined]) {
    const client = recordingClient();
    const removed = await deletePassRows(client, ids);
    assert.equal(client.calls.length, 0, 'no ids means no statements: a DELETE without a scope would be catastrophic here');
    assert.deepEqual(removed, {});
  }
});

test('deletePassRows without a profile id simply skips that step', async () => {
  const client = recordingClient();
  await deletePassRows(client, { queryId: 'Q' });
  assert.equal(client.calls.length, DELETE_ORDER.length, 'the probe and every table but the profile');
  assert.ok(!client.calls.some((call) => /recommendation_profile/.test(call.sql)));
});

test('deletePassRows refuses a non-client, rather than silently doing nothing', async () => {
  await assert.rejects(() => deletePassRows({}, { queryId: 'Q' }), /pg-compatible client/);
  await assert.rejects(() => deleteSwaps(null, 'Q'), /pg-compatible client/);
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
