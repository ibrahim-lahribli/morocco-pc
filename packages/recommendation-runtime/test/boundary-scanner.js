'use strict';

// packages/recommendation-runtime/test/boundary-scanner.js — the static
// boundary scanner behind test/boundary.test.js.
//
// The runtime sits on the OPPOSITE boundary to the core's purity gate: SQL and
// `.query()` are its job, so they are permitted here. What it must never do is
// own a connection, read the environment, or reach past the core's public entry
// point. This scanner proves exactly that:
//
//   1. IMPORTS. A runtime source file may require
//        * a relative path inside its own src/ — but not the package root from
//          a sibling, which is the barrel cycle;
//        * the core package by its package-ROOT specifier (RFC §11.4), which
//          resolves through core's `main`; a deeper path into core/src is a
//          violation because it ties the runtime to core's internal tree;
//        * `node:crypto`, the one allowed built-in (uuid generation).
//      Any other bare specifier (`pg`, `dotenv`, `node:fs`, ...) is a
//      violation, and a computed specifier fails closed. `module.require(...)`
//      is the same import in another spelling, including its computed member
//      (`module['require']`) and its `.call`/`.apply`/`.bind` proxies; an
//      object's own `require` method is not an import.
//   2. CONNECTION OWNERSHIP. `new Pool`/`new Client`, `pool.connect()`,
//      `.release()`, `.end()` on a client/pool and HTTP globals are violations:
//      the runtime receives one connected client and never creates, checks out,
//      releases or closes one.
//   3. ENVIRONMENT. `process.env` and database connection strings or
//      connection parameters are violations: the caller's bootstrap reads them.
//   4. CLOCK. Only `new Date(value)` is permitted. "Now" comes from the
//      database (`SELECT CURRENT_TIMESTAMP`) or from the caller; `Date.now()`, a
//      bare `Date()`, `new Date()`, `new Date(undefined)`, `new Date(void 0)` and
//      a spread that is empty or of unknown length all read the process clock.
//      A statically non-empty spread of a value (`new Date(...[value])`) is the
//      same call as `new Date(value)` and stays permitted.
//
// Approach: a small tokenizer drops comments (the source comments themselves
// discuss `process.env`, `pool.connect()` and `client.release()`), keeps
// string, template and regex literals as content, and the rules match token
// sequences rather than identifier spellings. Regex-versus-division uses the
// previous significant token: after a value or `)`/`]`/`}` a `/` divides,
// otherwise it starts a literal. That is the ordinary heuristic, and this
// corpus uses regexes only in `const RE = /.../;` position.
//
// Known limitations (a static scan is a gate, not a sandbox): a specifier built
// at runtime (`require(name)`, `require.call(null, name)`, `module[key]` /
// `module?.[key]`) is reported rather than resolved; an indirection through
// `eval`, `Function` or a require aliased into a new variable is not
// reconstructed; `.end()` receiver detection is name-based — there is no alias
// or data-flow analysis, so `const c = client; c.end()` is missed and stream,
// socket and HTTP-response receivers are deliberately exempt rather than risk
// false positives on ordinary stream methods; a receiver-less `this.end()`
// cannot be attributed to a client; a connection created inside a dependency is
// out of scope, which is why the package must also declare no dependencies
// (asserted in test/boundary.test.js).

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const SOURCE_EXTENSIONS = ['.js', '.cjs', '.mjs'];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

// A `/` after one of these identifiers starts a regular expression.
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

// `Math.max.call(Math)` reaches the same function as `Math.max(...)`; the
// helper segment is dropped before the rules read the name.
const INVOCATION_METHODS = new Set(['call', 'apply', 'bind']);

// Objects whose properties ARE the global scope.
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);

const HTTP_GLOBALS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']);

// A `.end()` call closes a connection when its receiver names one. The
// exclusion list keeps ordinary streams and protocol helpers out of the rule.
const CONNECTION_RECEIVER = /(?:client|pool|conn(?:ection)?|database|db)$/;
const NON_CONNECTION_RECEIVER = /(?:stream|socket|formatter|writer|reader|encoder|decoder|parser|iterator|generator|queue|logger|span|timer|buffer|response)$/;

// The only built-in the runtime may reach directly: uuid generation for
// persisted row ids (persist-ranked, persist-rejections, swap-commit).
const ALLOWED_BUILTINS = new Set(['node:crypto']);

const MODULE_CATEGORIES = [
  {
    category: 'database',
    pattern: /^(pg|pg-|pg$|postgres|pg-promise|mysql|mysql2|sqlite3|better-sqlite3|slonik|kysely|drizzle-orm|@prisma\/client|@neondatabase\/|@vercel\/postgres)/,
  },
  { category: 'environment', pattern: /^dotenv(-expand)?$/ },
  { category: 'filesystem', pattern: /^(node:)?fs(\/promises)?$|^fs-extra$/ },
  {
    category: 'network',
    pattern: /^(node:)?(http2?|https|net|tls|dgram|dns)$|^undici$|^axios$|^node-fetch$|^got$/,
  },
  { category: 'process', pattern: /^(node:)?(child_process|worker_threads|cluster)$/ },
  { category: 'test', pattern: /^(node:)?(test|node:test)$/ },
];

const DB_PARAMETER = /\b(DATABASE_URL|TEST_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGCONNECT_TIMEOUT|connectionString|connectionTimeoutMillis)\b/;
const DB_URL = /postgres(?:ql)?:\/\//i;
const DB_HOST = /\.neon\.tech\b/i;

// --- lexer ------------------------------------------------------------------

/**
 * Tokenize JavaScript well enough to tell code from comments, strings and
 * regular expressions.
 * Tokens: { type: 'ident'|'string'|'number'|'punct'|'regex', value, offset }.
 * Template literals emit one `string` token per literal chunk and `punct`
 * `${` / `}` around the interpolation, whose body is lexed as code.
 */
function lex(source) {
  const tokens = [];
  const n = source.length;
  let i = 0;
  let templateSeq = 0;

  function previous() {
    return tokens.length === 0 ? null : tokens[tokens.length - 1];
  }

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

  /**
   * Read a `/.../flags` literal. Character classes are content, so a `}` inside
   * one cannot end a template interpolation. When the text cannot be a regex
   * (it hits a newline first), rewind and let `/` lex as a punct.
   */
  function readRegex() {
    const start = i;
    let inClass = false;
    i++;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '\n' || c === '\r') break;
      if (inClass) {
        if (c === ']') inClass = false;
        i++;
        continue;
      }
      if (c === '[') {
        inClass = true;
        i++;
        continue;
      }
      if (c === '/') {
        i++;
        while (i < n && IDENT_PART.test(source[i])) i++;
        return { type: 'regex', value: source.slice(start, i), offset: start };
      }
      i++;
    }
    i = start + 1;
    return { type: 'punct', value: '/', offset: start };
  }

  function regexAllowed() {
    const prev = previous();
    if (!prev) return true;
    if (prev.type === 'punct') return prev.value !== ')' && prev.value !== ']' && prev.value !== '}';
    if (prev.type === 'ident') return REGEX_KEYWORDS.has(prev.value);
    return false;
  }

  function readTemplate() {
    const group = templateSeq++;
    let start = i;
    i++;
    let chunk = '';
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        chunk += source[i + 1] === undefined ? '' : source[i + 1];
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        tokens.push({ type: 'string', value: chunk, offset: start, template: true, templateGroup: group });
        return;
      }
      if (c === '$' && source[i + 1] === '{') {
        tokens.push({ type: 'string', value: chunk, offset: start, template: true, templateGroup: group });
        tokens.push({ type: 'punct', value: '${', offset: i });
        i += 2;
        lexCode(true);
        tokens.push({ type: 'punct', value: '}', offset: i - 1 });
        chunk = '';
        start = i;
        continue;
      }
      chunk += c;
      i++;
    }
    tokens.push({ type: 'string', value: chunk, offset: start, template: true, templateGroup: group });
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
      if (c === '/') {
        if (regexAllowed()) {
          tokens.push(readRegex());
        } else {
          tokens.push({ type: 'punct', value: '/', offset: i });
          i++;
        }
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
      if (c === '}') {
        if (stopAtBrace && depth === 0) {
          i++;
          return;
        }
        depth--;
        tokens.push({ type: 'punct', value: '}', offset: i });
        i++;
        continue;
      }
      if (c === '?' && source[i + 1] === '.') {
        tokens.push({ type: 'punct', value: '?.', offset: i });
        i += 2;
        continue;
      }
      if (source.slice(i, i + 3) === '...') {
        tokens.push({ type: 'punct', value: '...', offset: i });
        i += 3;
        continue;
      }
      tokens.push({ type: 'punct', value: c, offset: i });
      i++;
    }
  }

  lexCode(false);

  // A template chunk count > 1 means the literal has an interpolation (each
  // `${...}` splits a chunk), so its text is not statically known as a whole.
  const chunkCounts = new Map();
  for (const token of tokens) {
    if (!token.template) continue;
    chunkCounts.set(token.templateGroup, (chunkCounts.get(token.templateGroup) || 0) + 1);
  }
  for (const token of tokens) {
    if (token.template) token.templateInterpolated = chunkCounts.get(token.templateGroup) > 1;
  }

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

function isStaticallyKnownString(token) {
  if (!isString(token)) return false;
  if (!token.template) return true;
  return token.templateInterpolated !== true;
}

/** Read `a.b?.c['d']` starting at `start`; null when `start` is not an ident. */
function readMemberChain(tokens, start) {
  const first = tokens[start];
  if (!isIdent(first)) return null;
  const segments = [first.value];
  let end = start;
  while (end + 1 < tokens.length) {
    const next = tokens[end + 1];
    if (isMemberDot(next)) {
      if (isIdent(tokens[end + 2])) {
        segments.push(tokens[end + 2].value);
        end += 2;
        continue;
      }
      if (isPunct(tokens[end + 2], '[')) {
        const inner = tokens[end + 3];
        if (isStaticallyKnownString(inner) && isPunct(tokens[end + 4], ']')) {
          segments.push(inner.value);
          end += 4;
          continue;
        }
      }
      break;
    }
    if (isPunct(next, '[')) {
      const inner = tokens[end + 2];
      if (isStaticallyKnownString(inner) && isPunct(tokens[end + 3], ']')) {
        segments.push(inner.value);
        end += 3;
        continue;
      }
    }
    break;
  }
  return { segments, end, token: first };
}

function calledTarget(segments) {
  const target = segments.slice();
  while (target.length > 1 && INVOCATION_METHODS.has(target[target.length - 1])) target.pop();
  return target;
}

function hasAdjacentPair(segments, first, second) {
  for (let i = 0; i + 1 < segments.length; i++) {
    if (segments[i] === first && segments[i + 1] === second) return true;
  }
  return false;
}

/** The `(` that follows a call target, tolerating an optional `?.(` call. */
function callOpenAfter(tokens, indexAfterChain) {
  let open = indexAfterChain;
  if (isPunct(tokens[open], '?.')) open++;
  return isPunct(tokens[open], '(') ? open : null;
}

/** The `[` that follows a member chain, tolerating an optional `?.[`. */
function bracketOpenAfter(tokens, indexAfterChain) {
  let open = indexAfterChain;
  if (isPunct(tokens[open], '?.')) open++;
  return isPunct(tokens[open], '[') ? open : null;
}

/**
 * Split a parenthesised argument list or bracketed array literal into
 * top-level ranges. Each range is inclusive; an empty range (`end < start`)
 * is a hole between commas. Nested (), [], {}, and template interpolations do
 * not split. Returns null when the delimiter is unbalanced.
 */
function readDelimited(tokens, openIndex) {
  const open = tokens[openIndex];
  if (!isPunct(open, '(') && !isPunct(open, '[')) return null;
  const close = open.value === '(' ? ')' : ']';
  const ranges = [];
  let start = openIndex + 1;
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'punct') continue;
    const value = token.value;
    if (value === '(' || value === '[' || value === '{' || value === '${') {
      depth++;
      continue;
    }
    if (value === ')' || value === ']' || value === '}') {
      if (depth === 0) {
        if (value !== close) return null;
        if (i > start) ranges.push({ start, end: i - 1 });
        else if (ranges.length > 0) ranges.push({ start, end: start - 1 });
        return { ranges, closeIndex: i };
      }
      depth--;
      continue;
    }
    if (value === ',' && depth === 0) {
      ranges.push(i > start ? { start, end: i - 1 } : { start, end: start - 1 });
      start = i + 1;
    }
  }
  return null;
}

/** A range that is exactly one statically known string literal. */
function isSingleStaticString(tokens, range) {
  return Boolean(range) && range.end === range.start && isStaticallyKnownString(tokens[range.start]);
}

/**
 * Why a `new Date(...)` argument is not a caller- or database-supplied value,
 * or null when it is permitted.
 */
function classifyDateArgument(tokens, range) {
  if (!range || range.end < range.start) {
    return 'constructs a Date with no argument; `new Date(value)` from the caller is the permitted form';
  }
  const first = tokens[range.start];
  if (isIdent(first, 'undefined')) {
    return 'passes undefined as the Date value; use the caller- or database-supplied value';
  }
  if (isIdent(first, 'void')) {
    return 'passes void 0 as the Date value; use the caller- or database-supplied value';
  }
  if (!isPunct(first, '...')) return null;

  const operand = tokens[range.start + 1];
  if (isStaticallyKnownString(operand) && operand.value === '') {
    return 'spreads an empty literal, which is the zero-argument clock read';
  }
  if (isPunct(operand, '[')) {
    const array = readDelimited(tokens, range.start + 1);
    const element = array && array.ranges[0];
    if (!element || element.end < element.start) {
      return 'spreads an empty array, which is the zero-argument clock read';
    }
    const elementFirst = tokens[element.start];
    if (isIdent(elementFirst, 'undefined') || isIdent(elementFirst, 'void') || isPunct(elementFirst, '...')) {
      return 'spreads an array whose first value is undefined or another spread';
    }
    return null;
  }
  return 'spreads a value whose length is not statically known; it can collapse to the zero-argument clock read';
}

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/** `file:line rule — detail`, the shape a failing gate prints. */
function formatViolation(violation) {
  const file = violation.file || '<synthetic>';
  const line = typeof violation.line === 'number' ? ':' + violation.line : '';
  return file + line + ' ' + violation.rule + ' — ' + violation.detail;
}

// --- resolution -------------------------------------------------------------

function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch (_err) {
    return null;
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  if (relative === '' || path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith('..' + path.sep);
}

function isInsideOrEqual(child, parent) {
  return path.resolve(child) === path.resolve(parent) || isInside(child, parent);
}

function displayPath(from, target) {
  return path.relative(from, target).split(path.sep).join('/');
}

function isRelativeSpecifier(value) {
  return value === '.' || value === '..' || value.startsWith('./') || value.startsWith('../');
}

function classifyModule(specifier) {
  for (const entry of MODULE_CATEGORIES) {
    if (entry.pattern.test(specifier)) return entry.category;
  }
  return 'third-party';
}

/**
 * Every statically known import, with the specifier token. A call whose
 * specifier is not a static string is reported as `dynamic`.
 *
 * `require` and `module.require` are the same import. Their `.call`/`.apply`/
 * `.bind` proxies skip the `thisArg` (and `apply`'s array wrapper) to find the
 * specifier. An object with its own `require` method is not a module import.
 *
 * @returns {Array<{kind: 'static'|'dynamic', token: object, call: string}>}
 */
function collectImports(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isIdent(token) || isMemberDot(tokens[i - 1])) continue;
    const chain = readMemberChain(tokens, i);
    if (chain === null) continue;
    const segments = chain.segments;

    if (segments.length === 1 && segments[0] === 'import') {
      const open = callOpenAfter(tokens, chain.end + 1);
      if (open === null) continue; // `import.meta` and an import declaration
      const args = readDelimited(tokens, open);
      const specifier = args && args.ranges[0];
      if (isSingleStaticString(tokens, specifier)) {
        out.push({ kind: 'static', token: tokens[specifier.start], call: 'import' });
      } else {
        out.push({ kind: 'dynamic', token, call: 'import' });
      }
      i = chain.end;
      continue;
    }

    if (segments.length === 1 && segments[0] === 'from' && isStaticallyKnownString(tokens[i + 1])) {
      out.push({ kind: 'static', token: tokens[i + 1], call: 'from' });
      continue;
    }

    const target = calledTarget(segments);
    const isRequire =
      (target.length === 1 && target[0] === 'require') ||
      (target.length === 2 && target[0] === 'module' && target[1] === 'require');
    if (isRequire) {
      const open = callOpenAfter(tokens, chain.end + 1);
      if (open === null) {
        i = chain.end;
        continue; // a require value or `require.resolve(...)`, not an import call
      }
      const methods = segments.slice(target.length);
      const method = methods.length > 0 ? methods[methods.length - 1] : null;
      const args = readDelimited(tokens, open);
      const ranges = args ? args.ranges : [];
      let specifier = null;
      if (method === null) {
        specifier = ranges[0];
      } else if (method === 'apply') {
        const array = ranges[1] && isPunct(tokens[ranges[1].start], '[')
          ? readDelimited(tokens, ranges[1].start)
          : null;
        specifier = array && array.ranges[0];
      } else {
        specifier = ranges[1];
      }
      const label = segments.slice(0, target.length + (method === null ? 0 : 1)).join('.');
      if (isSingleStaticString(tokens, specifier)) {
        out.push({ kind: 'static', token: tokens[specifier.start], call: label });
      } else {
        out.push({ kind: 'dynamic', token: chain.token, call: label });
      }
      i = chain.end;
      continue;
    }

    // `module[key](...)` and `module?.[key](...)` can be
    // `module.require(...)`. Report it rather than resolve a member name the
    // scanner cannot prove.
    if (segments.length === 1 && segments[0] === 'module') {
      const bracket = bracketOpenAfter(tokens, chain.end + 1);
      if (bracket !== null) {
        const member = readDelimited(tokens, bracket);
        const memberRange = member && member.ranges[0];
        if (member && !isSingleStaticString(tokens, memberRange)) {
          const open = callOpenAfter(tokens, member.closeIndex + 1);
          if (open !== null) out.push({ kind: 'dynamic', token: chain.token, call: 'module[...]' });
        }
      }
    }
  }
  return out;
}

// --- scan -------------------------------------------------------------------

/**
 * Scan one source string.
 *
 * @param {string} source module text
 * @param {{file?: string, packageRoot: string, coreRoot: string}} options
 *   `file` enables resolution (its directory is the base) and is reported with
 *   every violation
 * @returns {Array<{rule: string, detail: string, line: number|null, file: string|null}>}
 */
function scanSource(source, options) {
  const opts = options || {};
  const packageRoot = opts.packageRoot;
  const coreRoot = opts.coreRoot;
  if (typeof packageRoot !== 'string' || packageRoot === '') {
    throw new Error('scanSource requires options.packageRoot');
  }
  if (typeof coreRoot !== 'string' || coreRoot === '') {
    throw new Error('scanSource requires options.coreRoot');
  }

  const file = opts.file || null;
  const srcRoot = path.join(packageRoot, 'src');
  const entry = path.join(srcRoot, 'index.js');
  const realSrcRoot = realpathOrNull(srcRoot);
  const realEntry = realpathOrNull(entry);
  const tokens = lex(source);
  const violations = [];

  function report(rule, detail, offset) {
    violations.push({
      rule,
      detail,
      line: typeof offset === 'number' ? lineOf(source, offset) : null,
      file,
    });
  }

  // 1. Imports.
  const requireFromFile = file === null ? null : createRequire(file);
  const expectedCore = file === null
    ? null
    : (() => {
        const relative = path.relative(path.dirname(file), coreRoot).split(path.sep).join('/');
        return relative.startsWith('.') ? relative : './' + relative;
      })();

  function resolveSpecifier(value) {
    if (requireFromFile === null) return null;
    try {
      return requireFromFile.resolve(value);
    } catch (_err) {
      return null;
    }
  }

  for (const entryPoint of collectImports(tokens)) {
    if (entryPoint.kind === 'dynamic') {
      report(
        'dynamic-import',
        entryPoint.call +
          '() takes a specifier that is not a statically known string literal; the import ' +
          'specifier must be statically verifiable (a relative path inside src/ or the core package root)',
        entryPoint.token.offset
      );
      continue;
    }

    const specifier = entryPoint.token;
    const value = specifier.value;

    if (!isRelativeSpecifier(value)) {
      if (!ALLOWED_BUILTINS.has(value)) {
        report(
          'forbidden-module',
          "'" +
            value +
            "' is a " +
            classifyModule(value) +
            ' module; the runtime may only import its own src/, the core package root and node:crypto',
          specifier.offset
        );
      }
      continue;
    }

    if (expectedCore !== null && value === expectedCore) {
      if (resolveSpecifier(value) === null) {
        report('unresolved-import', "'" + value + "' does not resolve to the core package", specifier.offset);
      }
      continue;
    }
    if (expectedCore !== null && value.startsWith(expectedCore + '/')) {
      report(
        'core-deep-import',
        "'" +
          value +
          "' reaches into the core package's internal tree; import the package root ('" +
          expectedCore +
          "') and use its namespaces (RFC §11.4)",
        specifier.offset
      );
      continue;
    }

    if (requireFromFile === null) continue;

    const resolved = resolveSpecifier(value);
    if (resolved === null) {
      report('unresolved-import', "'" + value + "' does not resolve to a file", specifier.offset);
      continue;
    }
    const realResolved = realpathOrNull(resolved);
    if (realResolved === null) {
      report('unresolved-import', "'" + value + "' resolves to an unreadable path", specifier.offset);
      continue;
    }

    const realCoreRoot = realpathOrNull(coreRoot);
    if (realCoreRoot !== null && isInsideOrEqual(realResolved, realCoreRoot)) {
      report(
        'core-deep-import',
        "'" + value + "' resolves inside the core package (" + displayPath(packageRoot, realResolved) + ')',
        specifier.offset
      );
      continue;
    }
    if (realResolved === realEntry && file !== null && realpathOrNull(file) !== realEntry) {
      report(
        'root-cycle',
        "'" + value + "' requires the package entry point from a sibling module; the barrel " +
          'imports its namespaces, never the other way round',
        specifier.offset
      );
      continue;
    }
    if (realSrcRoot === null || !isInsideOrEqual(realResolved, realSrcRoot)) {
      report(
        'import-outside-src',
        "'" +
          value +
          "' resolves outside src/ (" +
          displayPath(packageRoot, realResolved) +
          '); a runtime module may only import files under its own src/',
        specifier.offset
      );
    }
  }

  // 2. Structural rules.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isIdent(token) || isMemberDot(tokens[i - 1])) continue;
    const chain = readMemberChain(tokens, i);
    if (chain === null) continue;

    const isGlobalRoot = GLOBAL_OBJECTS.has(chain.segments[0]);
    const members = isGlobalRoot ? chain.segments.slice(1) : chain.segments;
    if (members.length === 0) continue;
    const target = calledTarget(members);
    const after = tokens[chain.end + 1];
    const callOpen = isPunct(after, '?.') ? chain.end + 2 : chain.end + 1;
    const hasCall = isPunct(tokens[callOpen], '(');
    const previous = tokens[i - 1];

    if (target[0] === 'process' && target[1] === 'env') {
      report('process-env', 'reads process.env; the runtime receives a connected client and nothing else', chain.token.offset);
      continue;
    }

    if (target[0] === 'Date' && target[1] === 'now' && target.length === 2) {
      report('clock-read', 'reads Date.now(); the runtime takes "now" from the database or the caller', chain.token.offset);
      continue;
    }

    if (target[0] === 'Date' && target.length === 1) {
      // Two forms reach the Date FUNCTION, which returns the current time
      // however it is called: `Date(...)` and the zero-argument construction
      // `new Date()` / `new Date`. `new Date(value)` is the only permitted
      // form, because it parses a value the caller supplied.
      const withNew = isIdent(previous, 'new');
      if (withNew) {
        if (!hasCall) {
          report(
            'clock-read',
            'constructs a Date with no argument; `new Date(value)` from the caller is the permitted form',
            chain.token.offset
          );
        } else {
          const call = readDelimited(tokens, callOpen);
          const argument = call && call.ranges[0];
          const detail = classifyDateArgument(tokens, argument);
          if (detail !== null) report('clock-read', detail, chain.token.offset);
        }
      } else if (hasCall) {
        report(
          'clock-read',
          'reaches the Date function, which returns the current time however it is called',
          chain.token.offset
        );
      }
      continue;
    }

    if (hasCall && isIdent(previous, 'new') && (target[target.length - 1] === 'Pool' || target[target.length - 1] === 'Client')) {
      report(
        'connection-creation',
        'constructs new ' + target.join('.') + '; the runtime receives one connected client and never creates one',
        chain.token.offset
      );
      continue;
    }

    if (hasCall && hasAdjacentPair(target, 'pool', 'connect')) {
      report('pool-connect', 'checks a client out of a pool; the caller owns the connection', chain.token.offset);
      continue;
    }

    if (hasCall && target[target.length - 1] === 'release') {
      report('client-release', 'releases or closes the client; the caller owns its lifetime', chain.token.offset);
      continue;
    }

    if (hasCall && target[target.length - 1] === 'end' && target.length >= 2) {
      const receiver = target[target.length - 2].toLowerCase().replace(/[^a-z0-9]/g, '');
      if (CONNECTION_RECEIVER.test(receiver) && !NON_CONNECTION_RECEIVER.test(receiver)) {
        report(
          'connection-close',
          'calls .end() on ' + target.join('.') + '; the runtime never closes the client or pool it was given',
          chain.token.offset
        );
        continue;
      }
    }

    if (hasCall && HTTP_GLOBALS.has(target[0])) {
      report('http-call', 'calls ' + target.join('.') + '(); the runtime performs no network I/O', chain.token.offset);
      continue;
    }
  }

  // 3. Environment and connection strings, in identifiers and string content.
  for (const token of tokens) {
    if (isIdent(token) && DB_PARAMETER.test(token.value)) {
      report('db-connection-param', "'" + token.value + "' names a database connection parameter", token.offset);
      continue;
    }
    if (isString(token) && token.value !== '') {
      if (DB_URL.test(token.value)) {
        report('db-connection-param', 'carries a PostgreSQL connection string', token.offset);
      } else if (DB_HOST.test(token.value)) {
        report('db-connection-param', 'names a database host', token.offset);
      } else if (DB_PARAMETER.test(token.value)) {
        report('db-connection-param', 'names a database connection parameter', token.offset);
      }
    }
  }

  return violations;
}

/** Read and scan one file, and refuse a file whose real path leaves src/. */
function scanFile(file, options) {
  const source = fs.readFileSync(file, 'utf8');
  const violations = scanSource(source, { ...options, file });

  const srcRoot = path.join(options.packageRoot, 'src');
  const realSrcRoot = realpathOrNull(srcRoot);
  const realFile = realpathOrNull(file);
  if (realSrcRoot === null || realFile === null || !isInsideOrEqual(realFile, realSrcRoot)) {
    violations.push({
      rule: 'source-file-outside-root',
      detail:
        'the file resolves outside src/ (' +
        (realFile === null ? 'unresolvable' : displayPath(options.packageRoot, realFile)) +
        '); a symbolic link must not turn an external file into runtime source',
      line: null,
      file,
    });
  }

  return violations.map((violation) => ({ file, ...violation }));
}

/**
 * Every JavaScript source file under `directory`, recursively, sorted.
 * Symbolic links are followed rather than skipped: a link that points outside
 * `src/` must surface as a scanned (and rejected) file. A broken link is an
 * error, never a silent omission.
 */
function listSourceFiles(directory, visited) {
  const seen = visited || new Set();
  const realDirectory = realpathOrNull(directory);
  if (realDirectory !== null) {
    if (seen.has(realDirectory)) return [];
    seen.add(realDirectory);
  }

  const out = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (entry.isSymbolicLink()) {
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (_err) {
        throw new Error('broken symbolic link in the source tree: ' + full);
      }
      isDirectory = stat.isDirectory();
      isFile = stat.isFile();
    }

    if (isDirectory) {
      out.push(...listSourceFiles(full, seen));
      continue;
    }
    if (isFile && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out.sort();
}

module.exports = {
  lex,
  scanSource,
  scanFile,
  listSourceFiles,
  formatViolation,
  SOURCE_EXTENSIONS,
};
