'use strict';

// scripts/lib/pool-independence.test.js - the PI-1 verdict rules.
//
// The bug this pins: the gate printed `RESULT: PASS` while comparing 0 builds
// with 0 builds at both pins (measured 2026-11-08 on TEST), so it asserted pool
// independence about an empty measurement. An empty comparison is INCONCLUSIVE
// at exit 0 and must never be PASS; a single drifted build still FAILs at exit 1
// even when another profile was empty.
//
// The second half of the same bug (2026-11-10 review): a run that measured ONE
// profile and assembled nothing in the other printed PASS with a note. Decision
// 23 criterion 3(a) measures GAMING and OFFICE, so a partial run is
// INCONCLUSIVE in BOTH directions - see the two partial tests below.

const test = require('node:test');
const assert = require('node:assert/strict');

const { VERDICTS, EXIT_CODES, classifyProfile, classifyRun } = require('./pool-independence');

test('a comparison with no pre-existing builds is INCONCLUSIVE, never PASS', () => {
  const run = classifyRun([
    { label: 'GAMING', beforeSize: 0, driftCount: 0 },
    { label: 'OFFICE', beforeSize: 0, driftCount: 0 },
  ]);
  assert.equal(run.verdict, VERDICTS.INCONCLUSIVE);
  assert.notEqual(run.verdict, VERDICTS.PASS);
  assert.equal(run.exitCode, 0, 'INCONCLUSIVE exits 0 by repo convention');
  assert.deepEqual(run.inconclusive, ['GAMING', 'OFFICE']);
  assert.deepEqual(run.conclusive, []);
});

test('real builds with no drift is PASS', () => {
  const run = classifyRun([
    { label: 'GAMING', beforeSize: 25, driftCount: 0 },
    { label: 'OFFICE', beforeSize: 20, driftCount: 0 },
  ]);
  assert.equal(run.verdict, VERDICTS.PASS);
  assert.equal(run.exitCode, 0);
  assert.deepEqual(run.inconclusive, []);
});

test('a single drifted build FAILs at exit 1', () => {
  const run = classifyRun([
    { label: 'GAMING', beforeSize: 25, driftCount: 1 },
    { label: 'OFFICE', beforeSize: 20, driftCount: 0 },
  ]);
  assert.equal(run.verdict, VERDICTS.FAIL);
  assert.equal(run.exitCode, 1);
  assert.deepEqual(run.failed, ['GAMING']);
});

test('drift wins over an empty sibling profile', () => {
  const run = classifyRun([
    { label: 'GAMING', beforeSize: 0, driftCount: 0 },
    { label: 'OFFICE', beforeSize: 18, driftCount: 2 },
  ]);
  assert.equal(run.verdict, VERDICTS.FAIL);
  assert.equal(run.exitCode, 1);
  assert.deepEqual(run.inconclusive, ['GAMING']);
});

test('a partial run is INCONCLUSIVE, never PASS: GAMING measured, OFFICE empty', () => {
  const run = classifyRun([
    { label: 'GAMING', beforeSize: 25, driftCount: 0 },
    { label: 'OFFICE', beforeSize: 0, driftCount: 0 },
  ]);
  assert.equal(run.verdict, VERDICTS.INCONCLUSIVE);
  assert.notEqual(run.verdict, VERDICTS.PASS);
  assert.equal(run.exitCode, 0, 'INCONCLUSIVE exits 0 by repo convention');
  assert.deepEqual(run.conclusive, ['GAMING']);
  assert.deepEqual(run.inconclusive, ['OFFICE']);
  assert.deepEqual(run.failed, []);
});

test('a partial run is INCONCLUSIVE, never PASS: OFFICE measured, GAMING empty', () => {
  const run = classifyRun([
    { label: 'GAMING', beforeSize: 0, driftCount: 0 },
    { label: 'OFFICE', beforeSize: 20, driftCount: 0 },
  ]);
  assert.equal(run.verdict, VERDICTS.INCONCLUSIVE);
  assert.equal(run.exitCode, 0);
  assert.deepEqual(run.conclusive, ['OFFICE']);
  assert.deepEqual(run.inconclusive, ['GAMING']);
});

test('no profiles at all is INCONCLUSIVE, not a vacuous pass', () => {
  for (const empty of [[], null, undefined]) {
    const run = classifyRun(empty);
    assert.equal(run.verdict, VERDICTS.INCONCLUSIVE);
    assert.equal(run.exitCode, 0);
  }
});

test('malformed profile input is refused rather than silently classified', () => {
  assert.throws(() => classifyProfile(null), /non-empty label/);
  assert.throws(() => classifyProfile({ label: '', beforeSize: 1, driftCount: 0 }), /non-empty label/);
  assert.throws(() => classifyProfile({ label: 'X', beforeSize: -1, driftCount: 0 }), /invalid beforeSize/);
  assert.throws(() => classifyProfile({ label: 'X', beforeSize: 1.5, driftCount: 0 }), /invalid beforeSize/);
  assert.throws(() => classifyProfile({ label: 'X', beforeSize: 1, driftCount: -2 }), /invalid driftCount/);
});

test('the exit-code table matches the repo INCONCLUSIVE convention', () => {
  assert.equal(EXIT_CODES.PASS, 0);
  assert.equal(EXIT_CODES.INCONCLUSIVE, 0);
  assert.equal(EXIT_CODES.FAIL, 1);
});
