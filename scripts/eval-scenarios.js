'use strict';

// scripts/eval-scenarios.js - E0 golden scenario harness.
//
// Runs the scenario matrix in test/golden/scenarios.json through the engine on
// the TEST branch, evaluates the A1-A2b/A3-A9 assertions (pure logic lives in
// scripts/lib/scenario-eval.js), prints a table, optionally writes the baseline
// markdown, and exits 1 only on a HARD FAIL - an `approved` expectation that
// failed, or an UNKNOWN escalated because its scenario declared
// `expect_builds_after` and that epic has landed. A `hypothesis` failure is
// reported as EXPECTED-RED and does NOT fail the run (manifest design).
//
// Contract (docs/briefs/engine.md):
//   * TEST branch only. getWriteTestDbUrl() throws unless TEST_DATABASE_URL is
//     set, DATABASE_URL is set, and the two normalized hosts differ. The shared
//     DATABASE_URL is NEVER contacted for data.
//   * Engine seam: for each scenario one recommendation_query row is inserted,
//     then runRecommendationSnapshot(client, queryId, options) runs TWICE (A8
//     determinism). The four scenarios tagged "full-run" also run
//     runRecommendationFullRun once, to cover ranking -> selection ->
//     explanation -> commit.
//   * Clock drift is real (ENGINE_BEHAVIOR_FINDINGS_2026-10.md Table F): A8
//     compares signature lists exactly and scores only within a tolerance.
//   * Every inserted row is deleted in a finally, in dependency order, and the
//     id-scoped residue must be 0 or the run exits non-zero. A gate that cannot
//     prove cleanup has not proved anything.
//   * Engine options: allow_unverified_seed_offers: true, mirroring the API's
//     fixed beta option (apps/api/src/engine.js), so scenario results reflect
//     recommendation SHAPE rather than offer age. Offer freshness is still
//     printed by the preflight, so staleness stays visible.
//
// Usage:
//   node scripts/eval-scenarios.js [--file=test/golden/scenarios.json]
//     [--baseline=test/golden/baseline-2026-10.md] [--json=out.json]
//     [--volatile=<path>|--no-volatile] [--filter=S03,S07] [--with-pi1]
//     [--allow-red] [--cleanup-orphans] [--model=<name@version>]
//
// Orphan safety (E0e): every row this harness inserts is linked to a
// recommendation_profile named `golden-eval-<runId>` (selection logic in
// scripts/lib/harness-orphans.js). Startup deletes the harness's OWN orphans
// left by earlier killed runs, the preflight then FAILS while any UNMARKED
// recommendation_query row exists, and a SIGINT/SIGTERM handler runs the same
// id-scoped cleanup. Nothing outside the `golden-eval-` prefix is ever deleted;
// rows predating the marker need a hand removal. `--cleanup-orphans` runs that
// startup sweep alone and exits.
//
// Step-2 item 1 / OG-39: WHICH active scoring model this run measures is a PIN,
// `--model=<name@version>` or the SCORING_MODEL_PIN environment variable,
// defaulting to `seed-minimal-v1@1.0.0` (scripts/lib/model-pin.js). This
// replaces the old "exactly ONE active model by COUNT" preflight, which refused
// to run on the two-active-model branch the Step-2 differential run needs. The
// pin still fails closed: zero matches, more than one match, or a pin naming
// only an INACTIVE model are hard errors, and the active models are printed
// when a pin does not resolve - so a second active model is measurable, never
// guessed.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const { getWriteTestDbUrl, describeTarget } = require('./lib/db-url');
const orchestrator = require('../src/recommendation/orchestrator');
const ranking = require('../src/recommendation/ranking');
const scenarioEval = require('./lib/scenario-eval');
const orphans = require('./lib/harness-orphans');
const modelPin = require('./lib/model-pin');

const DEFAULT_SCENARIO_FILE = 'test/golden/scenarios.json';
const DEFAULT_BASELINE_FILE = 'test/golden/baseline-2026-10.md';

/** Decision 35 / API parity: the API always runs with this, so do we. */
const ENGINE_OPTIONS = Object.freeze({ allow_unverified_seed_offers: true });

function parseArgs(argv) {
  const args = {
    file: DEFAULT_SCENARIO_FILE,
    baseline: DEFAULT_BASELINE_FILE,
    json: null,
    volatile: null,
    filter: null,
    model: null,
    withPi1: false,
    allowRed: false,
    cleanupOrphans: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--with-pi1') {
      args.withPi1 = true;
    } else if (arg === '--cleanup-orphans') {
      args.cleanupOrphans = true;
    } else if (arg === '--allow-red') {
      args.allowRed = true;
    } else if (arg === '--no-baseline') {
      args.baseline = null;
    } else if (arg.startsWith('--file=')) {
      args.file = arg.slice('--file='.length);
    } else if (arg.startsWith('--baseline=')) {
      args.baseline = arg.slice('--baseline='.length);
    } else if (arg.startsWith('--json=')) {
      args.json = arg.slice('--json='.length);
    } else if (arg.startsWith('--volatile=')) {
      args.volatile = arg.slice('--volatile='.length);
    } else if (arg === '--no-volatile') {
      args.volatile = false;
    } else if (arg.startsWith('--model=')) {
      args.model = arg.slice('--model='.length);
    } else if (arg.startsWith('--filter=')) {
      args.filter = arg.slice('--filter='.length).split(',').map((id) => id.trim()).filter((id) => id !== '');
    } else {
      throw new Error('unknown argument: ' + arg);
    }
  }
  return args;
}

function fail(message) {
  throw new Error(message);
}

async function preflight(client, pin = modelPin.DEFAULT_MODEL_PIN) {
  const probe = await client.query('SELECT 1 AS ok');
  if (probe.rows.length !== 1) fail('preflight SELECT 1 returned no rows');
  // Step-2 item 1 (OG-39): the old gate asserted EXACTLY ONE active model by
  // COUNT, which makes the two-active-model differential run unrunnable. The pin
  // replaces it and is strictly stronger: it names WHICH active model this run
  // measures, still fails on zero or multiple matches, and still cannot execute
  // an inactive row (resolvePinnedModel enforces all three and lists the active
  // models when the pin does not resolve).
  const model = await modelPin.resolvePinnedModel(client, pin);
  const counts = await client.query(
    "SELECT (SELECT count(*)::int FROM product WHERE name LIKE 'Seed %') AS products,"
    + " (SELECT count(*)::int FROM store_offer o JOIN product p ON p.id = o.product_id WHERE p.name LIKE 'Seed %') AS offers,"
    + " (SELECT count(*)::int FROM component_assessment a JOIN product p ON p.id = a.product_id WHERE p.name LIKE 'Seed %') AS assessments"
  );
  const freshnessResult = await client.query(
    'SELECT min(last_checked_at) AS oldest, count(*)::int AS total,'
    + " count(*) FILTER (WHERE last_checked_at >= NOW() - INTERVAL '30 days')::int AS fresh"
    + ' FROM store_offer'
  );
  // Item 2d: report the freshness instant as ISO (locale/timezone-independent).
  // Date.prototype.toString() embeds a locale timezone and was needless
  // committed-baseline churn.
  const freshness = freshnessResult.rows[0];
  if (freshness.oldest instanceof Date) freshness.oldest = freshness.oldest.toISOString();
  return {
    scoringModel: { id: model.id, name: model.name, version: model.version },
    counts: counts.rows[0],
    freshness,
  };
}

/** Read-only lookups the pure projector needs. */
async function loadMaps(client) {
  const vram = await client.query(
    'SELECT b.product_variant_id, c.vram_capacity_gb FROM gpu_board_spec b JOIN gpu_chipset c ON c.id = b.gpu_chipset_id'
  );
  const igpu = await client.query('SELECT product_id, integrated_gpu_present FROM cpu_spec');
  const products = await client.query('SELECT id, name FROM product ORDER BY id');
  return {
    productNames: new Map(products.rows.map((row) => [String(row.id), row.name])),
    vramByVariant: new Map(vram.rows.map((row) => [String(row.product_variant_id), row.vram_capacity_gb])),
    igpuByCpu: new Map(igpu.rows.map((row) => [String(row.product_id), row.integrated_gpu_present])),
  };
}

/** Insert one MARKED recommendation_query per scenario, in one transaction. */
async function insertQueries(client, scoringModelId, scenarios, profileId) {
  const ids = [];
  await client.query('BEGIN');
  try {
    for (const scenario of scenarios) {
      const inserted = await client.query(
        'INSERT INTO recommendation_query (recommendation_profile_id, scoring_model_id, budget_amount, currency, use_case, priority, resolution)'
        + ' VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [profileId, scoringModelId, String(scenario.budget), 'MAD', scenario.use_case, scenario.priority, scenario.resolution]
      );
      ids.push(inserted.rows[0].id);
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('cleanup note: ROLLBACK after a failed insert also failed:', rollbackError.message);
    }
    throw error;
  }
  return ids;
}

/** Delete ONLY this run's rows (and its marker profile), in dependency order, and verify residue 0. */
async function cleanup(client, ids, profileId) {
  if (ids.length === 0 && !profileId) return { q: 0, bc: 0, comp: 0, res: 0, rej: 0 };
  if (ids.length > 0) {
    await client.query('DELETE FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])', [ids]);
    await client.query(
      'DELETE FROM build_component WHERE build_candidate_id IN'
      + ' (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))',
      [ids]
    );
    await client.query('DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [ids]);
  }
  // The marker profile goes LAST: while it exists, an interrupted run's rows stay
  // attributable and the next startup can sweep them.
  if (profileId) {
    await client.query('DELETE FROM recommendation_profile WHERE id = $1', [profileId]);
  }
  if (ids.length === 0) return { q: 0, bc: 0, comp: 0, res: 0, rej: 0 };
  const residue = await client.query(
    'SELECT'
    + ' (SELECT count(*)::int FROM recommendation_query WHERE id = ANY($1::uuid[])) AS q,'
    + ' (SELECT count(*)::int FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])) AS bc,'
    + ' (SELECT count(*)::int FROM build_component WHERE build_candidate_id IN'
    + '   (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))) AS comp,'
    + ' (SELECT count(*)::int FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])) AS res,'
    + ' (SELECT count(*)::int FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])) AS rej',
    [ids]
  );
  const row = residue.rows[0];
  const total = row.q + row.bc + row.comp + row.res + row.rej;
  if (total !== 0) fail('residue after cleanup is not zero: ' + JSON.stringify(row));
  return row;
}

// ---------------------------------------------------------------------------
// Orphan management (E0e). Pure selection lives in scripts/lib/harness-orphans.js;
// only the SQL below is impure. Nothing outside the harness prefix is deleted.
// ---------------------------------------------------------------------------

/** Unique per process start: compact ISO timestamp + pid. */
function newRunId() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + process.pid;
}

/** Create this run's marker profile and return its id. */
async function createHarnessProfile(client, profileName) {
  const inserted = await client.query(
    'INSERT INTO recommendation_profile (name, description) VALUES ($1, $2) RETURNING id',
    [profileName, 'Golden scenario harness run marker (scripts/eval-scenarios.js)']
  );
  return inserted.rows[0].id;
}

/** Read the marker-bearing profiles and every query row (two SELECTs). */
async function readOrphanState(client) {
  const profiles = await client.query('SELECT id, name FROM recommendation_profile ORDER BY name');
  const queries = await client.query('SELECT id, recommendation_profile_id FROM recommendation_query ORDER BY id');
  return { profiles: profiles.rows, queries: queries.rows };
}

/**
 * Delete ONLY harness-marked orphan rows, in FK dependency order, in one
 * transaction: build_rejection -> recommendation_result -> build_component ->
 * build_candidate -> recommendation_query -> recommendation_profile.
 * Unmarked/foreign rows are counted and reported but never touched.
 */
async function cleanupOrphans(client) {
  const state = await readOrphanState(client);
  const owned = orphans.harnessProfileIds(state.profiles);
  const { marked, unmarked } = orphans.classifyQueries(state.queries, owned);
  const report = { profiles: 0, queries: 0, dependents: 0, unmarked: unmarked.length };
  if (owned.length === 0 && marked.length === 0) return report;
  const queryIds = marked.map((row) => String(row.id));
  await client.query('BEGIN');
  try {
    if (queryIds.length > 0) {
      const rej = await client.query('DELETE FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);
      const res = await client.query('DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);
      const comp = await client.query(
        'DELETE FROM build_component WHERE build_candidate_id IN'
        + ' (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))',
        [queryIds]
      );
      const bc = await client.query('DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);
      await client.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [queryIds]);
      report.dependents = rej.rowCount + res.rowCount + comp.rowCount + bc.rowCount;
      report.queries = queryIds.length;
    }
    if (owned.length > 0) {
      await client.query('DELETE FROM recommendation_profile WHERE id = ANY($1::uuid[])', [owned]);
      report.profiles = owned.length;
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // already gone
    }
    throw error;
  }
  return report;
}

/** Fail while any recommendation_query row carries no harness marker. */
async function assertNoUnmarkedQueries(client) {
  const state = await readOrphanState(client);
  const owned = orphans.harnessProfileIds(state.profiles);
  const { unmarked } = orphans.classifyQueries(state.queries, owned);
  if (unmarked.length > 0) {
    fail('preflight: ' + unmarked.length + ' recommendation_query row(s) carry no harness marker ("'
      + orphans.HARNESS_PROFILE_PREFIX + '" profile prefix); unmarked rows are never deleted by the harness.'
      + ' Remove them by hand first - see docs/briefs/step2-launch-v2-runbook.md.');
  }
}

function gitBranch() {
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '(unknown)';
  } catch (_error) {
    return '(unknown)';
  }
}

function runPi1() {
  const result = spawnSync(process.execPath, ['scripts/verify-pool-independence.js'], { encoding: 'utf8' });
  // stdout only: the gate's own RESULT/cleanup lines. stderr carries the pg SSL
  // warning banner, which is noise in a committed baseline.
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  const text = stdout !== '' ? stdout : stderr;
  const tail = text.split(/\r?\n/).filter((line) => !line.startsWith('(node:')).slice(-12).join('\n');
  return {
    status: result.status === 0 ? 'PASS' : 'FAIL',
    code: result.status === null ? 'spawn-failed' : result.status,
    tail,
  };
}

function short(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function printTable(results) {
  console.log('');
  console.log('ASSERTION | SCENARIO(S) | STATUS | DISPOSITION | MEASURED | EXPECTED');
  for (const result of results) {
    console.log(
      '  ' + result.assertion.padEnd(5)
      + ' | ' + result.scenario_ids.join(',').padEnd(20)
      + ' | ' + result.status.padEnd(7)
      + ' | ' + String(result.disposition).padEnd(12)
      + ' | ' + short(result.measured).slice(0, 70).padEnd(70)
      + ' | ' + result.expected
    );
  }
}

/**
 * Rows whose committed result is not stable run-to-run (OG-41 family). They are
 * excluded from the committed baseline and written to the volatile sidecar:
 *   - A8: compares ranked signature lists ORDER-SENSITIVELY, so a raw build_score
 *     on a .005 rounding boundary can flip a build's position under the ~1e-5
 *     clock drift between two passes.
 *   - the A9 PI-1 row (no scenarios): shells out to `npm run verify:pi1`, which
 *     compares build_score before/after a probe insert, so the same drift makes
 *     its PASS/FAIL flip. The A9 per-scenario (selected-set) rows stay committed.
 */
function isVolatileResult(result) {
  if (result.assertion === 'A8') return true;
  if (result.assertion === 'A9' && result.scenario_ids.length === 0) return true;
  return false;
}

/** Count a subset of results exactly as the full-suite summary does. */
function summarizeResults(results) {
  const out = {
    total: results.length,
    pass: 0, fail: 0, unknown: 0,
    disposition_pass: 0, expected_red: 0, hard_fail: 0, waived: 0, disposition_unknown: 0,
  };
  for (const result of results) {
    if (result.status === 'PASS') out.pass += 1;
    else if (result.status === 'FAIL') out.fail += 1;
    else out.unknown += 1;
    if (result.disposition === 'PASS') out.disposition_pass += 1;
    else if (result.disposition === 'EXPECTED-RED') out.expected_red += 1;
    else if (result.disposition === 'FAIL') out.hard_fail += 1;
    else if (result.disposition === 'WAIVED') out.waived += 1;
    else out.disposition_unknown += 1;
  }
  return out;
}

/**
 * Volatile observations (item 2d). These change every run WITHOUT an engine
 * change - A8's raw-score drift and the offer-freshness instant - so they live
 * in a sidecar, keeping the committed baseline diff-free unless something real
 * moved.
 */
function renderVolatile({ freshness, results, pi1 }) {
  const a8Rows = {};
  for (const result of results) {
    if (result.assertion !== 'A8') continue;
    a8Rows[result.scenario_ids.join(',')] = result;
  }
  return {
    note: 'VOLATILE observations - not part of the committed baseline. Regenerated every run; excluded from git (see test/golden/*.volatile.json in .gitignore).',
    generated_at: new Date().toISOString(),
    results: results.filter(isVolatileResult),
    offer_freshness: {
      fresh: freshness.fresh,
      total: freshness.total,
      oldest_iso: freshness.oldest,
    },
    a8_rows: a8Rows,
    pi1: pi1 === null || pi1 === undefined
      ? null
      : { status: pi1.status, code: pi1.code, tail: pi1.tail },
  };
}

function renderBaseline({ meta, suite, selected, artifacts, results, summary, fullRuns, pi1 }) {
  const lines = [];
  // Item 2d: assertions whose ROW can change without any real change (A8, whose
  // order-sensitive signature-list comparison flips on a .005 rounding boundary
  // under ~1e-5 clock drift - OG-41) are excluded from the committed baseline
  // and written to the volatile sidecar instead.
  const volatileResults = results.filter((r) => isVolatileResult(r));
  const committedResults = results.filter((r) => !isVolatileResult(r));
  const committedSummary = summarizeResults(committedResults);
  lines.push('# Golden scenario baseline - ' + meta.date);
  lines.push('');
  lines.push('Generated by `scripts/eval-scenarios.js` on the UNCHANGED engine. Do not hand-edit: thresholds live in');
  lines.push('`test/golden/scenarios.json`, and changing one requires a `test/golden/CHANGELOG.md` entry naming the reviewer.');
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push('- git branch: `' + meta.branch + '`');
  lines.push('- as_of: `' + (suite.as_of || '(legacy transaction clock)') + '`');
  lines.push('- scoring model: `' + meta.scoringModel.name + '` ' + meta.scoringModel.version + ' (`' + meta.scoringModel.id + '`)');
  lines.push('- target: `TEST_DATABASE_URL` (host hidden); engine options `allow_unverified_seed_offers: true`');
  lines.push('- catalog: ' + meta.counts.products + ' products / ' + meta.counts.offers + ' offers / ' + meta.counts.assessments + ' assessments');
  lines.push('- offer freshness: see the volatile sidecar (`<baseline>.volatile.json`, not committed) - it changes as offers age.');
  lines.push('');
  lines.push('## Scenario inputs');
  lines.push('');
  lines.push('| ID | use_case | resolution | priority | budget (MAD) |');
  lines.push('|---|---|---|---|---|');
  for (const scenario of selected) {
    lines.push('| ' + scenario.id + ' | ' + scenario.use_case + ' | ' + (scenario.resolution === null ? '-' : scenario.resolution)
      + ' | ' + scenario.priority + ' | ' + scenario.budget + ' |');
  }
  // Observed metrics for EVERY scenario (informational; item 5/7 of the E0
  // fixes). A3's GPU share is rank-1 GPU selected_price / build total_price.
  lines.push('');
  lines.push('## Observed metrics per scenario');
  lines.push('');
  lines.push('| ID | builds | ranked | rank-1 CPU | CPU price | rank-1 GPU | GPU price | rank-1 cooler | cooler price | total (MAD) | GPU share | CPU+RAM share | selected | distinct pairs | floor cheapest | within_budget |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const scenario of selected) {
    const artifact = artifacts.get(scenario.id);
    if (artifact === undefined || artifact === null) {
      lines.push('| ' + scenario.id + ' | ' + Array(15).fill('-').join(' | ') + ' |');
      continue;
    }
    const best = artifact.best;
    const floor = artifact.budget_floor !== null && artifact.budget_floor !== undefined ? artifact.budget_floor : null;
    lines.push('| ' + scenario.id
      + ' | ' + artifact.build_count
      + ' | ' + artifact.ranked_count
      + ' | ' + (best === null ? '-' : short(best.cpu_name).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ') || '-')
      + ' | ' + (best === null || best.cpu_price === null ? '-' : best.cpu_price)
      + ' | ' + (best === null ? '-' : short(best.gpu_name).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ') || '-')
      + ' | ' + (best === null || best.gpu_price === null ? '-' : best.gpu_price)
      + ' | ' + (best === null ? '-' : short(best.cooler_name).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ') || '-')
      + ' | ' + (best === null || best.cooler_price === null ? '-' : best.cooler_price)
      + ' | ' + (best === null ? '-' : best.total_price)
      + ' | ' + (artifact.best_gpu_price_share === null || artifact.best_gpu_price_share === undefined ? '-' : artifact.best_gpu_price_share)
      + ' | ' + (artifact.best_cpu_ram_share === null || artifact.best_cpu_ram_share === undefined ? '-' : artifact.best_cpu_ram_share)
      + ' | ' + artifact.selected.length
      + ' | ' + artifact.selected_pair_count
      + ' | ' + (floor === null ? '-' : floor.cheapest_total)
      + ' | ' + (floor === null ? '-' : floor.within_budget)
      + ' |');
  }
  lines.push('');
  lines.push('## Assertion results');
  lines.push('');
  lines.push('| Assertion | Scenario(s) | Status | Disposition | Measured | Expected |');
  lines.push('|---|---|---|---|---|---|');
  for (const result of committedResults) {
    lines.push('| ' + result.assertion + ' | ' + result.scenario_ids.join(', ')
      + ' | ' + result.status + ' | ' + result.disposition
      + ' | ' + short(result.measured).replace(/\|/g, '\\|')
      + ' | ' + result.expected.replace(/\|/g, '\\|') + ' |');
  }
  lines.push('');
  if (volatileResults.length > 0) {
    lines.push('Volatile assertion(s) omitted from this committed table (full rows in the sidecar): '
      + [...new Set(volatileResults.map((r) => r.assertion))].join(', ')
      + ' - A8 (order-sensitive ranking) and the A9 PI-1 row are drift-sensitive (OG-41).');
    lines.push('');
  }
  lines.push('## Summary');
  lines.push('');
  lines.push('- total ' + committedSummary.total + ' / PASS ' + committedSummary.pass + ' / FAIL ' + committedSummary.fail + ' / UNKNOWN ' + committedSummary.unknown
    + ' (volatile assertion(s) excluded; see the sidecar)');
  lines.push('- dispositions: PASS ' + committedSummary.disposition_pass + ' / EXPECTED-RED ' + committedSummary.expected_red
    + ' / FAIL ' + committedSummary.hard_fail + ' / WAIVED ' + committedSummary.waived + ' / UNKNOWN ' + committedSummary.disposition_unknown);
  const failedAssertions = [...new Set(committedResults.filter((r) => r.status === 'FAIL').map((r) => r.assertion))];
  const passedAssertions = [...new Set(committedResults.filter((r) => r.status === 'PASS').map((r) => r.assertion))];
  const unknownAssertions = [...new Set(committedResults.filter((r) => r.status === 'UNKNOWN').map((r) => r.assertion))];
  lines.push('- FAILing assertions: ' + (failedAssertions.length === 0 ? '(none)' : failedAssertions.join(', ')));
  lines.push('- UNKNOWN assertions: ' + (unknownAssertions.length === 0 ? '(none)' : unknownAssertions.join(', ')));
  lines.push('');
  lines.push('## Engine floor vs cheapest assembled build (informational, not an assertion)');
  lines.push('');
  let engineFloor = null;
  const s01 = artifacts.get('S01');
  if (s01 !== undefined && s01 !== null && s01.budget_floor !== null && s01.budget_floor !== undefined
    && Number.isFinite(s01.budget_floor.cheapest_total)) {
    engineFloor = s01.budget_floor.cheapest_total;
  } else {
    for (const scenario of selected) {
      const candidate = artifacts.get(scenario.id);
      if (candidate !== undefined && candidate !== null && candidate.budget_floor !== null
        && candidate.budget_floor !== undefined && Number.isFinite(candidate.budget_floor.cheapest_total)) {
        engineFloor = candidate.budget_floor.cheapest_total;
        break;
      }
    }
  }
  let cheapestAssembled = null;
  for (const scenario of selected) {
    const candidate = artifacts.get(scenario.id);
    if (candidate !== undefined && candidate !== null && candidate.best !== null
      && Number.isFinite(candidate.best.total_price)) {
      if (cheapestAssembled === null || candidate.best.total_price < cheapestAssembled) {
        cheapestAssembled = candidate.best.total_price;
      }
    }
  }
  lines.push('- engine `budget_floor.cheapest_total` - the sum of the cheapest eligible candidate per role, a LOWER BOUND, not a build: ' + short(engineFloor));
  lines.push('- cheapest total that actually assembles among these scenarios: ' + short(cheapestAssembled));
  lines.push('- budgets between the two (sub-8000 MAD here) therefore legitimately return ZERO builds while `within_budget` is TRUE: the');
  lines.push('  emptiness is a compatibility limit, not a budget shortfall. Tracked as open gap OG-40.');
  lines.push('');
  lines.push('## Full-run coverage (ranking -> selection -> commit)');
  lines.push('');
  lines.push('| Scenario | selected | build_candidate_ids |');
  lines.push('|---|---|---|');
  for (const entry of fullRuns) {
    lines.push('| ' + entry.id + ' | ' + (entry.selected === null ? 'ERROR: ' + entry.error : entry.selected)
      + ' | ' + (entry.build_candidate_ids === null ? '-' : entry.build_candidate_ids) + ' |');
  }
  lines.push('');
  lines.push('## Pool independence (A9 / Decision 23 criterion 3)');
  lines.push('');
  if (pi1 === null) {
    lines.push('NOT RUN in this pass (pass `--with-pi1` to spawn `npm run verify:pi1`).');
  } else {
    lines.push('Run in this pass (`--with-pi1`). Its PASS/FAIL, exit code and stdout tail are drift-sensitive (OG-41) and live in the volatile sidecar, not committed here - a flip is expected and is not a committed-baseline change.');
  }
  lines.push('');
  lines.push('## Reading this baseline');
  const a1ToA6 = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
  const greenAmongA1A6 = a1ToA6.filter((id) => passedAssertions.includes(id) && !failedAssertions.includes(id));
  lines.push('');
  lines.push('The brief expects A1-A6 RED on the unchanged engine (this is what detects OG-38). FAILing here: '
    + (failedAssertions.length === 0 ? '(none)' : failedAssertions.join(', ')) + '.');
  lines.push('');
  lines.push('Every assertion above is `hypothesis` (unreviewed), so its failures are reported as EXPECTED-RED and do NOT fail the');
  lines.push('run (exit 0). A failure becomes a HARD FAIL (exit 1) only for an `approved` expectation (which requires a reviewer and');
  lines.push('`reviewed_on`), or when an UNKNOWN is escalated because its scenario declared `expect_builds_after` and that epic has landed.');
  if (greenAmongA1A6.length > 0) {
    lines.push('');
    lines.push('BRIEF DIVERGENCE (recorded, not silently deviated): ' + greenAmongA1A6.join(', ')
      + ' already HOLD(s) on today\'s engine and therefore PASS(es).');
    lines.push('A2 (budget response) in particular is satisfied at the measured budgets, so it is GREEN today and acts as a');
    lines.push('control that the budget series is genuinely checked rather than being vacuously red. Nothing here was tuned.');
  }
  lines.push('');
  lines.push('STEP-1 DEVIATION (recorded): A2b (GPU price growth) was expected RED on the unchanged engine, but the rank-1 GPU price');
  lines.push('genuinely grows with budget (S03 -> S05: 3200 -> 11500, ratio 3.59), so it PASSes. Kept as measured, not tuned to force RED.');
  lines.push('');
  if (suite.as_of) {
    lines.push('OG-41 (Decision 38): this suite pins as_of for scoring and offer freshness. A8 still compares ordered signatures');
    lines.push('and raw scores; changing wall time no longer changes its run input. Catalog/model changes can still change results.');
  } else {
    lines.push('LEGACY CLOCK SENSITIVITY (OG-41): different transaction times can reorder near-equal rounded scores.');
  }
  lines.push('');
  lines.push('A7-A9 are expected GREEN: they pin behaviour that already holds, so a RED there is a genuine regression, never a');
  lines.push('threshold to relax.');
  lines.push('');
  // Normalize to pure CRLF: the embedded PI-1 tail contains bare LF, and a
  // mixed-ending committed file reads as a whole-file diff.
  return lines.join('\r\n').replace(/\r?\n/g, '\r\n') + '\r\n';
}

async function main() {
  const args = parseArgs(process.argv);
  const suite = JSON.parse(fs.readFileSync(args.file, 'utf8'));
  const dbConfig = getWriteTestDbUrl();
  const target = describeTarget(dbConfig.connectionString);
  const client = new Client(Object.assign({}, dbConfig, {
    application_name: 'morocco-pc-eval-scenarios',
    statement_timeout: 30000,
  }));
  const insertedIds = [];
  let runProfileId = null;
  let shuttingDown = false;
  let exitCode = 0;

  const runCleanup = async (label) => {
    const residue = await cleanup(client, insertedIds, runProfileId);
    console.log(label + ': residue ' + JSON.stringify(residue));
    return residue;
  };
  // SIGKILL cannot be caught, so the durable safety net is the startup sweep;
  // this handler covers the catchable signals (Ctrl-C, a tool SIGTERM).
  const onSignal = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error('received ' + signal + '; running cleanup before exit');
    (async () => {
      try {
        await runCleanup('signal cleanup');
      } catch (error) {
        exitCode = 1;
        console.error('SIGNAL CLEANUP FAILED: ' + error.message);
      }
      try {
        await client.end();
      } catch (_endError) {
        // already closed
      }
      process.exit(exitCode === 0 ? 130 : exitCode);
    })();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  try {
    await client.connect();
    console.log('target: TEST branch only; endpoint ' + target.endpointId
      + ' (' + (target.pooled ? 'pooled' : 'direct') + '), database ' + target.database
      + '; shared DATABASE_URL never contacted');

    // E0e: sweep the harness's OWN orphans, then refuse to run while any
    // unmarked (foreign or pre-marker) recommendation_query row exists.
    const orphanSweep = await cleanupOrphans(client);
    console.log('startup orphan cleanup: ' + JSON.stringify(orphanSweep));
    if (args.cleanupOrphans) {
      // Runs the sweep ALONE, so it must NOT be gated by the run preflight below:
      // otherwise the flag could never report on the very rows that gate exists
      // to surface (it would just throw the run preflight instead).
      await client.end();
      console.log('RESULT: --cleanup-orphans only; no scenarios run'
        + (orphanSweep.unmarked > 0 ? ' - unmarked rows remain (see the runbook)' : ''));
      process.exit(orphanSweep.unmarked > 0 ? 1 : 0);
    }
    await assertNoUnmarkedQueries(client);
    // Fail on an unresolvable pin BEFORE this run writes anything: the marker
    // profile below is the first write, and a mistyped --model= must not leave
    // one behind. Read-only, so a bad pin costs no cleanup.
    const pin = modelPin.modelPinValue(args.model);
    await modelPin.resolvePinnedModel(client, pin);
    const runId = newRunId();
    runProfileId = await createHarnessProfile(client, orphans.harnessProfileName(runId));
    console.log('run marker: ' + orphans.harnessProfileName(runId) + ' (' + runProfileId + ')');

    const meta = await preflight(client, pin);
    console.log('scoring model: ' + meta.scoringModel.name + ' ' + meta.scoringModel.version
      + ' (' + meta.scoringModel.id + ') [pin ' + pin + ']');
    // OG-39 / activation-plan Case (a) step 3: print the GLOBAL active count for
    // visibility. On the differential branch this is 2 and that is expected; the
    // pin above is what decided which of them this run measures.
    const activeModels = await modelPin.listActiveModels(client);
    console.log('active models: ' + activeModels.length + ' (' + activeModels.join(', ') + ')');
    console.log('catalog: ' + JSON.stringify(meta.counts));
    console.log('offers: ' + meta.freshness.fresh + '/' + meta.freshness.total + ' fresh; oldest ' + meta.freshness.oldest);

    if (typeof suite.as_of !== 'string') fail('scenario manifest requires a fixed ISO as_of');
    const engineOptions = Object.freeze({ ...ENGINE_OPTIONS, asOf: suite.as_of });
    const maps = await loadMaps(client);
    const selected = args.filter === null
      ? suite.scenarios
      : suite.scenarios.filter((scenario) => args.filter.includes(scenario.id));
    if (selected.length === 0) fail('no scenarios selected (check --filter)');

    // A scenario's budget is ABSOLUTE (`budget`) or FLOOR-RELATIVE
    // (`budget_factor_of_floor`). A floor-relative budget is resolved at RUN TIME
    // from a reference scenario's measured `budget_floor.cheapest_total`, so
    // `0.85 x floor` stays below the floor when the catalog moves - never a
    // hard-coded literal.
    const absolute = selected.filter((scenario) => scenario.budget !== undefined);
    const relative = selected.filter((scenario) => scenario.budget === undefined);
    for (const scenario of relative) {
      if (!Number.isFinite(scenario.budget_factor_of_floor) || scenario.budget_factor_of_floor <= 0) {
        fail('scenario ' + scenario.id + ' has neither an absolute budget nor a positive budget_factor_of_floor');
      }
    }

    const artifacts = new Map();
    const artifactsSecond = new Map();
    const queryIdByScenario = new Map();

    async function runScenarios(scenarios) {
      if (scenarios.length === 0) return;
      const ids = await insertQueries(client, meta.scoringModel.id, scenarios, runProfileId);
      insertedIds.push(...ids);
      console.log('inserted ' + ids.length + ' recommendation_query row(s)');
      for (let index = 0; index < scenarios.length; index += 1) {
        const scenario = scenarios[index];
        const queryId = ids[index];
        queryIdByScenario.set(scenario.id, queryId);
        const first = await orchestrator.runRecommendationSnapshot(client, queryId, engineOptions);
        const second = await orchestrator.runRecommendationSnapshot(client, queryId, engineOptions);
        const rankedFirst = ranking.rankBuilds({ builds: first.builds });
        const selectedFirst = ranking.selectDiverseTop({
          ranked: rankedFirst.ranked, limit: ranking.TOP_N_PERSISTED, maxPerPair: ranking.MAX_PER_PAIR,
        });
        const rankedSecond = ranking.rankBuilds({ builds: second.builds });
        const selectedSecond = ranking.selectDiverseTop({
          ranked: rankedSecond.ranked, limit: ranking.TOP_N_PERSISTED, maxPerPair: ranking.MAX_PER_PAIR,
        });
        artifacts.set(scenario.id, scenarioEval.projectArtifact(scenario.id, first, rankedFirst, selectedFirst, maps));
        artifactsSecond.set(scenario.id, scenarioEval.projectArtifact(scenario.id, second, rankedSecond, selectedSecond, maps));
      }
    }

    await runScenarios(absolute);
    for (const scenario of relative) {
      const refId = scenario.budget_factor_reference;
      const reference = refId === undefined ? null : artifacts.get(refId);
      if (reference === null || reference === undefined
        || reference.budget_floor === null || reference.budget_floor === undefined
        || !Number.isFinite(reference.budget_floor.cheapest_total)) {
        fail('scenario ' + scenario.id + ' needs the measured budget_floor of reference scenario '
          + JSON.stringify(refId) + ' - include it in the run (check --filter)');
      }
      scenario.budget = Math.round(scenario.budget_factor_of_floor * reference.budget_floor.cheapest_total);
      console.log('resolved ' + scenario.id + ' budget = round(' + scenario.budget_factor_of_floor
        + ' x ' + reference.budget_floor.cheapest_total + ') = ' + scenario.budget);
    }
    await runScenarios(relative);

    const fullRuns = [];
    for (const scenario of selected) {
      if (!Array.isArray(scenario.tags) || !scenario.tags.includes('full-run')) continue;
      try {
        const result = await orchestrator.runRecommendationFullRun(client, queryIdByScenario.get(scenario.id), engineOptions);
        fullRuns.push({
          id: scenario.id,
          selected: Array.isArray(result.selected) ? result.selected.length : null,
          build_candidate_ids: Array.isArray(result.build_candidate_ids) ? result.build_candidate_ids.length : null,
          error: null,
        });
      } catch (error) {
        fullRuns.push({ id: scenario.id, selected: null, build_candidate_ids: null, error: error.message });
        exitCode = 1;
      }
    }

    const pi1 = args.withPi1 ? runPi1() : null;
    const { results, summary } = scenarioEval.evaluateSuite({
      suite: {
        scenarios: selected,
        thresholds: suite.thresholds,
        assertions: suite.assertions,
        current_epic: suite.current_epic,
      },
      artifacts,
      artifactsSecond,
      pi1,
    });

    printTable(results);
    console.log('');
    console.log('SUMMARY: total ' + summary.total + ' / PASS ' + summary.pass
      + ' / FAIL ' + summary.fail + ' / UNKNOWN ' + summary.unknown
      + ' | dispositions: PASS ' + summary.disposition_pass + ' / EXPECTED-RED ' + summary.expected_red
      + ' / FAIL ' + summary.hard_fail + ' / WAIVED ' + summary.waived + ' / UNKNOWN ' + summary.disposition_unknown);

    const baselineText = renderBaseline({
      meta: {
        date: suite.as_of.slice(0, 10),
        branch: gitBranch(),
        scoringModel: meta.scoringModel,
        counts: meta.counts,
        freshness: meta.freshness,
      },
      suite,
      selected,
      artifacts,
      results,
      summary,
      fullRuns,
      pi1,
    });
    if (args.baseline !== null) {
      fs.mkdirSync(path.dirname(args.baseline), { recursive: true });
      fs.writeFileSync(args.baseline, baselineText, 'utf8');
      console.log('baseline written: ' + args.baseline);
    }
    const volatilePath = args.volatile === false
      ? null
      : (args.volatile !== null
        ? args.volatile
        : (args.baseline !== null ? args.baseline.replace(/\.md$/i, '') + '.volatile.json' : null));
    if (volatilePath !== null) {
      // Item 2d: volatile observations live in a sidecar so the committed
      // baseline only diffs on real changes.
      const volatileText = JSON.stringify(renderVolatile({ freshness: meta.freshness, results, pi1 }), null, 2);
      fs.mkdirSync(path.dirname(volatilePath), { recursive: true });
      fs.writeFileSync(volatilePath, volatileText + '\n', 'utf8');
      console.log('volatile observations written: ' + volatilePath);
    }
    if (args.json !== null) {
      fs.writeFileSync(args.json, JSON.stringify({ summary, results, fullRuns, pi1 }, null, 2), 'utf8');
      console.log('json written: ' + args.json);
    }

    if (summary.hard_fail > 0 && !args.allowRed) exitCode = 1;
    if (summary.hard_fail > 0) {
      console.log('RESULT: RED - ' + summary.hard_fail + ' HARD FAIL(s); '
        + summary.expected_red + ' EXPECTED-RED, ' + summary.waived + ' WAIVED');
    } else if (summary.expected_red > 0) {
      console.log('RESULT: EXPECTED-RED - ' + summary.expected_red
        + ' unreviewed expectation(s) failing; no approved assertion failed (exit 0)');
    } else {
      console.log('RESULT: GREEN - all assertions PASS');
    }
  } catch (error) {
    exitCode = 1;
    console.error('EVAL FAILED: ' + (error && error.message ? error.message : String(error)));
  } finally {
    try {
      await runCleanup('cleanup verified');
    } catch (cleanupError) {
      exitCode = 1;
      console.error('CLEANUP FAILED: ' + cleanupError.message);
    }
    try {
      await client.end();
    } catch (_endError) {
      // already closed
    }
  }

  process.exit(exitCode);
}

if (require.main === module) main();

module.exports = { parseArgs, preflight, renderBaseline, renderVolatile };
