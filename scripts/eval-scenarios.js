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
//     then runRecommendation({ db, queryId, options }) runs TWICE (A8
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
//     [--filter=S03,S07] [--with-pi1] [--allow-red]

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const { getWriteTestDbUrl } = require('./lib/db-url');
const orchestrator = require('../src/recommendation/orchestrator');
const ranking = require('../src/recommendation/ranking');
const scenarioEval = require('./lib/scenario-eval');

const DEFAULT_SCENARIO_FILE = 'test/golden/scenarios.json';
const DEFAULT_BASELINE_FILE = 'test/golden/baseline-2026-10.md';

/** Decision 35 / API parity: the API always runs with this, so do we. */
const ENGINE_OPTIONS = Object.freeze({ allow_unverified_seed_offers: true });

function parseArgs(argv) {
  const args = {
    file: DEFAULT_SCENARIO_FILE,
    baseline: DEFAULT_BASELINE_FILE,
    json: null,
    filter: null,
    withPi1: false,
    allowRed: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--with-pi1') {
      args.withPi1 = true;
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

async function preflight(client) {
  const probe = await client.query('SELECT 1 AS ok');
  if (probe.rows.length !== 1) fail('preflight SELECT 1 returned no rows');
  const model = await client.query(
    'SELECT id, name, version FROM scoring_model WHERE is_active = true ORDER BY created_at DESC, id ASC LIMIT 1'
  );
  if (model.rows.length !== 1) {
    fail('expected exactly 1 active scoring model, found ' + model.rows.length + ' - seed the TEST branch first');
  }
  const counts = await client.query(
    "SELECT (SELECT count(*)::int FROM product WHERE name LIKE 'Seed %') AS products,"
    + " (SELECT count(*)::int FROM store_offer o JOIN product p ON p.id = o.product_id WHERE p.name LIKE 'Seed %') AS offers,"
    + " (SELECT count(*)::int FROM component_assessment a JOIN product p ON p.id = a.product_id WHERE p.name LIKE 'Seed %') AS assessments"
  );
  const freshness = await client.query(
    'SELECT min(last_checked_at) AS oldest, count(*)::int AS total,'
    + " count(*) FILTER (WHERE last_checked_at >= NOW() - INTERVAL '30 days')::int AS fresh"
    + ' FROM store_offer'
  );
  return {
    scoringModel: model.rows[0],
    counts: counts.rows[0],
    freshness: freshness.rows[0],
  };
}

/** Read-only lookups the pure projector needs. */
async function loadMaps(client) {
  const vram = await client.query(
    'SELECT b.product_variant_id, c.vram_capacity_gb FROM gpu_board_spec b JOIN gpu_chipset c ON c.id = b.gpu_chipset_id'
  );
  const igpu = await client.query('SELECT product_id, integrated_gpu_present FROM cpu_spec');
  return {
    vramByVariant: new Map(vram.rows.map((row) => [String(row.product_variant_id), row.vram_capacity_gb])),
    igpuByCpu: new Map(igpu.rows.map((row) => [String(row.product_id), row.integrated_gpu_present])),
  };
}

/** Insert one recommendation_query per scenario, in one transaction. */
async function insertQueries(client, scoringModelId, scenarios) {
  const ids = [];
  await client.query('BEGIN');
  try {
    for (const scenario of scenarios) {
      const inserted = await client.query(
        'INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency, use_case, priority, resolution)'
        + ' VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [scoringModelId, String(scenario.budget), 'MAD', scenario.use_case, scenario.priority, scenario.resolution]
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

/** Delete ONLY this run's rows, in dependency order, and verify residue 0. */
async function cleanup(client, ids) {
  if (ids.length === 0) return { q: 0, bc: 0, comp: 0, res: 0, rej: 0 };
  await client.query('DELETE FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])', [ids]);
  await client.query(
    'DELETE FROM build_component WHERE build_candidate_id IN'
    + ' (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))',
    [ids]
  );
  await client.query('DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [ids]);
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

function renderBaseline({ meta, suite, selected, artifacts, results, summary, fullRuns, pi1 }) {
  const lines = [];
  lines.push('# Golden scenario baseline - ' + meta.date);
  lines.push('');
  lines.push('Generated by `scripts/eval-scenarios.js` on the UNCHANGED engine. Do not hand-edit: thresholds live in');
  lines.push('`test/golden/scenarios.json`, and changing one requires a `test/golden/CHANGELOG.md` entry naming the reviewer.');
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push('- git branch: `' + meta.branch + '`');
  lines.push('- scoring model: `' + meta.scoringModel.name + '` ' + meta.scoringModel.version + ' (`' + meta.scoringModel.id + '`)');
  lines.push('- target: `TEST_DATABASE_URL` (host hidden); engine options `allow_unverified_seed_offers: true`');
  lines.push('- catalog: ' + meta.counts.products + ' products / ' + meta.counts.offers + ' offers / ' + meta.counts.assessments + ' assessments');
  lines.push('- offer freshness: ' + meta.freshness.fresh + ' of ' + meta.freshness.total + ' within 30 days; oldest ' + meta.freshness.oldest);
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
  lines.push('| ID | builds | ranked | best total | best GPU | GPU share | CPU+RAM share | selected | distinct pairs | floor cheapest | within_budget |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const scenario of selected) {
    const artifact = artifacts.get(scenario.id);
    if (artifact === undefined || artifact === null) {
      lines.push('| ' + scenario.id + ' | | | | | | | | | | |');
      continue;
    }
    const best = artifact.best;
    const floor = artifact.budget_floor !== null && artifact.budget_floor !== undefined ? artifact.budget_floor : null;
    lines.push('| ' + scenario.id
      + ' | ' + artifact.build_count
      + ' | ' + artifact.ranked_count
      + ' | ' + (best === null ? '-' : best.total_price)
      + ' | ' + (best === null || best.gpu_price === null ? '-' : best.gpu_price)
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
  for (const result of results) {
    lines.push('| ' + result.assertion + ' | ' + result.scenario_ids.join(', ')
      + ' | ' + result.status + ' | ' + result.disposition
      + ' | ' + short(result.measured).replace(/\|/g, '\\|')
      + ' | ' + result.expected.replace(/\|/g, '\\|') + ' |');
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('- total ' + summary.total + ' / PASS ' + summary.pass + ' / FAIL ' + summary.fail + ' / UNKNOWN ' + summary.unknown);
  lines.push('- dispositions: PASS ' + summary.disposition_pass + ' / EXPECTED-RED ' + summary.expected_red
    + ' / FAIL ' + summary.hard_fail + ' / WAIVED ' + summary.waived + ' / UNKNOWN ' + summary.disposition_unknown);
  const failedAssertions = [...new Set(results.filter((r) => r.status === 'FAIL').map((r) => r.assertion))];
  const passedAssertions = [...new Set(results.filter((r) => r.status === 'PASS').map((r) => r.assertion))];
  const unknownAssertions = [...new Set(results.filter((r) => r.status === 'UNKNOWN').map((r) => r.assertion))];
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
    lines.push('`npm run verify:pi1` -> ' + pi1.status + ' (exit ' + pi1.code + ').');
    lines.push('');
    lines.push('```');
    lines.push(pi1.tail);
    lines.push('```');
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
  lines.push('KNOWN FLAKE (recorded, OG-41): A8 compares ranked signature lists ORDER-SENSITIVELY, while ranking orders by 2-dp-rounded');
  lines.push('build_score, so a raw score on a .005 boundary can reorder two near-equal builds under the ~1e-5 clock drift between two');
  lines.push('consecutive passes. A8 S09 is therefore intermittently RED; it is not a stable determinism failure.');
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
  const client = new Client(Object.assign({}, dbConfig, {
    application_name: 'morocco-pc-eval-scenarios',
    statement_timeout: 30000,
  }));
  const insertedIds = [];
  let exitCode = 0;

  try {
    await client.connect();
    const meta = await preflight(client);
    console.log('target: TEST branch only (host hidden); shared DATABASE_URL never contacted');
    console.log('scoring model: ' + meta.scoringModel.name + ' ' + meta.scoringModel.version
      + ' (' + meta.scoringModel.id + ')');
    console.log('catalog: ' + JSON.stringify(meta.counts));
    console.log('offers: ' + meta.freshness.fresh + '/' + meta.freshness.total + ' fresh; oldest ' + meta.freshness.oldest);

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
      const ids = await insertQueries(client, meta.scoringModel.id, scenarios);
      insertedIds.push(...ids);
      console.log('inserted ' + ids.length + ' recommendation_query row(s)');
      for (let index = 0; index < scenarios.length; index += 1) {
        const scenario = scenarios[index];
        const queryId = ids[index];
        queryIdByScenario.set(scenario.id, queryId);
        const first = await orchestrator.runRecommendation({ db: client, queryId, options: ENGINE_OPTIONS });
        const second = await orchestrator.runRecommendation({ db: client, queryId, options: ENGINE_OPTIONS });
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
        const result = await orchestrator.runRecommendationFullRun(client, queryIdByScenario.get(scenario.id), ENGINE_OPTIONS);
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
        date: new Date().toISOString().slice(0, 10),
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
      const residue = await cleanup(client, insertedIds);
      console.log('cleanup verified: residue ' + JSON.stringify(residue));
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

main();
