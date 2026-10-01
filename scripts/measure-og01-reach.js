'use strict';

/**
 * OG-01 reach measurement (read-only; shared-DB safe).
 *
 * Permanent home of the batch-1 acceptance measurement: replicates
 * orchestrator stages 4-11 read-only against DATABASE_URL -
 *
 *   loadCandidates -> selectCandidatePool -> selectOfferPrices ->
 *   loadFilteringContext -> filterCandidates -> loadComponentAssessments ->
 *   computeCandidateScores -> retainTopKPerRole
 *
 * Decision 17 compliance: NO recommendation_query row is written and no
 * other write is performed. This is the read-only alternative to
 * scripts/measure-orchestrator.js (which is TEST_DATABASE_URL-only because
 * it captures its own query rows). Use this script when only the reach/
 * score figures are needed and the shared DB is the only target; use
 * measure-orchestrator.js when the full Decision-20 acceptance (write path,
 * persisted ranks) is required.
 *
 * Known approximation (documented, accepted for reach figures): the
 * orchestrator reads the transaction timestamp (Decision 17.2) as the only
 * clock scoring sees; this script uses Date.now() at run time. Decay is
 * linear 0.5%/day (effective-score.js), so the difference only matters for
 * assessments close to a decay boundary and never changes ordering by more
 * than noise between same-day runs.
 *
 * Usage:
 *   node scripts/measure-og01-reach.js [--budget N] [--use-case GAMING|OFFICE|...]
 * Defaults: budget 25000 MAD, use_case GAMING (the batch-1 acceptance values).
 * Exit codes: 0 = measured; 1 = error; 2 = usage error.
 */

require('dotenv').config();
const { Client } = require('pg');
const path = require('path');

const candidates = require(path.join(__dirname, '..', 'src', 'recommendation', 'candidates'));
const offers = require(path.join(__dirname, '..', 'src', 'recommendation', 'offers', 'index.js'));
const filtering = require(path.join(
  __dirname,
  '..',
  'src',
  'recommendation',
  'filtering',
  'index.js'
));
const scoring = require(path.join(__dirname, '..', 'src', 'recommendation', 'scoring', 'index.js'));
const retention = require(path.join(
  __dirname,
  '..',
  'src',
  'recommendation',
  'retention',
  'index.js'
));

const ARGS = process.argv.slice(2);
function argValue(flag) {
  const i = ARGS.indexOf(flag);
  return i !== -1 ? ARGS[i + 1] : null;
}
const BUDGET = Number(argValue('--budget') || 25000);
const USE_CASE = argValue('--use-case') || 'GAMING';
if (
  ARGS.some((a) => a !== '--budget' && a !== '--use-case' && a !== String(BUDGET) && a !== USE_CASE) ||
  !Number.isFinite(BUDGET) ||
  BUDGET <= 0
) {
  console.error(
    'usage: node scripts/measure-og01-reach.js [--budget N] [--use-case <use_case>]'
  );
  process.exit(2);
}

const INPUT = {
  budget_amount: BUDGET,
  currency: 'MAD',
  use_case: USE_CASE,
  required_roles: [
    'CPU',
    'GPU',
    'MOTHERBOARD',
    'RAM',
    'SSD_BOOT',
    'PSU',
    'CASE',
    'CPU_COOLER',
  ],
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const db = new Client({ connectionString });
  await db.connect();
  try {
    // Pinned seed scoring model (Decision 11), read-only.
    const model = (
      await db.query(
        "SELECT id::text AS id, configuration FROM scoring_model WHERE name='seed-minimal-v1' AND version='1.0.0' AND is_active=true"
      )
    ).rows[0];
    if (!model) throw new Error('seed-minimal-v1 not found');
    const configuration = model.configuration;
    const topK = configuration.candidate_caps.top_k_per_role;
    console.log(
      'OG-01 reach measurement (read-only, DATABASE_URL) | budget ' +
        BUDGET +
        ' MAD | use_case ' +
        USE_CASE +
        ' | model seed-minimal-v1 ' +
        ' | top_k_per_role ' +
        topK
    );

    // Stages 4-11 (read-only). See orchestrator/run.js steps 4-11 for the
    // authoritative comments; stage 12 (persistence) is deliberately absent.
    const loaded = await candidates.loadCandidates(INPUT, db);
    const poolResult = candidates.selectCandidatePool(loaded.input, loaded.candidates);
    const offerResult = await offers.selectOfferPrices(poolResult, db);
    const filteringContext = await filtering.loadFilteringContext(offerResult, db);
    const filterResult = filtering.filterCandidates(filteringContext);

    const productIds = new Set(offerResult.pool.map((c) => c.product_id));
    const assessmentResult = await scoring.loadComponentAssessments(
      [...productIds],
      db
    );
    const nowMs = Date.now(); // approximation of the tx timestamp - see header
    const candidateScores = scoring.computeCandidateScores({
      candidates: offerResult.pool,
      assessments: assessmentResult.assessments,
      configuration,
      nowMs,
    });
    const retentionResult = retention.retainTopKPerRole({
      filterResult,
      candidateScores,
      topKPerRole: topK,
    });

    const byRole = new Map();
    for (const r of retentionResult.results) {
      if (!byRole.has(r.component_role)) byRole.set(r.component_role, []);
      byRole.get(r.component_role).push(r);
    }

    const ids = new Set(retentionResult.results.map((r) => r.product_id));
    const names = new Map();
    if (ids.size > 0) {
      const rows = await db.query(
        'SELECT id::text AS id, name FROM product WHERE id::text = ANY($1::text[])',
        [Array.from(ids)]
      );
      for (const row of rows.rows) names.set(row.id, row.name);
    }

    console.log(
      'candidates: ' +
        loaded.candidates.length +
        ' | pool: ' +
        poolResult.pool.length +
        ' | with offers: ' +
        offerResult.pool.length +
        ' | filter PASS: ' +
        filterResult.results.length
    );
    console.log('');
    console.log('=== reach per role (retained = top-K of PASS pool) ===');
    for (const role of [...byRole.keys()].sort()) {
      const list = byRole.get(role);
      const retainedScores = candidateScores.scores.filter((s) =>
        list.some(
          (r) => r.product_id === s.product_id && r.product_variant_id === s.product_variant_id
        )
      );
      const best = retainedScores.reduce(
        (m, s) => (s.candidate_score > m ? s.candidate_score : m),
        0
      );
      console.log(
        role +
          ': retained=' +
          list.length +
          ' | best_score=' +
          best.toFixed(3) +
          ' | ' +
          list
            .slice(0, 5)
            .map((r) => names.get(r.product_id))
            .join(' ; ')
      );
    }

    const flat40 = candidateScores.scores.filter(
      (s) => Math.abs(s.candidate_score - 40) < 1e-9
    );
    console.log('');
    console.log(
      'pool candidates scoring exactly 40.000 (no-evidence branch): ' +
        flat40.length +
        ' of ' +
        candidateScores.scores.length
    );
    console.log('RESULT: measured (read-only; no rows written)');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err && err.message);
  process.exit(1);
});
