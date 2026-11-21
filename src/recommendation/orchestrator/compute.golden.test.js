'use strict';

// compute.golden.test.js — the assemble-and-score seam must reproduce, exactly,
// what the live engine produced when the fixtures were frozen.
//
// test/golden/fixtures/<ID>.json is the input half of a capture taken on the
// TEST branch at the manifest's `as_of` with `launch-v2@2.5.0`;
// test/golden/expected/<ID>.json is every stage output behind this seam. Each
// scenario was captured TWICE and only the field that actually differed was
// stripped, so a mismatch here is a behaviour change, not clock drift.
//
// Numbers are compared at 6 decimal places (the plan's stability rule). The
// FIXTURES hold exact values - nothing was rounded on the way in, because a
// rounded price or weight can change a tie-break and therefore a rank.
//
// Retention is asserted through the namespace seam (compute calls
// retention.retainTopKPerRole through the namespace, deliberately), because the
// pass result does not carry that intermediate.
//
// DB-free, environment-free, network-free: the fixture is the whole world.
//   npm run test:unit

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const compute = require('./compute');
const retention = require('../retention');

const GOLDEN_DIR = path.resolve(__dirname, '..', '..', '..', 'test', 'golden');
const FIXTURE_DIR = path.join(GOLDEN_DIR, 'fixtures');
const EXPECTED_DIR = path.join(GOLDEN_DIR, 'expected');

const DECIMAL_PLACES = 6;

/** Compare at the stated precision without touching the fixtures. */
function roundDeep(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(DECIMAL_PLACES)) : value;
  }
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = roundDeep(value[key]);
    return out;
  }
  return value;
}

/**
 * JSON cannot carry a prototype, so the two things the fixture cannot express
 * are restored here — mechanically, and only those two:
 *
 *   1. `candidatePoolResult.prices` is a NULL-PROTOTYPE carrier in the live run
 *      (assembly/prices.js refuses anything else). Rehydrating it is not a
 *      relaxation: the entries are untouched and the validator still runs.
 *   2. nothing else. Every other captured object is a plain object in the live
 *      run too, so a blanket Object.create(null) would be a different bug.
 *
 * This is the amendment-3 fidelity seam: a capture that had lost a value (a
 * dropped `price_checked_at`, a stringified Date) would fail here, loudly.
 */
function rehydrate(fixture) {
  const live = fixture.candidatePoolResult.prices;
  const prices = Object.create(null);
  for (const key of Object.keys(live)) prices[key] = live[key];
  fixture.candidatePoolResult.prices = prices;
  return fixture;
}

function readJson(dir, id) {
  return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
}

function readFixture(id) {
  return rehydrate(readJson(FIXTURE_DIR, id));
}

const scenarioIds = fs.readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort();

/** Run the seam with retention's result captured through the documented seam. */
function runWithRetention(fixture) {
  const original = retention.retainTopKPerRole;
  let retained = null;
  retention.retainTopKPerRole = function capture(...args) {
    retained = original.apply(retention, args);
    return retained;
  };
  try {
    const result = compute.computeFromLoaded(fixture);
    return { result, retained };
  } finally {
    retention.retainTopKPerRole = original;
  }
}

/** The four derivations the pass result does not carry as separate fields. */
function deriveFrom(fixture) {
  const configuration = fixture.scoringModel.configuration;
  return {
    gpu_policy: compute.resolveGpuPolicy(configuration, fixture.query),
    role_targets: compute.resolveRoleTargets(configuration, fixture.query),
    vram_floor_gb: compute.resolveVramFloorGb(configuration, fixture.query),
    archetype_objectives: compute.resolveArchetypeObjectives(configuration, fixture.query),
  };
}

describe('compute.golden: every frozen scenario replays to its captured output', () => {
  it('covers the whole manifest', () => {
    assert.ok(scenarioIds.length > 0, 'the fixture set must not be empty');
    const suite = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'scenarios.json'), 'utf8'));
    assert.deepEqual(
      scenarioIds,
      suite.scenarios.map((scenario) => scenario.id).sort(),
      'every manifest scenario needs a fixture'
    );
  });

  for (const id of scenarioIds) {
    it(id + ' reproduces its frozen stage outputs', () => {
      const fixture = readFixture(id);
      const expected = readJson(EXPECTED_DIR, id);

      // The derived policy inputs the live run used.
      const derived = deriveFrom(fixture);
      assert.deepEqual(roundDeep(derived), roundDeep(expected.derived),
        id + ': the derived gpu_policy / role_targets / vram_floor_gb / archetype_objectives moved');

      const { result, retained } = runWithRetention(fixture);

      // E6: the same policy reaches retention and Engine 3.
      assert.deepEqual(
        roundDeep(retention.excludedCpuProductIds({
          gpuPolicy: derived.gpu_policy,
          filteringContext: fixture.filteringContext,
        })),
        roundDeep(expected.excluded_cpu_ids),
        id + ': the IGPU_ALLOWED CPU exclusion set moved'
      );

      // Decision 12/14 retention, captured through the namespace seam.
      assert.deepEqual(roundDeep(retained), roundDeep(expected.retention),
        id + ': retention moved');

      // Decision 27 diagnostic.
      assert.deepEqual(roundDeep(result.budget_floor), roundDeep(expected.budget_floor),
        id + ': budget_floor moved');

      // Engine 3, build for build, in discovery order.
      const engineBuilds = result.builds.map((build) => {
        const copy = Object.assign({}, build);
        delete copy.build_score;
        return copy;
      });
      assert.deepEqual(roundDeep(engineBuilds), roundDeep(expected.assembly.builds),
        id + ': Engine 3 assembly moved');

      // Engine 4 STEP 3, index-aligned with the builds.
      assert.deepEqual(
        roundDeep(result.builds.map((build) => build.build_score)),
        roundDeep(expected.build_scores.scores.map((score) => score.build_score)),
        id + ': build_score moved'
      );
      assert.deepEqual(roundDeep({ contributions: result.build_contributions }), roundDeep(expected.build_contributions),
        id + ': build score contributions moved');

      // The whole frozen pass result, which is what persistence consumes.
      assert.deepEqual(roundDeep(result), roundDeep(expected.result),
        id + ': the pass result moved');
    });

    it(id + ' is deterministic across two runs of the same fixture', () => {
      const fixture = readFixture(id);
      const first = compute.computeFromLoaded(fixture);
      const second = compute.computeFromLoaded(fixture);
      assert.deepEqual(second, first, id + ': the seam is not deterministic');
    });
  }
});
