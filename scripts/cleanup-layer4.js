'use strict';

// scripts/cleanup-layer4.js — R-14: ONE FK-ordered cleanup of the demo residue
// in the shared database's Layer 4.
//
// WHY THIS EXISTS. The public demo (`https://morocco-pc.onrender.com`) wrote its
// API passes into the SHARED database. It was suspended on 2026-11-06, so the
// rows can no longer grow, but they are still there: measured 2026-11-07,
// 12 `recommendation_query` rows with 16 results, 16 candidates, 126 components,
// 24 rejections and 13 `recommendation_profile` rows (one profile has no query).
// Every one hangs off a profile named `api-<uuid>` and described "Created by
// POST /v1/recommendations". `check-target-parity` reports those rows as
// EXPECTED DIFFs against EU until they are removed (R-14).
//
// WHAT IT DELETES, AND WHAT IT DOES NOT. Only the demo scope above. A pass from
// the EU service, a preset shelf or a test run does not carry that profile
// shape and is left untouched. A scoped query that a preset still points at is
// a REFUSAL, not a silent shelf deletion: presets are deliberate rows and the
// demo scope should never own one (measured: 0 on shared).
//
// DELETE ORDER IS THE FK ORDER, and it is load-bearing. `build_component` and
// `recommendation_result` reference `build_candidate` with NO ACTION, and
// `recommendation_swap` references BOTH the result and the candidate, so
// deleting a query first raises a constraint violation and leaks every child
// row (AGENTS §7 item 11). The plan in `scripts/lib/cleanup-layer4.js` is
// pinned by `cleanup-layer4.test.js`.
//
// SAFETY. The default is `--dry-run`: it connects (read-only), prints the
// target digest, the scope, the before counts and the plan, and writes nothing.
// A real cleanup needs ALL of `--commit --confirm-shared --restore-point=<id>`,
// reads the scope again INSIDE the transaction, re-checks scoped residue before
// COMMIT and rolls back if any remains. The target is `DATABASE_URL` only:
// `--test-db` and `--target-env` are refused by name. A run whose
// `DATABASE_URL` aliases the TEST branch is refused too.
//
// This is an OWNER-GATED operation: the row counts it deletes are real data on
// a database that is not disposable. Record the Neon restore point before it
// runs and keep the printed audit line.
//
// Usage:
//   node scripts/cleanup-layer4.js
//   node scripts/cleanup-layer4.js --commit --confirm-shared --restore-point=<id>
//
// Exit codes: 0 success / nothing to do, 1 refusal or failed run, 2 usage.

require('dotenv').config();

const { Client } = require('pg');

const { applyLogTarget } = require('./lib/migrations');
const { normalizeTarget } = require('../packages/database-guard/src');
const {
  DEMO_PROFILE_NAME_PATTERN,
  DEMO_PROFILE_DESCRIPTION,
  LAYER4_TABLES,
  UsageError,
  scopeParams,
  SCOPE_PROFILE_IDS_SQL,
  SCOPE_QUERY_IDS_SQL,
  SCOPE_RESULT_IDS_SQL,
  SCOPE_CANDIDATE_IDS_SQL,
  SCOPE_PRESET_COUNT_SQL,
  countsSql,
  residueSql,
  deletePlan,
  parseArgs,
  validateRun,
  residueProblems,
  formatCounts,
} = require('./lib/cleanup-layer4');

const CONNECTION_TIMEOUT_MILLIS = 15000;

/**
 * Refuse when DATABASE_URL and TEST_DATABASE_URL name the SAME database. A
 * branch is expected to differ; identical host+database means the "shared"
 * variable was pointed at the write-test branch by mistake, and a cleanup there
 * would delete a rehearsal, not the demo residue.
 *
 * @param {object} env
 * @returns {string|null}
 */
function testAliasProblem(env) {
  const e = env || {};
  if (typeof e.TEST_DATABASE_URL !== 'string' || e.TEST_DATABASE_URL.trim() === '') return null;
  try {
    const shared = normalizeTarget(e.DATABASE_URL);
    const test = normalizeTarget(e.TEST_DATABASE_URL);
    if (shared.host === test.host && shared.database === test.database) {
      return 'REFUSING: DATABASE_URL points at the TEST branch (same host and database as'
        + ' TEST_DATABASE_URL); this cleanup is for the shared database only.';
    }
  } catch (_err) {
    // An unparseable TEST_DATABASE_URL is not this script's concern; an
    // unparseable DATABASE_URL fails applyLogTarget with its own message.
  }
  return null;
}

/** One snapshot of the eight Layer 4 tables, keyed by relation. */
async function readCounts(db) {
  const rows = (await db.query(countsSql())).rows;
  const counts = {};
  for (const row of rows) counts[row.relation] = Number(row.n);
  for (const table of LAYER4_TABLES) {
    if (counts[table] === undefined) counts[table] = 0;
  }
  return counts;
}

/** Resolve the demo scope to ids. Read-only; the caller decides what to do. */
async function readScope(db) {
  const params = scopeParams();
  const profileIds = (await db.query(SCOPE_PROFILE_IDS_SQL, params)).rows.map((row) => row.id);
  const queryIds = (await db.query(SCOPE_QUERY_IDS_SQL, params)).rows.map((row) => row.id);
  const resultIds = queryIds.length === 0
    ? []
    : (await db.query(SCOPE_RESULT_IDS_SQL, [queryIds])).rows.map((row) => row.id);
  const candidateIds = queryIds.length === 0
    ? []
    : (await db.query(SCOPE_CANDIDATE_IDS_SQL, [queryIds])).rows.map((row) => row.id);
  const presetCount = Number((await db.query(SCOPE_PRESET_COUNT_SQL, params)).rows[0].n);
  return { profileIds, queryIds, resultIds, candidateIds, presetCount };
}

function scopeSummary(scope) {
  return scope.queryIds.length + ' query(ies), ' + scope.profileIds.length + ' profile(s), '
    + scope.presetCount + ' preset(s), ' + scope.resultIds.length + ' result(s), '
    + scope.candidateIds.length + ' candidate(s)';
}

async function main() {
  const args = parseArgs(process.argv);

  const refusal = validateRun(args);
  if (refusal) throw new Error(refusal);

  const connectionString = process.env.DATABASE_URL;
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    throw new Error('DATABASE_URL is not set; this cleanup targets the shared database only.');
  }
  const alias = testAliasProblem(process.env);
  if (alias) throw new Error(alias);

  // Printed BEFORE the connection: a long run has to say which database it is
  // about to change, and a pooled host is not quotable.
  const target = applyLogTarget(connectionString);
  console.log('target: DATABASE_URL (' + target + ')');
  console.log('scope: profile name LIKE \'' + DEMO_PROFILE_NAME_PATTERN
    + '\' AND description = \'' + DEMO_PROFILE_DESCRIPTION + '\'');
  if (args.commit) {
    console.log('AUDIT TARGET: ' + target + ' restore-point=' + args.restorePoint);
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
  });
  await client.connect();
  try {
    const before = await readCounts(client);
    const preview = await readScope(client);
    console.log('before: ' + scopeSummary(preview));
    console.log(formatCounts(before, null));

    if (preview.presetCount > 0) {
      throw new Error('REFUSING: ' + preview.presetCount + ' scoped query(ies) are referenced by a preset.'
        + ' A preset is a deliberate shelf row, not demo residue; inspect it before deleting anything.');
    }

    if (!args.commit) {
      console.log('plan (FK order): ' + deletePlan(preview).map((step) => step.relation).join(' -> '));
      console.log('DRY-RUN (nothing written). Re-run with --commit --confirm-shared'
        + ' --restore-point=<id> to apply.');
      return;
    }

    // The authoritative read is INSIDE the transaction: the preview above may be
    // stale, and the residue check below must judge what this transaction saw.
    await client.query('BEGIN');
    try {
      const scope = await readScope(client);
      if (scope.queryIds.length === 0 && scope.profileIds.length === 0) {
        await client.query('COMMIT');
        console.log('nothing to clean: the demo scope is empty.');
        return;
      }
      if (scope.presetCount > 0) {
        throw new Error('REFUSING: ' + scope.presetCount + ' scoped query(ies) gained a preset'
          + ' between the preview and the transaction; nothing was deleted.');
      }

      const removed = {};
      for (const step of deletePlan(scope)) {
        const result = await client.query(step.sql, step.params);
        removed[step.relation] = result.rowCount;
      }

      const residue = (await client.query(residueSql(), scopeParams())).rows[0];
      const problems = residueProblems(residue);
      if (problems.length > 0) {
        await client.query('ROLLBACK');
        throw new Error('ROLLBACK: scoped residue remains after the deletes: ' + problems.join('; '));
      }

      await client.query('COMMIT');

      const after = await readCounts(client);
      console.log(formatCounts(before, after));
      console.log('removed: ' + LAYER4_TABLES.map((table) => table + '=' + (removed[table] || 0)).join(', '));
      console.log('CLEANUP: removed ' + scope.queryIds.length + ' pass(es) and '
        + scope.profileIds.length + ' profile(s); residue 0.');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await client.end();
  }
}

module.exports = {
  main,
  testAliasProblem,
  readCounts,
  readScope,
  CONNECTION_TIMEOUT_MILLIS,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(error instanceof UsageError ? 2 : 1);
  });
}
