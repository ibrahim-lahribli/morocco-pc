'use strict';

// ---------------------------------------------------------------------------
// Retention price targets (E2): pure-module contract tests.
//
// Scope: the resolution multiplier table, the null-is-neutral rule, the
// GPU-only resolution scaling, ceiling derivation, role omission, freezing and
// fail-fast input gates. Pure functions only -- no DB, no migrations.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RESOLUTION_MULTIPLIERS,
  BAND_TOLERANCE,
  BAND_CEILING_FACTOR,
  resolutionMultiplier,
  computeRoleTargets,
} = require('./targets');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const GAMING_SPEND = Object.freeze({
  CPU: 0.17, GPU: 0.38, MOTHERBOARD: 0.10,
  RAM: 0.07, SSD_BOOT: 0.07, PSU: 0.07,
  CASE: 0.07, CPU_COOLER: 0.04,
});

function rejectionOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Published constants
// ---------------------------------------------------------------------------

test('the resolution multiplier table and band constants are frozen code constants (Decision 39)', () => {
  assert.ok(Object.isFrozen(RESOLUTION_MULTIPLIERS));
  assert.deepEqual([...Object.keys(RESOLUTION_MULTIPLIERS)], ['1080p', '1440p', '2160p']);
  assert.equal(BAND_TOLERANCE, 0.15);
  assert.equal(BAND_CEILING_FACTOR, 2.0);
});

// ---------------------------------------------------------------------------
// resolutionMultiplier
// ---------------------------------------------------------------------------

test('resolutionMultiplier maps 1080p/1440p/2160p and treats null as neutral', () => {
  assert.equal(resolutionMultiplier('1080p'), 1.0);
  assert.equal(resolutionMultiplier('1440p'), 1.25);
  assert.equal(resolutionMultiplier('2160p'), 1.5);
  assert.equal(resolutionMultiplier(null), 1.0);
  assert.equal(resolutionMultiplier(undefined), 1.0);
});

test('resolutionMultiplier fails closed on an unknown resolution', () => {
  for (const bad of ['4k', '1440P', '', ' 1080p ', 42, {}]) {
    const error = rejectionOf(() => resolutionMultiplier(bad));
    assert.ok(error instanceof CandidateSelectionError, JSON.stringify(bad));
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE, JSON.stringify(bad));
    assert.equal(error.field, 'resolution', JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------------------
// computeRoleTargets
// ---------------------------------------------------------------------------

test('computeRoleTargets scales GPU by resolution but leaves other roles unmultiplied', () => {
  const targets = computeRoleTargets({
    spendTargets: GAMING_SPEND,
    budgetAmount: 20000,
    resolution: '2160p',
  });
  // CPU is resolution-blind: share x budget with NO multiplier applied.
  assert.equal(targets.CPU.target, 0.17 * 20000);
  // GPU carries the 1.5x on top of share x budget.
  assert.equal(targets.GPU.target, 0.38 * 20000 * 1.5);
  assert.ok(Math.abs(targets.GPU.target / (0.38 * 20000) - 1.5) < 1e-12);
});

test('computeRoleTargets resolves a null resolution to a neutral GPU target', () => {
  const targets = computeRoleTargets({
    spendTargets: GAMING_SPEND,
    budgetAmount: 20000,
    resolution: null,
  });
  assert.equal(targets.GPU.target, 0.38 * 20000 * 1.0);
});

test('computeRoleTargets derives ceiling as BAND_CEILING_FACTOR x target', () => {
  const targets = computeRoleTargets({
    spendTargets: GAMING_SPEND,
    budgetAmount: 10000,
    resolution: '1080p',
  });
  for (const role of Object.keys(targets)) {
    assert.equal(targets[role].ceiling, targets[role].target * BAND_CEILING_FACTOR, role);
  }
});

test('computeRoleTargets omits roles not declared in spendTargets', () => {
  const targets = computeRoleTargets({
    spendTargets: { CPU: 0.2, GPU: 0.4 },
    budgetAmount: 10000,
    resolution: '1080p',
  });
  assert.deepEqual(Object.keys(targets).sort(), ['CPU', 'GPU']);
  assert.ok(!('CASE' in targets));
});

test('computeRoleTargets is pure and returns a frozen map', () => {
  const spend = { CPU: 0.2, GPU: 0.4 };
  const snapshot = JSON.parse(JSON.stringify(spend));
  const targets = computeRoleTargets({ spendTargets: spend, budgetAmount: 10000, resolution: null });

  assert.ok(Object.isFrozen(targets));
  assert.ok(Object.isFrozen(targets.CPU));
  assert.throws(() => { targets.CPU.target = 1; }, TypeError);
  assert.deepEqual(spend, snapshot, 'the caller\'s spendTargets must not be mutated');
  assert.equal(Object.isFrozen(spend), false);
});

test('computeRoleTargets fails fast on a bad budget, an empty map or a bad share', () => {
  const badBudget = rejectionOf(() => computeRoleTargets({
    spendTargets: { CPU: 0.2 }, budgetAmount: 0, resolution: null,
  }));
  assert.equal(badBudget.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(badBudget.field, 'budgetAmount');

  const nanBudget = rejectionOf(() => computeRoleTargets({
    spendTargets: { CPU: 0.2 }, budgetAmount: NaN, resolution: null,
  }));
  assert.equal(nanBudget.field, 'budgetAmount');

  const empty = rejectionOf(() => computeRoleTargets({
    spendTargets: {}, budgetAmount: 10000, resolution: null,
  }));
  assert.equal(empty.code, ERROR_CODES.INVALID_INPUT);
  assert.equal(empty.field, 'spendTargets');

  for (const bad of [-0.1, 1.5, '0.2', null]) {
    const error = rejectionOf(() => computeRoleTargets({
      spendTargets: { GPU: bad }, budgetAmount: 10000, resolution: null,
    }));
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE, JSON.stringify(bad));
    assert.equal(error.field, 'spendTargets.GPU', JSON.stringify(bad));
  }

  const noSources = rejectionOf(() => computeRoleTargets());
  assert.equal(noSources.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
});

test('targets.js keeps its source boundary (pure, no DB, no upward imports)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'targets.js'), 'utf8');
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(required, ['../candidates/errors']);
  for (const token of ["require('pg')", 'new Pool', 'Date.now', 'Math.random', "require('../assembly", "require('../orchestrator"]) {
    assert.ok(!source.includes(token), `targets.js must not contain ${token}`);
  }
});
