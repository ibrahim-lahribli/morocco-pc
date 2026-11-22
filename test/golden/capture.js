#!/usr/bin/env node
'use strict';

// test/golden/capture.js — reproduce the frozen golden pairs against the TEST branch.
//
// Capture source: Neon project "morocco-pc" (aws-us-east-2), branch "test"
// (br-odd-breeze-axklg9xd), endpoint ep-dry-mountain-ax6b5wu6, as_of
// 2026-10-08T20:00:00.000Z, model pin launch-v2@2.5.0, catalog 113 products /
// 116 offers / 319 assessments (measured read-only 2026-11-21). Captured on
// TEST with 116 offers; the 2 extra are manual ingestion residue (record
// ff400777), no golden metric changes.
//
// These are captured outputs and are never regenerated automatically. A genuine
// capture bug may justify a re-capture, REPORTED as such; changing an assertion
// to match new output is never allowed. `--check` (the default) NEVER writes: it
// re-runs the live engine and byte-compares against the committed pairs, so
// drift is reported rather than absorbed.
//
// Nothing here is intercepted-and-reimplemented: the script calls the real
// `runRecommendation` and observes it by temporarily wrapping the stage
// namespaces it already calls through. The composition under capture is
// therefore production's own, not a copy of it, and no resolver body is
// duplicated here.
//
// Write safety: the connection comes from packages/database-guard, which throws
// unless TEST_DATABASE_URL and DATABASE_URL are both set and resolve to
// different hosts. Rows this script creates hang off a `golden-capture-`
// profile — deliberately NOT the `golden-eval-` prefix, so neither harness ever
// sweeps the other's rows — and are deleted BY ID. The 80 pre-existing foreign
// `recommendation_query` rows on TEST (R-32) are never counted, marked, touched
// or deleted; this script never runs the unmarked-rows preflight that makes
// `npm run eval:scenarios` refuse to start.
//
// Not collected by any test runner: `test:unit` globs `src/**/*.test.js` and
// `test:scripts` globs `scripts/lib/*.test.js`.
//
//   node test/golden/capture.js --check
//   node test/golden/capture.js --check --filter=S03,S01b
//   node test/golden/capture.js --write --out=/tmp/recapture --force-recapture

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { getWriteTestDbUrl, describeTarget } = require('../../packages/database-guard/src');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GOLDEN_DIR = path.join(REPO_ROOT, 'test', 'golden');
const FIXTURE_DIR = path.join(GOLDEN_DIR, 'fixtures');
const EXPECTED_DIR = path.join(GOLDEN_DIR, 'expected');
const SUITE_FILE = path.join(GOLDEN_DIR, 'scenarios.json');

const orchestrator = require('../../src/recommendation/orchestrator/run');
const queryNs = require('../../src/recommendation/query');
const candidatesNs = require('../../src/recommendation/candidates');
const offersNs = require('../../src/recommendation/offers');
const filteringNs = require('../../src/recommendation/filtering');
const scoringNs = require('../../src/recommendation/scoring');
const retentionNs = require('../../src/recommendation/retention');
const assemblyNs = require('../../src/recommendation/assembly');

const PROFILE_PREFIX = 'golden-capture-';
const QUERY_ID_PIN = '<ID>';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { mode: 'check', out: null, force: false, filter: null };
  for (const arg of argv) {
    if (arg === '--check') opts.mode = 'check';
    else if (arg === '--write') opts.mode = 'write';
    else if (arg === '--force-recapture') opts.force = true;
    else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length);
    else if (arg.startsWith('--filter=')) opts.filter = arg.slice('--filter='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error('unknown argument: ' + arg);
  }
  if (opts.mode === 'write' && opts.out === null) {
    throw new Error('--write requires --out=<dir>');
  }
  return opts;
}

function usage(message) {
  process.stderr.write(message + '\n\n');
  process.stderr.write('usage: node test/golden/capture.js [--check] [--write --out=<dir> [--force-recapture]] [--filter=ID,...]\n');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Serialization + diffing
// ---------------------------------------------------------------------------

function serialize(value) {
  return JSON.stringify(value) + '\n';
}

/** Leaf paths whose value differs between two captured trees. */
function differingPaths(a, b, prefix, out) {
  if (a === b) return out;
  const aObj = a !== null && typeof a === 'object';
  const bObj = b !== null && typeof b === 'object';
  if (!aObj || !bObj) {
    out.push(prefix);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(prefix);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    differingPaths(a[key], b[key], prefix === '' ? key : prefix + '.' + key, out);
  }
  return out;
}

/** Position and context of the first byte that differs, for a readable report. */
function firstByteDiff(actual, expected) {
  const n = Math.min(actual.length, expected.length);
  for (let i = 0; i < n; i += 1) {
    if (actual[i] !== expected[i]) {
      const from = Math.max(0, i - 60);
      return 'byte ' + i + ' (len ' + actual.length + ' vs ' + expected.length + ')\n'
        + '  captured: ...' + actual.slice(from, i + 60).replace(/\n/g, '\\n') + '\n'
        + '  committed: ...' + expected.slice(from, i + 60).replace(/\n/g, '\\n');
    }
  }
  if (actual.length !== expected.length) {
    return 'length differs: captured ' + actual.length + ' vs committed ' + expected.length;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Observation seam
// ---------------------------------------------------------------------------

/**
 * Wrap one namespace method, recording its arguments and resolved value.
 * run.js holds the namespace OBJECTS and does a property lookup at call time
 * (`scoring.computeBuildScores(...)`), so replacing the property is observed by
 * production code without editing it. Every wrapper is restored in a finally.
 */
function observe(namespace, method, record, key) {
  const original = namespace[method];
  if (typeof original !== 'function') {
    throw new Error('cannot observe ' + key + ': ' + method + ' is not a function');
  }
  namespace[method] = function observed(...args) {
    const out = original.apply(this, args);
    if (out && typeof out.then === 'function') {
      return out.then((value) => { record[key] = { args, value }; return value; });
    }
    record[key] = { args, value: out };
    return out;
  };
  return function restore() { namespace[method] = original; };
}

const OBSERVED = [
  [queryNs, 'loadQueryInput', 'query'],
  [scoringNs, 'loadScoringModel', 'scoringModel'],
  [offersNs, 'selectOfferPrices', 'candidatePoolResult'],
  [filteringNs, 'loadFilteringContext', 'filteringContext'],
  [filteringNs, 'filterCandidates', 'filterResult'],
  [scoringNs, 'loadComponentAssessments', 'assessments'],
  [retentionNs, 'excludedCpuProductIds', 'excludedCpuIds'],
  [retentionNs, 'retainTopKPerRole', 'retention'],
  [retentionNs, 'computeBudgetFloor', 'budgetFloor'],
  [assemblyNs, 'assembleBuildsForRecommendation', 'assembly'],
  [scoringNs, 'computeBuildScores', 'buildScores'],
  [scoringNs, 'computeBuildScoreContributions', 'contributions'],
];

/** One live pass: returns the fixture half and the expected half. */
async function captureOnce(client, queryId, scenario, suite, budgetResolved, label) {
  const record = {};
  const restores = OBSERVED.map(([ns, method, key]) => observe(ns, method, record, key));
  let result;
  try {
    result = await orchestrator.runRecommendation({
      db: client,
      queryId,
      options: { ...suite.engine_options, asOf: suite.as_of },
    });
  } finally {
    restores.forEach((restore) => restore());
  }

  const assemblyArgs = record.assembly.args[0];
  const retentionArgs = record.retention.args[0];

  const fixture = {
    meta: {
      scenario_id: scenario.id,
      use_case: scenario.use_case,
      resolution: scenario.resolution,
      priority: scenario.priority,
      budget_resolved: budgetResolved,
      as_of: suite.as_of,
      scoring_model: suite.scoring_model,
      engine_options: suite.engine_options,
      capture: label,
    },
    query: record.query.value,
    scoringModel: record.scoringModel.value,
    candidatePoolResult: record.candidatePoolResult.value,
    filteringContext: record.filteringContext.value,
    filterResult: record.filterResult.value,
    assessments: record.assessments.value.assessments,
    nowMs: Date.parse(suite.as_of),
  };

  const expected = {
    derived: {
      gpu_policy: assemblyArgs.gpuPolicy,
      role_targets: retentionArgs.roleTargets,
      vram_floor_gb: assemblyArgs.vramFloorGb,
      archetype_objectives: result.archetype_objectives,
    },
    excluded_cpu_ids: record.excludedCpuIds.value,
    retention: record.retention.value,
    budget_floor: record.budgetFloor.value,
    assembly: { builds: record.assembly.value.builds },
    build_scores: {
      scores: record.buildScores.value.scores.map((s) => ({ build_index: s.build_index, build_score: s.build_score })),
    },
    build_contributions: { contributions: record.contributions.value.contributions },
    result,
  };

  return { fixture, expected };
}

// ---------------------------------------------------------------------------
// Row lifecycle (id-scoped; foreign rows are never touched)
// ---------------------------------------------------------------------------

async function createProfile(client, runId) {
  const name = PROFILE_PREFIX + runId;
  const res = await client.query(
    'INSERT INTO recommendation_profile (name, description) VALUES ($1, $2) RETURNING id',
    [name, 'golden capture harness run ' + runId + ' (id-scoped cleanup; safe to delete)']
  );
  return res.rows[0].id;
}

async function createQuery(client, profileId, scoringModelId, scenario, budget) {
  const res = await client.query(
    'INSERT INTO recommendation_query (recommendation_profile_id, scoring_model_id, budget_amount, currency, use_case, priority, resolution)'
    + ' VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [profileId, scoringModelId, String(budget), 'MAD', scenario.use_case, scenario.priority, scenario.resolution]
  );
  return res.rows[0].id;
}

async function cleanup(client, profileId, queryIds) {
  if (queryIds.length > 0) {
    await client.query('DELETE FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);
    await client.query('DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);
    await client.query(
      'DELETE FROM build_component WHERE build_candidate_id IN'
      + ' (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))',
      [queryIds]
    );
    await client.query('DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);
    await client.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [queryIds]);
  }
  if (profileId !== null) {
    await client.query('DELETE FROM recommendation_profile WHERE id = $1', [profileId]);
  }
}

/** Residue scoped to OUR ids only. Foreign rows are invisible to this query. */
async function residue(client, profileId, queryIds) {
  if (queryIds.length === 0) return 0;
  const q = await client.query('SELECT count(*)::int AS n FROM recommendation_query WHERE id = ANY($1::uuid[])', [queryIds]);
  const bc = await client.query('SELECT count(*)::int AS n FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);
  const p = profileId === null
    ? { rows: [{ n: 0 }] }
    : await client.query('SELECT count(*)::int AS n FROM recommendation_profile WHERE id = $1', [profileId]);
  return q.rows[0].n + bc.rows[0].n + p.rows[0].n;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage(err.message);
  }

  const suite = JSON.parse(fs.readFileSync(SUITE_FILE, 'utf8'));
  suite.engine_options = Object.freeze({ allow_unverified_seed_offers: true });
  suite.scoring_model = 'launch-v2@2.5.0';

  const wanted = opts.filter === null
    ? suite.scenarios.map((s) => s.id)
    : opts.filter;
  const scenarios = wanted.map((id) => {
    const found = suite.scenarios.find((s) => s.id === id);
    if (!found) throw new Error('unknown scenario id: ' + id);
    return found;
  });

  const guardTarget = getWriteTestDbUrl();
  const connectionString = guardTarget.connectionString;
  process.stdout.write('target: ' + JSON.stringify(describeTarget(connectionString)) + '\n');
  process.stdout.write('mode: ' + opts.mode + '  scenarios: ' + scenarios.length + '\n');

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: guardTarget.connectionTimeoutMillis || 10000,
  });
  await client.connect();

  const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + '-' + process.pid;
  let profileId = null;
  const queryIds = [];
  const failures = [];
  let compared = 0;

  try {
    const modelRow = await client.query(
      "SELECT id FROM scoring_model WHERE name || '@' || version = $1",
      [suite.scoring_model]
    );
    if (modelRow.rows.length !== 1) {
      throw new Error('expected exactly one scoring model ' + suite.scoring_model + ', found ' + modelRow.rows.length);
    }
    const scoringModelId = modelRow.rows[0].id;

    profileId = await createProfile(client, runId);

    // Absolute budgets first: a factor-of-floor scenario resolves against a
    // measured floor, so its reference must already have been captured.
    const absolutes = scenarios.filter((s) => typeof s.budget === 'number');
    const relatives = scenarios.filter((s) => typeof s.budget !== 'number');
    const measuredFloors = new Map();

    const runScenario = async (scenario) => {
      let budget;
      if (typeof scenario.budget === 'number') {
        budget = scenario.budget;
      } else {
        const ref = scenario.floor_reference || 'S01';
        const floor = measuredFloors.get(ref);
        if (floor === undefined) {
          throw new Error(scenario.id + ': budget_factor_of_floor needs reference ' + ref + ', which was not captured');
        }
        budget = Math.round(scenario.budget_factor_of_floor * floor);
      }

      const ids = [];
      const captures = [];
      for (const label of ['A', 'B']) {
        const queryId = await createQuery(client, profileId, scoringModelId, scenario, budget);
        ids.push(queryId);
        queryIds.push(queryId);
        captures.push(await captureOnce(client, queryId, scenario, suite, budget, label));
      }

      // Two-capture determinism: the ONLY fields allowed to differ are the row's
      // own identity and the capture label ("A"/"B"), which the committed
      // fixture keeps as "A".
      const diffA = differingPaths(captures[0].fixture, captures[1].fixture, '', []);
      const diffB = differingPaths(captures[0].expected, captures[1].expected, '', []);
      const allowed = new Set(['meta.capture', 'query.query_id', 'result.query_id']);
      const unexpected = [...diffA, ...diffB].filter((p) => !allowed.has(p));
      if (unexpected.length > 0) {
        failures.push(scenario.id + ': NON-DETERMINISTIC capture (a capture bug, not drift): ' + unexpected.slice(0, 5).join(', '));
        return;
      }

      // The loader and pass-result objects are frozen, so the pin is applied by
      // re-spreading rather than assigning. An existing key keeps its insertion
      // position under spread, so the committed key order is preserved.
      const fixture = { ...captures[0].fixture, query: { ...captures[0].fixture.query, query_id: QUERY_ID_PIN } };
      const expected = { ...captures[0].expected, result: { ...captures[0].expected.result, query_id: QUERY_ID_PIN } };

      measuredFloors.set(scenario.id, expected.budget_floor.cheapest_total);

      if (opts.mode === 'write') {
        fs.mkdirSync(path.join(opts.out, 'fixtures'), { recursive: true });
        fs.mkdirSync(path.join(opts.out, 'expected'), { recursive: true });
        fs.writeFileSync(path.join(opts.out, 'fixtures', scenario.id + '.json'), serialize(fixture), 'utf8');
        fs.writeFileSync(path.join(opts.out, 'expected', scenario.id + '.json'), serialize(expected), 'utf8');
        process.stdout.write('wrote ' + scenario.id + '\n');
        return;
      }

      for (const [dir, tree, half] of [[FIXTURE_DIR, fixture, 'fixture'], [EXPECTED_DIR, expected, 'expected']]) {
        const file = path.join(dir, scenario.id + '.json');
        if (!fs.existsSync(file)) {
          failures.push(scenario.id + ' (' + half + '): no committed file at ' + file);
          continue;
        }
        const committed = fs.readFileSync(file, 'utf8');
        const captured = serialize(tree);
        compared += 1;
        if (captured !== committed) {
          failures.push(scenario.id + ' (' + half + '): ' + firstByteDiff(captured, committed));
        }
      }
      process.stdout.write((failures.length === 0 ? 'OK   ' : 'DRIFT') + ' ' + scenario.id + '\n');
    };

    for (const scenario of absolutes) await runScenario(scenario);
    for (const scenario of relatives) await runScenario(scenario);
  } finally {
    await cleanup(client, profileId, queryIds);
    const left = await residue(client, profileId, queryIds);
    await client.end();
    process.stdout.write('cleanup: ' + queryIds.length + ' rows deleted by id, residue ' + left + '\n');
    if (left !== 0) {
      process.stderr.write('FAIL: residue ' + left + ' rows owned by this run were not deleted\n');
      process.exit(1);
    }
  }

  if (opts.mode === 'check') {
    if (failures.length > 0) {
      process.stderr.write('\nCAPTURE BUG OR DRIFT — ' + failures.length + ' finding(s). Report; do NOT regenerate the fixtures:\n\n');
      failures.forEach((f) => process.stderr.write('- ' + f + '\n'));
      process.exit(1);
    }
    process.stdout.write('\n' + compared + '/' + compared + ' committed files reproduced byte-identically ('
      + scenarios.length + ' scenarios x fixture+expected)\n');
  }
}

main().catch((err) => {
  process.stderr.write('ERROR: ' + (err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
