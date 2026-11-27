'use strict';

// packages/recommendation-runtime/test/index.test.js — the package loads
// through its declared `main`, publishes the RFC §11.5 namespaces, declares the
// approved `exports` map, and the export surface is pinned.
//
// The snapshot (test/export-surface.json) exists so an extraction batch cannot
// grow the public surface by accident: adding an export fails here until the
// snapshot is updated in the same commit, which makes the growth a line in the
// diff a reviewer sees. It also means this suite never has to guess what the
// package "should" export at a given wave — the answer is committed.
//
// The `exports` map is checked the way core checks its own (§11.4 precedent):
// compared as a WHOLE against the approved table, so a missing, additional or
// retargeted subpath fails and `./package.json` is rejected by name even though
// its file exists. Containment is filesystem-real — every target is realpath'd
// and must stay inside the package — so a symlink cannot smuggle one outside.
// This suite resolves those targets by RELATIVE path; the proof that a real
// consumer reaches them through Node's resolver lives in
// scripts/lib/runtime-package-exports.test.js, because package-surface
// validation belongs to repository tooling, not to the package's DB-free suite.
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

// RFC §11.5, approved as written by decision A2. This table is the approved
// contract: adding, removing or retargeting a subpath is an RFC amendment, not
// a test edit.
const APPROVED_SUBPATHS = {
  '.': './src/index.js',
  './loaders': './src/loaders/index.js',
  './orchestrator': './src/orchestrator/index.js',
  './persistence': './src/persistence/index.js',
};

const MANIFEST = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));

describe('recommendation-runtime entry point', () => {
  it('is loadable through its declared main entry point', () => {
    // `require('..')` goes through package.json `main`, not a hardcoded path:
    // that is the address every consumer (today the old-path shims) will use.
    assert.equal(require.resolve('..'), ENTRY);
    assert.equal(require('..'), runtime);
  });

  it('exports the approved namespaces as objects', () => {
    // The SHAPE: every export is a namespace object. The snapshot test below
    // asserts the exact committed list, so growth is still a deliberate,
    // reviewable edit; each namespace's members are pinned by its own suite.
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
    assert.equal(MANIFEST.name, snapshot.package);
    assert.equal(MANIFEST.main, snapshot.entry);
  });
});

describe('recommendation-runtime declared exports map', () => {
  it('declares exactly the RFC §11.5 subpaths, retargeted nowhere', () => {
    assert.deepEqual(
      Object.keys(MANIFEST.exports).sort(),
      Object.keys(APPROVED_SUBPATHS).sort(),
      'the exports map must be exactly the approved subpaths: a missing or additional one is an RFC amendment'
    );
    for (const [subpath, target] of Object.entries(APPROVED_SUBPATHS)) {
      assert.equal(MANIFEST.exports[subpath], target, subpath + ' must map to ' + target);
    }
  });

  it('publishes no ./package.json and no deep src path', () => {
    // `./package.json` is the convenience export core deliberately removed; a
    // deep path would make an implementation file a public contract.
    assert.equal(Object.prototype.hasOwnProperty.call(MANIFEST.exports, './package.json'), false);
    for (const [subpath, target] of Object.entries(MANIFEST.exports)) {
      assert.equal(subpath.startsWith('./src/'), false, subpath + ' exposes the implementation tree');
      assert.equal(typeof target, 'string');
      assert.equal(target.startsWith('./src/'), true, subpath + ' must target a file under ./src/');
    }
  });

  it('keeps `main` equal to the root subpath target', () => {
    // Path requires (`require('..')`, the Docker image, the hermetic copy)
    // bypass `exports`; `main` must name the same file or the two disagree.
    assert.equal('./' + MANIFEST.main, APPROVED_SUBPATHS['.']);
  });

  it('targets files that exist and stay inside the package', () => {
    const realRoot = fs.realpathSync(PACKAGE_ROOT);
    for (const [subpath, target] of Object.entries(APPROVED_SUBPATHS)) {
      const resolved = path.resolve(PACKAGE_ROOT, target);
      assert.ok(fs.existsSync(resolved), subpath + ' target does not exist: ' + target);
      const real = fs.realpathSync(resolved);
      assert.ok(
        real === realRoot || real.startsWith(realRoot + path.sep),
        subpath + ' escapes the package: ' + real
      );
    }
  });

  it('resolves each namespace subpath to the SAME object the root publishes', () => {
    // Identity, not equality of members: a copy would pass a deepEqual and
    // still break `require(...).loaders === require(.../loaders)`.
    const SUBPATH_TO_NAMESPACE = {
      './loaders': 'loaders',
      './orchestrator': 'orchestrator',
      './persistence': 'persistence',
    };
    for (const [subpath, name] of Object.entries(SUBPATH_TO_NAMESPACE)) {
      const loaded = require(path.resolve(PACKAGE_ROOT, APPROVED_SUBPATHS[subpath]));
      assert.equal(loaded, runtime[name], subpath + ' is not the ' + name + ' namespace object');
    }
    assert.equal(require(path.resolve(PACKAGE_ROOT, APPROVED_SUBPATHS['.'])), runtime);
  });
});
