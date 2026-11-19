'use strict';

/**
 * scripts/characterize-pr5.js - freeze the Engine 2D retention surface's
 * behaviour BEFORE the extraction moves anything (step 4B PR 5, protection L2).
 *
 * Why this exists
 *   Moving src/recommendation/retention/ into
 *   packages/recommendation-core/src/retention/ must not change a single
 *   retained membership, ordering, floor, target or iGPU exclusion. The
 *   existing assertions (L1) prove the contracts they already cover; this
 *   script records what the ORIGINAL implementation actually returns for a
 *   fixed, explicitly supplied set of inputs, so the extracted implementation
 *   can be compared against it field by field.
 *
 * What it is NOT
 *   It is not a test and not a fixture for runtime code. It reads the engine
 *   through its `src/` modules, exactly as the pre-move tree exposes them (the
 *   retention barrel plus the four stage modules, and only the pure helpers the
 *   fixtures need - no loader, no `pg`, no filesystem input), and writes one
 *   JSON document. Run it ONCE, at the baseline SHA, before the first `git mv`;
 *   the committed document is the baseline, and the extraction is compared
 *   against it afterwards.
 *
 * Determinism
 *   No clock read, no randomness, no database, no environment input: every id,
 *   score and price below is a literal. The provenance block records the
 *   baseline SHA and its commit date (read from git, not from `Date.now()`), so
 *   re-running on the same commit produces byte-identical output. Nothing here
 *   compares strings with `localeCompare`: the fixture pins code-unit ordering,
 *   which is the contract the stage actually states.
 *
 * DB-free by construction
 *   Every verdict, score, price carrier and filtering context below is built IN
 *   MEMORY from literals. Nothing here opens a connection, reads a credential
 *   or touches the filesystem for input.
 *
 * Usage
 *   node scripts/characterize-pr5.js                        # write the fixture
 *   node scripts/characterize-pr5.js --check                # compare, never write
 *   node scripts/characterize-pr5.js --check --fixture=<p>  # compare another copy
 *
 * Where --check reads the fixture from
 *   With no --fixture, --check compares against the COMMITTED fixture blob at
 *   HEAD (`git show HEAD:<path>`), not the working tree. This command is a CI
 *   gate, and a gate that reads a file the working tree can edit would agree
 *   with an uncommitted "fix" to itself. A dirty or modified working-tree copy
 *   is therefore ignored, and the output says `HEAD:<path>` so the source is
 *   never ambiguous.
 *
 *   --fixture=<path> is the deliberate exception: it names an explicit copy and
 *   is read from disk.
 *
 *   This command proves the code still reproduces the frozen behaviour. It does
 *   NOT prove the fixture's origin: when and by which commit it was introduced,
 *   and that nothing changed it since, is owned by
 *   scripts/verify-pr2-provenance.js for every manifest batch.
 *
 *   --check never creates, truncates or rewrites a file: a missing fixture is an
 *   error, not an invitation to write one.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(
  REPO_ROOT,
  'packages',
  'recommendation-core',
  'test',
  'fixtures',
  'pr5-characterization.json'
);
const FIXTURE_REL = 'packages/recommendation-core/test/fixtures/pr5-characterization.json';
const COMMAND = 'node scripts/characterize-pr5.js';

// The PRE-MOVE paths: after the extraction these are identity shims, so the
// same numbers must come back - which is exactly what --check proves.
const retention = require('../src/recommendation/retention');
const retainModule = require('../src/recommendation/retention/retain');
const budgetFloorModule = require('../src/recommendation/retention/budget-floor');
const targetsModule = require('../src/recommendation/retention/targets');
const igpuPoolModule = require('../src/recommendation/retention/igpu-pool');

const { retainTopKPerRole } = retainModule;
const { computeBudgetFloor, BUDGET_FLOOR_ROLES } = budgetFloorModule;
const { computeRoleTargets, resolutionMultiplier } = targetsModule;
const { excludedCpuProductIds, GPU_POLICY_VALUES } = igpuPoolModule;

const { CANDIDATE_STATUSES } = require('../src/recommendation/filtering/filter');
const { ROLE_CATEGORIES } = require('../src/recommendation/candidates/roles');
const { priceKey } = require('../src/recommendation/assembly/prices');

// ---------------------------------------------------------------------------
// Literal fixture builders. Every value is supplied here; nothing is derived
// from the clock, the environment, a locale or a database.
// ---------------------------------------------------------------------------

function verdict(role, productId, overrides = {}) {
  const { variantId = null, status = CANDIDATE_STATUSES.PASS, ...rest } = overrides;
  return {
    product_id: productId,
    product_variant_id: variantId,
    category: ROLE_CATEGORIES[role],
    component_role: role,
    status,
    reason: null,
    relationships: {},
    unknown_pairwise_count: 0,
    ...rest,
  };
}

function scoreEntry(role, productId, candidateScore, variantId = null) {
  return {
    product_id: productId,
    product_variant_id: variantId,
    component_role: role,
    candidate_score: candidateScore,
  };
}

function scores(entries) {
  return { scores: entries };
}

function filterResult(entries) {
  return { results: entries };
}

function priceEntry(selectedPrice) {
  return {
    selected_price: selectedPrice,
    currency: 'MAD',
    store_id: 'store-1',
    price_checked_at: '2026-10-02T00:00:00.000Z',
  };
}

function carrier(rows) {
  const out = Object.create(null);
  for (const [role, productId, price, variantId = null] of rows) {
    out[priceKey(productId, variantId, role)] = priceEntry(price);
  }
  return out;
}

/** The uniform base pool: every role one candidate, three CPUs, two GPUs. */
function baseVertices() {
  return [
    verdict('CPU', 'cpu-a'),
    verdict('CPU', 'cpu-b'),
    verdict('CPU', 'cpu-c'),
    verdict('GPU', 'gpu-a'),
    verdict('GPU', 'gpu-b'),
    verdict('MOTHERBOARD', 'mb-a'),
    verdict('MOTHERBOARD', 'mb-b'),
    verdict('RAM', 'ram-a'),
    verdict('PSU', 'psu-a'),
    verdict('CASE', 'case-a'),
    verdict('CPU_COOLER', 'cool-a'),
    verdict('SSD_BOOT', 'ssd-a'),
  ];
}

function baseScores() {
  return [
    scoreEntry('CPU', 'cpu-a', 0.9),
    scoreEntry('CPU', 'cpu-b', 0.8),
    scoreEntry('CPU', 'cpu-c', 0.7),
    scoreEntry('GPU', 'gpu-a', 0.85),
    scoreEntry('GPU', 'gpu-b', 0.75),
    scoreEntry('MOTHERBOARD', 'mb-a', 0.5),
    scoreEntry('MOTHERBOARD', 'mb-b', 0.4),
    scoreEntry('RAM', 'ram-a', 0.6),
    scoreEntry('PSU', 'psu-a', 0.55),
    scoreEntry('CASE', 'case-a', 0.45),
    scoreEntry('CPU_COOLER', 'cool-a', 0.4),
    scoreEntry('SSD_BOOT', 'ssd-a', 0.5),
  ];
}

function basePrices(selectedPrice = 1000) {
  return carrier(baseVertices().map((entry) => [entry.component_role, entry.product_id, selectedPrice]));
}

function baseSources(overrides = {}) {
  return {
    filterResult: filterResult(baseVertices()),
    candidateScores: scores(baseScores()),
    topKPerRole: 2,
    prices: basePrices(),
    ...overrides,
  };
}

/** Eight GPUs, so a K=5 scenario has a bucket that must actually be cut. */
function wideVertices() {
  return [
    verdict('CPU', 'cpu-a'),
    verdict('GPU', 'gpu-1'),
    verdict('GPU', 'gpu-2'),
    verdict('GPU', 'gpu-3'),
    verdict('GPU', 'gpu-4'),
    verdict('GPU', 'gpu-5'),
    verdict('GPU', 'gpu-6'),
    verdict('GPU', 'gpu-7'),
    verdict('GPU', 'gpu-8'),
  ];
}

function wideScores() {
  return [
    scoreEntry('CPU', 'cpu-a', 0.5),
    scoreEntry('GPU', 'gpu-1', 0.9),
    scoreEntry('GPU', 'gpu-2', 0.8),
    scoreEntry('GPU', 'gpu-3', 0.7),
    scoreEntry('GPU', 'gpu-4', 0.6),
    scoreEntry('GPU', 'gpu-5', 0.5),
    scoreEntry('GPU', 'gpu-6', 0.4),
    scoreEntry('GPU', 'gpu-7', 0.3),
    scoreEntry('GPU', 'gpu-8', 0.2),
  ];
}

function wideSources(overrides = {}) {
  return {
    filterResult: filterResult(wideVertices()),
    candidateScores: scores(wideScores()),
    topKPerRole: 5,
    prices: carrier(wideVertices().map((entry) => [entry.component_role, entry.product_id, 1000])),
    ...overrides,
  };
}

const ROLE_PRODUCT_IDS = {
  CPU: 'cpu-a',
  GPU: 'gpu-a',
  MOTHERBOARD: 'mb-a',
  RAM: 'ram-a',
  SSD_BOOT: 'ssd-a',
  SSD_SECONDARY: 'ssd-2-a',
  PSU: 'psu-a',
  CASE: 'case-a',
  CPU_COOLER: 'cool-a',
};

const GAMING_SPEND = {
  CPU: 0.2,
  GPU: 0.35,
  MOTHERBOARD: 0.1,
  RAM: 0.1,
  SSD_BOOT: 0.08,
  PSU: 0.06,
  CASE: 0.06,
  CPU_COOLER: 0.05,
};

function retainedFor(roles) {
  return roles.map((role) => verdict(role, ROLE_PRODUCT_IDS[role]));
}

function pricesFor(retained, priceByRole) {
  return carrier(retained.map((entry) => [entry.component_role, entry.product_id, priceByRole[entry.component_role]]));
}

const FLOOR_PRICES = {
  CPU: 3000,
  MOTHERBOARD: 1500,
  RAM: 800,
  PSU: 600,
  CASE: 500,
  CPU_COOLER: 300,
  SSD_BOOT: 700,
  GPU: 4000,
};

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(error) {
  return {
    ok: false,
    error: {
      name: error && error.name,
      code: error && error.code,
      field: error && error.field,
      message: error && error.message,
    },
  };
}

/**
 * Run one scenario and record its outcome. Only the OUTPUT is recorded: the
 * inputs are summarised by shape, so the fixture stays a record of behaviour
 * rather than six copies of the same pool.
 */
function capture(run) {
  try {
    return { ok: true, output: snapshot(run()) };
  } catch (error) {
    return captureError(error);
  }
}

function idsOf(results) {
  return results.map((entry) =>
    entry.product_variant_id === null ? entry.product_id : entry.product_id + '#' + entry.product_variant_id
  );
}

function retainedProjection(output) {
  return {
    ids: idsOf(output.results),
    entries: output.results.map((entry) => ({
      product_id: entry.product_id,
      product_variant_id: entry.product_variant_id,
      component_role: entry.component_role,
      status: entry.status,
    })),
    container_frozen: Object.isFrozen(output),
    results_frozen: Object.isFrozen(output.results),
    verdicts_frozen: output.results.every((entry) => Object.isFrozen(entry)),
  };
}

function sourcesSummary(sources) {
  if (sources === null || typeof sources !== 'object' || Array.isArray(sources)) {
    return { kind: sources === null ? 'null' : Array.isArray(sources) ? 'array' : typeof sources };
  }
  const shape = (value) => (value === null ? null : typeof value);
  const verdicts = sources.filterResult && Array.isArray(sources.filterResult.results)
    ? sources.filterResult.results.length
    : shape(sources.filterResult);
  const scoreRows = sources.candidateScores && Array.isArray(sources.candidateScores.scores)
    ? sources.candidateScores.scores.length
    : shape(sources.candidateScores);
  const priced = sources.prices && typeof sources.prices === 'object' && !Array.isArray(sources.prices)
    ? Object.keys(sources.prices).length
    : shape(sources.prices);
  return {
    verdicts,
    scores: scoreRows,
    topKPerRole: sources.topKPerRole,
    priced,
    roleTargets: sources.roleTargets === null || sources.roleTargets === undefined
      ? sources.roleTargets === undefined ? 'absent' : null
      : Object.keys(sources.roleTargets),
    roleExclusions: sources.roleExclusions === null || sources.roleExclusions === undefined
      ? sources.roleExclusions === undefined ? 'absent' : null
      : Object.keys(sources.roleExclusions),
    topKByRole: sources.topKByRole === null || sources.topKByRole === undefined
      ? sources.topKByRole === undefined ? 'absent' : null
      : sources.topKByRole,
  };
}

function scenario(id, description, buildSources, project = retainedProjection) {
  let sources;
  try {
    sources = buildSources();
  } catch (error) {
    return { id, description, input: { build_error: error && error.message }, ...captureError(error) };
  }
  return {
    id,
    description,
    input: sourcesSummary(sources),
    ...capture(() => project(retainTopKPerRole(sources))),
  };
}

function gateScenario(id, description, buildSources) {
  return {
    id,
    description,
    input: (() => {
      try {
        return sourcesSummary(buildSources());
      } catch (error) {
        return { build_error: error && error.message };
      }
    })(),
    ...capture(() => retainedProjection(retainTopKPerRole(buildSources()))),
  };
}

// ---------------------------------------------------------------------------
// A. Public API and identity
// ---------------------------------------------------------------------------

function captureBarrel() {
  return {
    keys: Object.keys(retention),
    key_count: Object.keys(retention).length,
    arity: {
      retainTopKPerRole: retention.retainTopKPerRole.length,
      excludedCpuProductIds: retention.excludedCpuProductIds.length,
      computeBudgetFloor: retention.computeBudgetFloor.length,
      computeRoleTargets: retention.computeRoleTargets.length,
      resolutionMultiplier: retention.resolutionMultiplier.length,
    },
    budget_floor_roles: snapshot(retention.BUDGET_FLOOR_ROLES),
    budget_floor_roles_frozen: Object.isFrozen(retention.BUDGET_FLOOR_ROLES),
    resolution_multipliers: snapshot(retention.RESOLUTION_MULTIPLIERS),
    resolution_multipliers_frozen: Object.isFrozen(retention.RESOLUTION_MULTIPLIERS),
    band_tolerance: retention.BAND_TOLERANCE,
    band_ceiling_factor: retention.BAND_CEILING_FACTOR,
    identity: {
      retainTopKPerRole: retention.retainTopKPerRole === retainModule.retainTopKPerRole,
      excludedCpuProductIds: retention.excludedCpuProductIds === igpuPoolModule.excludedCpuProductIds,
      computeBudgetFloor: retention.computeBudgetFloor === budgetFloorModule.computeBudgetFloor,
      BUDGET_FLOOR_ROLES: retention.BUDGET_FLOOR_ROLES === budgetFloorModule.BUDGET_FLOOR_ROLES,
      computeRoleTargets: retention.computeRoleTargets === targetsModule.computeRoleTargets,
      resolutionMultiplier: retention.resolutionMultiplier === targetsModule.resolutionMultiplier,
      RESOLUTION_MULTIPLIERS: retention.RESOLUTION_MULTIPLIERS === targetsModule.RESOLUTION_MULTIPLIERS,
      BAND_TOLERANCE: retention.BAND_TOLERANCE === targetsModule.BAND_TOLERANCE,
      BAND_CEILING_FACTOR: retention.BAND_CEILING_FACTOR === targetsModule.BAND_CEILING_FACTOR,
    },
    gpu_policy_values_is_public: Object.prototype.hasOwnProperty.call(retention, 'GPU_POLICY_VALUES'),
    gpu_policy_values: snapshot(GPU_POLICY_VALUES),
    gpu_policy_values_frozen: Object.isFrozen(GPU_POLICY_VALUES),
  };
}

// ---------------------------------------------------------------------------
// B. Retention selection
// ---------------------------------------------------------------------------

function captureSelection() {
  const scenarios = [];

  scenarios.push(
    scenario(
      'B1-k1-over-subscribed',
      'K=1 with three CPU candidates keeps only the best scorer per role',
      () => baseSources({ topKPerRole: 1 })
    )
  );

  scenarios.push(
    scenario(
      'B2-k3-uniform-prices',
      'K=3 with every bucket at or below K: returned whole, reservation never consulted',
      () => baseSources({ topKPerRole: 3 })
    )
  );

  scenarios.push(
    scenario(
      'B3-k5-wide-bucket',
      'K=5 cuts a bucket of eight GPUs to min(K, eligible_count)',
      () => wideSources()
    )
  );

  const targetPrices = carrier(
    baseVertices().map((entry) => {
      if (entry.component_role === 'CPU') {
        const price = entry.product_id === 'cpu-a' ? 7000 : entry.product_id === 'cpu-b' ? 3000 : 2000;
        return ['CPU', entry.product_id, price];
      }
      return [entry.component_role, entry.product_id, 1000];
    })
  );
  const gamingTargets = () =>
    computeRoleTargets({ spendTargets: GAMING_SPEND, budgetAmount: 15000, resolution: '1440p' });

  scenarios.push(
    scenario(
      'B4-targeted-bands',
      'A declared roleTargets switches the CPU bucket to price-band picks (K=2)',
      () => baseSources({ prices: targetPrices, roleTargets: gamingTargets() })
    )
  );

  scenarios.push(
    scenario(
      'B5-untargeted-null',
      'The same pool with roleTargets null keeps the pre-E2 top-(K-1) plus reservation rule',
      () => baseSources({ prices: targetPrices, roleTargets: null })
    )
  );

  scenarios.push(
    scenario(
      'B6a-exclusions-array',
      'roleExclusions as an array drops cpu-b before ordering and the K cap',
      () => baseSources({ roleExclusions: { CPU: ['cpu-b'] } })
    )
  );

  scenarios.push(
    scenario(
      'B6b-exclusions-set',
      'roleExclusions as a Set drops cpu-b and cpu-c',
      () => baseSources({ roleExclusions: { CPU: new Set(['cpu-b', 'cpu-c']) } })
    )
  );

  scenarios.push(
    scenario(
      'B7a-override-gpu-one',
      'topKByRole { GPU: 1 } caps only the GPU bucket',
      () => baseSources({ topKByRole: { GPU: 1 } })
    )
  );

  scenarios.push(
    scenario(
      'B7b-override-empty-map',
      'topKByRole {} is a no-op',
      () => baseSources({ topKByRole: {} })
    )
  );

  scenarios.push(
    scenario(
      'B7c-override-null',
      'topKByRole null is a no-op',
      () => baseSources({ topKByRole: null })
    )
  );

  const reservationPrices = carrier([
    ...baseVertices()
      .filter((entry) => entry.component_role !== 'CPU')
      .map((entry) => [entry.component_role, entry.product_id, 1000]),
    ['CPU', 'cpu-a', 5000],
    ['CPU', 'cpu-b', 3000],
    ['CPU', 'cpu-c', 2000],
  ]);

  scenarios.push(
    scenario(
      'B8a-reservation-k2',
      'K=2 reserves the cheapest CPU even when it is the lowest scorer',
      () => baseSources({ prices: reservationPrices, topKPerRole: 2 })
    )
  );

  scenarios.push(
    scenario(
      'B8b-reservation-k1',
      'K=1 fills the slot from the reservation alone',
      () => baseSources({ prices: reservationPrices, topKPerRole: 1 })
    )
  );

  const tieVertices = [
    verdict('CPU', 'cpu-a', { variantId: null, status: CANDIDATE_STATUSES.PASS }),
    verdict('CPU', 'cpu-a', { variantId: 'v1', status: CANDIDATE_STATUSES.PASS }),
  ];
  const tieScores = [scoreEntry('CPU', 'cpu-a', 0.8, null), scoreEntry('CPU', 'cpu-a', 0.8, 'v1')];
  const tiePrices = carrier([
    ['CPU', 'cpu-a', 1000, null],
    ['CPU', 'cpu-a', 1000, 'v1'],
  ]);

  scenarios.push(
    scenario(
      'B9-tie-break-null-variant-first',
      'Equal scores fall to the canonical tie-break: variant NULL first',
      () => ({
        filterResult: filterResult(tieVertices),
        candidateScores: scores(tieScores),
        topKPerRole: 1,
        prices: tiePrices,
      })
    )
  );

  const gates = [];
  gates.push(
    gateScenario('B10a-price-entry-missing', 'An over-K bucket with an unpriced candidate fails fast', () =>
      baseSources({
        topKPerRole: 1,
        prices: carrier(
          baseVertices()
            .filter((entry) => entry.product_id !== 'cpu-c')
            .map((entry) => [entry.component_role, entry.product_id, 1000])
        ),
      })
    )
  );
  gates.push(
    gateScenario('B10b-price-null', 'selected_price null is a missing price, never 0', () =>
      baseSources({
        topKPerRole: 1,
        prices: carrier(
          baseVertices().map((entry) => [
            entry.component_role,
            entry.product_id,
            entry.product_id === 'cpu-c' ? null : 1000,
          ])
        ),
      })
    )
  );
  gates.push(
    gateScenario('B10c-price-nan', 'selected_price NaN is not a usable price', () =>
      baseSources({
        topKPerRole: 1,
        prices: carrier(
          baseVertices().map((entry) => [
            entry.component_role,
            entry.product_id,
            entry.product_id === 'cpu-c' ? NaN : 1000,
          ])
        ),
      })
    )
  );

  gates.push(gateScenario('B11a-sources-null', 'null sources is MISSING_REQUIRED_FIELD', () => null));
  gates.push(gateScenario('B11b-sources-array', 'an array sources object is INVALID_INPUT', () => []));
  gates.push(
    gateScenario('B11c-prices-array', 'an array price carrier is INVALID_INPUT', () =>
      baseSources({ prices: [] })
    )
  );
  gates.push(
    gateScenario('B11d-k-zero', 'topKPerRole 0 is INVALID_FIELD_VALUE', () =>
      baseSources({ topKPerRole: 0 })
    )
  );
  gates.push(
    gateScenario('B11e-k-fraction', 'topKPerRole 1.5 is INVALID_FIELD_VALUE', () =>
      baseSources({ topKPerRole: 1.5 })
    )
  );
  gates.push(
    gateScenario('B11f-duplicate-identity', 'duplicate STEP 2 identities are refused', () => {
      const sources = baseSources();
      sources.candidateScores = scores([...baseScores(), scoreEntry('CPU', 'cpu-a', 0.1)]);
      return sources;
    })
  );
  gates.push(
    gateScenario('B11g-eligible-without-score', 'an eligible verdict without a score is refused', () => {
      const sources = baseSources();
      sources.candidateScores = scores(baseScores().filter((entry) => entry.product_id !== 'cpu-c'));
      return sources;
    })
  );
  gates.push(
    gateScenario('B11h-unknown-exclusion-role', 'an exclusion key outside the role vocabulary is refused', () =>
      baseSources({ roleExclusions: { MEMORY: ['ram-a'] } })
    )
  );
  gates.push(
    gateScenario('B11i-exclusion-bad-value', 'a non-array/Set exclusion value is refused', () =>
      baseSources({ roleExclusions: { CPU: 'cpu-a' } })
    )
  );
  gates.push(
    gateScenario('B11j-role-targets-array', 'an array roleTargets holder is refused', () =>
      baseSources({ roleTargets: [] })
    )
  );
  gates.push(
    gateScenario('B11k-override-unknown-role', 'a topKByRole key outside the role vocabulary is refused', () =>
      baseSources({ topKByRole: { MEMORY: 1 } })
    )
  );
  gates.push(
    gateScenario('B11l-override-zero', 'a non-positive topKByRole depth is refused', () =>
      baseSources({ topKByRole: { GPU: 0 } })
    )
  );

  // A bucket that fits K never consults a price: an empty carrier must not fail.
  gates.push(
    gateScenario('B13-lazy-price-read', 'a bucket that fits K never reads the carrier', () => ({
      filterResult: filterResult([verdict('CPU', 'cpu-a')]),
      candidateScores: scores([scoreEntry('CPU', 'cpu-a', 0.5)]),
      topKPerRole: 3,
      prices: Object.create(null),
    }))
  );

  const shape = (() => {
    const output = retainTopKPerRole(baseSources({ topKPerRole: 1 }));
    return {
      container_frozen: Object.isFrozen(output),
      results_frozen: Object.isFrozen(output.results),
      verdicts_frozen: output.results.every((entry) => Object.isFrozen(entry)),
    };
  })();

  const immutability = (() => {
    const sources = baseSources({ topKPerRole: 1 });
    const before = JSON.stringify(sources);
    retainTopKPerRole(sources);
    return { inputs_unchanged: JSON.stringify(sources) === before };
  })();

  const determinism = (() => {
    const first = retainTopKPerRole(baseSources({ topKPerRole: 1 }));
    const second = retainTopKPerRole(baseSources({ topKPerRole: 1 }));
    return { identical_across_runs: JSON.stringify(first) === JSON.stringify(second) };
  })();

  return { scenarios, gates, shape, immutability, determinism };
}

// ---------------------------------------------------------------------------
// C. Budget floor
// ---------------------------------------------------------------------------

function captureBudgetFloor() {
  const scenarios = [];
  const requiredRoles = BUDGET_FLOOR_ROLES;
  const allFloorRoles = [...requiredRoles, 'GPU'];

  const floor = (roles, budgetAmount = 15000, overrides = {}) => {
    const retained = retainedFor(roles);
    return {
      retained,
      prices: pricesFor(retained, overrides.prices || FLOOR_PRICES),
      budgetAmount,
      currency: overrides.currency || 'MAD',
    };
  };

  const project = (output) => ({
    ...snapshot(output),
    cheapest_by_role_keys: Object.keys(output.cheapest_by_role),
    frozen: Object.isFrozen(output),
    missing_roles_frozen: Object.isFrozen(output.missing_roles),
  });

  const add = (id, description, build, projector = project) => {
    let sources;
    try {
      sources = build();
    } catch (error) {
      scenarios.push({ id, description, input: { build_error: error && error.message }, ...captureError(error) });
      return;
    }
    scenarios.push({
      id,
      description,
      input: {
        retained: Array.isArray(sources.retained) ? sources.retained.length : typeof sources.retained,
        budgetAmount: sources.budgetAmount,
        currency: sources.currency,
      },
      ...capture(() => projector(computeBudgetFloor(sources))),
    });
  };

  add('C1-valid', 'A complete retained set at 7400 MAD is within a 15000 budget', () => floor(allFloorRoles));
  add('C2-unaffordable', 'The same floor against 5000 MAD is not within budget', () => floor(allFloorRoles, 5000));
  add('C3-missing-role', 'A missing PSU yields null/null, never 0/true', () =>
    floor(requiredRoles.filter((role) => role !== 'PSU'))
  );
  add('C4-empty', 'An empty retained set reports every required role missing', () => floor([]));
  add(
    'C5-gpu-excluded-from-total',
    'A retained GPU still reports its cheapest price but is excluded from the total',
    () => {
      const retained = [...retainedFor(allFloorRoles), verdict('GPU', 'gpu-b')];
      return {
        retained,
        prices: carrier([
          ...retainedFor(allFloorRoles).map((entry) => [
            entry.component_role,
            entry.product_id,
            FLOOR_PRICES[entry.component_role],
          ]),
          ['GPU', 'gpu-a', 4000],
          ['GPU', 'gpu-b', 9999],
        ]),
        budgetAmount: 15000,
        currency: 'MAD',
      };
    }
  );
  add(
    'C6-input-order-stable',
    'Reversing the retained order yields the identical floor',
    () => {
      const sources = floor(allFloorRoles);
      return { ...sources, retained: [...sources.retained].reverse() };
    }
  );

  const errors = [];
  const addError = (id, description, build, argsHolder) => {
    let sources;
    try {
      sources = build();
    } catch (error) {
      errors.push({ id, description, ...captureError(error) });
      return;
    }
    errors.push({
      id,
      description,
      input: argsHolder
        ? argsHolder(sources)
        : sources === null || typeof sources !== 'object'
          ? { kind: sources === null ? 'null' : typeof sources }
          : { budgetAmount: sources.budgetAmount, currency: sources.currency },
      ...capture(() => computeBudgetFloor(sources)),
    });
  };

  addError('C7a-sources-null', 'null sources is MISSING_REQUIRED_FIELD', () => null);
  addError('C7b-retained-non-array', 'a non-array retained value is INVALID_INPUT', () => ({ ...floor(allFloorRoles), retained: {} }));
  addError('C7c-prices-array', 'an array price carrier is INVALID_INPUT', () => ({ ...floor(allFloorRoles), prices: [] }));
  addError('C7d-budget-zero', 'budgetAmount 0 is INVALID_FIELD_VALUE', () => floor(allFloorRoles, 0));
  addError('C7e-budget-nan', 'budgetAmount NaN is INVALID_FIELD_VALUE', () => floor(allFloorRoles, NaN));
  addError('C7f-currency-lowercase', "currency 'mad' is INVALID_FIELD_VALUE", () => floor(allFloorRoles, 15000, { currency: 'mad' }));
  addError('C7g-price-entry-missing', 'a retained candidate with no carrier entry is refused', () => {
    const sources = floor(allFloorRoles);
    delete sources.prices[priceKey('ssd-a', null, 'SSD_BOOT')];
    return sources;
  });
  addError('C7h-price-infinite', 'an infinite selected_price is not a usable price', () => {
    const sources = floor(allFloorRoles);
    sources.prices[priceKey('ssd-a', null, 'SSD_BOOT')] = priceEntry(Infinity);
    return sources;
  });

  return { scenarios, errors };
}

// ---------------------------------------------------------------------------
// D. Role targets
// ---------------------------------------------------------------------------

function captureTargets() {
  const scenarios = [];
  const errors = [];

  const added = (list, id, description, run) => {
    list.push({ id, description, ...capture(run) });
  };

  added(scenarios, 'D1a-null', 'null resolution is neutral', () => resolutionMultiplier(null));
  added(scenarios, 'D1b-undefined', 'absent resolution is neutral', () => resolutionMultiplier(undefined));
  added(scenarios, 'D1c-1080p', '1080p maps to 1.0', () => resolutionMultiplier('1080p'));
  added(scenarios, 'D1d-1440p', '1440p maps to 1.25', () => resolutionMultiplier('1440p'));
  added(scenarios, 'D1e-2160p', '2160p maps to 1.5', () => resolutionMultiplier('2160p'));

  const project = (output) => ({
    keys: Object.keys(output),
    values: snapshot(output),
    frozen: Object.isFrozen(output),
    entries_frozen: Object.keys(output).every((role) => Object.isFrozen(output[role])),
  });

  const targets = (spendTargets, budgetAmount = 15000, resolution = '1440p') => ({
    spendTargets,
    budgetAmount,
    resolution,
  });

  added(scenarios, 'D2-gaming-1440p', 'The gaming spend map at 15000 and 1440p', () =>
    project(computeRoleTargets(targets(GAMING_SPEND)))
  );
  added(scenarios, 'D3a-gaming-1080p', 'The same map at 1080p', () =>
    project(computeRoleTargets(targets(GAMING_SPEND, 15000, '1080p')))
  );
  added(scenarios, 'D3b-gaming-null-resolution', 'The same map at a null resolution', () =>
    project(computeRoleTargets(targets(GAMING_SPEND, 15000, null)))
  );
  added(scenarios, 'D4-zero-share-emitted', 'A zero share is emitted as {target:0,ceiling:0}', () =>
    project(computeRoleTargets(targets({ CPU: 0, GPU: 0.5 }, 10000)))
  );
  added(scenarios, 'D5-omitted-role-absent', 'A role omitted from spendTargets is absent from the result', () =>
    project(computeRoleTargets(targets({ CPU: 0.25 }, 10000)))
  );

  const addError = (id, description, run) => {
    errors.push({ id, description, ...capture(run) });
  };

  addError('D6a-resolution-unknown', "resolution '8k' is INVALID_FIELD_VALUE", () =>
    computeRoleTargets(targets({ CPU: 0.2 }, 10000, '8k'))
  );
  addError('D6b-spend-empty', 'an empty spendTargets object is INVALID_INPUT', () =>
    computeRoleTargets(targets({}))
  );
  addError('D6c-share-high', 'a share above 1 is INVALID_FIELD_VALUE', () =>
    computeRoleTargets(targets({ CPU: 1.5 }))
  );
  addError('D6d-share-negative', 'a negative share is INVALID_FIELD_VALUE', () =>
    computeRoleTargets(targets({ CPU: -0.1 }))
  );
  addError('D6e-budget-zero', 'budgetAmount 0 is INVALID_FIELD_VALUE', () =>
    computeRoleTargets(targets({ CPU: 0.2 }, 0))
  );
  addError('D6f-sources-null', 'null sources is MISSING_REQUIRED_FIELD', () => computeRoleTargets(null));
  addError('D6g-blank-role', 'a blank spendTargets key is INVALID_FIELD_VALUE', () =>
    computeRoleTargets(targets({ '  ': 0.1 }))
  );

  return { scenarios, errors };
}

// ---------------------------------------------------------------------------
// E. Integrated-GPU pool
// ---------------------------------------------------------------------------

function captureIgpuPool() {
  const scenarios = [];
  const errors = [];

  const context = (candidates, specs) => ({ candidates: { CPU: candidates }, specs });
  const cpu = (productId) => ({ product_id: productId });

  const added = (list, id, description, run) => {
    list.push({ id, description, ...capture(run) });
  };

  added(scenarios, 'E1a-required', 'REQUIRED yields null', () =>
    excludedCpuProductIds({ gpuPolicy: 'REQUIRED', filteringContext: context([cpu('c1')], { 'p:c1': { integrated_gpu_present: true } }) })
  );
  added(scenarios, 'E1b-null-policy', 'A null policy yields null', () =>
    excludedCpuProductIds({ gpuPolicy: null, filteringContext: context([cpu('c1')], {}) })
  );
  added(scenarios, 'E1c-absent-policy', 'An absent policy yields null', () =>
    excludedCpuProductIds({ filteringContext: context([cpu('c1')], {}) })
  );
  added(scenarios, 'E1d-absent-args', 'Absent args yield null', () => excludedCpuProductIds());

  added(scenarios, 'E2-allowed-policy-matrix', 'IGPU_ALLOWED excludes CPUs without a verified iGPU', () =>
    excludedCpuProductIds({
      gpuPolicy: 'IGPU_ALLOWED',
      filteringContext: context(
        [cpu('c1'), cpu('c2'), cpu('c3'), cpu('c4')],
        {
          'p:c1': { integrated_gpu_present: true },
          'p:c2': { integrated_gpu_present: false },
          'p:c4': { integrated_gpu_present: null },
        }
      ),
    })
  );

  added(scenarios, 'E3-normalization-dedupe-sort', 'Numeric ids are stringified, deduped and code-unit sorted', () =>
    excludedCpuProductIds({
      gpuPolicy: 'IGPU_ALLOWED',
      filteringContext: context([cpu(9), cpu('9'), cpu(10)], {
        'p:9': { integrated_gpu_present: false },
        'p:10': { integrated_gpu_present: false },
      }),
    })
  );

  added(scenarios, 'E4-ghost-spec-ignored', 'A spec with no matching candidate changes nothing', () =>
    excludedCpuProductIds({
      gpuPolicy: 'IGPU_ALLOWED',
      filteringContext: context([cpu('c1')], {
        'p:c1': { integrated_gpu_present: true },
        'p:ghost': { integrated_gpu_present: false },
      }),
    })
  );

  added(scenarios, 'E6-shape', 'The result is a frozen array and the context is not mutated', () => {
    const filteringContext = context([cpu('c1'), cpu('c2')], {
      'p:c1': { integrated_gpu_present: true },
      'p:c2': { integrated_gpu_present: false },
    });
    const before = JSON.stringify(filteringContext);
    const excluded = excludedCpuProductIds({ gpuPolicy: 'IGPU_ALLOWED', filteringContext });
    return {
      excluded: snapshot(excluded),
      frozen: Object.isFrozen(excluded),
      context_unchanged: JSON.stringify(filteringContext) === before,
    };
  });

  const addError = (id, description, run) => {
    errors.push({ id, description, ...capture(run) });
  };

  addError('E5a-unknown-policy', "gpuPolicy 'OPTIONAL' is INVALID_FIELD_VALUE", () =>
    excludedCpuProductIds({ gpuPolicy: 'OPTIONAL', filteringContext: context([], {}) })
  );
  addError('E5b-allowed-without-context', 'IGPU_ALLOWED without a context is INVALID_INPUT', () =>
    excludedCpuProductIds({ gpuPolicy: 'IGPU_ALLOWED' })
  );
  addError('E5c-cpu-not-array', 'candidates.CPU that is not an array is INVALID_INPUT', () =>
    excludedCpuProductIds({ gpuPolicy: 'IGPU_ALLOWED', filteringContext: { candidates: { CPU: {} }, specs: {} } })
  );
  addError('E5d-specs-missing', 'a missing specs map is INVALID_INPUT', () =>
    excludedCpuProductIds({ gpuPolicy: 'IGPU_ALLOWED', filteringContext: { candidates: { CPU: [] } } })
  );
  addError('E5e-cpu-without-id', 'a CPU row without product_id is INVALID_FIELD_VALUE', () =>
    excludedCpuProductIds({ gpuPolicy: 'IGPU_ALLOWED', filteringContext: context([{}], {}) })
  );
  addError('E5f-args-not-object', 'a non-object args value is INVALID_INPUT', () => excludedCpuProductIds('nope'));

  return { scenarios, errors };
}

// ---------------------------------------------------------------------------
// F. Pipeline: one retained set flows into the floor
// ---------------------------------------------------------------------------

function capturePipeline() {
  const retained = retainTopKPerRole(baseSources({ topKPerRole: 2 }));
  const floor = computeBudgetFloor({
    retained: retained.results,
    prices: basePrices(),
    budgetAmount: 15000,
    currency: 'MAD',
  });
  return {
    retained: retainedProjection(retained),
    floor: {
      ...snapshot(floor),
      cheapest_by_role_keys: Object.keys(floor.cheapest_by_role),
      frozen: Object.isFrozen(floor),
    },
  };
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

function gitOutput(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function committedFixture(relativePath) {
  try {
    return execFileSync('git', ['show', 'HEAD:' + relativePath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (_error) {
    return null;
  }
}

function buildDocument() {
  return {
    kind: 'pr5-characterization',
    description:
      'Frozen input/output pairs for the step 4B PR 5 extraction surface: the retention barrel contract, ' +
      'retainTopKPerRole selection (K, targets, untargeted, exclusions, overrides, reservation, ties, ' +
      'malformed carriers), computeBudgetFloor, the E2 target map and the E6 iGPU exclusion set. ' +
      'DB-free: every id, score and price is a literal.',
    timestamp_policy:
      'No ambient clock is read while capturing: every id, score and price is an input literal, so the ' +
      'document is byte-stable on its baseline commit. String order is recorded by code unit; nothing ' +
      'here reads a locale.',
    provenance: {
      baseline_sha: gitOutput(['rev-parse', 'HEAD']),
      baseline_commit_date: gitOutput(['log', '-1', '--format=%cI']),
      node_version: process.version,
      command: COMMAND,
      origin:
        'Captured from the PRE-MOVE implementation under src/recommendation/retention/ before any module ' +
        'moved into packages/recommendation-core. The committed document is the baseline: do not ' +
        'regenerate it from the extracted code, because a fixture produced by the implementation under ' +
        'test proves nothing.',
    },
    barrel: captureBarrel(),
    retain: captureSelection(),
    budget_floor: captureBudgetFloor(),
    targets: captureTargets(),
    igpu_pool: captureIgpuPool(),
    pipeline: capturePipeline(),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { check: false, fixture: OUT_FILE, errors: [] };
  for (const arg of argv) {
    if (arg === '--check') {
      options.check = true;
    } else if (arg.startsWith('--fixture=')) {
      const value = arg.slice('--fixture='.length);
      if (value.length === 0) options.errors.push('--fixture= needs a path');
      else options.fixture = path.resolve(process.cwd(), value);
    } else {
      options.errors.push('unknown argument ' + JSON.stringify(arg));
    }
  }
  return options;
}

function displayPath(file) {
  const relative = path.relative(REPO_ROOT, file);
  return (relative.length === 0 ? file : relative).split(path.sep).join('/');
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.errors.length > 0) {
    process.stderr.write('characterize-pr5: ' + options.errors.join('\n  ') + '\n');
    process.stderr.write('usage: ' + COMMAND + ' [--check] [--fixture=<path>]\n');
    return 2;
  }

  const check = options.check;
  const outFile = options.fixture;
  const document = buildDocument();
  const serialized = JSON.stringify(document, null, 2) + '\n';

  if (check) {
    // The provenance block names the PRE-MOVE commit, so it is expected to
    // differ once the extraction is committed. Only the captured behaviour is
    // compared: that is what must not change.
    const fromCommit = outFile === OUT_FILE;
    const source = fromCommit ? 'HEAD:' + FIXTURE_REL : displayPath(outFile);
    let text;
    if (fromCommit) {
      text = committedFixture(FIXTURE_REL);
      if (text === null) {
        process.stderr.write(
          'characterize-pr5: no committed fixture at ' + source +
          '; --check compares the committed baseline and never writes one\n'
        );
        return 1;
      }
    } else {
      if (!fs.existsSync(outFile)) {
        process.stderr.write(
          'characterize-pr5: no fixture at ' + source +
          '; --check compares an existing baseline and never writes one\n'
        );
        return 1;
      }
      text = fs.readFileSync(outFile, 'utf8');
    }
    let existing;
    try {
      existing = JSON.parse(text);
    } catch (err) {
      process.stderr.write('characterize-pr5: ' + source + ' is not valid JSON: ' + err.message + '\n');
      return 1;
    }
    const captured = (doc) => {
      const { provenance: _provenance, ...behaviour } = doc;
      return JSON.stringify(behaviour, null, 2);
    };
    if (captured(existing) !== captured(document)) {
      process.stderr.write(
        'characterize-pr5: the captured behaviour no longer matches the pre-move baseline (' + source + ')\n'
      );
      return 1;
    }
    process.stdout.write(
      'characterize-pr5: OK - the current implementation reproduces the frozen retention behaviour (' +
      source + '). Fixture origin is proven by scripts/verify-pr2-provenance.js, not here.\n'
    );
    return 0;
  }

  fs.writeFileSync(outFile, serialized);
  process.stdout.write(
    'characterize-pr5: wrote ' + displayPath(outFile) + ' (' + serialized.length + ' bytes) at ' +
    document.provenance.baseline_sha + '\n'
  );
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { buildDocument, main };
