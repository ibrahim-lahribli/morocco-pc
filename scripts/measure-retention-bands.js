'use strict';

/**
 * E2 acceptance - retained per-role sets across budgets (read-only, TEST branch).
 *
 * Why this exists: E2's acceptance is that retention stops being budget-blind,
 * i.e. the retained set DIFFERS at 8k / 12k / 20k / 30k MAD. That is a property
 * of the retention stage alone, so it is measured at the retention seam rather
 * than inferred from assembled builds. `scripts/measure-og01-reach.js` cannot
 * serve it: that script reads the shared `DATABASE_URL`, and the model that
 * declares `use_case_profiles` (`launch-v2`, seed 013) exists only on the TEST
 * branch. So this script is TEST-branch-only by construction.
 *
 * Read-only. It replicates orchestrator stages 4-11 exactly like
 * measure-og01-reach.js (no recommendation_query row is written; nothing is
 * persisted) and adds the ONE E2 input the orchestrator now threads:
 * `roleTargets`, resolved from the PINNED model's
 * `use_case_profiles[use_case].spend_targets` via `retention.computeRoleTargets`.
 *
 * A model that declares no `use_case_profiles` (seed-minimal-v1) resolves to
 * `roleTargets = null`, so running this script against v1 prints the PRE-E2
 * retention and is how the byte-identical claim is spot-checked.
 *
 * Usage:
 *   node scripts/measure-retention-bands.js [--use-case GAMING]
 *     [--budgets=8000,12000,20000,30000] [--resolution=1080p] [--model=<name@version>]
 * Exit codes: 0 = measured; 1 = error; 2 = usage error.
 */

require('dotenv').config();

const path = require('path');
const { Client } = require('pg');

const { getWriteTestDbUrl, describeTarget } = require('./lib/db-url');
const modelPin = require('./lib/model-pin');

const candidates = require(path.join(__dirname, '..', 'src', 'recommendation', 'candidates'));
const offers = require(path.join(__dirname, '..', 'src', 'recommendation', 'offers', 'index.js'));
const filtering = require(path.join(__dirname, '..', 'src', 'recommendation', 'filtering', 'index.js'));
const scoring = require(path.join(__dirname, '..', 'src', 'recommendation', 'scoring', 'index.js'));
const retention = require(path.join(__dirname, '..', 'src', 'recommendation', 'retention', 'index.js'));

const ARGS = process.argv.slice(2);

const USAGE = 'usage: node scripts/measure-retention-bands.js [--use-case <use_case>]'
  + ' [--resolution <r>] [--budgets=a,b,c] [--model=<name@version>]';
const FLAGS = ['use-case', 'resolution', 'budgets', 'model'];

/** Accepts both `--flag value` and `--flag=value`. */
function flagValue(name) {
  const eq = ARGS.find((a) => a.startsWith('--' + name + '='));
  if (eq !== undefined) return eq.slice(('--' + name + '=').length);
  const i = ARGS.indexOf('--' + name);
  return i !== -1 ? ARGS[i + 1] : null;
}

for (let i = 0; i < ARGS.length; i += 1) {
  const arg = ARGS[i];
  const name = arg.startsWith('--') ? arg.slice(2).split('=')[0] : null;
  if (name === null || !FLAGS.includes(name)) {
    console.error(USAGE);
    process.exit(2);
  }
  if (!arg.includes('=')) i += 1; // skip this flag's value token
}

const USE_CASE = flagValue('use-case') || 'GAMING';
const RESOLUTION = flagValue('resolution') || null;
const BUDGETS = (flagValue('budgets') || '8000,12000,20000,30000')
  .split(',')
  .map((s) => Number(s.trim()));
const MODEL_PIN = modelPin.modelPinValue(flagValue('model'));

if (BUDGETS.some((b) => !Number.isFinite(b) || b <= 0)) {
  console.error(USAGE + '\n  --budgets must be positive numbers, e.g. --budgets=8000,12000');
  process.exit(2);
}

/** The same resolution the orchestrator threads into the retention call. */
function resolveRoleTargets(configuration, budget) {
  const profiles = configuration === null || typeof configuration !== 'object'
    ? undefined
    : configuration.use_case_profiles;
  if (profiles === null || typeof profiles !== 'object' || Array.isArray(profiles)) {
    return null;
  }
  const profile = profiles[USE_CASE];
  if (profile === null || typeof profile !== 'object'
      || profile.spend_targets === null || typeof profile.spend_targets !== 'object') {
    return null;
  }
  return retention.computeRoleTargets({
    spendTargets: profile.spend_targets,
    budgetAmount: budget,
    resolution: RESOLUTION,
  });
}

async function main() {
  const config = getWriteTestDbUrl();
  const target = describeTarget(config.connectionString);
  const db = new Client(Object.assign({}, config, { application_name: 'morocco-pc-retention-bands' }));
  await db.connect();
  console.log(
    'E2 retention-band measurement (read-only) | target endpoint ' + target.endpointId
    + ' (' + (target.pooled ? 'pooled' : 'direct') + '), database ' + target.database
  );
  try {
    const model = await modelPin.resolvePinnedModel(db, MODEL_PIN);
    const configuration = model.configuration;
    const topK = configuration.candidate_caps.top_k_per_role;
    console.log('model: ' + MODEL_PIN + ' (' + model.id + ') | use_case ' + USE_CASE
      + ' | resolution ' + (RESOLUTION === null ? '(null)' : RESOLUTION)
      + ' | top_k_per_role ' + topK);

    const fingerprints = [];
    for (const budget of BUDGETS) {
      const input = {
        budget_amount: budget,
        currency: 'MAD',
        use_case: USE_CASE,
        required_roles: ['CPU', 'GPU', 'MOTHERBOARD', 'RAM', 'SSD_BOOT', 'PSU', 'CASE', 'CPU_COOLER'],
      };
      const loaded = await candidates.loadCandidates(input, db);
      const poolResult = await candidates.selectCandidatePool(loaded.input, loaded.candidates);
      const offerResult = await offers.selectOfferPrices(poolResult, db);
      const filteringContext = await filtering.loadFilteringContext(offerResult, db);
      const filterResult = filtering.filterCandidates(filteringContext);
      const productIds = [...new Set(offerResult.pool.map((c) => c.product_id))];
      const assessmentResult = await scoring.loadComponentAssessments(productIds, db);
      const candidateScores = scoring.computeCandidateScores({
        candidates: offerResult.pool,
        assessments: assessmentResult.assessments,
        configuration,
        nowMs: Date.now(),
      });
      const roleTargets = resolveRoleTargets(configuration, budget);
      const retentionResult = retention.retainTopKPerRole({
        filterResult,
        candidateScores,
        topKPerRole: topK,
        prices: offerResult.prices,
        roleTargets,
      });

      const byRole = new Map();
      for (const verdict of retentionResult.results) {
        if (!byRole.has(verdict.component_role)) byRole.set(verdict.component_role, []);
        byRole.get(verdict.component_role).push(verdict);
      }

      const ids = [...new Set(retentionResult.results.map((r) => r.product_id))];
      const names = new Map();
      if (ids.length > 0) {
        const rows = await db.query(
          'SELECT id::text AS id, name FROM product WHERE id::text = ANY($1::text[]) ORDER BY name',
          [ids]
        );
        for (const row of rows.rows) names.set(row.id, row.name);
      }

      const roles = ['CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'PSU', 'CASE', 'CPU_COOLER', 'SSD_BOOT'];
      const fingerprint = [];
      console.log('');
      console.log('=== budget ' + budget + ' MAD ===');
      if (roleTargets === null) {
        console.log('  roleTargets: null (model declares no use_case_profiles for ' + USE_CASE + ')');
      }
      for (const role of roles) {
        const entries = byRole.get(role) || [];
        const parts = entries.map((v) => names.get(String(v.product_id)) || String(v.product_id));
        fingerprint.push(role + '=' + entries.map((v) => String(v.product_id).slice(0, 8)).join('|'));
        const t = roleTargets === null ? null : roleTargets[role];
        console.log('  ' + role.padEnd(12) + (t ? 'target ' + Math.round(t.target) + ' ' : '             ')
          + '(' + entries.length + ') ' + (parts.length === 0 ? '(none retained)' : parts.join(', ')));
      }
      fingerprints.push({ budget, value: fingerprint.join(';') });
    }

    console.log('');
    console.log('=== retained-set comparison (E2 acceptance: these must DIFFER) ===');
    for (let i = 0; i < fingerprints.length; i += 1) {
      const prev = i === 0 ? null : fingerprints[i - 1];
      const same = prev !== null && prev.value === fingerprints[i].value;
      console.log('  budget ' + fingerprints[i].budget + ' MAD: '
        + (prev === null ? '(reference)' : same ? 'IDENTICAL to budget ' + prev.budget : 'DIFFERENT from budget ' + prev.budget));
    }
    const distinct = new Set(fingerprints.map((f) => f.value)).size;
    console.log('  distinct retained sets across ' + fingerprints.length + ' budgets: ' + distinct);
    console.log('  RESULT: ' + (distinct > 1 ? 'PASS - retention is budget-aware' : 'FAIL - every budget retained the same set'));
    process.exitCode = distinct > 1 ? 0 : 1;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error('MEASURE FAILED: ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
