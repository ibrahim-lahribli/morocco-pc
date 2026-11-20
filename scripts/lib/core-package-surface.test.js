'use strict';

// scripts/lib/core-package-surface.test.js - the core surface, derived from the
// filesystem instead of the two hand-edited files.
//
// `packages/recommendation-core/src/index.js` and `test/export-surface.json` are
// edited together, so a namespace can be added to one and forgotten in the other.
// These assertions read the package's own tree and metadata: a namespace
// directory that exists but is not published fails, a published namespace with no
// barrel or an empty surface fails, and the snapshot must match the entry.
//
// This gate lives in scripts/lib, not packages/recommendation-core/test, because
// the core-test purity audit forbids node:fs and dynamic require there, and the
// hermetic core copy must never read repo paths.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE_ROOT = path.resolve(__dirname, '../../packages/recommendation-core');
const SRC_ROOT = path.join(CORE_ROOT, 'src');
const SNAPSHOT = path.join(CORE_ROOT, 'test/export-surface.json');

const core = require(CORE_ROOT);

function published() {
  return Object.keys(core).sort();
}

function barrels() {
  return fs.readdirSync(SRC_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(SRC_ROOT, name, 'index.js')))
    .sort();
}

describe('core package surface', () => {
  it('the snapshot matches the package metadata and the entry point', () => {
    const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8'));

    assert.equal(snapshot.package, pkg.name);
    assert.equal(snapshot.entry, pkg.main);
    assert.deepEqual([...snapshot.exports].sort(), published());
  });

  it('every published namespace has a barrel and a non-empty surface', () => {
    for (const name of published()) {
      const file = path.join(SRC_ROOT, name, 'index.js');
      assert.ok(fs.existsSync(file), name + ' is published but src/' + name + '/index.js is missing');
      assert.equal(require(file), core[name],
        name + ' must be the same object the entry point publishes');

      const ns = core[name];
      const loaded = ns !== null && (typeof ns === 'object' || typeof ns === 'function');
      assert.ok(loaded, name + ' must export an object or function, not ' + typeof ns);
      if (typeof ns === 'object') {
        assert.ok(Object.keys(ns).length > 0, name + ' is published but exports nothing');
      }
    }
  });

  it('every src/<dir>/index.js barrel is published by the entry point', () => {
    assert.deepEqual(barrels(), published(),
      'src/<dir>/index.js exists but the namespace is not exported, or vice versa');
  });
});
