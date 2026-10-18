'use strict';

/**
 * apps/api/test/db/dedupe.db.test.js - the reuse key against REAL rows.
 *
 * TEST BRANCH ONLY. `resolveTestDbUrl` runs at module scope and throws when
 * TEST_DATABASE_URL is absent or points at the shared endpoint, so a missing
 * environment fails the suite loudly instead of skipping it.
 *
 * Why this file exists next to the API's own DB suite. `recommendations.db.test.js`
 * proves the dedupe END TO END (two identical POSTs, one query row, residue 0),
 * but it can only do that through the API, whose key is whatever the route
 * computed. The conditions that decide a hit are `SELECT_REUSABLE_QUERY_SQL`'s,
 * and two of them can only be exercised by CHOOSING the stored rows:
 *
 *   - the CATALOG VERSION must be equal AND RECORDED. Sprint scenario 5.3 is
 *     "a POST after a seed or a pricing change gets a new id (NOT a stale hit)".
 *     Proving it through the API would mean mutating the catalog - a committed
 *     write to a shared dev branch - so it is proven here by inserting rows that
 *     differ ONLY in `catalog_version`, and by asserting that a row recording
 *     NONE is not reusable.
 *   - an UNCOMMITTED pass must not be reused. A pass that threw before its write
 *     transaction leaves a query row with a NULL `budget_floor` and no result
 *     rows; serving it would mean fabricating the `reason` it cannot substantiate.
 *
 * Everything happens inside ONE transaction that is ROLLED BACK, so the suite
 * writes nothing durable and does not need the row-count bookkeeping the API
 * suite keeps. The residue assertion is still made, because "it was rolled back"
 * is a claim worth checking rather than assuming.
 */

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const { resolveTestDbUrl } = require('../../../../scripts/lib/db-url');
const repository = require('../../src/repository');

const ENGINE_VERSION = 'db-test-sha';

// Module scope on purpose: an unusable environment fails the file, not a test.
const POOL_CONFIG = resolveTestDbUrl(process.env);

/** Two distinct, well-formed digests - the values only need to differ. */
const VERSION_A = 'a'.repeat(32);
const VERSION_B = 'b'.repeat(32);
const VERSION_UNKNOWN = 'c'.repeat(32);

function createPool() {
  return new Pool({
    connectionString: POOL_CONFIG.connectionString,
    connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
    application_name: 'morocco-pc-dedupe-test',
  });
}

/**
 * A minimal, valid query row. `id` is OMITTED rather than passed as NULL - the
 * column's `gen_random_uuid()` DEFAULT only applies to an omitted column, and
 * passing NULL would violate NOT NULL instead of minting an id. The
 * `RETURNING id` below is therefore the only id, and it is the one the row
 * really has.
 *
 * `created_at` is explicit so the ordering assertion is pinned rather than
 * dependent on how fast two consecutive INSERTs happen to run.
 */
const INSERT_SQL = [
  'INSERT INTO recommendation_query',
  '  (scoring_model_id, budget_amount, currency, use_case, priority, resolution,',
  '   catalog_version, budget_floor, created_at)',
  "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now() - ($9 || ' minutes')::interval)",
  'RETURNING id',
].join(' ');

const FLOOR = JSON.stringify({ cheapest_total: 4477, within_budget: true, missing_roles: [] });

test('the reuse key matches a catalog version exactly, and never matches an UNKNOWN one', async () => {
  const pool = createPool();
  const createdIds = [];
  let rolledBack = false;

  try {
    const modelId = (await pool.query(
      'SELECT id FROM scoring_model ORDER BY is_active DESC, created_at DESC, id ASC LIMIT 1'
    )).rows[0].id;

    await pool.query('BEGIN');

    // Every row below shares the SAME request identity and differs only in the
    // component under test. That is what makes each assertion attributable.
    const insert = async (label, catalogVersion, floor, minutesAgo) => {
      const result = await pool.query(INSERT_SQL, [
        modelId,
        20000,
        'MAD',
        'GAMING',
        null,
        null,
        catalogVersion,
        floor,
        String(minutesAgo),
      ]);
      // A generated id is only useful if the INSERT returns the SAME one, so
      // assert it here rather than trusting the RETURNING clause by eye.
      const id = result.rows[0].id;
      assert.match(id, /^[0-9a-f-]{36}$/, label + ' got a real uuid back from the database');
      const stored = (await pool.query('SELECT id FROM recommendation_query WHERE id = $1', [id])).rows;
      assert.equal(stored.length, 1, label + ': the returned id addresses the row that was just written');
      createdIds.push(id);
      return id;
    };

    const older = await insert('A (older, version A)', VERSION_A, FLOOR, 60);
    const newer = await insert('A2 (newer, version A)', VERSION_A, FLOOR, 0);
    const other = await insert('B (version B)', VERSION_B, FLOOR, 0);
    const unrecorded = await insert('C (no version recorded)', null, FLOOR, 0);
    const uncommitted = await insert('D (version A, no floor - a FAILED pass)', VERSION_A, null, 0);

    const key = (catalogVersion) => ({
      scoringModelId: modelId,
      budgetAmount: 20000,
      currency: 'MAD',
      useCase: 'GAMING',
      resolution: undefined,
      priority: undefined,
      catalogVersion,
      engineVersion: ENGINE_VERSION,
    });

    const hitA = await repository.findReusableQuery(pool, key(VERSION_A));
    assert.notEqual(hitA, null, 'a pass recorded against this catalog is reusable');
    assert.equal(
      hitA.queryId,
      newer,
      'the NEWEST equivalent pass is served, and the row with no floor (D) is skipped even though '
        + 'it carries the same catalog version - an uncommitted pass is not an answer'
    );
    assert.notEqual(hitA.queryId, older, 'ordering is created_at DESC, so the older pass loses');
    assert.notEqual(hitA.queryId, uncommitted, 'the failed pass is never reusable');

    const hitB = await repository.findReusableQuery(pool, key(VERSION_B));
    assert.notEqual(hitB, null);
    assert.equal(hitB.queryId, other, 'a different catalog version is a different catalog, and matches its own row');

    // Sprint scenario 5.3, stated at the key level: a catalog state no row ran
    // against is a MISS. This is the "after a seed or a price change" case, and
    // the reason a stale answer cannot be served.
    const missUnknownVersion = await repository.findReusableQuery(pool, key(VERSION_UNKNOWN));
    assert.equal(missUnknownVersion, null, 'an unseen catalog version must NOT reuse an older pass');

    // Decision 47 item 10: an unknown version is a MISS, never a match. Note
    // this must ALSO not match row C, which itself recorded nothing - two
    // unrecorded versions are not known to be the same catalog.
    const missNullVersion = await repository.findReusableQuery(pool, key(null));
    assert.equal(
      missNullVersion,
      null,
      'a request with no catalog version matches nothing, not even the row that recorded none'
    );
    const missUndefinedVersion = await repository.findReusableQuery(pool, key(undefined));
    assert.equal(missUndefinedVersion, null, 'an omitted version is the same as a null one here');

    // The request identity is still a hard gate: a different budget is a
    // different request whatever the catalog says.
    const missBudget = await repository.findReusableQuery(pool, Object.assign(key(VERSION_A), { budgetAmount: 21000 }));
    assert.equal(missBudget, null, 'a different budget is a different request');
    assert.ok(unrecorded.length > 0, 'the unrecorded-version row was inserted');

    await pool.query('ROLLBACK');
    rolledBack = true;
  } finally {
    try {
      if (!rolledBack) {
        // A throw before the ROLLBACK above would otherwise leave the
        // transaction open on a pooled connection.
        await pool.query('ROLLBACK').catch(() => {});
      }
      // Residue is asserted LAST and scoped to the ids this test minted: the
      // rollback is supposed to have erased them, and a leftover
      // recommendation_query row would break the guarded harnesses' preflight.
      const residue = await pool.query(
        'SELECT count(*)::int AS n FROM recommendation_query WHERE id = ANY($1::uuid[])',
        [createdIds]
      );
      assert.equal(Number(residue.rows[0].n), 0, 'the rolled-back rows are gone: ' + createdIds.join(', '));
    } finally {
      await pool.end();
    }
  }
});
