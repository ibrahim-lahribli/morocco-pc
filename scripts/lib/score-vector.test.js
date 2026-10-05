'use strict';

// scripts/lib/score-vector.test.js — tests for the pure score-vector comparator
// used by scripts/verify-pool-independence.js (Decision 23 criterion 3, PI-1).
//
// PI-1 asks a narrow question: after an unrelated product joins the candidate
// pool, must any PRE-EXISTING build's build_score move? New builds appearing is
// explicitly allowed by the decision; a moved or vanished score is drift.
//
// Uses node:test + node:assert/strict only. No database, no filesystem.
// NOT part of `npm run test:unit` (that glob is `src/**/*.test.js`); run with:
//   node --test scripts/lib/score-vector.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { captureScoreVector, scoreVectorDrift } = require('./score-vector');

// Minimal ranked-entry shape, matching what rankBuilds() returns.
function entry(signature, build_score) {
  return { signature, build_score };
}

describe('captureScoreVector', () => {
  it('keys each build by its signature and keeps its score', () => {
    const v = captureScoreVector([entry('a', 60.52), entry('b', 41.1)]);
    assert.equal(v.get('a'), 60.52);
    assert.equal(v.get('b'), 41.1);
    assert.equal(v.size, 2);
  });

  it('is empty for no builds', () => {
    assert.equal(captureScoreVector([]).size, 0);
  });

  it('is empty for null/undefined rather than throwing', () => {
    assert.equal(captureScoreVector(null).size, 0);
    assert.equal(captureScoreVector(undefined).size, 0);
  });

  // Decision 18 makes duplicate signatures a fail-fast error upstream, so a
  // duplicate here would mean rankBuilds was bypassed. Last write would hide
  // that, so refuse instead.
  it('rejects two builds sharing one signature', () => {
    assert.throws(
      () => captureScoreVector([entry('a', 1), entry('a', 2)]),
      /duplicate/i,
    );
  });

  it('rejects a build with no signature', () => {
    assert.throws(() => captureScoreVector([{ build_score: 1 }]), /signature/i);
  });

  it('rejects a non-numeric score rather than storing NaN', () => {
    assert.throws(() => captureScoreVector([entry('a', 'sixty')]), /score/i);
    assert.throws(() => captureScoreVector([entry('a', null)]), /score/i);
    assert.throws(() => captureScoreVector([entry('a', NaN)]), /score/i);
  });
});

describe('scoreVectorDrift', () => {
  it('an unchanged score is not drift', () => {
    const v = new Map([['sig-a', 60.52]]);
    assert.deepEqual(scoreVectorDrift(v, new Map([['sig-a', 60.52]])), []);
  });

  it('a moved score is drift', () => {
    const before = new Map([['sig-a', 60.52]]);
    const after = new Map([['sig-a', 60.5]]);
    assert.deepEqual(scoreVectorDrift(before, after), ['sig-a']);
  });

  // A build that vanished is the strongest possible signal that the pool change
  // reached scoring; the decision calls it out separately from a moved score.
  it('a build that disappears is drift', () => {
    assert.deepEqual(scoreVectorDrift(new Map([['sig-a', 1]]), new Map()), ['sig-a']);
  });

  // Decision 23 step (c): "New builds may appear; existing builds' scores may
  // not move."
  it('a new build only is NOT drift', () => {
    const before = new Map([['sig-a', 1]]);
    const after = new Map([['sig-a', 1], ['sig-b', 9]]);
    assert.deepEqual(scoreVectorDrift(before, after), []);
  });

  it('reports every drifting signature, sorted, not just the first', () => {
    const before = new Map([['sig-c', 1], ['sig-a', 2], ['sig-b', 3]]);
    const after = new Map([['sig-c', 1], ['sig-a', 20], ['sig-b', 30]]);
    assert.deepEqual(scoreVectorDrift(before, after), ['sig-a', 'sig-b']);
  });

  it('reports a mix of moved and vanished signatures', () => {
    const before = new Map([['sig-a', 1], ['sig-b', 2], ['sig-c', 3]]);
    const after = new Map([['sig-a', 99], ['sig-c', 3]]);
    assert.deepEqual(scoreVectorDrift(before, after), ['sig-a', 'sig-b']);
  });

  it('two empty vectors are not drift', () => {
    assert.deepEqual(scoreVectorDrift(new Map(), new Map()), []);
  });

  it('an empty BEFORE vector means nothing was established, so nothing drifted', () => {
    assert.deepEqual(scoreVectorDrift(new Map(), new Map([['sig-a', 1]])), []);
  });
});