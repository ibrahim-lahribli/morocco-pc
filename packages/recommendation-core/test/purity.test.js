'use strict';

// packages/recommendation-core/test/purity.test.js — the core package's boundary
// gate (RFC §11.6 "Static boundary").
//
// What it proves:
//   1. every JavaScript source file under packages/recommendation-core/src/ is
//      free of third-party or outward imports, database clients, SQL,
//      `.query()` calls, filesystem/HTTP access, `process.env`, clock reads and
//      randomness;
//   2. the package declares no dependencies at all;
//   3. the scanner that proves (1) actually reports deliberate violations, and
//      does not report the permitted forms — `new Date(value)` above all.
//
// Point (3) is why the scanner lives in ./purity-scanner.js and is exercised
// against synthetic sources here: proving the gate works must not mean writing
// impurity into the package's real source. The gate is still approximate (see
// the limitation list in the scanner header); import resolution runs against
// the real filesystem, so a relative import that leaves the package fails even
// when its text looks local.
//
// DB-free, dependency-free: node:test + node:assert only, no database, no
// environment read.
//   npm run test:core
//   node --test "packages/recommendation-core/test/*.test.js"

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scanSource, scanFile, listSourceFiles } = require('./purity-scanner');

const CORE_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(CORE_ROOT, 'src');
// A path that looks like a source file inside the package, used as the
// resolution base for synthetic sources. It never has to exist.
const PROBE_FILE = path.join(SRC_ROOT, 'probe-fixture.js');

function scan(source) {
  return scanSource(source, { file: PROBE_FILE, coreRoot: CORE_ROOT });
}

function assertClean(source, label) {
  const violations = scan(source);
  assert.deepEqual(
    violations,
    [],
    'expected no violations from ' + (label || 'fixture') + ', got ' + JSON.stringify(violations)
  );
}

function assertReports(source, expectedRule, haystack) {
  const found = scan(source);
  const match = found.find((violation) => violation.rule === expectedRule);
  assert.ok(
    match,
    'expected rule ' + expectedRule + ', got ' + JSON.stringify(found)
  );
  if (haystack) {
    assert.ok(
      match.detail.includes(haystack),
      'expected detail to mention ' + haystack + ', got ' + match.detail
    );
  }
  return match;
}

// --- the package's own source ----------------------------------------------

describe('recommendation-core source boundary', () => {
  const files = listSourceFiles(SRC_ROOT);

  it('finds the source tree (a rename to another extension must not pass silently)', () => {
    assert.ok(files.length > 0, 'no JavaScript source file found under ' + SRC_ROOT);
    assert.ok(
      files.includes(path.join(SRC_ROOT, 'index.js')),
      'src/index.js is the declared main entry point and must be scanned'
    );
  });

  it('every source file is pure', () => {
    const violations = files.flatMap((file) => (scanFile(file, CORE_ROOT) || []).map((item) => item));
    const rendered = violations.map(
      (violation) =>
        path.relative(CORE_ROOT, violation.file) +
        (violation.line === null ? '' : ':' + violation.line) +
        ' ' + violation.rule + ' — ' + violation.detail
    );
    assert.deepEqual(rendered, [], 'core impurity:\n  ' + rendered.join('\n  '));
  });

  it('declares no dependencies of any kind', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const value = manifest[field];
      assert.ok(
        value === undefined || Object.keys(value).length === 0,
        'packages/recommendation-core/package.json must not declare ' + field
      );
    }
    assert.equal(manifest.main, 'src/index.js');
  });
});

// --- the scanner's own contract --------------------------------------------

describe('purity scanner: representative violations are caught', () => {
  it('reports require("pg") as a database module', () => {
    assertReports("const { Pool } = require('pg');", 'non-relative-import', 'database');
  });

  it('reports require("fs") as a filesystem module', () => {
    assertReports("const fs = require('fs');", 'non-relative-import', 'filesystem');
  });

  it('reports node:-prefixed builtins and other third-party packages', () => {
    assertReports("const crypto = require('node:crypto');", 'non-relative-import', 'crypto');
    assertReports("const got = require('lodash');", 'non-relative-import', 'third-party');
  });

  it('reports an ESM import of a bare package', () => {
    assertReports("import pkg from 'dotenv';", 'non-relative-import', 'environment');
  });

  it('reports a relative import that resolves outside the package', () => {
    const violation = assertReports(
      "const server = require('../../../apps/api/src/server');",
      'import-outside-package',
      'apps/api/src/server.js'
    );
    assert.equal(typeof violation.line, 'number');
  });

  it('reports a relative import that does not resolve at all', () => {
    assertReports("const missing = require('./does-not-exist');", 'unresolved-import');
  });

  it('reports .query()', () => {
    assertReports("client.query('SELECT 1');", 'sql-call');
    assertReports("db?.query('SELECT 1');", 'sql-call');
  });

  it('reports a SQL string literal', () => {
    assertReports("const sql = 'SELECT id FROM products WHERE id = $1';", 'sql-string');
    assertReports("const sql = `INSERT INTO offers (id) VALUES ($1)`;", 'sql-string');
  });

  it('reports process.env', () => {
    assertReports('const url = process.env.DATABASE_URL;', 'process-env');
    assertReports('const url = process?.env?.DATABASE_URL;', 'process-env');
  });

  it('reports process.env inside a template interpolation', () => {
    assertReports('const q = `prefix ${process.env.HOME} suffix`;', 'process-env');
  });

  it('reports Date.now()', () => {
    assertReports('const at = Date.now();', 'clock-read');
  });

  it('reports a zero-argument new Date()', () => {
    assertReports('const at = new Date();', 'clock-read', 'no argument');
    assertReports('const at = new Date(/* now */);', 'clock-read', 'no argument');
  });

  it('reports a bare `new Date` with no argument list', () => {
    assertReports('const at = new Date;', 'clock-read');
  });

  it('reports Math.random()', () => {
    assertReports('const pick = Math.random();', 'randomness');
  });

  it('reports crypto', () => {
    assertReports('const id = crypto.randomUUID();', 'crypto');
    assertReports('const id = globalThis.crypto.randomUUID();', 'crypto');
  });

  it('reports a fetch call', () => {
    assertReports("const res = await fetch('https://example.test');", 'http-call');
  });

  it('reports database connection parameters and connection strings', () => {
    assertReports('const connectionString = source;', 'db-connection-param');
    assertReports("const url = 'postgresql://user@host/db';", 'db-connection-param');
    assertReports("const host = 'ep-cool-1234.us-east-2.aws.neon.tech';", 'db-connection-param');
  });
});

describe('purity scanner: legitimate code stays clean', () => {
  it('permits new Date(value) — caller-supplied time', () => {
    assertClean('const at = new Date(row.created_at).toISOString();', 'new Date(value)');
    assertClean('const at = new Date(entry.timestamp);', 'new Date(member)');
    assertClean('const at = new Date(Date.parse(value));', 'new Date(Date.parse(value))');
    assertClean('const at = new Date(0);', 'new Date(0)');
  });

  it('permits a relative import that resolves inside the package', () => {
    assertClean("const core = require('./index');", 'in-package require');
    assertClean("import core from './index.js';", 'in-package import');
  });

  it('is not misled by comments', () => {
    assertClean(
      [
        '// process.env.DATABASE_URL, db.query() and Date.now() are forbidden here.',
        '/* Math.random(), crypto.randomUUID(), new Date() and require(\'pg\') too. */',
        'module.exports = {};',
      ].join('\n'),
      'comments'
    );
  });

  it('is not misled by string literals', () => {
    assertClean(
      [
        "const note = 'never call process.env or db.query() or Date.now() from core';",
        "const label = 'Math.random() and new Date() are banned';",
        'module.exports = { note, label };',
      ].join('\n'),
      'string literals'
    );
  });

  it('is not misled by an object property named query or crypto', () => {
    assertClean('const shape = { query: 1, crypto: 2 };', 'property keys');
    assertClean('const q = shape.query;', 'non-call member read');
  });

  it('reports violations with their line', () => {
    const found = scan(['const a = 1;', 'const b = Date.now();'].join('\n'));
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'clock-read');
    assert.equal(found[0].line, 2);
  });

  it('keeps comments and strings out of the reported lines', () => {
    const found = scan(['// Date.now() in a comment', 'const at = new Date();'].join('\n'));
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
  });

  it('reports the expected rule set on a mixed source, and no others', () => {
    const known = new Set([
      'non-relative-import',
      'unresolved-import',
      'import-outside-package',
      'sql-call',
      'sql-string',
      'process-env',
      'clock-read',
      'randomness',
      'crypto',
      'http-call',
      'db-connection-param',
    ]);
    const found = scan(
      [
        "const pg = require('pg');",
        "const fs = require('fs');",
        "const q = db.query('SELECT 1');",
        'const url = process.env.DATABASE_URL;',
        'const at = Date.now();',
        'const empty = new Date();',
        'const r = Math.random();',
        'const id = crypto.randomUUID();',
        "const res = fetch('https://example.test');",
      ].join('\n')
    );
    for (const violation of found) {
      assert.ok(known.has(violation.rule), 'unexpected rule ' + violation.rule);
    }
    assert.deepEqual(
      [...new Set(found.map((violation) => violation.rule))].sort(),
      [
        'clock-read',
        'crypto',
        'db-connection-param',
        'http-call',
        'non-relative-import',
        'process-env',
        'randomness',
        'sql-call',
        'sql-string',
      ],
      'a rule stopped firing (or a new one appeared) on the mixed fixture'
    );
  });
});
