'use strict';

// scripts/lib/cleanup-layer4.test.js — the DB-free half of R-14's cleanup gate.
//
// What is pinned here is what an operator relies on BEFORE any row is deleted:
// the dry-run default, the restore-point and --confirm-shared refusals, the
// flags this shared-only script rejects by name, the FK delete order, and the
// rule that a scoped preset is a refusal rather than a silent shelf delete.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEMO_PROFILE_DESCRIPTION,
  LAYER4_TABLES,
  USAGE,
  UsageError,
  scopeParams,
  countsSql,
  residueSql,
  deletePlan,
  parseArgs,
  validateRun,
  residueProblems,
  formatCounts,
} = require('./cleanup-layer4');

const ARGV = ['node', 'scripts/cleanup-layer4.js'];
const RESTORE_POINT = 'br-royal-block-axu8i4a9';

test('the default is a DRY RUN, and it needs no restore point', () => {
  const args = parseArgs(ARGV);
  assert.equal(args.commit, false);
  assert.equal(args.restorePoint, null);
  assert.equal(args.confirmShared, false);
  assert.equal(validateRun(args), null);
});

test('--commit refuses without a restore point of the right shape', () => {
  for (const missing of [null, '', 'short', '<PASTE ID HERE>', 'br-abc 123']) {
    const argv = ARGV.concat(['--commit', '--confirm-shared']);
    if (missing !== null) argv.push('--restore-point=' + missing);
    const args = parseArgs(argv);
    const refusal = validateRun(args);
    assert.ok(refusal, 'a missing or placeholder restore point must refuse');
    assert.match(refusal, /--restore-point=<id>/);
  }
});

test('--commit also refuses without --confirm-shared', () => {
  const args = parseArgs(ARGV.concat(['--commit', '--restore-point=' + RESTORE_POINT]));
  assert.match(validateRun(args), /--confirm-shared/);
});

test('a complete --commit passes validation', () => {
  const args = parseArgs(ARGV.concat([
    '--commit', '--confirm-shared', '--restore-point=' + RESTORE_POINT,
  ]));
  assert.equal(args.commit, true);
  assert.equal(args.confirmShared, true);
  assert.equal(args.restorePoint, RESTORE_POINT);
  assert.equal(validateRun(args), null);
});

test('the two modes are mutually exclusive, never last-wins', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--dry-run', '--commit'])), UsageError);
  assert.throws(() => parseArgs(ARGV.concat(['--commit', '--dry-run'])), UsageError);
  assert.equal(parseArgs(ARGV.concat(['--dry-run'])).commit, false);
});

test('the space form of --restore-point is refused, like the other CLIs', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--restore-point', RESTORE_POINT])), /EQUALS form/);
});

test('flags that would widen the target are refused by name', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--test-db'])), /DATABASE_URL only/);
  assert.throws(() => parseArgs(ARGV.concat(['--target-env=TARGET_DATABASE_URL'])), /DATABASE_URL only/);
  assert.throws(() => parseArgs(ARGV.concat(['--target-env'])), /DATABASE_URL only/);
});

test('an unknown argument and --help both exit through usage', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--nope'])), /unknown argument/);
  assert.throws(() => parseArgs(ARGV.concat(['--help'])), new RegExp('usage: node scripts/cleanup-layer4.js'));
  assert.match(USAGE, /--confirm-shared/);
});

test('the scope is the demo profile shape, encoded as two parameters', () => {
  const [pattern, description] = scopeParams();
  assert.equal(pattern, 'api-%');
  assert.equal(description, DEMO_PROFILE_DESCRIPTION);
  assert.equal(description, 'Created by POST /v1/recommendations');
});

test('the delete order is the FK order, with the profile last', () => {
  const plan = deletePlan({ queryIds: [], resultIds: [], candidateIds: [], profileIds: [] });
  assert.deepEqual(plan.map((step) => step.relation), [
    'recommendation_swap',
    'recommendation_preset',
    'build_rejection',
    'recommendation_result',
    'build_component',
    'build_candidate',
    'recommendation_query',
    'recommendation_profile',
  ]);
  assert.ok(
    plan.findIndex((step) => step.relation === 'recommendation_result')
      < plan.findIndex((step) => step.relation === 'build_candidate'),
    'a result references its candidate, so it must go first'
  );
  assert.ok(
    plan.findIndex((step) => step.relation === 'build_component')
      < plan.findIndex((step) => step.relation === 'build_candidate'),
    'a component references its candidate, so it must go first'
  );
});

test('every statement is parameterized and no id is interpolated', () => {
  const plan = deletePlan({
    queryIds: ['q1'], resultIds: ['r1'], candidateIds: ['c1'], profileIds: ['p1'],
  });
  for (const step of plan) {
    assert.match(step.sql, /\$1/, step.relation + ' must take a bound parameter');
    assert.doesNotMatch(step.sql, /'[0-9a-f]{8}-[0-9a-f]{4}/, step.relation + ' must not inline a uuid');
    assert.doesNotMatch(step.sql, /\$\{/, step.relation + ' must not interpolate a value');
  }
});

test('the profile delete spares a profile another query still references', () => {
  const profileStep = deletePlan({ profileIds: ['p1'] }).find((s) => s.relation === 'recommendation_profile');
  assert.match(profileStep.sql, /NOT EXISTS \(SELECT 1 FROM recommendation_query/);
});

test('the plan passes the ids it was given, as uuid arrays', () => {
  const plan = deletePlan({ queryIds: ['q1'], resultIds: ['r1'], candidateIds: ['c1'], profileIds: ['p1'] });
  const swap = plan.find((s) => s.relation === 'recommendation_swap');
  assert.deepEqual(swap.params, [['r1'], ['c1']]);
  assert.match(swap.sql, /ANY\(\$1::uuid\[\]\)/);
  assert.match(swap.sql, /ANY\(\$2::uuid\[\]\)/);
});

test('the count query and the residue query cover every Layer 4 table', () => {
  const counts = countsSql();
  for (const table of LAYER4_TABLES) {
    assert.match(counts, new RegExp("'" + table + "' AS relation"), table + ' missing from the before/after snapshot');
  }
  const residue = residueSql();
  for (const key of ['profiles', 'queries', 'results', 'candidates', 'components', 'rejections', 'swaps', 'presets']) {
    assert.match(residue, new RegExp('AS ' + key), key + ' missing from the residue check');
  }
});

test('residue is an empty list only when every scoped count is zero', () => {
  const zero = { profiles: 0, queries: 0, results: 0, candidates: 0, components: 0, rejections: 0, swaps: 0, presets: 0 };
  assert.deepEqual(residueProblems(zero), []);
  const dirty = { ...zero, queries: 2, presets: 1 };
  const problems = residueProblems(dirty);
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /queries: 2/);
  assert.match(problems.join('\n'), /presets: 1/);
});

test('the before/after table names every table and both sides', () => {
  const before = Object.fromEntries(LAYER4_TABLES.map((t) => [t, 3]));
  const after = Object.fromEntries(LAYER4_TABLES.map((t) => [t, 0]));
  const table = formatCounts(before, after);
  for (const t of LAYER4_TABLES) assert.match(table, new RegExp(t));
  assert.match(table, /before\s+after/);
  assert.match(table, /recommendation_query\s+3\s+0/);
});
