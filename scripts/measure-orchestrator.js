'use strict';

// scripts/measure-orchestrator.js - Decision 20 measurement harness.
//
// Purpose: exercise the Decision 17 no-writes orchestrator (runRecommendation /
// runRecommendationSnapshot) against the minimal seed on an ISOLATED test
// branch, and MEASURE the Decision 20 assembly-diversity question. This script
// decides nothing: it prints facts and a factual summary only.
//
// Safety contract (mirrors scripts/lib/db-url.js):
//   * Target is TEST_DATABASE_URL only. getWriteTestDbUrl() throws unless
//     TEST_DATABASE_URL is set, DATABASE_URL is set, and the two hosts differ
//     (pooled vs direct counts as the same endpoint). The shared DATABASE_URL
//     is never contacted, never printed.
//   * Only the HOST of TEST_DATABASE_URL is printed - never credentials,
//     user, port or path.
//   * Writes: exactly two INSERTs into recommendation_query (one transaction)
//     and one DELETE of those same captured ids in a finally block. Nothing
//     else is written; the orchestrator itself writes nothing (Decision 17).
//   * Preflight READ-ONLY counts must match the seed exactly (15 Seed %
//     products, 1 active seed-minimal-v1 model, 16 seed offers, 25 seed
//     assessments, 0 recommendation_query rows) - the run aborts otherwise,
//     before any insert.
//   * Cleanup is idempotent by id: only rows this run inserted are deleted,
//     and the post-delete counts are verified and printed. If the script dies
//     between INSERT and DELETE, the next run aborts in preflight and prints
//     the leftover ids for a human decision (it never deletes rows it did not
//     create).
//   * The high-cap variant never touches the stored scoring_model value: the
//     cap is raised on an IN-MEMORY COPY of the row returned to the loader
//     (a read-only db decorator that forwards every statement unchanged).
//
// Run: node scripts/measure-orchestrator.js   (only after the operator asks)

require('dotenv').config();
const { Client } = require('pg');

const { getWriteTestDbUrl } = require('./lib/db-url');
const { runRecommendationSnapshot } = require('../src/recommendation/orchestrator');
const { EXPANSION_ORDER } = require('../src/recommendation/assembly');
const { SELECT_SCORING_MODEL_SQL } = require('../src/recommendation/scoring');

/** The uncapped variant cap: never written anywhere, only seen by the loader. */
const HIGH_CAP = 100000;

/** Budgets proposed from the seed prices (see the seed plan); MAD throughout. */
const QUERIES = [
  { useCase: 'GAMING', budget: '15000' },
  { useCase: 'OFFICE', budget: '10000' },
];

/** Exact seed expectations (database/seeds/001_minimal_builds.sql). */
const EXPECTED = { products: 15, models: 1, offers: 16, assessments: 25, queries: 0 };

function fail(message) {
  throw new Error(message);
}

/** Hostname only - never credentials, user, port or path. */
function hostOf(connectionString) {
  return new URL(connectionString).hostname;
}

async function count(client, sql, params = []) {
  const result = await client.query(sql, params);
  return Number(result.rows[0].count);
}

/**
 * Read-only preflight. Aborts (before any write) unless every count matches
 * the seed exactly; returns the pinned seed scoring-model id.
 */
async function preflight(client) {
  const products = await count(client, "SELECT count(*)::int AS count FROM product WHERE name LIKE 'Seed %'");
  const models = await count(client,
    "SELECT count(*)::int AS count FROM scoring_model WHERE name = 'seed-minimal-v1' AND version = '1.0.0' AND is_active = true");
  const offers = await count(client,
    "SELECT count(*)::int AS count FROM store_offer o JOIN product p ON p.id = o.product_id WHERE p.name LIKE 'Seed %'");
  const assessments = await count(client,
    "SELECT count(*)::int AS count FROM component_assessment a JOIN product p ON p.id = a.product_id WHERE p.name LIKE 'Seed %'");
  const queries = await count(client, 'SELECT count(*)::int AS count FROM recommendation_query');
  const buildCandidates = await count(client, 'SELECT count(*)::int AS count FROM build_candidate');

  const observed = { products, models, offers, assessments, queries };
  const mismatches = [];
  for (const key of Object.keys(EXPECTED)) {
    if (observed[key] !== EXPECTED[key]) {
      mismatches.push(key + ': expected ' + EXPECTED[key] + ', found ' + observed[key]);
    }
  }
  if (mismatches.length > 0) {
    fail('PREFLIGHT FAILED (no write was performed): ' + mismatches.join('; ')
      + ' - reset the test branch from its parent and run the seeds first');
  }
  if (buildCandidates !== 0) {
    fail('PREFLIGHT FAILED: build_candidate is not empty (' + buildCandidates + ' rows)');
  }

  const model = await client.query(
    "SELECT id FROM scoring_model WHERE name = 'seed-minimal-v1' AND version = '1.0.0' AND is_active = true");
  return { observed, scoringModelId: model.rows[0].id };
}

/** The two measurement queries, inserted in ONE transaction; ids captured. */
async function insertQueries(client, scoringModelId) {
  const ids = [];
  await client.query('BEGIN');
  try {
    for (const query of QUERIES) {
      const inserted = await client.query(
        'INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency, use_case)'
        + " VALUES ($1, $2, 'MAD', $3) RETURNING id",
        [scoringModelId, query.budget, query.useCase]
      );
      ids.push(inserted.rows[0].id);
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('cleanup note: ROLLBACK after the failed insert also failed:', rollbackError.message);
    }
    throw error;
  }
  return ids;
}

/** Delete ONLY the rows this run inserted, then verify Layer 4 is empty again. */
async function deleteQueries(client, ids) {
  if (ids.length === 0) return;
  await client.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [ids]);
  const remaining = await count(client, 'SELECT count(*)::int AS count FROM recommendation_query');
  if (remaining !== EXPECTED.queries) {
    console.error('CLEANUP WARNING: recommendation_query still holds ' + remaining
      + ' row(s); inserted ids were: ' + ids.join(', '));
  } else {
    console.log('cleanup verified: recommendation_query back to ' + remaining + ' rows');
  }
}
// ---------------------------------------------------------------------------
// Decision 20 measurement helpers (in memory, read-only).
// ---------------------------------------------------------------------------

/**
 * Read-only db decorator: every statement is forwarded unchanged EXCEPT the
 * Decision 11 scoring-model lookup, whose returned rows are replaced by an
 * IN-MEMORY COPY with candidate_caps.max_builds_per_query raised. The stored
 * scoring_model value is never written; the loader re-validates the copy, and
 * a positive integer cap stays a valid closed two-key candidate_caps object.
 */
function withRaisedCap(client, cap) {
  return {
    query(sql, params) {
      return client.query(sql, params).then((resolved) => {
        if (sql !== SELECT_SCORING_MODEL_SQL) return resolved;
        const rows = resolved.rows.map((row) => ({
          ...row,
          configuration: {
            ...row.configuration,
            candidate_caps: {
              ...row.configuration.candidate_caps,
              max_builds_per_query: cap,
            },
          },
        }));
        return { ...resolved, rows };
      });
    },
  };
}

const round2 = (value) => Math.round(value * 100) / 100;

/** Decision 18.2 content signature: components in EXPANSION_ORDER. */
function signatureOf(build) {
  const byRole = new Map(build.components.map((component) => [component.component_role, component]));
  return EXPANSION_ORDER.map((role) => {
    const component = byRole.get(role);
    if (!component) return '';
    return component.product_id + (component.product_variant_id || '');
  }).join('|');
}

/**
 * Decision 18.2 sort applied HERE ONLY (no ranking module exists yet):
 * build_score DESC, total_price ASC, signature ASC, all on 2-decimal rounds.
 */
function rankBuilds(builds) {
  return [...builds].sort((a, b) => {
    const scoreDelta = round2(b.build_score) - round2(a.build_score);
    if (scoreDelta !== 0) return scoreDelta;
    const priceDelta = round2(a.total_price) - round2(b.total_price);
    if (priceDelta !== 0) return priceDelta;
    return signatureOf(a) < signatureOf(b) ? -1 : 1;
  });
}

/** One role's value in a build; '(omitted)' is a legitimate value (GPU-omit). */
function roleValue(build, role) {
  const component = build.components.find((entry) => entry.component_role === role);
  if (!component) return '(omitted)';
  return component.product_variant_id
    ? component.product_id + ' variant ' + component.product_variant_id
    : component.product_id;
}

/**
 * Mixed-radix structure check over EXPANSION_ORDER. In the pure discovery
 * order the first change of a role happens at the product of the option
 * counts of the roles AFTER it. Deviations are reported factually (budget
 * pruning, pair-FAIL pruning, GPU-omit paths, the build cap) and are never
 * labelled a verdict: with 2 candidates per role the LAST roles are expected
 * to vary inside 25 builds, which does not contradict Decision 18.4.
 */
function structureRows(builds) {
  const optionCount = new Map();
  for (const role of EXPANSION_ORDER) {
    optionCount.set(role, new Set(builds.map((build) => roleValue(build, role))).size);
  }
  const rows = [];
  for (let index = 0; index < EXPANSION_ORDER.length; index += 1) {
    const role = EXPANSION_ORDER[index];
    const base = roleValue(builds[0], role);
    let firstChange = null;
    for (let buildIndex = 1; buildIndex < builds.length; buildIndex += 1) {
      if (roleValue(builds[buildIndex], role) !== base) {
        firstChange = buildIndex;
        break;
      }
    }
    let predicted = 1;
    for (let later = index + 1; later < EXPANSION_ORDER.length; later += 1) {
      predicted *= optionCount.get(EXPANSION_ORDER[later]);
    }
    const distinct = optionCount.get(role);
    let deviation;
    if (firstChange === null) {
      deviation = distinct > 1 ? 'never changes within the run' : 'single value in the run';
    } else if (firstChange < predicted) {
      deviation = 'earlier than predicted (pruning / GPU-omit shorten later chains)';
    } else if (firstChange > predicted) {
      deviation = 'later than predicted (option combinations pruned)';
    } else {
      deviation = 'matches the mixed-radix prediction';
    }
    rows.push({ role, distinct, firstChange, predicted, deviation });
  }
  return rows;
}

function scoreSpread(builds) {
  if (builds.length === 0) return null;
  const scores = builds.map((build) => build.build_score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return {
    min,
    max,
    mean: scores.reduce((sum, value) => sum + value, 0) / scores.length,
    distinct: new Set(scores.map(round2)).size,
    gap: max - min,
  };
}

function spreadText(label, spread) {
  if (spread === null) return '  ' + label + ': (no builds)';
  return '  ' + label + ': build_score min ' + spread.min.toFixed(2)
    + ' | max ' + spread.max.toFixed(2)
    + ' | mean ' + spread.mean.toFixed(2)
    + ' | distinct ' + spread.distinct
    + ' | gap ' + spread.gap.toFixed(2);
}
// ---------------------------------------------------------------------------
// Reporting (plain text; facts only).
// ---------------------------------------------------------------------------

const SUMMARY = [];

function printQueryReport(query, queryId, runs) {
  const title = 'query ' + query.useCase + ' | budget ' + query.budget + ' MAD | id ' + queryId;
  console.log('');
  console.log('== ' + title);

  const record = { useCase: query.useCase, runs: [], rank1: null };
  for (const run of runs) {
    const builds = run.result.builds;
    const spread = scoreSpread(builds);
    console.log('');
    console.log('  ' + run.label + ': ' + builds.length + ' build(s)');
    console.log(spreadText('    scores', spread));

    const varying = [];
    if (builds.length > 0) {
      console.log('    structure (role / distinct / first-change / predicted / deviation):');
      for (const row of structureRows(builds)) {
        console.log('      ' + row.role.padEnd(13)
          + ' distinct ' + String(row.distinct).padStart(2)
          + '  first-change ' + (row.firstChange === null ? '   -' : String(row.firstChange).padStart(4))
          + '  predicted ' + String(row.predicted).padStart(6)
          + '  | ' + row.deviation);
        if (row.distinct > 1) varying.push(row.role + '(' + row.distinct + ')');
      }
    } else {
      console.log('    structure: (no builds)');
    }
    record.runs.push({ label: run.label, cap: run.cap, buildCount: builds.length, spread, varying });
  }

  const ranked = runs.map((run) => ({ run, rank1: rankBuilds(run.result.builds)[0] || null }));
  const capped = ranked[0];
  const raised = ranked[1];
  console.log('');
  console.log('  rank 1 (Decision 18 sort, applied in this script only - no ranking module exists):');
  if (capped.rank1 && raised.rank1) {
    const sameScore = round2(capped.rank1.build_score) === round2(raised.rank1.build_score);
    const sameSignature = signatureOf(capped.rank1) === signatureOf(raised.rank1);
    console.log('    configured cap : score ' + capped.rank1.build_score.toFixed(2)
      + ' | total ' + capped.rank1.total_price.toFixed(2)
      + ' | signature ' + signatureOf(capped.rank1));
    console.log('    raised cap     : score ' + raised.rank1.build_score.toFixed(2)
      + ' | total ' + raised.rank1.total_price.toFixed(2)
      + ' | signature ' + signatureOf(raised.rank1));
    console.log('    rank 1 is ' + (sameSignature ? 'THE SAME build' : 'a DIFFERENT build')
      + ' capped vs uncapped (score ' + (sameScore ? 'equal' : 'differs') + ')');
    record.rank1 = { sameSignature, sameScore };
  } else {
    console.log('    not comparable (a run produced no builds)');
  }
  SUMMARY.push(record);
}

function printKExtrapolation(cap) {
  console.log('');
  console.log('== K=5 extrapolation (arithmetic only; the synthetic run was SKIPPED - see note)');
  for (let index = 0; index < EXPANSION_ORDER.length; index += 1) {
    const role = EXPANSION_ORDER[index];
    let predicted = 1;
    for (let later = index + 1; later < EXPANSION_ORDER.length; later += 1) predicted *= 5;
    console.log('  ' + role.padEnd(13) + ' first change at build ' + predicted
      + (predicted <= cap ? ' (within the cap)' : ' (beyond the cap)'));
  }
  console.log('  With K=5 options per role and cap 25 the only roles that can vary inside the cap are');
  console.log('  SSD_BOOT (every build) and CPU_COOLER (every 5th build); CASE changes at build 26, the');
  console.log('  first build beyond the cap. That is the shape Decision 18.4 describes (vary only');
  console.log('  CPU_COOLER and SSD_BOOT), and each additional varying role costs K times more builds.');
  console.log('  SKIPPED-RUN NOTE: the synthetic in-memory K=5 assembleBuilds run was NOT executed: its');
  console.log('  fixture builders live inside assemble.test.js / pipeline.test.js (not exported), so');
  console.log('  reusing them would have required editing existing test files. These numbers are');
  console.log('  arithmetic, not a run.');
}

function printSummary() {
  console.log('');
  console.log('== FACTUAL SUMMARY (a measurement; NOT a Decision 20 outcome)');
  for (const record of SUMMARY) {
    const capped = record.runs[0];
    const raised = record.runs[1];
    console.log('  ' + record.useCase + ': configured cap -> ' + capped.buildCount + ' build(s); raised cap -> '
      + raised.buildCount + ' build(s); rank 1 '
      + (record.rank1
        ? (record.rank1.sameSignature ? 'SAME build' : 'DIFFERENT build') + ' capped vs uncapped'
        : 'not comparable'));
    console.log('    varying roles at the configured cap: '
      + (capped.varying.length > 0 ? capped.varying.join(', ') : '(none)'));
    console.log('    varying roles at the raised cap:     '
      + (raised.varying.length > 0 ? raised.varying.join(', ') : '(none)'));
  }
  console.log('  With 2 candidates per role on this seed, the last roles of EXPANSION_ORDER are expected');
  console.log('  to vary inside 25 builds (mixed-radix discovery order); that is not a contradiction of');
  console.log('  Decision 18.4, whose K-scaling half needs K at or below the per-role option counts - the');
  console.log('  K=5 arithmetic above stands in for it (synthetic run skipped, see its note).');
  console.log('  No Decision 20 outcome is recommended or implied by this output.');
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  const dbConfig = getWriteTestDbUrl();
  const client = new Client({
    connectionString: dbConfig.connectionString,
    connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
  });
  const insertedIds = [];
  try {
    await client.connect();
    console.log('target: test-scratch only (host: ' + hostOf(dbConfig.connectionString) + ')');
    console.log('the shared DATABASE_URL is never contacted and never printed');

    const pre = await preflight(client);
    console.log('preflight ok: ' + JSON.stringify(pre.observed)
      + ' (seed scoring_model ' + pre.scoringModelId + ')');

    insertedIds.push(...(await insertQueries(client, pre.scoringModelId)));
    console.log('inserted measurement queries: ' + insertedIds.join(', '));

    for (let index = 0; index < QUERIES.length; index += 1) {
      const runs = [];
      for (const variant of [
        { label: 'configured cap', cap: null },
        { label: 'raised cap ' + HIGH_CAP + ' (in-memory copy; DB value untouched)', cap: HIGH_CAP },
      ]) {
        const db = variant.cap === null ? client : withRaisedCap(client, variant.cap);
        const result = await runRecommendationSnapshot(db, insertedIds[index]);
        runs.push({ label: variant.label, cap: variant.cap, result });
      }
      printQueryReport(QUERIES[index], insertedIds[index], runs);
    }

    printKExtrapolation(25);
    printSummary();
  } finally {
    try {
      await deleteQueries(client, insertedIds);
    } catch (cleanupError) {
      console.error('CLEANUP FAILED:', cleanupError.message, '- inserted ids were:', insertedIds.join(', '));
    }
    try {
      await client.end();
    } catch (endError) {
      void endError;
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('MEASUREMENT FAILED:', error.message);
    process.exit(1);
  }
);