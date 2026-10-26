'use strict';

/**
 * apps/api/test/db/swap-commit.db.test.js - Decision 56's COMMIT against the real
 * engine, the real catalog and a real persisted pass.
 *
 * TEST BRANCH ONLY. `resolveTestDbUrl` runs at module scope, so a missing or
 * shared-pointing TEST_DATABASE_URL FAILS this file instead of skipping it.
 *
 * What only a real database can prove here, and the unit suites cannot:
 *
 *   - the three INSERTs survive the real schema (enum casts, UNNEST column
 *     order, the FK from `recommendation_swap` to `recommendation_result`);
 *   - appended, never edited: the pass's OWN result row, its total and its
 *     engine_version are byte-identical after the commit, and the derived build
 *     is a NEW `build_candidate` row reachable only through
 *     `recommendation_swap`;
 *   - the GET that follows serves the SWAPPED build for that rank - same rank,
 *     the replacement's components, `swapped` naming the role and
 *     `explanation` null (Decision 56 item 7);
 *   - one swap per build really is enforced: the second attempt is a 409 from
 *     the pre-check, and a FAILing swap writes nothing at all;
 *   - the 201's arithmetic is the preview's, on a replacement whose live price
 *     DIFFERS from the installed one, so `total = persisted - previous + next`
 *     is observable rather than trivially equal;
 *   - the EFFECTIVE build is what BOTH reads serve: the GET's rows carry the
 *     derived `build_candidate_id`, and a swap preview taken afterwards prices
 *     the part that is installed NOW (previewing the reverse swap reports the
 *     pass's own total). Reading the pass's original components would answer
 *     `price.previous` with the replaced part's price and judge a build nobody
 *     is looking at.
 *
 * Cleanup is dependency order and scoped to this run's query id:
 * recommendation_swap -> build_rejection -> recommendation_result ->
 * build_component -> build_candidate -> recommendation_query ->
 * recommendation_profile. The swap goes FIRST because it holds FKs to the
 * result and to the derived candidate. The order is NOT written in this file: it
 * is `scripts/lib/pass-rows.js` `deletePassRows`, the helper the role rehearsal
 * and the production smoke test clean up with, so this file doubles as its live
 * proof - a swapped pass deleted through it, with residue asserted zero. A
 * leftover `recommendation_query` row would block `npm run eval:scenarios`'s
 * preflight, so residue is asserted zero AND whole-table counts are compared with
 * the pre-run snapshot.
 */

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const { resolveTestDbUrl } = require('../../../../scripts/lib/db-url');
const passRows = require('../../../../scripts/lib/pass-rows');
const { buildApp } = require('../../src/app');
const repository = require('../../src/repository');
const engine = require('../../src/engine');
const { STATEMENT_TIMEOUT_MS } = require('../../src/db');

/** A deploy tag of its own, so the POST below cannot answer from a reused pass. */
const ENGINE_VERSION = 'db-test-swap-commit';

const POOL_CONFIG = resolveTestDbUrl(process.env);

function createPool() {
  return new Pool({
    connectionString: POOL_CONFIG.connectionString,
    connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: 'morocco-pc-api-test',
  });
}

function createApp(pool) {
  return buildApp({
    pool,
    repository,
    engine,
    engineVersion: ENGINE_VERSION,
    env: { ENGINE_VERSION, ALLOWED_ORIGINS: '' },
    logger: false,
  });
}

/**
 * Reverse-dependency cleanup through the SHARED helper, not a copy of its SQL.
 *
 * A pass with a committed swap is exactly the case that used to be undeletable:
 * `recommendation_swap` holds FKs to the source result and to the derived
 * candidate, so deleting either first raises 23503. Delegating is also the point
 * - the order proven here is the order the role rehearsal and the production
 * smoke test run.
 */
async function cleanup(pool, queryIds) {
  for (const queryId of queryIds) {
    const attached = (await pool.query(
      'SELECT recommendation_profile_id FROM recommendation_query WHERE id = $1::uuid',
      [queryId]
    )).rows[0];
    await passRows.deletePassRows(pool, {
      queryId,
      profileId: attached ? attached.recommendation_profile_id : null,
    });
  }
}

/** Whole-table counts for the Layer 4 tables this path can touch. */
async function countAll(pool) {
  const result = await pool.query(
    'SELECT'
    + ' (SELECT count(*)::int FROM recommendation_profile) AS profiles,'
    + ' (SELECT count(*)::int FROM recommendation_query) AS queries,'
    + ' (SELECT count(*)::int FROM recommendation_result) AS results,'
    + ' (SELECT count(*)::int FROM build_candidate) AS candidates,'
    + ' (SELECT count(*)::int FROM build_component) AS components,'
    + ' (SELECT count(*)::int FROM build_rejection) AS rejections,'
    + ' (SELECT count(*)::int FROM recommendation_swap) AS swaps'
  );
  return result.rows[0];
}

async function residueFor(pool, queryIds) {
  const result = await pool.query(
    'SELECT'
    + ' (SELECT count(*)::int FROM recommendation_query WHERE id = ANY($1::uuid[])) AS queries,'
    + ' (SELECT count(*)::int FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])) AS candidates,'
    + ' (SELECT count(*)::int FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])) AS results,'
    + ' (SELECT count(*)::int FROM build_component WHERE build_candidate_id IN'
    + '   (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))) AS components,'
    + ' (SELECT count(*)::int FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])) AS rejections,'
    + ' (SELECT count(*)::int FROM recommendation_swap WHERE source_result_id IN'
    + '   (SELECT id FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[]))) AS swaps',
    [queryIds]
  );
  return result.rows[0];
}

function commitUrl(queryId, rank) {
  return '/v1/recommendations/' + queryId + '/builds/' + rank + '/swap';
}

test('a real build can be swapped once: the derived build is APPENDED and served in place', async () => {
  const pool = createPool();
  const app = createApp(pool);
  const before = await countAll(pool);
  let queryId = null;

  try {
    // 1. A real pass, so the build is a genuine persisted record.
    const created = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 20000, currency: 'MAD', use_case: 'GAMING' },
    });
    assert.equal(created.statusCode, 201, 'a 20000 MAD GAMING budget must assemble at least one build');
    queryId = created.json().id;
    const rank = created.json().builds[0].rank;

    const persisted = await repository.readBuildForSwap(pool, queryId, rank);
    assert.equal(persisted.found, true);
    const resultId = persisted.build.result_id;
    const persistedTotal = Number(persisted.build.total_price);
    assert.ok(Number.isFinite(persistedTotal), 'the persisted build has a total');

    // The pass's own result row, as it stands BEFORE anything is committed. This
    // pair is the "appended, never edited" claim: it must be identical after.
    const originalResult = (await pool.query(
      'SELECT id, build_candidate_id, rank FROM recommendation_result WHERE id = $1',
      [resultId]
    )).rows[0];
    assert.ok(originalResult, 'the result row exists');
    const originalCandidate = (await pool.query(
      'SELECT id, total_price, compatibility_status FROM build_candidate WHERE id = $1',
      [originalResult.build_candidate_id]
    )).rows[0];
    const originalComponents = (await pool.query(
      'SELECT component_role, product_id FROM build_component WHERE build_candidate_id = $1'
      + ' ORDER BY component_role ASC',
      [originalResult.build_candidate_id]
    )).rows;

    const cpu = persisted.build.components.find((component) => component.role === 'CPU');
    const board = persisted.build.components.find((component) => component.role === 'MOTHERBOARD');
    assert.ok(cpu && board, 'the persisted build has a CPU and a motherboard');

    // 2. A swap that must FAIL, from real data: an ACTIVE board on a different
    //    socket. Committing it is a 409 and writes NOTHING - the refusal path is
    //    proved before the happy one, so the counts below are unambiguous.
    const mismatched = (await pool.query(
      'SELECT m.product_id'
      + ' FROM motherboard_spec m'
      + ' JOIN product p ON p.id = m.product_id'
      + ' JOIN cpu_spec c ON c.product_id = $1'
      + ' WHERE m.socket_id <> c.socket_id'
      + "   AND p.lifecycle_status = 'ACTIVE'"
      + '   AND m.product_id <> $2'
      + '   AND EXISTS (SELECT 1 FROM store_offer o'
      + '     WHERE o.product_id = m.product_id AND o.currency = $3'
      + "       AND o.price > 0 AND o.availability <> 'OUT_OF_STOCK')"
      + ' ORDER BY m.product_id ASC'
      + ' LIMIT 1',
      [cpu.product_id, board.product_id, 'MAD']
    )).rows[0];
    assert.ok(mismatched, 'the branch catalog must hold an incompatible ACTIVE motherboard');

    const countsBeforeRefusals = await countAll(pool);
    const refusedSwap = await app.inject({
      method: 'POST',
      url: commitUrl(queryId, rank),
      payload: { role: 'MOTHERBOARD', product_id: mismatched.product_id },
    });
    assert.equal(refusedSwap.statusCode, 409, 'an incompatible swap is refused, never persisted');
    assert.equal(refusedSwap.json().error, 'SWAP_NOT_COMMITTABLE');
    assert.deepEqual(
      await countAll(pool),
      countsBeforeRefusals,
      'a refused commit writes no build_candidate, no component and no swap row'
    );

    // 3. The commit that must succeed: a DIFFERENT boot SSD whose live price
    //    differs from the installed one. SSD_BOOT keys no PAIRWISE_CHECKS entry,
    //    so the substitution cannot be incompatible, and the price difference is
    //    what makes the arithmetic and the effective-build read observable - a
    //    self-swap would reproduce every number and every component identity.
    const ssd = persisted.build.components.find((component) => component.role === 'SSD_BOOT');
    assert.ok(ssd, 'the persisted build carries a boot SSD');
    const replacement = (await pool.query(
      'SELECT p.id, MIN(o.price) AS price'
      + ' FROM product p'
      + ' JOIN store_offer o ON o.product_id = p.id'
      + " WHERE o.currency = 'MAD' AND o.price > 0 AND o.availability <> 'OUT_OF_STOCK'"
      + "   AND p.lifecycle_status = 'ACTIVE'"
      + '   AND p.id <> $1'
      + '   AND EXISTS (SELECT 1 FROM ssd_spec s WHERE s.product_id = p.id)'
      + ' GROUP BY p.id'
      + ' HAVING MIN(o.price) <> $2'
      + ' ORDER BY p.id ASC'
      + ' LIMIT 1',
      [ssd.product_id, ssd.selected_price]
    )).rows[0];
    assert.ok(replacement, 'the branch catalog must hold a second priced SSD at a different price');
    const previousPrice = Number(ssd.selected_price);
    const nextPrice = Number(replacement.price);
    assert.notEqual(nextPrice, previousPrice, 'the replacement is priced differently on purpose');

    const committed = await app.inject({
      method: 'POST',
      url: commitUrl(queryId, rank),
      payload: { role: 'SSD_BOOT', product_id: replacement.id },
    });
    assert.equal(committed.statusCode, 201, JSON.stringify(committed.json()).slice(0, 400));
    assert.equal(committed.headers['cache-control'], 'no-store');
    const body = committed.json();

    assert.equal(body.swapped.role, 'SSD_BOOT');
    assert.equal(body.price.previous, previousPrice, 'previous is the part that was installed');
    assert.equal(body.price.next, nextPrice, 'next is the live cheapest eligible offer');
    assert.equal(body.price.delta, Math.round((nextPrice - previousPrice) * 100) / 100);
    const expectedTotal = Math.round((persistedTotal - previousPrice + nextPrice) * 100) / 100;
    assert.equal(body.budget.total, expectedTotal, 'the derived total is the preview arithmetic');
    assert.equal(body.budget.delta, Math.round((nextPrice - previousPrice) * 100) / 100);
    assert.equal(body.budget.within_budget, expectedTotal <= Number(persisted.build.budget_amount));
    assert.match(body.catalog_version, /^[0-9a-f]{32}$/, 'the swap row records the LIVE digest');
    assert.equal(body.engine_version, ENGINE_VERSION);
    assert.equal(
      body.compatibility.status === 'PASS' || body.compatibility.status === 'UNKNOWN',
      true,
      'SSD_BOOT keys no pairwise check, so a storage swap cannot be FAIL: got '
        + body.compatibility.status
    );

    // 4. The rows: a NEW candidate, its components, and the link - all in the
    //    same query, reachable only through recommendation_swap.
    const swapRow = (await pool.query(
      'SELECT source_result_id, build_candidate_id, component_role, replaced_product_id,'
      + ' replaced_product_variant_id, catalog_version, engine_version'
      + ' FROM recommendation_swap WHERE source_result_id = $1',
      [resultId]
    )).rows[0];
    assert.ok(swapRow, 'the commit wrote its link row');
    assert.equal(swapRow.component_role, 'SSD_BOOT');
    assert.equal(swapRow.replaced_product_id, ssd.product_id);
    assert.equal(swapRow.catalog_version, body.catalog_version);
    assert.equal(swapRow.engine_version, ENGINE_VERSION);
    assert.notEqual(swapRow.build_candidate_id, originalResult.build_candidate_id, 'the pass is not edited');

    const derived = (await pool.query(
      'SELECT id, recommendation_query_id, total_price, score, compatibility_status'
      + ' FROM build_candidate WHERE id = $1',
      [swapRow.build_candidate_id]
    )).rows[0];
    assert.equal(derived.recommendation_query_id, queryId, 'the derived build belongs to the same pass');
    assert.equal(Number(derived.total_price), expectedTotal);
    assert.notEqual(expectedTotal, persistedTotal, 'a different part is a different total');
    assert.equal(derived.compatibility_status, body.compatibility.status);

    const derivedComponents = (await pool.query(
      'SELECT component_role, product_id, product_variant_id, selected_price, currency, store_id,'
      + ' price_checked_at, offer_class, store_offer_id'
      + ' FROM build_component WHERE build_candidate_id = $1 ORDER BY component_role ASC',
      [swapRow.build_candidate_id]
    )).rows;
    assert.equal(
      derivedComponents.length,
      persisted.build.components.length,
      'a swap replaces one part: the derived build has the same roles'
    );
    const derivedSsd = derivedComponents.find((row) => row.component_role === 'SSD_BOOT');
    assert.equal(derivedSsd.product_id, replacement.id, 'the derived build carries the replacement');
    assert.equal(Number(derivedSsd.selected_price), nextPrice, 'at the carrier price Stage 1 chose');
    for (const row of derivedComponents) {
      assert.ok(row.selected_price !== null, row.component_role + ' carries its price');
      assert.ok(row.currency, row.component_role + ' carries its currency');
      assert.ok(row.offer_class, row.component_role + ' carries its provenance class');
    }

    // 5. Appended, never edited: the pass's own rows are untouched.
    const afterResult = (await pool.query(
      'SELECT id, build_candidate_id, rank FROM recommendation_result WHERE id = $1',
      [resultId]
    )).rows[0];
    assert.deepEqual(afterResult, originalResult, 'rank, result id and candidate stay the pass own rows');
    const afterCandidate = (await pool.query(
      'SELECT id, total_price, compatibility_status FROM build_candidate WHERE id = $1',
      [originalResult.build_candidate_id]
    )).rows[0];
    assert.deepEqual(afterCandidate, originalCandidate, 'the pass build is byte-identical');
    const afterComponents = (await pool.query(
      'SELECT component_role, product_id FROM build_component WHERE build_candidate_id = $1'
      + ' ORDER BY component_role ASC',
      [originalResult.build_candidate_id]
    )).rows;
    assert.deepEqual(afterComponents, originalComponents, 'and so are its components');

    // 6. The GET serves the EFFECTIVE build at that rank, without inventing one.
    const read = await app.inject({ method: 'GET', url: '/v1/recommendations/' + queryId });
    assert.equal(read.statusCode, 200);
    const served = read.json().builds.find((build) => build.rank === rank);
    assert.ok(served, 'the rank is still addressable');
    assert.equal(served.rank, rank, 'the swap did not become a new rank');
    assert.deepEqual(served.swapped, {
      role: 'SSD_BOOT',
      committed_at: body.swapped.committed_at,
      engine_version: ENGINE_VERSION,
    });
    assert.equal(served.explanation, null, 'a swapped build has no engine explanation to serve');
    assert.equal(served.total_price, expectedTotal);
    assert.equal(
      served.components.find((component) => component.role === 'SSD_BOOT').product_id,
      replacement.id,
      'the served build carries the replacement, not the pass original'
    );
    assert.equal(served.build_score, Number(derived.score), 'the served score is the recomputed one');

    // The repository read behind the GET joins the SAME effective candidate - the
    // candidate id is what a self-swap could not distinguish.
    const servedRows = await repository.readRecommendationResult(pool, queryId);
    const servedRow = servedRows.rows.find((row) => row.rank === rank);
    assert.ok(servedRow, 'the rank is still one row set');
    assert.equal(
      servedRow.build_candidate_id,
      swapRow.build_candidate_id,
      'the read path serves the DERIVED candidate for this rank'
    );

    // 6b. A preview taken AFTER the commit describes the build on screen: the
    //     reverse swap prices the part that is installed now, and its total is
    //     the pass's own. Reading the pass's original components would report
    //     `previous` = the replaced part's price instead.
    const previewAfter = await app.inject({
      method: 'GET',
      url: '/v1/recommendations/' + queryId + '/builds/' + rank + '/swap-preview'
        + '?role=SSD_BOOT&product_id=' + ssd.product_id,
    });
    assert.equal(previewAfter.statusCode, 200, JSON.stringify(previewAfter.json()).slice(0, 300));
    const afterBody = previewAfter.json();
    assert.equal(afterBody.price.previous, nextPrice, 'previous is what the build serves now');
    assert.equal(afterBody.price.next, previousPrice, 'next is the original part, still priced');
    assert.equal(afterBody.price.delta, Math.round((previousPrice - nextPrice) * 100) / 100);
    assert.equal(afterBody.budget.total, persistedTotal, 'the reverse swap lands back on the pass total');

    // 7. One swap per build: the second attempt never reaches the engine.
    const second = await app.inject({
      method: 'POST',
      url: commitUrl(queryId, rank),
      payload: { role: 'SSD_BOOT', product_id: replacement.id },
    });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error, 'SWAP_ALREADY_COMMITTED');
    const swapsAfter = (await pool.query(
      'SELECT count(*)::int AS n FROM recommendation_swap WHERE source_result_id = $1',
      [resultId]
    )).rows[0].n;
    assert.equal(swapsAfter, 1, 'the UNIQUE index and the pre-check agree');
  } finally {
    await cleanup(pool, queryId === null ? [] : [queryId]);
    await app.close();
    await pool.end();
  }

  // 8. Nothing was left behind.
  const verifyPool = createPool();
  try {
    const after = await countAll(verifyPool);
    assert.deepEqual(after, before, 'the cleanup restored every Layer 4 table this path touched');
    const residue = await residueFor(verifyPool, [queryId]);
    assert.deepEqual(
      residue,
      { queries: 0, candidates: 0, results: 0, components: 0, rejections: 0, swaps: 0 },
      'a leftover recommendation_query row would block eval:scenarios'
    );
  } finally {
    await verifyPool.end();
  }
});
