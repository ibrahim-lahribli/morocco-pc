'use strict';

// packages/recommendation-core/test/index.test.js — the package loads through
// its declared `main`, exports nothing yet, and the export surface is pinned.
//
// The snapshot (test/export-surface.json) exists so an extraction PR cannot
// grow the public surface by accident: adding an export fails here until the
// snapshot is updated in the same commit, which makes the growth a line in the
// diff a reviewer sees. It also means this suite never has to guess what the
// package "should" export at a given step — the answer is committed.
//
// DB-free and dependency-free: node:test + node:assert only.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../src');
const snapshot = require('./export-surface.json');

const CORE_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(CORE_ROOT, 'src', 'index.js');

describe('recommendation-core entry point', () => {
  it('is loadable through its declared main entry point', () => {
    // `require('..')` goes through package.json `main`, not a hardcoded path:
    // that is the address every future consumer will use.
    assert.equal(require.resolve('..'), ENTRY);
    assert.equal(require('..'), core);
  });

  it('exports an empty object at this step', () => {
    assert.equal(typeof core, 'object');
    assert.notEqual(core, null);
    assert.deepEqual(Object.keys(core), []);
  });

  it('matches the committed export-surface snapshot', () => {
    const actual = Object.keys(core).sort();
    const expected = [...snapshot.exports].sort();
    assert.deepEqual(
      actual,
      expected,
      'the core export surface changed. If the new export is intended, add it to ' +
        'test/export-surface.json in the same commit (and to src/index.js); if it is not, ' +
        'remove it. Actual: ' + JSON.stringify(actual) + ' Committed: ' + JSON.stringify(expected)
    );
  });

  it('keeps the snapshot well formed and pointed at this package', () => {
    assert.equal(snapshot.package, '@morocco-pc/recommendation-core');
    assert.equal(snapshot.entry, 'src/index.js');
    assert.ok(Array.isArray(snapshot.exports), 'snapshot.exports must be an array');
    assert.deepEqual([...new Set(snapshot.exports)], snapshot.exports, 'snapshot must not repeat an export');
    const manifest = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8'));
    assert.equal(manifest.name, snapshot.package);
    assert.equal(manifest.main, snapshot.entry);
  });
});
