#!/usr/bin/env node
'use strict';

/**
 * scripts/check-golden-loader-parity.js — I/O half of the golden loader-parity
 * gate.
 *
 * WHAT IT PROVES
 * The frozen golden pairs under `test/golden/` carry the output of five real
 * database loaders as INPUT (`test/golden/fixtures/<ID>.json`), so the offline
 * replay (`compute.golden.test.js`) never exercises those loaders. This script
 * re-runs the same loader chain, in the same order `orchestrator/run.js` uses,
 * and compares each output to its committed half:
 *
 *   fixture.query.input
 *     -> candidates.loadCandidates          -> selectCandidatePool
 *     -> offers.selectOfferPrices           -> candidatePoolResult
 *     -> filtering.loadFilteringContext     -> filteringContext
 *     -> filtering.filterCandidates         -> filterResult
 *     -> scoring.loadScoringModel           -> scoringModel
 *     -> scoring.loadComponentAssessments   -> assessments
 *
 * `query` (loadQueryInput) needs a committed `recommendation_query` row, so it
 * is UNMEASURED unless `--with-query-row` is passed (opt-in: inserts a row in a
 * transaction that is ALWAYS rolled back). Its SQL is separately pinned by
 * `src/recommendation/query/load-query-input.test.js`.
 *
 * IDENTITY, AND WHY THIS IS NOT A BYTE DIFF
 * Seeds mint every id with `gen_random_uuid()` and ranking breaks ties on
 * `product_id`, so a freshly seeded database cannot reproduce the capture's
 * ids or its tie-break order. The comparator (`./lib/golden-loader-parity`)
 * therefore compares CONTENT:
 *   - default (`mask`): a UUID equals any UUID; UUID-keyed carriers (`prices`,
 *     `assessments`, `specs`) compare as multisets; array order is not asserted;
 *   - `--strict`: ids are compared as values. This only passes against the
 *     database the pairs were captured from (TEST) — it is the byte-level
 *     reproducibility check, not the ephemeral one;
 *   - row-audit clocks (`created_at`, `updated_at`) are compared for PRESENCE
 *     and masked for value, because every database stamps its own seed time.
 * Nothing else is excluded; a changed price, verdict, role count or score is a
 * FAIL with its first differing path.
 *
 * WRITE SAFETY
 * The connection comes from `packages/database-guard` (`getWriteTestDbUrl()`),
 * so `TEST_DATABASE_URL` must be set and must resolve to a different host than
 * `DATABASE_URL`. The transaction is `BEGIN READ ONLY` unless `--with-query-row`
 * is passed, and it is ALWAYS rolled back in a `finally`. No row is committed,
 * no migration is applied, no golden file is written.
 *
 * Dispositions are the project's: PASS / FAIL / UNMEASURED. Exit 0 on PASS, 1
 * on any FAIL, 2 on usage, 3 when no scenario could be measured (a gate that
 * measured nothing has not passed).
 *
 *   node scripts/check-golden-loader-parity.js
 *   node scripts/check-golden-loader-parity.js --filter=S01,S01b
 *   node scripts/check-golden-loader-parity.js --strict --json=/tmp/parity.json
 *   node scripts/check-golden-loader-parity.js --with-query-row
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const { getWriteTestDbUrl, describeTarget } = require('../packages/database-guard/src');
const candidates = require('../src/recommendation/candidates');
const offers = require('../src/recommendation/offers');
const filtering = require('../src/recommendation/filtering');
const scoring = require('../src/recommendation/scoring');
const queryNs = require('../src/recommendation/query');
const parity = require('./lib/golden-loader-parity');

const REPO_ROOT = path.resolve(__dirname, '..');
const GOLDEN_DIR = path.join(REPO_ROOT, 'test', 'golden');
const FIXTURE_DIR = path.join(GOLDEN_DIR, 'fixtures');

const PROFILE_PREFIX = 'golden-loader-parity-';
const QUERY_ID_PIN = '<ID>';

const USAGE = 'usage: node scripts/check-golden-loader-parity.js'
  + ' [--filter=ID,...] [--json=<path>] [--strict] [--with-query-row] [--help]';

function parseArgs(argv) {
  const opts = { filter: null, json: null, strict: false, withQueryRow: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE + '\n');
      process.exit(0);
    } else if (arg === '--strict') opts.strict = true;
    else if (arg === '--with-query-row') opts.withQueryRow = true;
    else if (arg.startsWith('--json=')) opts.json = arg.slice('--json='.length);
    else if (arg.startsWith('--filter=')) {
      opts.filter = arg.slice('--filter='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      process.stderr.write('unknown argument: ' + arg + '\n\n' + USAGE + '\n');
      process.exit(2);
    }
  }
  return opts;
}

function readJson(dir, id) {
  const file = path.join(dir, id + '.json');
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Deduped, sorted product ids of the Stage 1 pool — same rule as run.js. */
function assessmentProductIds(pool) {
  const ids = new Set();
  for (const candidate of pool) ids.add(candidate.product_id);
  return [...ids].sort();
}

function pad(text, width) {
  return String(text).padEnd(width, ' ');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const identityMode = opts.strict ? 'strict' : 'mask';

  const fixtureIds = fs.readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
  const scenarioIds = opts.filter === null ? fixtureIds : opts.filter;
  const unknown = scenarioIds.filter((id) => !fixtureIds.includes(id));
  if (unknown.length > 0) {
    process.stderr.write('unknown scenario id(s): ' + unknown.join(', ') + '\n');
    process.exit(2);
  }

  let target;
  try {
    target = getWriteTestDbUrl();
  } catch (err) {
    process.stderr.write('RESULT: BLOCKED — ' + err.message + '\n');
    process.stderr.write('A database is required; TEST_DATABASE_URL and DATABASE_URL must be set to different hosts.\n');
    process.exit(3);
  }

  process.stdout.write('target: ' + JSON.stringify(describeTarget(target.connectionString)) + '\n');
  process.stdout.write('mode: ' + identityMode + (opts.withQueryRow ? ' + query-row' : '')
    + '  scenarios: ' + scenarioIds.length + '\n');

  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: target.connectionTimeoutMillis || 10000,
  });
  await client.connect();

  const report = { target: describeTarget(target.connectionString), mode: identityMode, scenarios: [] };
  let failCount = 0;
  let measuredCount = 0;
  let queryRowCount = 0;

  try {
    await client.query(opts.withQueryRow ? 'BEGIN' : 'BEGIN READ ONLY');

    // The fixture carries the CAPTURE database's scoring_model id. Resolve the
    // same name@version on this database; comparing ids is `--strict`'s job.
    const modelPins = new Map();
    for (const id of scenarioIds) {
      const fixture = readJson(FIXTURE_DIR, id);
      modelPins.set(id, fixture.meta.scoring_model);
    }
    const pins = [...new Set(modelPins.values())];
    const modelIds = new Map();
    for (const pin of pins) {
      const found = await client.query(
        "SELECT id FROM scoring_model WHERE name || '@' || version = $1 AND is_active = true",
        [pin]
      );
      if (found.rows.length !== 1) {
        process.stderr.write('RESULT: BLOCKED — expected exactly one ACTIVE scoring model '
          + pin + ', found ' + found.rows.length + ' on this target\n');
        await client.query('ROLLBACK');
        await client.end();
        process.exit(3);
      }
      modelIds.set(pin, found.rows[0].id);
    }

    let profileId = null;
    if (opts.withQueryRow) {
      const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + '-' + process.pid;
      const profile = await client.query(
        'INSERT INTO recommendation_profile (name, description) VALUES ($1, $2) RETURNING id',
        [PROFILE_PREFIX + runId, 'golden loader parity run ' + runId + ' (rolled back; never committed)']
      );
      profileId = profile.rows[0].id;
    }

    process.stdout.write('\n'
      + pad('scenario', 9) + pad('status', 9) + pad('query', 12) + pad('model', 9)
      + pad('pool', 8) + pad('context', 10) + pad('filter', 9) + 'assessments\n');
    process.stdout.write('-'.repeat(80) + '\n');

    for (const id of scenarioIds) {
      const fixture = readJson(FIXTURE_DIR, id);
      const live = {};
      const reasons = {};

      if (opts.withQueryRow) {
        const scenario = { use_case: fixture.meta.use_case, priority: fixture.meta.priority, resolution: fixture.meta.resolution };
        const inserted = await client.query(
          'INSERT INTO recommendation_query (recommendation_profile_id, scoring_model_id, budget_amount, currency, use_case, priority, resolution)'
          + ' VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [profileId, modelIds.get(fixture.meta.scoring_model), String(fixture.meta.budget_resolved),
            'MAD', scenario.use_case, scenario.priority, scenario.resolution]
        );
        queryRowCount += 1;
        // The pair pins the volatile row id to "<ID>" (capture.js does the same),
        // so the comparison keeps that pin rather than asserting a fresh uuid.
        live.query = { ...await queryNs.loadQueryInput(inserted.rows[0].id, client), query_id: QUERY_ID_PIN };
      } else {
        reasons.query = 'loadQueryInput needs a committed query row; pass --with-query-row to measure it';
      }

      // The chain follows orchestrator/run.js steps 4-9. Without a query row the
      // fixture's own query input is the documented substitution.
      const queryInput = live.query ? live.query.input : fixture.query.input;
      const model = await scoring.loadScoringModel(modelIds.get(fixture.meta.scoring_model), client);
      live.scoringModel = model;

      const loaded = await candidates.loadCandidates(queryInput, client);
      const poolResult = candidates.selectCandidatePool(loaded.input, loaded.candidates);
      const offerResult = await offers.selectOfferPrices(poolResult, client, {
        ...fixture.meta.engine_options,
        asOf: fixture.meta.as_of,
      });
      live.candidatePoolResult = offerResult;

      const filteringContext = await filtering.loadFilteringContext(offerResult, client);
      live.filteringContext = filteringContext;
      live.filterResult = filtering.filterCandidates(filteringContext);

      const assessmentResult = await scoring.loadComponentAssessments(
        assessmentProductIds(offerResult.pool),
        client
      );
      live.assessments = assessmentResult.assessments;

      const result = parity.compareScenario({ fixture, live, unmeasuredReasons: reasons, identityMode });
      if (result.components.some((c) => c.status !== 'UNMEASURED')) measuredCount += 1;
      if (result.status === 'FAIL') failCount += 1;

      const byLabel = Object.fromEntries(result.components.map((c) => [c.label, c]));
      process.stdout.write(
        pad(id, 9) + pad(result.status, 9)
        + pad(byLabel.query.status, 12)
        + pad(byLabel.scoringModel.status, 9)
        + pad(byLabel.candidatePoolResult.status, 8)
        + pad(byLabel.filteringContext.status, 10)
        + pad(byLabel.filterResult.status, 9)
        + byLabel.assessments.status + '\n'
      );

      const failing = result.components.filter((c) => c.status === 'FAIL');
      for (const component of failing) {
        const first = component.differences[0];
        process.stdout.write('  FAIL ' + id + ' ' + component.label + ' at ' + first.path
          + ': actual=' + JSON.stringify(first.actual).slice(0, 180)
          + ' expected=' + JSON.stringify(first.expected).slice(0, 180) + '\n');
      }

      report.scenarios.push({
        id,
        status: result.status,
        identities: result.components.reduce((sum, c) => sum + c.identities, 0),
        components: result.components.map((c) => ({
          label: c.label,
          status: c.status,
          reason: c.reason,
          differences: c.differences.slice(0, 3),
        })),
      });
    }
  } finally {
    // ALWAYS undo, whether the run succeeded, failed or threw. A parity gate
    // must never leave a row behind, and the read-only transaction cannot.
    try { await client.query('ROLLBACK'); } catch (err) { /* connection already gone */ }
    await client.end();
  }

  report.summary = {
    scenarios: scenarioIds.length,
    measured: measuredCount,
    failed: failCount,
    query_rows_inserted_and_rolled_back: queryRowCount,
  };

  if (opts.json !== null) {
    fs.writeFileSync(opts.json, JSON.stringify(report, null, 2) + '\n', 'utf8');
    process.stdout.write('\njson: ' + opts.json + '\n');
  }

  if (measuredCount === 0) {
    process.stderr.write('\nRESULT: UNMEASURED — no scenario produced a comparable loader output\n');
    process.exit(3);
  }
  if (failCount > 0) {
    process.stderr.write('\nRESULT: FAIL — ' + failCount + ' of ' + scenarioIds.length
      + ' scenario(s) differ from the frozen golden halves\n');
    process.exit(1);
  }
  process.stdout.write('\nRESULT: PASS — ' + scenarioIds.length + ' scenario(s) match the frozen golden halves'
    + ' (mode ' + identityMode + ', ' + queryRowCount + ' query row(s) rolled back)\n');
}

main().catch((err) => {
  process.stderr.write('ERROR: ' + (err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
