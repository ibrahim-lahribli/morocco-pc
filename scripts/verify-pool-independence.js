'use strict';

// scripts/verify-pool-independence.js — Decision 23 acceptance criterion 3,
// PI-1: POOL INDEPENDENCE.
//
// The claim under test (Decision 23 section 6, step 3): adding an unrelated
// product to the candidate pool must not change any EXISTING build's score.
// The justification is that `unknown_pairwise_count` is build-local (O2), so a
// change that only enlarges the pool cannot reach the penalty a given build is
// scored on. That is a property of the code, and this script is what proves it
// still holds — it is a STANDING REGRESSION, not a one-off check.
//
// Usage:
//   node scripts/verify-pool-independence.js
//
// Reads and writes the TEST branch only (TEST_DATABASE_URL via
// scripts/lib/db-url.js). It never contacts the shared DATABASE_URL except to
// resolve the scoring model row the queries must reference — the run itself is
// executed entirely on the test branch. Exits non-zero on any drift.
//
// WHY THIS IS NOT A FLAG ON measure-orchestrator.js
// 1. That harness scores only `ranked.slice(0, TOP_N_PERSISTED)` — a top-10
//    slice. PI-1 must compare EVERY pre-existing signature, so it needs the
//    whole vector.
// 2. Its preflight asserts exact catalog counts, so it would abort the moment
//    the probe product exists. Those assertions are a real tripwire for an
//    out-of-band catalog change and are deliberately left alone.
//
// WHY IT IS SAFE TO RUN
// The probe product is inserted in its own transaction and removed in a
// `finally`, so a failure anywhere still cleans up. A leaked product would
// corrupt every later measurement on the branch, so the cleanup path verifies
// the row is really gone and says so loudly if it is not.

require('dotenv').config();
const { Client } = require('pg');
const { getWriteTestDbUrl } = require('./lib/db-url');
const { runRecommendationSnapshot } = require('../src/recommendation/orchestrator');
const { rankBuilds } = require('../src/recommendation/ranking');
const { captureScoreVector, scoreVectorDrift } = require('./lib/score-vector');

// The two measured profiles, matching Decision 23's acceptance pass.
const QUERIES = [
  { useCase: 'GAMING', budget: '15000' },
  { useCase: 'OFFICE', budget: '10000' },
];

// The probe: a PSU that no finished build can select because its rated wattage
// is above every case's budget ceiling, and whose connector columns are NULL
// (Decision 23 step 3b — "a deliberately over-budget PSU with NULL connector
// columns"). NULLs are honest here: they are the point of the probe.
const PROBE_NAME = 'PI1 Probe PSU (pool-independence gate)';
const PROBE_FAMILY_NAME = 'PI1 Probe Family (pool-independence gate)';
const PROBE_RATED_WATTAGE = 100000;

function fail(message) {
  throw new Error(message);
}

/** Read-only: the pinned active scoring model every query must reference. */
async function readScoringModelId(client) {
  const res = await client.query(
    "SELECT id FROM scoring_model WHERE name = 'seed-minimal-v1' AND version = '1.0.0' AND is_active = true",
  );
  if (res.rows.length !== 1) {
    fail('expected exactly 1 active seed-minimal-v1 scoring model, found ' + res.rows.length);
  }
  return res.rows[0].id;
}

/** Insert one throwaway recommendation_query per profile, in one transaction. */
async function insertQueries(client, scoringModelId) {
  const ids = [];
  await client.query('BEGIN');
  try {
    for (const q of QUERIES) {
      const inserted = await client.query(
        'INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency, use_case)'
        + " VALUES ($1, $2, 'MAD', $3) RETURNING id",
        [scoringModelId, q.budget, q.useCase],
      );
      ids.push(inserted.rows[0].id);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  return ids;
}

/** Remove the measurement queries. Never leaves them behind. */
async function deleteQueries(client, ids) {
  if (ids.length === 0) return;
  await client.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [ids]);
  const remaining = await client.query(
    'SELECT count(*)::int AS count FROM recommendation_query WHERE id = ANY($1::uuid[])',
    [ids],
  );
  if (remaining.rows[0].count !== 0) {
    fail('cleanup failed: ' + remaining.rows[0].count + ' measurement query row(s) survived');
  }
}

/**
 * Insert the probe product, its own product_family, and its psu_spec row.
 *
 * The probe gets a DEDICATED family rather than borrowing an existing one.
 * Decision 23 step (b) requires the probe to sit "outside every finished build's
 * component set". An earlier version anchored it to an existing PSU's family
 * with `LIMIT 1` and no ORDER BY, which made the anchor nondeterministic: it
 * sometimes borrowed a family that participates in a build, and the gate then
 * reported drift for a probe that should have been inert — a false red that
 * would have taught everyone to ignore it.
 *
 * The 100 kW rating is the other half of the guarantee: no assembled build
 * needs a PSU that large, so retention may keep the probe in the pool but no
 * build can select it.
 *
 * @returns {Promise<string>} the new product's id.
 */
async function insertProbeProduct(client) {
  const anchors = await client.query(
    "SELECT p.manufacturer_id FROM product p"
    + " JOIN psu_spec s ON s.product_id = p.id WHERE p.lifecycle_status = 'ACTIVE'"
    + ' ORDER BY p.id ASC LIMIT 1',
  );
  if (anchors.rows.length === 0) {
    fail('no ACTIVE PSU product to borrow a manufacturer from; is the catalog seeded on this branch?');
  }
  const manufacturerId = anchors.rows[0].manufacturer_id;

  await client.query('BEGIN');
  try {
    const family = await client.query(
      'INSERT INTO product_family (name, manufacturer_id) VALUES ($1, $2) RETURNING id',
      [PROBE_FAMILY_NAME, manufacturerId],
    );
    const familyId = family.rows[0].id;
    const product = await client.query(
      'INSERT INTO product (product_family_id, manufacturer_id, name, lifecycle_status)'
      + " VALUES ($1, $2, $3, 'ACTIVE') RETURNING id",
      [familyId, manufacturerId, PROBE_NAME],
    );
    const productId = product.rows[0].id;
    await client.query(
      'INSERT INTO psu_spec (product_id, rated_wattage) VALUES ($1, $2)',
      [productId, PROBE_RATED_WATTAGE],
    );
    await client.query('COMMIT');
    return productId;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

/** Remove the probe. Children first: both FKs are NO ACTION, not CASCADE. */
async function deleteProbeProduct(client, productId) {
  await client.query('BEGIN');
  try {
    // `psu_spec_product_id_fkey` and `product_product_family_id_fkey` are both
    // ON DELETE NO ACTION, so deleting the product first raises a constraint
    // violation and leaks every row. Peel the tree from the leaves up.
    await client.query('DELETE FROM psu_spec WHERE product_id = $1', [productId]);
    await client.query('DELETE FROM product WHERE id = $1 RETURNING product_family_id', [productId])
      .then(async (res) => {
        if (res.rows.length > 0) {
          await client.query('DELETE FROM product_family WHERE id = $1', [res.rows[0].product_family_id]);
        }
      });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  const left = await client.query(
    'SELECT (SELECT count(*)::int FROM product WHERE id = $1)'
    + ' + (SELECT count(*)::int FROM psu_spec WHERE product_id = $1) AS n',
    [productId],
  );
  if (left.rows[0].n !== 0) {
    fail(
      'CLEANUP FAILED: probe product ' + productId + ' still has ' + left.rows[0].n
      + ' row(s). Every later measurement on this branch is now suspect.',
    );
  }
  const families = await client.query(
    'SELECT count(*)::int AS n FROM product_family WHERE name = $1', [PROBE_FAMILY_NAME],
  );
  if (families.rows[0].n !== 0) {
    fail('CLEANUP FAILED: ' + families.rows[0].n + ' probe product_family row(s) survived');
  }
}

/** Run one profile and return its signature-keyed score vector. */
async function captureForProfile(client, queryId, label) {
  const result = await runRecommendationSnapshot(client, queryId);
  const { ranked } = rankBuilds({ builds: result.builds });
  console.log(
    '  ' + label + ': ' + ranked.length + ' ranked build(s), '
    + new Set(ranked.map((e) => e.build_score)).size + ' distinct build_score',
  );
  return captureScoreVector(ranked);
}

// Set by the cleanup path in main()'s finally. Module scope because a `return`
// inside `try` has already computed its value before `finally` runs, so the
// failure cannot change main()'s return directly.
let cleanupFailed = false;

async function main() {
  const dbConfig = getWriteTestDbUrl();
  const client = new Client(dbConfig);
  const queryIds = [];
  let probeId = null;

  try {
    await client.connect();
    console.log('PI-1 pool-independence gate (Decision 23 criterion 3)');
    console.log('target: TEST branch only — the shared DATABASE_URL is never written to');

    const scoringModelId = await readScoringModelId(client);
    queryIds.push(...(await insertQueries(client, scoringModelId)));
    console.log('measurement queries inserted: ' + queryIds.length);

    console.log('\nBEFORE — capturing the score vector:');
    const before = [];
    for (let i = 0; i < QUERIES.length; i += 1) {
      before.push(await captureForProfile(client, queryIds[i], QUERIES[i].useCase));
    }

    console.log('\nInserting the probe product (over-budget PSU, NULL connector columns)...');
    probeId = await insertProbeProduct(client);
    console.log('  probe product id: ' + probeId);
    const inPool = await client.query(
      "SELECT count(*)::int AS n FROM psu_spec WHERE product_id = $1", [probeId],
    );
    console.log('  probe is a live PSU candidate: ' + (inPool.rows[0].n === 1));

    console.log('\nAFTER — re-running the identical queries:');
    const after = [];
    for (let i = 0; i < QUERIES.length; i += 1) {
      after.push(await captureForProfile(client, queryIds[i], QUERIES[i].useCase));
    }

    console.log('\nComparing:');
    let drifted = false;
    for (let i = 0; i < QUERIES.length; i += 1) {
      const moved = scoreVectorDrift(before[i], after[i]);
      if (moved.length === 0) {
        console.log('  ' + QUERIES[i].useCase + ': 0 drifted of ' + before[i].size + ' pre-existing build(s) — MET');
      } else {
        drifted = true;
        console.log('  ' + QUERIES[i].useCase + ': ' + moved.length + ' DRIFTED of ' + before[i].size);
        for (const signature of moved.slice(0, 5)) {
          const from = before[i].get(signature);
          const to = after[i].has(signature) ? after[i].get(signature) : '(build gone)';
          console.log('    ' + signature + ': ' + from + ' -> ' + to);
        }
        if (moved.length > 5) console.log('    ... and ' + (moved.length - 5) + ' more');
      }
    }

    if (drifted) {
      console.log('\nRESULT: FAIL - an unrelated pool-only product moved existing build scores.');
      console.log('        This contradicts Decision 23 O2 (build-local unknown_pairwise_count).');
      return 1;
    }
    console.log('\nRESULT: PASS - no pre-existing build_score moved when the pool grew.');
    return 0;
  } finally {
    // Order matters: remove the probe BEFORE the queries, so the branch is left
    // exactly as found even if one cleanup fails.
    //
    // A failed cleanup must NOT be swallowed. The first version of this script
    // printed CLEANUP FAILED and still exited 0, reporting a clean PASS while
    // leaving the probe product in the catalog — which silently changes every
    // later measurement on the branch. A gate that cannot prove it cleaned up
    // has not proved anything, so cleanup failure forces a non-zero exit.
    if (probeId !== null) {
      try {
        await deleteProbeProduct(client, probeId);
        console.log('\ncleanup verified: probe product removed');
      } catch (cleanupError) {
        cleanupFailed = true;
        console.error('CLEANUP FAILED:', cleanupError.message);
        console.error('  Manually remove it with:');
        console.error("    DELETE FROM psu_spec WHERE product_id = '" + probeId + "';");
        console.error("    DELETE FROM product   WHERE id         = '" + probeId + "';");
      }
    }
    try {
      await deleteQueries(client, queryIds);
      console.log('cleanup verified: measurement queries removed');
    } catch (cleanupError) {
      cleanupFailed = true;
      console.error('CLEANUP FAILED:', cleanupError.message);
    }
    await client.end().catch(() => {});
  }
}

main().then(
  // `process.exit(code)` ignores process.exitCode, so the cleanup verdict has to
  // be folded into the exit path here rather than set inside the finally block.
  (code) => process.exit(cleanupFailed ? 1 : code),
  (error) => {
    console.error('PI-1 GATE FAILED:', error.message);
    process.exit(1);
  },
);