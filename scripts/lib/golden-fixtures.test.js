'use strict';

// scripts/lib/golden-fixtures.test.js — shape gate for the frozen golden pairs.
//
// test/golden/fixtures/<ID>.json is the exact input computeFromLoaded receives
// (Decision 17.3's pure seam); test/golden/expected/<ID>.json is what the live
// run produced for every stage behind that seam. Both were captured on the TEST
// branch at the manifest's `as_of` with `launch-v2@2.5.0`, each scenario twice,
// and every field that differed between the two captures was removed (only
// `query_id`, which is pinned to "<ID>"). See test/golden/CHANGELOG.md.
//
// This file checks SHAPE only — that the pairs exist, pair up, and carry the
// keys the replay needs. The behavioural assertion is
// src/recommendation/orchestrator/compute.golden.test.js.
//
// DB-free and dependency-free: node:test + node:assert only.
//   node --test scripts/lib/golden-fixtures.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SUITE_FILE = path.join(REPO_ROOT, 'test', 'golden', 'scenarios.json');
const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'golden', 'fixtures');
const EXPECTED_DIR = path.join(REPO_ROOT, 'test', 'golden', 'expected');

// Amendment 4: the pair set has a hard size ceiling, so a re-capture that
// silently doubles the fixtures fails here instead of in review.
const SIZE_CAP_BYTES = 10 * 1024 * 1024;

const FIXTURE_KEYS = [
  'meta',
  'query',
  'scoringModel',
  'candidatePoolResult',
  'filteringContext',
  'filterResult',
  'assessments',
  'nowMs',
];

const EXPECTED_KEYS = [
  'derived',
  'excluded_cpu_ids',
  'retention',
  'budget_floor',
  'assembly',
  'build_scores',
  'build_contributions',
  'result',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function idsIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

const suite = readJson(SUITE_FILE);
const manifestIds = suite.scenarios.map((scenario) => scenario.id).sort();
const fixtureIds = idsIn(FIXTURE_DIR);
const expectedIds = idsIn(EXPECTED_DIR);

function bytesIn(dir) {
  return fs.readdirSync(dir).reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
}

describe('golden fixtures: the pair set', () => {
  it('has exactly the manifest scenarios, no more and no fewer', () => {
    assert.deepEqual(fixtureIds, manifestIds);
    assert.deepEqual(expectedIds, manifestIds);
  });

  it('pairs every fixture with exactly one expected file', () => {
    assert.deepEqual(fixtureIds, expectedIds);
  });

  it('stays inside the 10 MiB cap', () => {
    const total = bytesIn(FIXTURE_DIR) + bytesIn(EXPECTED_DIR);
    assert.ok(
      total <= SIZE_CAP_BYTES,
      'the committed pair set is ' + total + ' bytes, over the ' + SIZE_CAP_BYTES + '-byte cap'
    );
  });
});

describe('golden fixtures: the fixture is the computeFromLoaded input', () => {
  for (const id of fixtureIds) {
    it(id + ' carries exactly the replay keys', () => {
      const fixture = readJson(path.join(FIXTURE_DIR, id + '.json'));
      assert.deepEqual(Object.keys(fixture).sort(), FIXTURE_KEYS.slice().sort());
      assert.equal(fixture.meta.scenario_id, id, 'meta.scenario_id must name its own file');
      assert.equal(fixture.meta.as_of, suite.as_of, 'every fixture is captured at the manifest as_of');
      assert.equal(typeof fixture.nowMs, 'number', 'the frozen clock is an epoch-milliseconds number');
      assert.ok(Array.isArray(fixture.candidatePoolResult.pool), 'the Stage 1 carrier carries a pool');
      assert.ok(fixture.candidatePoolResult.prices !== null, 'the Stage 1 carrier carries its prices');
      assert.ok(Array.isArray(fixture.filterResult.results), 'the filter result carries its verdicts');
      assert.equal(typeof fixture.assessments, 'object');
    });
  }

  it('S01b sits strictly below the S01 budget floor', () => {
    const s01 = readJson(path.join(FIXTURE_DIR, 'S01.json'));
    const s01b = readJson(path.join(FIXTURE_DIR, 'S01b.json'));
    assert.ok(
      s01b.meta.budget_resolved < s01.meta.budget_resolved,
      'S01b is the sub-floor rung and must resolve below S01'
    );
  });
});

describe('golden fixtures: the expected file is every stage output', () => {
  for (const id of expectedIds) {
    it(id + ' carries exactly the stage keys', () => {
      const expected = readJson(path.join(EXPECTED_DIR, id + '.json'));
      assert.deepEqual(Object.keys(expected).sort(), EXPECTED_KEYS.slice().sort());
      for (const key of ['gpu_policy', 'role_targets', 'vram_floor_gb', 'archetype_objectives']) {
        assert.ok(Object.prototype.hasOwnProperty.call(expected.derived, key),
          'derived must carry ' + key);
      }
      assert.ok(Array.isArray(expected.retention.results), 'retention results are frozen');
      assert.ok(Array.isArray(expected.assembly.builds), 'assembly builds are frozen');
      assert.ok(Array.isArray(expected.build_scores.scores), 'build scores are aligned with builds');
      assert.ok(Array.isArray(expected.build_contributions.contributions));
      assert.ok(expected.result !== null && typeof expected.result === 'object', 'the pass result is frozen');
      assert.equal(expected.result.query_id, '<ID>', 'the query id is the capture placeholder');
    });
  }

  it('the frozen builds agree with the frozen scores in length', () => {
    for (const id of expectedIds) {
      const expected = readJson(path.join(EXPECTED_DIR, id + '.json'));
      assert.equal(expected.build_scores.scores.length, expected.assembly.builds.length,
        id + ': build scores must stay index-aligned with the builds');
      assert.equal(expected.build_contributions.contributions.length, expected.assembly.builds.length,
        id + ': contributions must stay index-aligned with the builds');
      assert.equal(expected.result.builds.length, expected.assembly.builds.length,
        id + ': the pass result must carry the same builds');
    }
  });
});
