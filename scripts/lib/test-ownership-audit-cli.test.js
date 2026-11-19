'use strict';

// scripts/lib/test-ownership-audit-cli.test.js - the ownership audit's BASELINE
// SELECTION is evidence, so it is tested rather than assumed.
//
// What is pinned:
//   * the default baseline is the manifest's PR 2 batch baseline, printed in
//     full so a run is reproducible;
//   * --base=<ref> selects another revision explicitly, and the resolved SHA is
//     what the before-counts were read from;
//   * a base that cannot be resolved, is not an ancestor of HEAD, or does not
//     contain a baseline test file FAILS closed - it is never measured as an
//     empty file and never reported as a clean relocation;
//   * moved/stayed rows keep identical test and assertion counts, and split rows
//     keep identical assertion counts, so the audit cannot pass by dropping
//     assertions it used to count.
//
// DB-free, dependency-free, read-only. The audit itself delegates the L2/L3
// claims to scripts/verify-pr2-provenance.js, which the provenance suite covers.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { REPO_ROOT } = require('./extraction-manifest');

const SCRIPT = path.resolve(__dirname, '..', 'audit-pr2-test-ownership.js');
const PR2_BASELINE = 'afccc671dae5abe6df80ad56dfcbc231d7947c7a';

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function tableRows(stdout) {
  const rows = [];
  const pattern = /^\| (moved|stayed|split) \| (.+?) \| (\d+) -> (\d+) \| (\d+) -> (\d+) \|/gm;
  let match;
  while ((match = pattern.exec(stdout)) !== null) {
    rows.push({
      kind: match[1],
      location: match[2],
      testsBefore: Number(match[3]),
      testsAfter: Number(match[4]),
      assertsBefore: Number(match[5]),
      assertsAfter: Number(match[6]),
    });
  }
  return rows;
}

test('the default baseline is the manifest PR 2 batch baseline', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp('^baseline: ' + PR2_BASELINE + '$', 'm'));
  assert.match(result.stdout, /^baseline source: manifest batch step-4b-pr2 \(default\)$/m);
  assert.match(result.stdout, /files: 20 \(moved 11, stayed 5, split 1, added 3\)/);
  assert.match(result.stdout, /audit: PASS/);
});

test('the default baseline is the same commit the L2 fixture was captured at', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  const fixtureSha = JSON.parse(
    require('node:fs').readFileSync(
      path.join(REPO_ROOT, 'packages/recommendation-core/test/fixtures/pr2-characterization.json'),
      'utf8'
    )
  ).provenance.baseline_sha;
  assert.equal(fixtureSha, PR2_BASELINE);
  assert.match(result.stdout, new RegExp('^baseline: ' + fixtureSha + '$', 'm'));
});

test('moved and stayed rows keep their counts, and split rows keep their assertions', () => {
  const result = run(['--base=' + PR2_BASELINE]);
  assert.equal(result.status, 0, result.stderr);

  const rows = tableRows(result.stdout);
  const moved = rows.filter((row) => row.kind === 'moved');
  const stayed = rows.filter((row) => row.kind === 'stayed');
  const split = rows.filter((row) => row.kind === 'split');
  assert.equal(moved.length, 11);
  assert.equal(stayed.length, 5);
  assert.equal(split.length, 1);

  for (const row of [...moved, ...stayed]) {
    assert.equal(row.testsAfter, row.testsBefore, 'test count changed for ' + row.location);
    assert.equal(row.assertsAfter, row.assertsBefore, 'assertion count changed for ' + row.location);
  }
  for (const row of split) {
    assert.equal(row.assertsAfter, row.assertsBefore, 'a split dropped assertions in ' + row.location);
  }

  assert.match(result.stdout, /reconciliation: .*: PASS/);
  assert.match(result.stdout, /nothing is unaccounted for/);
});

test('--base selects another revision explicitly and prints the resolved SHA', () => {
  const explicit = git(['rev-parse', '581ee73']);
  const result = run(['--base=581ee73']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp('^baseline: ' + explicit + '$', 'm'));
  assert.match(result.stdout, /^baseline source: --base=581ee73$/m);
  assert.notEqual(explicit, PR2_BASELINE);
});

test('an unresolvable --base is refused', () => {
  const result = run(['--base=definitely-not-a-commit']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /audit: FAIL/);
  assert.match(result.stderr, /is not a commit in this repository/);
});

test('a --base that cannot contain the baseline inventory fails closed', () => {
  const result = run(['--base=HEAD']);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /has no file at src\/recommendation\/candidates\/candidates\.test\.js, so this row cannot be measured/
  );
});

test('--base without a value is an argument error', () => {
  const result = run(['--base=']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--base= needs a git reference/);
  assert.match(result.stderr, /usage: node scripts\/audit-pr2-test-ownership\.js/);
});

// The PR 2 inventory is defined by the ABSENCE of a batch tag, not by a list of
// the tags to exclude. This is the regression that keeps it that way: a batch
// appended by a future extraction PR (step-4b-pr6) must not become a PR 2 row
// merely because the filter never named it.
test('a batch tag the inventory has never seen cannot leak into PR 2', () => {
  const audit = require(SCRIPT);

  const future = {
    batch: 'step-4b-pr6',
    kind: 'moved',
    baseline: 'src/recommendation/scoring/scoring.test.js',
    current: 'packages/recommendation-core/test/scoring.test.js',
  };

  for (const row of audit.INVENTORIES.pr2) {
    assert.equal(row.batch, undefined, 'PR 2 carries only untagged rows: ' + (row.current || row.baseline));
  }

  const rowsWithFuture = [...audit.INVENTORY, future];
  assert.equal(
    audit.selectInventoryRows(rowsWithFuture, 'pr2').includes(future),
    false,
    'a hypothetical future batch (step-4b-pr6) leaked into PR 2'
  );
  assert.deepEqual(
    audit.selectInventoryRows(rowsWithFuture, 'pr2'),
    audit.INVENTORIES.pr2,
    'a row PR 2 does not own must not change the PR 2 inventory'
  );
  for (const name of Object.keys(audit.INVENTORIES)) {
    assert.deepEqual(
      audit.selectInventoryRows([future], name),
      [],
      'an unknown batch must not be reachable from inventory ' + name
    );
  }
});

test('the audit delegates provenance instead of re-implementing it', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /### Provenance \(delegated to scripts\/verify-pr2-provenance\.js\)/);
  assert.match(result.stdout, /: \*\*PASS\*\*/);
});
