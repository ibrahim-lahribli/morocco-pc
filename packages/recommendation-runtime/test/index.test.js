'use strict';

// packages/recommendation-runtime/test/index.test.js — the package loads
// through its declared `main`, exports nothing yet, and the export surface is
// pinned.
//
// The snapshot (test/export-surface.json) exists so an extraction batch cannot
// grow the public surface by accident: adding an export fails here until the
// snapshot is updated in the same commit, which makes the growth a line in the
// diff a reviewer sees. It also means this suite never has to guess what the
// package "should" export at a given wave — the answer is committed.
//
// DB-free and dependency-free: node:test + node:assert only.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtime = require('../src');
const snapshot = require('./export-surface.json');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(PACKAGE_ROOT, 'src', 'index.js');

describe('recommendation-runtime entry point', () => {
  it('is loadable through its declared main entry point', () => {
    // `require('..')` goes through package.json `main`, not a hardcoded path:
    // that is the address every consumer (today the old-path shims) will use.
    assert.equal(require.resolve('..'), ENTRY);
    assert.equal(require('..'), runtime);
  });

  it('exports the extracted namespaces as objects', () => {
    // Step 5 W0 ships an empty surface on purpose; W1 adds loaders, W2 adds
    // persistence and W3 adds orchestrator. This asserts the SHAPE (every
    // export is a namespace object); the snapshot test below asserts the exact
    // committed list, so growth is still a deliberate, reviewable edit.
    assert.equal(typeof runtime, 'object');
    assert.notEqual(runtime, null);
    for (const name of Object.keys(runtime)) {
      assert.equal(typeof runtime[name], 'object', name + ' must be a namespace object');
      assert.notEqual(runtime[name], null);
    }
  });

  it('matches the committed export-surface snapshot', () => {
    const actual = Object.keys(runtime).sort();
    const expected = [...snapshot.exports].sort();
    assert.deepEqual(
      actual,
      expected,
      'the runtime export surface changed. If the new export is intended, add it to ' +
        'test/export-surface.json in the same commit (and to src/index.js); if it is not, ' +
        'remove it. Actual: ' + JSON.stringify(actual) + ' Committed: ' + JSON.stringify(expected)
    );
  });

  it('keeps the snapshot well formed and pointed at this package', () => {
    assert.equal(snapshot.package, '@morocco-pc/recommendation-runtime');
    assert.equal(snapshot.entry, 'src/index.js');
    assert.ok(Array.isArray(snapshot.exports), 'snapshot.exports must be an array');
    assert.deepEqual([...new Set(snapshot.exports)], snapshot.exports, 'snapshot must not repeat an export');
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    assert.equal(manifest.name, snapshot.package);
    assert.equal(manifest.main, snapshot.entry);
  });
});
