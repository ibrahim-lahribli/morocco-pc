'use strict';

// packages/recommendation-runtime/test/assert-discovery.js — the zero-test
// guard in front of the suite.
//
// `node --test "test/*.test.js"` exits 0 when the glob matches nothing (measured
// on Node 24.22.1: "tests 0 ... pass 0" and exit status 0). A gate that passes
// because it discovered no tests is worse than no gate, so the package's `test`
// script runs this file first and fails when a required suite is not on disk —
// the boundary harness, the export surface, and one surface suite per published
// namespace. Later waves add test files; this list is the floor, not the ceiling.
//
// It is not named *.test.js on purpose: it must run BEFORE the runner, not as
// one more test that would also vanish in the same rename.
//
// DB-free and dependency-free: node:fs + node:path only.

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED = [
  'boundary.test.js',
  'composite-lifecycle.test.js',
  'index.test.js',
  'loaders-surface.test.js',
  'namespace-barrels.test.js',
  'orchestrator-index.test.js',
  'persistence-surface.test.js',
  'surface.test.js',
  'transaction-ownership.test.js',
];

const present = fs.readdirSync(__dirname).filter((name) => name.endsWith('.test.js'));
const missing = REQUIRED.filter((name) => !present.includes(name));

if (missing.length > 0) {
  process.stderr.write(
    'recommendation-runtime: the test runner would discover ' +
      present.length +
      ' suite(s); missing ' +
      missing.join(', ') +
      '. Refusing to report a vacuous pass.\n'
  );
  process.exit(1);
}

process.stdout.write('recommendation-runtime: ' + present.length + ' test suite(s) discovered\n');
