'use strict';

// packages/recommendation-runtime/test/boundary.test.js — the runtime package's
// boundary gate (RFC §11.5/§11.6, the counterpart of the core's purity gate).
//
// What it proves:
//   1. every JavaScript source file under packages/recommendation-runtime/src/
//      imports only its own src/, the core package ROOT and node:crypto — no
//      `pg`, no `dotenv`, no deep path into core, no barrel cycle;
//   2. no source file creates or owns a connection (`new Pool`, `new Client`,
//      `pool.connect()`, `.release()`) and none performs network I/O;
//   3. no source file reads `process.env` or carries a database connection
//      string, and only `new Date(value)` is permitted as a clock read;
//   4. SQL, `.query()` and `node:crypto` are permitted — they are the runtime's
//      job — and the package declares no dependencies at all;
//   5. the scanner that proves (1)-(3) actually fires, and does not fire on
//      comments, strings, SQL or caller-supplied time.
//
// Point (5) is why the scanner lives in ./boundary-scanner.js and is exercised
// against synthetic sources here: proving the gate works must not mean putting
// violations into the package's own source.
//
// DB-free and dependency-free: node:test + node:assert only.
//   npm test                       (from the package)
//   npm run test:runtime           (from the repo root, wired by Agent 1)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { lex, scanSource, scanFile, listSourceFiles, formatViolation } = require('./boundary-scanner');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(PACKAGE_ROOT, 'src');
const CORE_ROOT = path.resolve(PACKAGE_ROOT, '..', 'recommendation-core');
// Real-looking sibling paths inside src/, used as resolution bases. They do
// not have to exist.
const PROBE = path.join(SRC_ROOT, 'probe-fixture.js');
const LOADER_PROBE = path.join(SRC_ROOT, 'loaders', 'probe-fixture.js');

function scan(source, file) {
  return scanSource(source, { file: file === undefined ? PROBE : file, packageRoot: PACKAGE_ROOT, coreRoot: CORE_ROOT });
}

function assertClean(source, label, file) {
  const violations = scan(source, file);
  assert.deepEqual(
    violations,
    [],
    'expected no violations from ' + (label || 'fixture') + ', got ' + JSON.stringify(violations)
  );
}

function assertReports(source, expectedRule, haystack, file) {
  const found = scan(source, file);
  const match = found.find((violation) => violation.rule === expectedRule);
  assert.ok(match, 'expected rule ' + expectedRule + ', got ' + JSON.stringify(found));
  if (haystack) {
    assert.ok(
      match.detail.includes(haystack),
      'expected detail to mention ' + haystack + ', got ' + match.detail
    );
  }
  return match;
}

function makeTempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-boundary-'));
  const srcRoot = path.join(root, 'src');
  fs.mkdirSync(srcRoot);
  fs.writeFileSync(path.join(srcRoot, 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(srcRoot, 'util.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'outside.js'), 'module.exports = 2;\n');
  return {
    root,
    srcRoot,
    probe: path.join(srcRoot, 'probe-fixture.js'),
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function scanIn(temp, source) {
  return scanSource(source, { file: temp.probe, packageRoot: temp.root, coreRoot: CORE_ROOT });
}

// --- the package's own source ----------------------------------------------

describe('recommendation-runtime source boundary', () => {
  const files = listSourceFiles(SRC_ROOT);

  it('finds the source tree (a rename to another extension must not pass silently)', () => {
    assert.ok(files.length > 0, 'no JavaScript source file found under ' + SRC_ROOT);
    assert.ok(
      files.includes(path.join(SRC_ROOT, 'index.js')),
      'src/index.js is the declared main entry point and must be scanned'
    );
  });

  it('every source file stays inside the runtime boundary', () => {
    const violations = files.flatMap((file) => scanFile(file, { packageRoot: PACKAGE_ROOT, coreRoot: CORE_ROOT }) || []);
    const rendered = violations.map(
      (violation) =>
        path.relative(PACKAGE_ROOT, violation.file) +
        (violation.line === null ? '' : ':' + violation.line) +
        ' ' + violation.rule + ' — ' + violation.detail
    );
    assert.deepEqual(rendered, [], 'runtime boundary violations:\n  ' + rendered.join('\n  '));
  });

  it('declares no dependencies of any kind', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const value = manifest[field];
      assert.ok(
        value === undefined || Object.keys(value).length === 0,
        'packages/recommendation-runtime/package.json must not declare ' + field
      );
    }
    assert.equal(manifest.main, 'src/index.js');
  });
});

// --- imports ----------------------------------------------------------------

describe('boundary scanner: import rules', () => {
  it('reports a database client as a forbidden module', () => {
    assertReports("const { Pool } = require('pg');", 'forbidden-module', 'database');
    assertReports("const pg = require('pg-promise');", 'forbidden-module', 'database');
  });

  it('reports dotenv and every other bare module', () => {
    assertReports("import env from 'dotenv';", 'forbidden-module', 'environment');
    assertReports("const fs = require('node:fs');", 'forbidden-module', 'filesystem');
    assertReports("const lodash = require('lodash');", 'forbidden-module', 'third-party');
  });

  it('permits node:crypto', () => {
    assertClean("const { randomUUID } = require('node:crypto');", 'node:crypto');
  });

  it('permits the core package root specifier, and reports every deeper path', () => {
    assertClean("const core = require('../../recommendation-core');", 'core package root');
    assertReports("const core = require('../../recommendation-core/src');", 'core-deep-import');
    assertReports("const filtering = require('../../recommendation-core/src/filtering');", 'core-deep-import');
  });

  it('permits the core package root from a nested namespace directory too', () => {
    assertClean("const core = require('../../../recommendation-core');", 'nested core root', LOADER_PROBE);
  });

  it('permits a relative import inside src/ and reports one that escapes it', () => {
    const temp = makeTempTree();
    try {
      assert.deepEqual(scanIn(temp, "const util = require('./util');"), []);
      const violation = scanIn(temp, "const outside = require('../outside');").find(
        (item) => item.rule === 'import-outside-src'
      );
      assert.ok(violation, 'expected an escaping import to be reported');
      assert.ok(violation.detail.includes('outside.js'), violation.detail);
      assert.equal(typeof violation.line, 'number');
    } finally {
      temp.dispose();
    }
  });

  it('reports a sibling requiring the package entry point as a barrel cycle', () => {
    assertReports("const barrel = require('./index');", 'root-cycle');
  });

  it('reports a package file outside src/ and a file outside the package', () => {
    assertReports("const manifest = require('../package.json');", 'import-outside-src', 'package.json');
    assertReports("const root = require('../../../package.json');", 'import-outside-src', 'package.json');
  });

  it('reports a specifier that does not resolve, and any computed specifier', () => {
    assertReports("const missing = require('./does-not-exist');", 'unresolved-import');
    assertReports('const mod = require(moduleName);', 'dynamic-import', 'statically verifiable');
    assertReports('const mod = await import(moduleName);', 'dynamic-import');
    assertReports('const mod = require(`./${name}`);', 'dynamic-import');
  });

  it('permits a template specifier with no interpolation', () => {
    const temp = makeTempTree();
    try {
      assert.deepEqual(scanIn(temp, 'const util = require(`./util`);'), []);
    } finally {
      temp.dispose();
    }
  });

  it('reports module.require() in its direct, computed and invocation forms', () => {
    assertReports("module.require('pg');", 'forbidden-module', 'database');
    assertReports("module['require']('pg');", 'forbidden-module', 'database');
    assertReports("module?.require('pg');", 'forbidden-module', 'database');
    assertReports("module.require?.('pg');", 'forbidden-module', 'database');
    assertReports("module.require.call(module, 'dotenv');", 'forbidden-module', 'environment');
    assertReports("require.call(null, 'node:fs');", 'forbidden-module', 'filesystem');
    assertReports("require['apply'](null, ['lodash']);", 'forbidden-module', 'third-party');
    assertReports("require.bind(null, 'pg')();", 'forbidden-module', 'database');
  });

  it('reports optional computed module access in both forms', () => {
    assertReports("module?.[key]('pg');", 'dynamic-import', 'statically verifiable');
    assertReports("module?.[key]?.('pg');", 'dynamic-import', 'statically verifiable');
    assertReports("module?.['req' + 'uire']('pg');", 'dynamic-import', 'statically verifiable');
    assertReports("module?.['require']('pg');", 'forbidden-module', 'database');
  });

  it('reports a proxy or computed require as a dynamic import', () => {
    assertReports("module[key]('pg');", 'dynamic-import', 'statically verifiable');
    assertReports('require.call(null, specifier);', 'dynamic-import', 'statically verifiable');
    assertReports('require.apply(null, specifiers);', 'dynamic-import', 'statically verifiable');
    assertReports('module.require(name);', 'dynamic-import', 'statically verifiable');
  });

  it("does not treat an object's own require method or require.resolve as an import", () => {
    assertClean("const shape = { require: () => 1 }; shape.require('pg');", 'own require method');
    assertClean(
      "const shape = { require: () => 1 }; shape?.['require']('pg');",
      'optional computed own require method'
    );
    assertClean("const path = require.resolve('./util');", 'require.resolve');
    assertClean('const load = module.require;', 'uncalled require value');
  });

  it('permits module.require and its proxies for a relative path inside src/', () => {
    const temp = makeTempTree();
    try {
      assert.deepEqual(scanIn(temp, "const util = module.require('./util');"), []);
      assert.deepEqual(scanIn(temp, "const util = module.require.call(module, './util');"), []);
      assert.deepEqual(scanIn(temp, "const util = require['apply'](null, ['./util']);"), []);
      assert.deepEqual(scanIn(temp, "const util = module?.['require']('./util');"), []);
    } finally {
      temp.dispose();
    }
  });

  it('holds module.require and its proxies to the escape and cycle rules', () => {
    const temp = makeTempTree();
    try {
      const outside = scanIn(temp, "const outside = require.call(null, '../outside');").find(
        (violation) => violation.rule === 'import-outside-src'
      );
      assert.ok(outside, 'expected an escaping proxy import to be reported');
      assert.ok(outside.detail.includes('outside.js'), outside.detail);
      assert.ok(
        scanIn(temp, "const barrel = module.require('./index');").some((violation) => violation.rule === 'root-cycle'),
        'expected module.require of the entry point to be a barrel cycle'
      );
    } finally {
      temp.dispose();
    }
  });

  it('permits the core package root through module.require', () => {
    assertClean("const core = module.require('../../recommendation-core');", 'module.require core root');
  });
});

// --- connection ownership ---------------------------------------------------

describe('boundary scanner: connection ownership', () => {
  it('reports pool and client creation', () => {
    assertReports('const pool = new Pool({});', 'connection-creation', 'new Pool');
    assertReports('const client = new Client(options);', 'connection-creation', 'new Client');
    assertReports('const pool = new pg.Pool(config);', 'connection-creation', 'pg.Pool');
  });

  it('reports pool.connect() and client.release()', () => {
    assertReports('const client = await pool.connect();', 'pool-connect');
    assertReports('client.release();', 'client-release');
    assertReports('await client.release.call(client);', 'client-release');
  });

  it('reports .end() closing a client, pool or connection in every reachable form', () => {
    assertReports('client.end();', 'connection-close', 'client.end');
    assertReports('await pool.end();', 'connection-close', 'pool.end');
    assertReports('db.end();', 'connection-close', 'db.end');
    assertReports('connection.end();', 'connection-close', 'connection.end');
    assertReports('database.end();', 'connection-close', 'database.end');
    assertReports('this.client.end();', 'connection-close', 'client.end');
    assertReports('options.pool.end();', 'connection-close', 'pool.end');
    assertReports('pgPool.end();', 'connection-close', 'pgPool.end');
    assertReports("client['end']();", 'connection-close');
    assertReports('client?.end();', 'connection-close');
    assertReports('client.end?.();', 'connection-close');
    assertReports('client.end.call(client);', 'connection-close');
    assertReports('pool.end.bind(pool)();', 'connection-close');
  });

  it('does not report .end() on a stream, socket or formatter', () => {
    assertClean('stream.end();', 'stream.end');
    assertClean('socket.end();', 'socket.end');
    assertClean('formatter.end({});', 'formatter.end');
    assertClean('response.end();', 'response.end');
  });

  it('does not report reading .end without calling it', () => {
    assertClean('const end = client.end;', 'uncalled client.end');
  });

  it('reports network globals', () => {
    assertReports("const res = fetch('https://example.test');", 'http-call');
    assertReports("globalThis.fetch('https://example.test');", 'http-call');
  });

  it('permits queries on the injected client', () => {
    assertClean("client.query('SELECT 1');", 'query on the injected client');
    assertClean("await client.query(SELECT_QUERY_INPUT_SQL, [queryId]);", 'query with a SQL constant');
  });

  it('is not misled by comments naming the forbidden calls', () => {
    assertClean(
      [
        '// With a pg Pool, check a client out first (const client = await pool.connect())',
        '// and release it afterwards (client.release()). The runtime never reads process.env.',
        '// module.require(\'pg\') and client.end() are forbidden here, as is new Date(...args).',
        '/* require(\'pg\'), new Pool, new Client and fetch() are forbidden here. */',
        'module.exports = {};',
      ].join('\n'),
      'comments'
    );
  });
});

// --- environment ------------------------------------------------------------

describe('boundary scanner: environment and credentials', () => {
  it('reports process.env in every reachable form', () => {
    assertReports('const url = process.env.DATABASE_URL;', 'process-env');
    assertReports('const url = process?.env?.DATABASE_URL;', 'process-env');
    assertReports('const url = globalThis.process.env.API_URL;', 'process-env');
    assertReports('const url = process["env"].API_URL;', 'process-env');
  });

  it('reports process.env inside a template interpolation', () => {
    assertReports('const q = `prefix ${process.env.HOME} suffix`;', 'process-env');
  });

  it('reports connection strings, hosts and parameter names', () => {
    assertReports("const url = 'postgresql://user@host/db';", 'db-connection-param');
    assertReports("const host = 'ep-cool-1234.us-east-2.aws.neon.tech';", 'db-connection-param');
    assertReports('const connectionString = source;', 'db-connection-param');
    assertReports('const url = TEST_DATABASE_URL;', 'db-connection-param');
  });

  it('is not misled by string literals that merely mention the names', () => {
    assertClean(
      [
        "const note = 'the bootstrap reads process.env, never this module';",
        "const label = 'pg is required by the API, not by the runtime';",
        'module.exports = { note, label };',
      ].join('\n'),
      'string literals'
    );
  });
});

// --- clock ------------------------------------------------------------------

describe('boundary scanner: the clock rule', () => {
  it('reports Date.now(), a bare Date() and a zero-argument new Date()', () => {
    assertReports('const at = Date.now();', 'clock-read');
    assertReports('const at = Date();', 'clock-read');
    assertReports('const at = new Date();', 'clock-read', 'no argument');
    assertReports('const at = new Date(/* now */);', 'clock-read', 'no argument');
    assertReports('const at = new Date;', 'clock-read');
    assertReports('const at = globalThis.Date();', 'clock-read');
  });

  it('reports a Date built from undefined or void', () => {
    assertReports('const at = new Date(undefined);', 'clock-read', 'undefined');
    assertReports('const at = new Date(void 0);', 'clock-read', 'void 0');
  });

  it('reports a spread that can collapse to the zero-argument clock read', () => {
    assertReports('const at = new Date(...[]);', 'clock-read', 'empty array');
    assertReports('const at = new Date(...[,]);', 'clock-read', 'empty array');
    assertReports('const at = new Date(...args);', 'clock-read', 'statically known');
    assertReports('const at = new Date(...values.slice(0, 1));', 'clock-read', 'statically known');
    assertReports('const at = new Date(...[undefined]);', 'clock-read');
    assertReports("const at = new Date(...'');", 'clock-read', 'empty literal');
  });

  it('permits new Date(value) — caller or database supplied time', () => {
    assertClean('const at = new Date(row.created_at).toISOString();', 'new Date(member)');
    assertClean('const ms = new Date(value).getTime();', 'new Date(value)');
    assertClean('const at = new Date(0);', 'new Date(0)');
    assertClean('const at = new Date(Date.parse(value));', 'new Date(Date.parse(value))');
    assertClean('const at = new Date(options.now);', 'new Date(options.now)');
    assertClean('const at = new Date(values[0]);', 'new Date(values[0])');
    assertClean('const at = new Date(...[value]);', 'new Date(...[value])');
    assertClean('const at = new Date(...[value, extra]);', 'new Date(...[value, extra])');
  });
});

// --- permissive half --------------------------------------------------------

describe('boundary scanner: SQL and crypto are the runtime job', () => {
  it('permits SQL text, including interpolated templates', () => {
    assertClean("const sql = 'SELECT id FROM products WHERE id = $1';", 'SQL literal');
    assertClean('const sql = `SELECT ${columns} FROM products`;', 'interpolated SQL');
    assertClean('const sql = `INSERT INTO offers (${columns}) VALUES (${values})`;', 'interpolated DML');
  });

  it('permits uuid generation through the crypto module', () => {
    assertClean("const { randomUUID } = require('node:crypto');\nconst id = randomUUID();", 'randomUUID');
  });

  it('is not misled by a regex literal or a property named like a rule', () => {
    assertClean('const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}$/;', 'regex literal');
    assertClean('const shape = { query: 1, fetch: 2, pool: 3 };', 'property keys');
    assertClean('const q = shape.query;', 'non-call member read');
  });
});

// --- reporting --------------------------------------------------------------

describe('boundary scanner: reporting', () => {
  it('reports violations with their line and file', () => {
    const found = scan(['const a = 1;', 'const at = Date.now();'].join('\n'));
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'clock-read');
    assert.equal(found[0].line, 2);
    const rendered = formatViolation(found[0]);
    assert.ok(rendered.includes('probe-fixture.js'), rendered);
    assert.ok(rendered.includes(':2'), rendered);
  });

  it('keeps comments out of the reported lines', () => {
    const found = scan(['// Date.now() in a comment', 'const at = new Date();'].join('\n'));
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
  });

  it('lexes a regex literal as one token rather than as a comment', () => {
    const tokens = lex('const r = /a\\/b/; // trailing');
    assert.equal(tokens.filter((token) => token.type === 'regex').length, 1);
  });
});
