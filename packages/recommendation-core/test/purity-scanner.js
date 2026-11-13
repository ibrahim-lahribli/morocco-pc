'use strict';

// packages/recommendation-core/test/purity-scanner.js — the static impurity
// scanner behind test/purity.test.js.
//
// It is NOT production code: nothing under src/ may import it, and the purity
// suite scans src/ only. It lives in its own module so the scanner can be
// exercised against synthetic sources (fixtures passed as strings) instead of
// by editing the package's real source.
//
// Approach — deliberately not one regex over the file text:
//   1. LEX. A small hand-written tokenizer drops comments, keeps string and
//      template-literal VALUES, and keeps template `${...}` bodies as code.
//      Every rule therefore sees code, not prose: `// Date.now()` and
//      `'db.query()'` cannot trip a rule, and interpolation is not hidden.
//   2. STRUCTURAL MATCH. Rules match token sequences (`Date` `.` `now`,
//      `new` `Date` `(`, ident `query` after a member dot and before `(`),
//      not identifier spellings alone.
//   3. IMPORT RESOLUTION. Every `require`/`import`/`from` specifier is
//      resolved against the real filesystem with Node's resolution order
//      (exact file, `.js`/`.cjs`/`.mjs`/`.json`, then a directory `index`),
//      and the RESOLVED path must sit inside the core package. A relative
//      specifier that resolves out of the package, or does not resolve at all,
//      fails here even if the text "looks" local.
//
// Known limitations (static scanning is approximate by construction — the
// import resolution above and the focused suite next to this file are what
// carry the boundary, not this list):
//   * Dynamic specifiers (`require(name)`, `import(expr)`) are not resolvable
//     statically; only literal specifiers are checked. A caller-supplied module
//     name is an escape hatch the scanner cannot see.
//   * Regular-expression literals are not lexed as literals (they are read as
//     code), so a regex containing `Date\.now` would be reported. A regex that
//     names a forbidden call is worth reviewing anyway.
//   * Values built at runtime (`String.fromCharCode`, concatenated fragments)
//     are not reconstructed, so SQL assembled from pieces can slip past the
//     string rule. `.query()` — the call that would execute it — is matched
//     structurally.
//   * Indirect access is not caught: `globalThis['Date']`, `(0, eval)`,
//     `Reflect.get`. The boundary is a review gate plus resolution, not a
//     sandbox.
//   * Only `.js`/`.cjs`/`.mjs` files are scanned; the suite fails if the
//     source tree is empty, so a rename to another extension is visible as a
//     missing file rather than a silent pass.
//   * The name heuristics for connection parameters (`connectionString`,
//     `DATABASE_URL`, ...) are conservative: a property that merely shares one
//     of those names is reported, and the fix is to rename it.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXTENSIONS = ['.js', '.cjs', '.mjs'];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

// --- lexer ------------------------------------------------------------------

/**
 * Tokenize JavaScript well enough to tell code from comments and strings.
 * Tokens: { type: 'ident'|'string'|'number'|'punct', value, offset }.
 * Template literals emit one `string` token per literal chunk and `punct`
 * `${` / `}` around the interpolation, whose body is lexed as code.
 */
function lex(source) {
  const tokens = [];
  let i = 0;
  const n = source.length;

  function skipLineComment() {
    while (i < n && source[i] !== '\n') i++;
  }

  function skipBlockComment() {
    i += 2;
    while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
    i = Math.min(n, i + 2);
  }

  function readString(quote) {
    const start = i;
    i++;
    let value = '';
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        value += source[i + 1] === undefined ? '' : source[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) {
        i++;
        break;
      }
      if (c === '\n') break;
      value += c;
      i++;
    }
    return { type: 'string', value, offset: start };
  }

  function readTemplate() {
    const start = i;
    i++;
    let chunk = '';
    let chunkStart = start;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        chunk += source[i + 1] === undefined ? '' : source[i + 1];
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        tokens.push({ type: 'string', value: chunk, offset: chunkStart, template: true });
        return;
      }
      if (c === '$' && source[i + 1] === '{') {
        tokens.push({ type: 'string', value: chunk, offset: chunkStart, template: true });
        chunk = '';
        i += 2;
        tokens.push({ type: 'punct', value: '${', offset: i - 2 });
        lexCode(true);
        tokens.push({ type: 'punct', value: '}', offset: i - 1 });
        chunkStart = i;
        continue;
      }
      chunk += c;
      i++;
    }
    tokens.push({ type: 'string', value: chunk, offset: chunkStart, template: true });
  }

  function readIdent() {
    const start = i;
    while (i < n && IDENT_PART.test(source[i])) i++;
    return { type: 'ident', value: source.slice(start, i), offset: start };
  }

  function readNumber() {
    const start = i;
    while (i < n && /[0-9A-Za-z_.]/.test(source[i])) i++;
    return { type: 'number', value: source.slice(start, i), offset: start };
  }

  function lexCode(stopAtBrace) {
    let depth = 0;
    while (i < n) {
      const c = source[i];
      if (c === '\n' || c === '\r' || c === ' ' || c === '\t') {
        i++;
        continue;
      }
      if (c === '/' && source[i + 1] === '/') {
        skipLineComment();
        continue;
      }
      if (c === '/' && source[i + 1] === '*') {
        skipBlockComment();
        continue;
      }
      if (c === "'" || c === '"') {
        tokens.push(readString(c));
        continue;
      }
      if (c === '`') {
        readTemplate();
        continue;
      }
      if (IDENT_START.test(c)) {
        tokens.push(readIdent());
        continue;
      }
      if (/[0-9]/.test(c)) {
        tokens.push(readNumber());
        continue;
      }
      if (c === '{') {
        depth++;
        tokens.push({ type: 'punct', value: '{', offset: i });
        i++;
        continue;
      }
      if (c === '}' && stopAtBrace) {
        if (depth === 0) {
          i++;
          return;
        }
        depth--;
        tokens.push({ type: 'punct', value: '}', offset: i });
        i++;
        continue;
      }
      const three = source.slice(i, i + 3);
      const two = source.slice(i, i + 2);
      if (three === '...') {
        tokens.push({ type: 'punct', value: '...', offset: i });
        i += 3;
        continue;
      }
      if (two === '?.') {
        tokens.push({ type: 'punct', value: '?.', offset: i });
        i += 2;
        continue;
      }
      tokens.push({ type: 'punct', value: c, offset: i });
      i++;
    }
  }

  lexCode(false);
  return tokens;
}

// --- token helpers ----------------------------------------------------------

function isPunct(token, value) {
  return Boolean(token) && token.type === 'punct' && token.value === value;
}

function isMemberDot(token) {
  return Boolean(token) && token.type === 'punct' && (token.value === '.' || token.value === '?.');
}

function isIdent(token, value) {
  return Boolean(token) && token.type === 'ident' && (value === undefined || token.value === value);
}

function isString(token) {
  return Boolean(token) && token.type === 'string';
}

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

// --- rules ------------------------------------------------------------------

// Module specifiers that name an infrastructure dependency, so the failure
// message says WHAT was reached for. Any bare specifier is a violation whether
// or not it appears here; this table only classifies.
const MODULE_CATEGORIES = [
  {
    category: 'database',
    pattern: /^(pg|pg-|pg$|postgres|pg-promise|mysql|mysql2|sqlite3|better-sqlite3|slonik|kysely|drizzle-orm|@prisma\/client|@neondatabase\/serverless|@vercel\/postgres)/,
  },
  {
    category: 'filesystem',
    pattern: /^(node:)?fs(\/promises)?$|^fs-extra$|^glob$|^globby$|^graceful-fs$/,
  },
  {
    category: 'network',
    pattern: /^(node:)?(http2?|https|net|tls|dgram|dns)$|^undici$|^axios$|^node-fetch$|^got$|^superagent$/,
  },
  { category: 'crypto', pattern: /^(node:)?crypto$/ },
  { category: 'environment', pattern: /^dotenv(-expand)?$/ },
  { category: 'process', pattern: /^(node:)?(child_process|worker_threads|cluster)$/ },
];

const SQL_PATTERNS = [
  // `select` alone is also English ("select the cheapest build"), so the short
  // form requires a projection: a star, a digit, or an aggregate call.
  /\bselect\s+(?:\*|\d|count\s*\()/i,
  /\bselect\b[\s\S]*\bfrom\b/i,
  /\binsert\s+into\b/i,
  /\bupdate\s+[A-Za-z_][\w."]*\s+set\b/i,
  /\bdelete\s+from\b/i,
  /\bcreate\s+(table|index|view|schema|materialized)\b/i,
  /\balter\s+table\b/i,
  /\bdrop\s+(table|index|view|schema)\b/i,
  /\btruncate\s+(table\s+)?[A-Za-z_]/i,
];

const DB_PARAMETER = /\b(DATABASE_URL|TEST_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGCONNECT_TIMEOUT|connectionString|connectionTimeoutMillis)\b/;
const DB_URL = /postgres(?:ql)?:\/\//i;
const DB_HOST = /\.neon\.tech\b/i;

const HTTP_GLOBALS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']);

function classifyModule(specifier) {
  for (const entry of MODULE_CATEGORIES) {
    if (entry.pattern.test(specifier)) return entry.category;
  }
  return 'third-party';
}

function collectSpecifiers(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isIdent(token)) continue;
    if (token.value === 'require') {
      if (isPunct(tokens[i + 1], '(') && isString(tokens[i + 2])) out.push(tokens[i + 2]);
      continue;
    }
    if (token.value === 'import') {
      // `import x from 'y'` / `export * from 'y'` are caught by the `from`
      // branch; these are `import 'y'` and `import('y')`.
      if (isString(tokens[i + 1])) out.push(tokens[i + 1]);
      else if (isPunct(tokens[i + 1], '(') && isString(tokens[i + 2])) out.push(tokens[i + 2]);
      continue;
    }
    if (token.value === 'from' && isString(tokens[i + 1])) out.push(tokens[i + 1]);
  }
  return out;
}

/**
 * Node-style candidate list for a relative specifier, without loading it:
 * the exact file, then the source/manifest extensions, then a directory index.
 */
function resolveRelative(specifier, fromDir) {
  const base = path.resolve(fromDir, specifier);
  const candidates = [base];
  for (const extension of SOURCE_EXTENSIONS) candidates.push(base + extension);
  candidates.push(base + '.json');
  for (const extension of SOURCE_EXTENSIONS) candidates.push(path.join(base, 'index' + extension));
  candidates.push(path.join(base, 'index.json'));
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_err) {
      // not there; try the next candidate
    }
  }
  return null;
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Scan one source string.
 *
 * @param {string} source module text
 * @param {{file?: string, coreRoot: string}} options `file` enables relative
 *   import resolution (its directory is the resolution base)
 * @returns {Array<{rule: string, detail: string, line: number|null}>}
 */
function scanSource(source, options) {
  const opts = options || {};
  const coreRoot = opts.coreRoot;
  if (typeof coreRoot !== 'string' || coreRoot === '') {
    throw new Error('scanSource requires options.coreRoot');
  }
  const file = opts.file || null;
  const tokens = lex(source);
  const violations = [];

  function report(rule, detail, offset) {
    violations.push({
      rule,
      detail,
      line: typeof offset === 'number' ? lineOf(source, offset) : null,
    });
  }

  // 1. Imports: specifier shape, then real resolution for relative ones.
  for (const specifier of collectSpecifiers(tokens)) {
    const value = specifier.value;
    if (!value.startsWith('.')) {
      report(
        'non-relative-import',
        "'" + value + "' is a " + classifyModule(value) + ' module; core may only import relative paths inside itself',
        specifier.offset
      );
      continue;
    }
    if (!file) continue;
    const resolved = resolveRelative(value, path.dirname(file));
    if (!resolved) {
      report('unresolved-import', "'" + value + "' does not resolve to a file", specifier.offset);
      continue;
    }
    if (!isInside(resolved, coreRoot)) {
      report(
        'import-outside-package',
        "'" + value + "' resolves outside the core package (" +
          path.relative(coreRoot, resolved).split(path.sep).join('/') + ')',
        specifier.offset
      );
    }
  }

  // 2. Structural, token-sequence rules.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const previous = tokens[i - 1];
    const following = tokens[i + 1];

    if (isIdent(token, 'process') && isMemberDot(following) && isIdent(tokens[i + 2], 'env')) {
      report('process-env', 'reads process.env; core takes its environment as an argument', token.offset);
      continue;
    }

    if (isIdent(token, 'Date') && !isMemberDot(previous) && isMemberDot(following) && isIdent(tokens[i + 2], 'now')) {
      report('clock-read', 'reads Date.now(); core receives time from its caller', token.offset);
      continue;
    }

    if (isIdent(token, 'Math') && !isMemberDot(previous) && isMemberDot(following) && isIdent(tokens[i + 2], 'random')) {
      report('randomness', 'calls Math.random(); core must be deterministic', token.offset);
      continue;
    }

    if ((isIdent(token, 'new') && isIdent(following, 'Date')) || (isIdent(token, 'globalThis') && isMemberDot(following) && isIdent(tokens[i + 2], 'Date'))) {
      const dateIndex = isIdent(token, 'new') ? i + 1 : i + 2;
      const afterDate = tokens[dateIndex + 1];
      const isEmptyCall = isPunct(afterDate, '(') && isPunct(tokens[dateIndex + 2], ')');
      const isBareConstruction = !isPunct(afterDate, '(');
      if (isEmptyCall || isBareConstruction) {
        report(
          'clock-read',
          'constructs a Date with no argument; `new Date(value)` from the caller is the permitted form',
          tokens[dateIndex].offset
        );
      }
      continue;
    }

    if (isIdent(token, 'query') && isMemberDot(previous) && isPunct(following, '(')) {
      report('sql-call', 'calls .query(); core executes no statement', token.offset);
      continue;
    }

    // An object-literal property KEY named crypto (`{ crypto: 2 }`) is a name,
    // not a use of the global.
    if (isIdent(token, 'crypto') && !isMemberDot(previous) && !isPunct(following, ':')) {
      report('crypto', 'uses crypto; core has no cryptographic or random source', token.offset);
      continue;
    }

    if (isIdent(token, 'crypto') && isMemberDot(previous) && isIdent(tokens[i - 2], 'globalThis')) {
      report('crypto', 'uses globalThis.crypto; core has no cryptographic or random source', token.offset);
      continue;
    }

    if (HTTP_GLOBALS.has(token.value) && isIdent(token) && isPunct(following, '(') && !isMemberDot(previous)) {
      report('http-call', 'calls ' + token.value + '(); core performs no network I/O', token.offset);
      continue;
    }

    if (isIdent(token) && DB_PARAMETER.test(token.value)) {
      report(
        'db-connection-param',
        "'" + token.value + "' names a database connection parameter",
        token.offset
      );
      continue;
    }

    if (isString(token)) {
      const value = token.value;
      for (const pattern of SQL_PATTERNS) {
        if (pattern.test(value)) {
          report('sql-string', 'contains SQL text; core performs no database access', token.offset);
          break;
        }
      }
      if (DB_URL.test(value)) {
        report('db-connection-param', 'carries a PostgreSQL connection string', token.offset);
      }
      if (DB_HOST.test(value)) {
        report('db-connection-param', 'names a database host', token.offset);
      }
      if (DB_PARAMETER.test(value)) {
        report('db-connection-param', 'names a database connection parameter', token.offset);
      }
    }
  }

  return violations;
}

/** Read and scan one file. */
function scanFile(file, coreRoot) {
  const source = fs.readFileSync(file, 'utf8');
  return scanSource(source, { file, coreRoot }).map((violation) => ({ file, ...violation }));
}

/** Every JavaScript source file under `directory`, recursively, sorted. */
function listSourceFiles(directory) {
  const out = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out.sort();
}

module.exports = {
  lex,
  scanSource,
  scanFile,
  listSourceFiles,
  SOURCE_EXTENSIONS,
};
