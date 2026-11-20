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
const MANIFEST = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8'));

// The RFC §11.4 subpaths, approved for this package (A2). "./package.json" is
// the one addition: `exports` would otherwise hide the manifest from any
// consumer that reads it.
const APPROVED_SUBPATHS = [
  '.',
  './assembly',
  './candidates',
  './compatibility',
  './errors',
  './explanation',
  './filtering',
  './offers',
  './package.json',
  './ranking',
  './retention',
  './scoring',
];

describe('recommendation-core entry point', () => {
  it('is loadable through its declared main entry point', () => {
    // `require('..')` goes through package.json `main`, not a hardcoded path:
    // that is the address every future consumer will use.
    assert.equal(require.resolve('..'), ENTRY);
    assert.equal(require('..'), core);
  });

  it('exports the extracted namespaces as objects', () => {
    // Step 4B PR 1 shipped an empty surface on purpose; PR 2 added three
    // namespaces whose modules moved, PR 3 added Engine 3 assembly, PR 4
    // added Engine 5a ranking, PR 5 added Engine 2D retention, PR 6 added
    // Engine 4 scoring and PR 7 added Engine 6 explanation plus offers/as-of.
    // This asserts
    // the SHAPE (every export is a namespace object); the snapshot test below
    // asserts the exact committed list, so growth is still a deliberate,
    // reviewable edit.
    assert.equal(typeof core, 'object');
    assert.notEqual(core, null);
    assert.deepEqual(Object.keys(core).sort(), ['assembly', 'candidates', 'compatibility', 'explanation', 'filtering', 'offers', 'ranking', 'retention', 'scoring']);
    for (const name of Object.keys(core)) {
      assert.equal(typeof core[name], 'object', name + ' must be a namespace object');
      assert.notEqual(core[name], null);
    }
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
    assert.equal(MANIFEST.name, snapshot.package);
    assert.equal(MANIFEST.main, snapshot.entry);
  });
});

// The subpaths that must name a module, as static relative specifiers: the
// purity scanner only accepts a specifier it can verify as a file under src/,
// so these are literals and never built. "./package.json" is handled apart -
// it is a file, not a module, and it deliberately sits outside src/.
const APPROVED_TARGETS = {
  '.': '../src/index.js',
  './assembly': '../src/assembly/index.js',
  './candidates': '../src/candidates/index.js',
  './compatibility': '../src/compatibility/index.js',
  './errors': '../src/candidates/errors.js',
  './explanation': '../src/explanation/index.js',
  './filtering': '../src/filtering/index.js',
  './offers': '../src/offers/as-of.js',
  './ranking': '../src/ranking/index.js',
  './retention': '../src/retention/index.js',
  './scoring': '../src/scoring/index.js',
};

describe('recommendation-core exports map', () => {
  it('declares exactly the approved subpaths', () => {
    assert.deepEqual(Object.keys(MANIFEST.exports).sort(), [...APPROVED_SUBPATHS].sort());
    for (const [subpath, target] of Object.entries(MANIFEST.exports)) {
      assert.equal(typeof target, 'string', subpath + ' must map to one static target, not a condition');
      assert.ok(target.startsWith('./'), subpath + ' must use a relative "./" target');
    }
  });

  it('points "." at the same file as main', () => {
    // `main` stays for path requires (require('..'), the Docker image, the
    // hermetic copy); "." is the same file for bare-specifier consumers.
    assert.equal(path.resolve(CORE_ROOT, MANIFEST.exports['.']), path.resolve(CORE_ROOT, MANIFEST.main));
    assert.equal(require.resolve('../src/index.js'), ENTRY);
  });

  it('maps every module subpath to its statically resolved file', () => {
    for (const [subpath, specifier] of Object.entries(APPROVED_TARGETS)) {
      const resolved = require.resolve(specifier);
      assert.ok(
        resolved.startsWith(CORE_ROOT + path.sep),
        subpath + ' must stay inside the package, got ' + resolved
      );
      const relative = path.relative(CORE_ROOT, resolved).split(path.sep).join('/');
      assert.equal(MANIFEST.exports[subpath], './' + relative, subpath + ' must name the file it resolves to');
    }
    assert.equal(MANIFEST.exports['./package.json'], './package.json');
    assert.ok(fs.existsSync(path.join(CORE_ROOT, 'package.json')));
  });

  it('publishes ./offers as the as-of module itself, with no core offers barrel', () => {
    assert.equal(core.offers, require('../src/offers/as-of'), 'the root namespace and ./offers must be the same object');
    assert.equal(fs.existsSync(path.join(CORE_ROOT, 'src', 'offers', 'index.js')), false);
  });

  it('./errors exposes exactly the error contract', () => {
    const errors = require('../src/candidates/errors');
    assert.deepEqual(Object.keys(errors).sort(), ['CandidateSelectionError', 'ERROR_CODES']);
    assert.equal(errors.ERROR_CODES, core.candidates.ERROR_CODES);
    assert.equal(errors.CandidateSelectionError, core.candidates.CandidateSelectionError);
  });
});
