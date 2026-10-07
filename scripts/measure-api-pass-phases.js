'use strict';

// scripts/measure-api-pass-phases.js - per-phase statement counts and timings
// for ONE API-shaped recommendation pass, measured on the TEST branch only.
//
// What it measures: the exact statement sequence a POST /v1/recommendations
// issues (model select -> profile+query insert -> engine full run -> read-back),
// attributing every statement to the phase that issued it. Two numbers per
// phase: INCLUSIVE (statements issued anywhere inside the phase, including
// nested child phases) and EXCLUSIVE (statements issued by the phase itself,
// not a child). A statement issued while several phase timers are open is the
// "overlap" the report calls out: parent -> child pairs with counts.
//
// How it measures WITHOUT engine edits: Decision 17/21 make every collaborator
// call go through a module namespace (the documented stub seam), so this script
// wraps `client.query` plus those namespace functions, and restores every patch
// in `finally`. The engine's own files are never modified.
//
// Write safety: the target comes from getWriteTestDbUrl() (TEST branch guard).
// The run's own Layer 4 rows are deleted in dependency order in `finally`, and
// a cleanup failure exits non-zero (a gate that cannot prove cleanup has not
// proved anything).
//
// Usage: node scripts/measure-api-pass-phases.js [--budget N] [--use-case U]

require('dotenv').config();

const { Client } = require('pg');
const { getWriteTestDbUrl } = require('./lib/db-url');

// Namespace seams (all called through their module namespace by the engine).
const run = require('../src/recommendation/orchestrator/run');
const snapshotModule = require('../src/recommendation/orchestrator/snapshot');
const commitModule = require('../src/recommendation/orchestrator/commit');
const ranking = require('../src/recommendation/ranking');
const explanation = require('../src/recommendation/explanation');
const queryStage = require('../src/recommendation/query');
const candidates = require('../src/recommendation/candidates');
const offers = require('../src/recommendation/offers');
const filtering = require('../src/recommendation/filtering');
const scoring = require('../src/recommendation/scoring');
const retention = require('../src/recommendation/retention');
const assembly = require('../src/recommendation/assembly');
const repository = require('../apps/api/src/repository');

function parseArgs(argv) {
  const args = { budget: 20000, useCase: 'GAMING' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--budget=')) {
      args.budget = Number(arg.slice('--budget='.length));
    } else if (arg.startsWith('--use-case=')) {
      args.useCase = arg.slice('--use-case='.length);
    } else {
      throw new Error('unknown argument: ' + arg);
    }
  }
  if (!Number.isFinite(args.budget) || args.budget <= 0) {
    throw new Error('--budget must be a positive finite number');
  }
  return args;
}

// __MEASUREMENT_CORE__

const recorder = { statements: [], stack: [], phaseWall: {} };

/** Patch client.query to time and attribute every statement. */
function instrumentClient(client) {
  const original = client.query.bind(client);
  client.query = function measuredQuery(...args) {
    const started = process.hrtime.bigint();
    const sqlArg = args[0];
    const sql = typeof sqlArg === 'string' ? sqlArg : (sqlArg && sqlArg.text) || String(sqlArg);
    const phases = recorder.stack.slice();
    const hasCallback = typeof args[args.length - 1] === 'function';
    const done = (error) => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      recorder.statements.push({
        phases,
        sql: sql.replace(/\s+/g, ' ').slice(0, 120),
        duration_ms: Math.round(durationMs * 100) / 100,
        error: error ? String(error.code || error.message).slice(0, 80) : null,
      });
    };
    if (hasCallback) {
      const callback = args[args.length - 1];
      args[args.length - 1] = function measuredCallback(err, result) {
        done(err);
        callback(err, result);
      };
      return original(...args);
    }
    const promise = original(...args);
    return promise.then(
      (value) => { done(null); return value; },
      (err) => { done(err); throw err; }
    );
  };
}

// __PATCH_HELPERS__

const patches = [];

/** Wrap one namespace function with a phase label (wall time + stack push). */
function phase(mod, fnName, label) {
  const original = mod[fnName];
  if (typeof original !== 'function') {
    throw new Error('seam not found: ' + (mod && mod.constructor ? 'module' : mod) + '.' + fnName);
  }
  patches.push({ mod, fnName, original });
  mod[fnName] = function measuredPhase(...args) {
    const started = process.hrtime.bigint();
    recorder.stack.push(label);
    const finish = () => {
      recorder.stack.pop();
      const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
      recorder.phaseWall[label] = (recorder.phaseWall[label] || 0) + wallMs;
      return wallMs;
    };
    let result;
    try {
      result = original.apply(this, args);
    } catch (error) {
      finish();
      throw error;
    }
    if (result && typeof result.then === 'function') {
      return result.then(
        (value) => { finish(); return value; },
        (error) => { finish(); throw error; }
      );
    }
    finish();
    return result;
  };
}

function restorePatches() {
  while (patches.length > 0) {
    const { mod, fnName, original } = patches.pop();
    mod[fnName] = original;
  }
}

function installPatches() {
  // API-side phases (repository.js is the API's only SQL owner).
  phase(repository, 'selectActiveScoringModel', 'api.model_select');
  phase(repository, 'createRecommendationQuery', 'api.profile_query_insert');
  phase(repository, 'readRecommendationResult', 'api.read_back');
  // Engine phases (orchestrator + stage barrels, all namespace-called).
  phase(snapshotModule, 'runRecommendationSnapshot', 'engine.snapshot');
  phase(run, 'runRecommendation', 'engine.pass');
  phase(queryStage, 'loadQueryInput', 'engine.load_query');
  phase(scoring, 'loadScoringModel', 'engine.load_scoring_model');
  phase(candidates, 'loadCandidates', 'engine.load_candidates');
  phase(candidates, 'selectCandidatePool', 'engine.select_pool');
  phase(offers, 'selectOfferPrices', 'engine.select_offer_prices');
  phase(filtering, 'loadFilteringContext', 'engine.load_filtering_context');
  phase(filtering, 'filterCandidates', 'engine.filter');
  phase(scoring, 'loadComponentAssessments', 'engine.load_assessments');
  phase(scoring, 'computeCandidateScores', 'engine.score_candidates');
  phase(retention, 'retainTopKPerRole', 'engine.retention');
  phase(retention, 'computeBudgetFloor', 'engine.budget_floor');
  phase(assembly, 'assembleBuildsForRecommendation', 'engine.assemble');
  phase(scoring, 'computeBuildScores', 'engine.score_builds');
  phase(scoring, 'computeBuildScoreContributions', 'engine.score_contributions');
  phase(ranking, 'rankBuilds', 'engine.rank');
  phase(ranking, 'selectDiverseTop', 'engine.select_diverse');
  phase(explanation, 'explainSelection', 'engine.explain');
  phase(commitModule, 'runRecommendationCommit', 'engine.commit');
}

// __AGGREGATE__

const PHASE_ORDER = [
  'api.model_select',
  'api.profile_query_insert',
  'engine.snapshot',
  'engine.pass',
  'engine.load_query',
  'engine.load_scoring_model',
  'engine.load_candidates',
  'engine.select_pool',
  'engine.select_offer_prices',
  'engine.load_filtering_context',
  'engine.filter',
  'engine.load_assessments',
  'engine.score_candidates',
  'engine.retention',
  'engine.budget_floor',
  'engine.assemble',
  'engine.score_builds',
  'engine.score_contributions',
  'engine.rank',
  'engine.select_diverse',
  'engine.explain',
  'engine.commit',
  'api.read_back',
];

function round2(value) {
  return Math.round(value * 100) / 100;
}

function aggregate() {
  const perPhase = {};
  const overlaps = {};
  for (const label of PHASE_ORDER) {
    perPhase[label] = { phase: label, wall_ms: 0, stmt_inclusive: 0, stmt_inclusive_ms: 0, stmt_exclusive: 0, stmt_exclusive_ms: 0 };
  }
  let totalMs = 0;
  for (const statement of recorder.statements) {
    totalMs += statement.duration_ms;
    const top = statement.phases[statement.phases.length - 1] || null;
    for (const label of statement.phases) {
      if (!perPhase[label]) continue;
      perPhase[label].stmt_inclusive += 1;
      perPhase[label].stmt_inclusive_ms += statement.duration_ms;
    }
    if (top && perPhase[top]) {
      perPhase[top].stmt_exclusive += 1;
      perPhase[top].stmt_exclusive_ms += statement.duration_ms;
    }
    // Overlaps: every ancestor/descendant pair the statement sits under.
    for (let a = 0; a < statement.phases.length; a += 1) {
      for (let b = a + 1; b < statement.phases.length; b += 1) {
        const key = statement.phases[a] + ' -> ' + statement.phases[b];
        overlaps[key] = (overlaps[key] || 0) + 1;
      }
    }
  }
  for (const label of PHASE_ORDER) {
    perPhase[label].wall_ms = round2(recorder.phaseWall[label] || 0);
    perPhase[label].stmt_inclusive_ms = round2(perPhase[label].stmt_inclusive_ms);
    perPhase[label].stmt_exclusive_ms = round2(perPhase[label].stmt_exclusive_ms);
  }
  return {
    total: {
      statements: recorder.statements.length,
      statement_ms: round2(totalMs),
      phase_wall_sum_ms: round2(PHASE_ORDER.reduce((sum, l) => sum + (recorder.phaseWall[l] || 0), 0)),
    },
    per_phase: perPhase,
    overlaps: overlaps,
  };
}

// __MAIN__

async function cleanup(client, ids) {
  if (!ids.queryId) return;
  await client.query('DELETE FROM build_rejection WHERE recommendation_query_id = $1::uuid', [ids.queryId]);
  await client.query('DELETE FROM recommendation_result WHERE recommendation_query_id = $1::uuid', [ids.queryId]);
  await client.query(
    'DELETE FROM build_component WHERE build_candidate_id IN'
    + ' (SELECT id FROM build_candidate WHERE recommendation_query_id = $1::uuid)',
    [ids.queryId]
  );
  await client.query('DELETE FROM build_candidate WHERE recommendation_query_id = $1::uuid', [ids.queryId]);
  if (ids.profileId) {
    await client.query('DELETE FROM recommendation_query WHERE id = $1::uuid AND recommendation_profile_id = $2::uuid', [ids.queryId, ids.profileId]);
    await client.query('DELETE FROM recommendation_profile WHERE id = $1::uuid', [ids.profileId]);
  } else {
    await client.query('DELETE FROM recommendation_query WHERE id = $1::uuid', [ids.queryId]);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const client = new Client(Object.assign(getWriteTestDbUrl(), {
    statement_timeout: 10000,
    application_name: 'morocco-pc-measure-phases',
  }));
  const ids = { queryId: null, profileId: null };
  const runStarted = process.hrtime.bigint();
  let exitCode = 0;
  try {
    await client.connect();
    instrumentClient(client);
    // One preflight so a dead branch fails with a named message.
    const probe = await client.query('SELECT 1 AS ok');
    if (probe.rows.length !== 1) throw new Error('TEST branch preflight SELECT 1 returned no rows');

    installPatches();
    // The API POST flow, minus HTTP: same repository, same engine barrel options,
    // one dedicated client for the whole request.
    const model = await repository.selectActiveScoringModel(client);
    if (model === null) throw new Error('no active scoring model on the TEST branch');
    const created = await repository.createRecommendationQuery(client, {
      scoringModelId: model.id,
      budgetAmount: args.budget,
      currency: 'MAD',
      useCase: args.useCase,
      resolution: undefined,
      priority: undefined,
    });
    ids.queryId = created.queryId;
    ids.profileId = created.profileId;

    const runResult = await require('../apps/api/src/engine').runFullRun(client, created.queryId);
    const snapshot = await repository.readRecommendationResult(client, created.queryId);
    const wallMs = Number(process.hrtime.bigint() - runStarted) / 1e6;

    const report = {
      target: 'TEST_DATABASE_URL (host hidden)',
      input: { budget: args.budget, currency: 'MAD', use_case: args.useCase },
      outcome: {
        builds: runResult.builds.length,
        budget_floor: runResult.budget_floor,
        read_back_found: snapshot.found,
        read_back_rows: snapshot.found ? snapshot.rows.length : 0,
      },
      wall_ms: round2(wallMs),
      aggregate: aggregate(),
      statements: recorder.statements,
    };
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    exitCode = 1;
    console.error('MEASUREMENT FAILED: ' + (error && error.code ? error.code + ' ' : '') + error.message);
  } finally {
    restorePatches();
    try {
      if (ids.queryId) {
        await cleanup(client, ids);
        const residue = await client.query(
          'SELECT count(*)::int AS n FROM recommendation_query WHERE id = $1::uuid',
          [ids.queryId]
        );
        if (Number(residue.rows[0].n) !== 0) {
          throw new Error('cleanup did not remove the query row');
        }
      }
    } catch (cleanupError) {
      exitCode = 1;
      console.error('CLEANUP FAILED: ' + cleanupError.message);
    } finally {
      try { await client.end(); } catch (_endError) { /* already closed */ }
    }
  }
  process.exit(exitCode);
}

main();
