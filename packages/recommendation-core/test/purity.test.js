'use strict';

// packages/recommendation-core/test/purity.test.js — the core package's boundary
// gate (RFC §11.6 "Static boundary").
//
// What it proves:
//   1. every JavaScript source file under packages/recommendation-core/src/ is
//      free of third-party or outward imports, dynamic (unverifiable)
//      specifiers, database clients, SQL (including SQL spanning template
//      interpolations), `.query()` calls, filesystem/HTTP access, `process.env`,
//      clock reads and randomness — however the global object is reached;
//   2. the package declares no dependencies at all;
//   3. the scanner that proves (1) actually reports deliberate violations, and
//      does not report the permitted forms — `new Date(value)` above all.
//
// Point (3) is why the scanner lives in ./purity-scanner.js and is exercised
// against synthetic sources here: proving the gate works must not mean writing
// impurity into the package's real source. Import resolution runs against the
// real filesystem and through `realpath`, so a relative import that leaves
// `src/` — by `..`, by a symbolic link, or by naming an unscanned package area
// such as `test/` — fails even when its text looks local.
//
// The hermetic counterpart (RFC §11.6 "Hermetic run") is ./hermetic-run.js:
// it copies this package outside the repository, proves no node_modules is
// reachable, and runs this suite with NODE_PATH emptied.
//
// DB-free, dependency-free: node:test + node:assert only, no database, no
// environment read.
//   npm run test:core
//   node --test "packages/recommendation-core/test/*.test.js"

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { lex, scanSource, scanFile, listSourceFiles, formatViolation } = require('./purity-scanner');

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

// --- temporary fixtures -----------------------------------------------------

function makeTempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-boundary-'));
  const srcRoot = path.join(root, 'src');
  fs.mkdirSync(srcRoot);
  fs.writeFileSync(path.join(srcRoot, 'index.js'), 'module.exports = {};\n');
  return {
    root,
    srcRoot,
    probe: path.join(srcRoot, 'probe-fixture.js'),
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function makeOutsideTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-outside-'));
  fs.writeFileSync(path.join(root, 'outside.js'), 'module.exports = () => Date.now();\n');
  return {
    root,
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Create a symbolic link, or skip when the platform refuses one (Windows
 * without Developer Mode returns EPERM). The CI runner is Linux, where the
 * assertion always executes; nothing here is skipped to make it pass.
 *
 * On Windows a junction stands in where it can: Node reports it through
 * `lstat().isSymbolicLink()` and resolves it through `realpath`, which is the
 * shape the scanner sees. A junction cannot point at an existing FILE, so the
 * file-link case is the one that still skips locally.
 */
function trySymlink(t, target, linkPath, type) {
  const attempts = [{ target, type }];
  if (process.platform === 'win32' && (type === 'dir' || !fs.existsSync(target))) {
    attempts.push({ target, type: 'junction' });
  }
  let lastError = null;
  for (const attempt of attempts) {
    try {
      fs.symlinkSync(attempt.target, linkPath, attempt.type);
      return true;
    } catch (err) {
      lastError = err;
      if (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'ENOTSUP' && err.code !== 'EUNKNOWN') {
        throw err;
      }
    }
  }
  t.skip('symbolic links are not permitted on this platform (' + (lastError && lastError.code) + ')');
  return false;
}

function scanIn(temp, source) {
  return scanSource(source, { file: temp.probe, coreRoot: temp.root });
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
    // A real outside file, not a path into this checkout: the assertion is the
    // same (escaping imports are reported, with a line), but the fixture works
    // in the isolated copy too, which RFC §11.6 requires.
    const tree = makeTempTree();
    const outside = makeOutsideTree();
    try {
      const specifier = path
        .relative(path.dirname(tree.probe), path.join(outside.root, 'outside.js'))
        .split(path.sep)
        .join('/');
      const violations = scanIn(tree, "const outside = require('" + specifier + "');");
      const violation = violations.find((item) => item.rule === 'import-outside-package');
      assert.ok(violation, 'expected an escaping import to be reported, got ' + JSON.stringify(violations));
      assert.ok(violation.detail.includes('outside.js'), violation.detail);
      assert.equal(typeof violation.line, 'number');
    } finally {
      tree.dispose();
      outside.dispose();
    }
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

// --- A. a specifier must be statically verifiable ---------------------------

describe('purity scanner: an import specifier must be statically verifiable', () => {
  it('reports require(moduleName)', () => {
    const violation = assertReports('const mod = require(moduleName);', 'dynamic-import', 'statically verifiable');
    assert.equal(typeof violation.line, 'number');
  });

  it('reports import(moduleName)', () => {
    assertReports('const mod = await import(moduleName);', 'dynamic-import', 'statically verifiable');
  });

  it('reports a call result as the specifier', () => {
    assertReports('const mod = require(getModuleName());', 'dynamic-import');
  });

  it('reports a concatenated specifier', () => {
    assertReports('const mod = require(prefix + moduleName);', 'dynamic-import');
    assertReports('const mod = await import(prefix + moduleName);', 'dynamic-import');
  });

  it('reports optional-chaining call forms', () => {
    assertReports('const mod = require?.(moduleName);', 'dynamic-import');
    assertReports("const mod = require?.('pg');", 'non-relative-import', 'database');
  });

  it('reports an interpolated template specifier', () => {
    assertReports('const mod = require(`./${name}`);', 'dynamic-import');
  });

  it('reports a global-object import escape', () => {
    assertReports('const mod = globalThis.require(moduleName);', 'global-import');
    assertReports("globalThis['require']('pg');", 'global-import');
  });

  it('names the file and the line in the rendered message', () => {
    const found = scanSource('const a = 1;\nconst mod = require(name);\n', {
      file: PROBE_FILE,
      coreRoot: CORE_ROOT,
    });
    assert.equal(found.length, 1);
    const rendered = formatViolation(found[0]);
    assert.ok(rendered.includes('probe-fixture.js'), rendered);
    assert.ok(rendered.includes(':2'), rendered);
    assert.ok(rendered.includes('statically verifiable'), rendered);
  });

  it('still permits statically known relative specifiers', () => {
    assertClean("const mod = require('./index');", 'require literal');
    assertClean("const mod = await import('./index.js');", 'import literal');
    assertClean('const mod = require(`./index`);', 'template with no interpolation');
  });
});

// --- B. symbolic links cannot escape src/ -----------------------------------

describe('purity scanner: symbolic links cannot escape src/', () => {
  it('rejects a symlinked file inside src/ that points outside the source root', (t) => {
    const tree = makeTempTree();
    const outside = makeOutsideTree();
    try {
      if (!trySymlink(t, path.join(outside.root, 'outside.js'), path.join(tree.srcRoot, 'linked.js'), 'file')) return;
      const violations = scanIn(tree, "const mod = require('./linked');");
      const match = violations.find((violation) => violation.rule === 'import-outside-package');
      assert.ok(match, 'expected a symlink escape to be reported, got ' + JSON.stringify(violations));
      assert.ok(match.detail.includes('src/'), match.detail);
    } finally {
      tree.dispose();
      outside.dispose();
    }
  });

  it('rejects a symlinked directory inside src/ that points outside the source root', (t) => {
    const tree = makeTempTree();
    const outside = makeOutsideTree();
    try {
      if (!trySymlink(t, outside.root, path.join(tree.srcRoot, 'vendor'), 'dir')) return;
      const violations = scanIn(tree, "const mod = require('./vendor/outside');");
      const match = violations.find((violation) => violation.rule === 'import-outside-package');
      assert.ok(match, 'expected a symlinked directory escape to be reported, got ' + JSON.stringify(violations));
    } finally {
      tree.dispose();
      outside.dispose();
    }
  });

  it('rejects a broken symlink instead of treating it as safe', (t) => {
    const tree = makeTempTree();
    const outside = makeOutsideTree();
    try {
      if (!trySymlink(t, path.join(outside.root, 'missing.js'), path.join(tree.srcRoot, 'broken.js'), 'file')) return;
      const violations = scanIn(tree, "const mod = require('./broken');");
      const match = violations.find((violation) => violation.rule === 'unresolved-import');
      assert.ok(match, 'expected a broken symlink to be reported, got ' + JSON.stringify(violations));
      assert.match(match.detail, /symbolic link/);
    } finally {
      tree.dispose();
      outside.dispose();
    }
  });

  it('permits an ordinary relative import inside src/', () => {
    const tree = makeTempTree();
    try {
      fs.writeFileSync(path.join(tree.srcRoot, 'util.js'), 'module.exports = 1;\n');
      assert.deepEqual(scanIn(tree, "const util = require('./util');"), []);
    } finally {
      tree.dispose();
    }
  });

  it('does not treat a symlinked external file as core source', (t) => {
    const tree = makeTempTree();
    const outside = makeOutsideTree();
    try {
      if (!trySymlink(t, path.join(outside.root, 'outside.js'), path.join(tree.srcRoot, 'linked.js'), 'file')) return;
      const files = listSourceFiles(tree.srcRoot);
      assert.ok(
        files.includes(path.join(tree.srcRoot, 'linked.js')),
        'the symlinked source file was skipped instead of scanned: ' + JSON.stringify(files)
      );
      const violations = scanFile(path.join(tree.srcRoot, 'linked.js'), tree.root);
      assert.ok(
        violations.some((violation) => violation.rule === 'source-file-outside-root'),
        'a symlinked external file must not be treated as core source: ' + JSON.stringify(violations)
      );
    } finally {
      tree.dispose();
      outside.dispose();
    }
  });
});

// --- C. regex literals inside template interpolations -----------------------

describe('purity scanner: regex literals are not structural braces', () => {
  it('detects a forbidden access after a brace inside a regex', () => {
    assertReports('const q = `${/}/.test(value) ? process.env.API_URL : "safe"}`;', 'process-env');
  });

  it('handles a regex character class containing a brace', () => {
    assertReports('const q = `${/[}]/.test(value) ? process.env.API_URL : "safe"}`;', 'process-env');
  });

  it('handles escaped slashes and braces in a regex', () => {
    assertReports('const q = `${/a\\/b\\}/.test(value) ? process.env.API_URL : "safe"}`;', 'process-env');
  });

  it('lexes a regex literal as one token', () => {
    const tokens = lex('const r = /}/;');
    const regex = tokens.find((token) => token.type === 'regex');
    assert.ok(regex, JSON.stringify(tokens));
    assert.equal(regex.value, '/}/');
  });

  it('lexes a character-class brace as regex content', () => {
    const tokens = lex('const r = /[}]/;');
    const regex = tokens.find((token) => token.type === 'regex');
    assert.ok(regex, JSON.stringify(tokens));
    assert.equal(regex.value, '/[}]/');
  });

  it('keeps division a division', () => {
    const tokens = lex('const x = (a + b) / 2 / c;');
    assert.equal(tokens.filter((token) => token.type === 'regex').length, 0);
    assert.equal(tokens.filter((token) => token.type === 'punct' && token.value === '/').length, 2);
  });

  it('does not report a forbidden name that is regex text', () => {
    assertClean('const pattern = /Date\\.now\\(\\)/;', 'regex text');
  });

  it('handles nested template literals', () => {
    assertReports('const q = `outer ${`inner ${process.env.HOME}`}`;', 'process-env');
  });

  it('does not end an interpolation at a brace inside a nested regex', () => {
    assertClean('const q = `${/[}]/.test(value)}`;', 'regex-only interpolation');
  });
});

// --- D. forbidden APIs through a global object ------------------------------

describe('purity scanner: forbidden APIs reached through a global object', () => {
  it('reports globalThis.fetch(...)', () => {
    assertReports("globalThis.fetch('https://example.test');", 'http-call');
  });

  it('reports window.fetch(...) and window.crypto', () => {
    assertReports("window.fetch('https://example.test');", 'http-call');
    assertReports('const id = window.crypto.randomUUID();', 'crypto');
  });

  it('reports globalThis.Date.now()', () => {
    assertReports('const at = globalThis.Date.now();', 'clock-read');
  });

  it('reports globalThis.Math.random()', () => {
    assertReports('const pick = globalThis.Math.random();', 'randomness');
  });

  it('reports globalThis.process.env', () => {
    assertReports('const url = globalThis.process.env.API_URL;', 'process-env');
  });

  it('reports computed global access', () => {
    assertReports("globalThis['fetch']('https://example.test');", 'http-call');
    assertReports("const url = globalThis['process']['env'].API_URL;", 'process-env');
  });

  it('permits new Date(value) through the global object', () => {
    assertClean('const at = new globalThis.Date(value).toISOString();', 'globalThis.Date(value)');
  });

  it('still rejects the zero-argument construction through the global object', () => {
    assertReports('const at = new globalThis.Date();', 'clock-read', 'no argument');
  });

  it('does not flag property names or unrelated roots', () => {
    assertClean('const stats = { fetch: 1, window: 2, crypto: 3 };', 'property keys');
    assertClean('const handle = config.fetch;', 'non-call member read');
    assertClean('const nested = registry.window.fetch;', 'unknown root');
  });
});

// --- E. package files outside src/ are not core source ----------------------

describe('purity scanner: package files outside src/ are not core source', () => {
  it('rejects a source file importing a test helper inside the package', () => {
    const violation = assertReports(
      "const helper = require('../test/purity-scanner');",
      'import-outside-package',
      'test/purity-scanner.js'
    );
    assert.ok(violation.detail.includes('src/'), violation.detail);
  });

  it('rejects importing the package manifest', () => {
    assertReports("const manifest = require('../package.json');", 'import-outside-package', 'package.json');
  });

  it('still permits a relative import from src/ to src/', () => {
    assertClean("const core = require('./index');", 'in-src import');
  });
});

// --- F. SQL in interpolated template literals -------------------------------

describe('purity scanner: SQL spanning template interpolations', () => {
  it('reports SELECT ... FROM with an interpolated projection', () => {
    assertReports('const sql = `SELECT ${columns} FROM products`;', 'sql-string');
  });

  it('reports INSERT INTO with interpolated column and value lists', () => {
    assertReports('const sql = `INSERT INTO products (${columns}) VALUES (${values})`;', 'sql-string');
  });

  it('reports UPDATE ... SET with an interpolated predicate', () => {
    assertReports('const sql = `update products set price = ${price} where id = ${id}`;', 'sql-string');
  });

  it('keeps .query() detection', () => {
    assertReports("client.query('SELECT 1');", 'sql-call');
  });

  it('does not flag harmless template strings', () => {
    assertClean('const label = `${role} of ${total}`;', 'no SQL words');
    assertClean('const note = `Update ${count} builds`;', 'update as prose');
    assertClean('const note = `choose from ${options.length} candidates`;', 'from as prose');
  });
});
