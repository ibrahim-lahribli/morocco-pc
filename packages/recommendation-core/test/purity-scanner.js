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
//      template-literal VALUES, lexes REGULAR-EXPRESSION literals as their own
//      token (so a `}` or `Date.now` inside one is content, not structure),
//      and keeps template `${...}` bodies as code at any nesting depth.
//      Regex-versus-division is decided from BRACKET NESTING, not from the
//      preceding character alone: a `/` after a control-flow condition's `)`
//      (`if (flag) /re/`) or after a block statement's `}` (`if (f) { g(); }
//      /re/`) starts a regex, while a `/` after a call or group `)` or an
//      object literal's `}` divides.
//   2. STRUCTURAL MATCH. Rules match token sequences — `Date` `.` `now`,
//      `new` `Date` `(`, ident `query` after a member dot and before `(`, and
//      member chains rooted at a global object — not identifier spellings
//      alone. A trailing `.call`/`.apply`/`.bind` segment is dropped first, so
//      `Math.random.call(Math)` still reads as `Math.random`.
//   3. IMPORT RESOLUTION. Every statically known `require`/`import`/`from`
//      specifier is resolved against the real filesystem with Node's resolution
//      order (exact file, `.js`/`.cjs`/`.mjs`/`.json`, then a directory
//      `index`), through `realpath`, and the RESOLVED file must sit inside
//      `src/`. A computed specifier is a violation, not a silent skip.
//
// Known limitations (static scanning is approximate by construction — the
// import resolution above and the focused suite next to this file are what
// carry the boundary, not this list):
//   * Values built at runtime (`String.fromCharCode`, concatenated fragments)
//     are not reconstructed, so SQL assembled from pieces can slip past the
//     string rule. `.query()` — the call that would execute it — is matched
//     structurally.
//   * An import call can still be hidden behind an alias (`const r = require;
//     r(name)`), `eval`/`new Function`, `Reflect.get`, or a non-literal
//     computed member name (`globalThis[name]`). The boundary is a review gate
//     plus resolution, not a sandbox.
//   * Only `.js`/`.cjs`/`.mjs` files are scanned; the suite fails if the
//     source tree is empty, so a rename to another extension is visible as a
//     missing file rather than a silent pass.
//   * The name heuristics for connection parameters (`connectionString`,
//     `DATABASE_URL`, ...) are conservative: a property that merely shares one
//     of those names is reported, and the fix is to rename it.
//   * Telling a block statement's `}` from an object literal's `}` is a
//     heuristic (a `{` in statement position opens a block). It is only used
//     to choose between a regex and a division after the brace, and the
//     statement-position reading is the one that fails closed.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXTENSIONS = ['.js', '.cjs', '.mjs'];
const RESOLUTION_EXTENSIONS = ['.js', '.cjs', '.mjs', '.json'];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

// A `/` after one of these tokens starts a DIVISION, not a regular expression.
// `)` and `}` are deliberately NOT here: the lexer decides each one from the
// bracket it closed (see `afterControlCondition` / `closesBlock` on the token),
// because `if (flag) /re/` and `if (flag) { work(); } /re/` are valid code.
const DIVISION_PRECEDERS = new Set([']', '++', '--']);
// A `/` after one of these keywords starts a regular expression
// (`return /re/`, `case /re/:`).
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);
// `(` after one of these keywords opens a CONTROL-FLOW CONDITION: the `)` that
// closes it ends a condition, not a value, so a following `/` is a regex.
const CONTROL_CONDITION_KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'with']);
// `{` after one of these keywords opens a BLOCK STATEMENT, always.
const BLOCK_PRECEDING_KEYWORDS = new Set(['else', 'do', 'try', 'finally']);
// Invocation helpers. `Math.random.call(Math)` reaches the same function as
// `Math.random()`, so the helper segment is dropped before the rules read the
// member chain; only the helper segment, never the name under test.
const INVOCATION_METHODS = new Set(['call', 'apply', 'bind']);

// Objects whose properties ARE the global scope: `window.fetch` reaches the
// same binding as `fetch`, so the member chain is analysed from the property
// onwards.
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);

// --- lexer ------------------------------------------------------------------

/**
 * Does the `{` that follows `previous` open a BLOCK STATEMENT rather than an
 * object literal? It decides whether a `/` after that block's `}` starts a
 * statement (regex) or divides an object literal's value. Statement position
 * follows a `)` (a control condition or a function body), `=>`, `else`/`do`/
 * `try`/`finally`, a `;` or `}` that ended the previous statement, or the start
 * of the code; a value position follows `=`, `(`, `[`, `,`, `return` and the
 * operators.
 *
 * `:` needs the enclosing bracket, because it only introduces a block as a
 * case or label colon in STATEMENT position. Inside an object literal it
 * introduces a property value, and after a pending `?` it is a ternary's false
 * branch; both of those introduce a VALUE, so `{` after them is an object
 * literal. Reading such an object as a block would turn the division that
 * follows it into a regex opener and swallow whatever comes next, which is the
 * escape this distinction exists to prevent.
 */
function startsBlock(previous, enclosing) {
  if (!previous) return true;
  if (previous.type === 'punct') {
    if (previous.value === ':') {
      if (previous.ternary === true) return false;
      return enclosing === null || (enclosing.kind === 'brace' && enclosing.block === true);
    }
    return (
      previous.value === ')' ||
      previous.value === '}' ||
      previous.value === ';' ||
      previous.value === '{' ||
      previous.value === '>' // the `>` of `=> {`
    );
  }
  if (previous.type === 'ident') return BLOCK_PRECEDING_KEYWORDS.has(previous.value);
  return false;
}

/**
 * Tokenize JavaScript well enough to tell code from comments, strings and
 * regular expressions.
 * Tokens: { type: 'ident'|'string'|'number'|'punct'|'regex', value, offset }.
 * Template literals emit one `string` token per literal chunk and `punct`
 * `${` / `}` around the interpolation, whose body is lexed as code. Chunk
 * tokens carry `templateGroup`/`templateInterpolated` so a specifier that
 * spans an interpolation is not mistaken for a static one.
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
   * Read a `/.../flags` literal starting at `i`. Character classes (`[}]`)
   * and escaped characters are content, so a brace inside either one cannot be
   * mistaken for the end of a template interpolation.
   *
   * Returns a `regex` token, or — when the text cannot be a regex (it hits a
   * newline before a closing slash) — a single `/` punct token and rewinds, so
   * the caller's normal punct handling continues.
   */
  function readRegex() {
    const start = i;
    const bodyStart = i + 1;
    let inClass = false;
    i = bodyStart;
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
    if (prev.type === 'punct') {
      // A `)` that closed a control-flow condition and a `}` that closed a
      // block statement end a STATEMENT position, so `/` starts a regex there;
      // a `)` that closed a call or a group, and a `}` that closed an object
      // literal, end a VALUE, so `/` divides.
      if (prev.value === ')') return prev.afterControlCondition === true;
      if (prev.value === '}') return prev.closesBlock === true;
      return !DIVISION_PRECEDERS.has(prev.value);
    }
    if (prev.type === 'ident') return REGEX_KEYWORDS.has(prev.value);
    // string, number or regex: `/` divides.
    return false;
  }

  function readTemplate() {
    const group = templateSeq++;
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
        tokens.push({ type: 'string', value: chunk, offset: chunkStart, template: true, templateGroup: group });
        return;
      }
      if (c === '$' && source[i + 1] === '{') {
        tokens.push({ type: 'string', value: chunk, offset: chunkStart, template: true, templateGroup: group });
        chunk = '';
        tokens.push({ type: 'punct', value: '${', offset: i });
        i += 2;
        lexCode(true);
        tokens.push({ type: 'punct', value: '}', offset: i - 1 });
        chunkStart = i;
        continue;
      }
      chunk += c;
      i++;
    }
    tokens.push({ type: 'string', value: chunk, offset: chunkStart, template: true, templateGroup: group });
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
    // Open bracket contexts, innermost last. They are what lets `regexAllowed`
    // tell a `)` that closed `if (...)` from one that closed a call, and a `}`
    // that closed a block from one that closed an object literal.
    const brackets = [];
    // Depths of the `?` tokens still waiting for their `:`, so a ternary colon
    // can be told from an object property's colon and from a `case` label's.
    const ternaries = [];

    function innermost() {
      return brackets.length === 0 ? null : brackets[brackets.length - 1];
    }

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
      if (c === '(') {
        const before = previous();
        brackets.push({
          kind: 'paren',
          control: isIdent(before) && CONTROL_CONDITION_KEYWORDS.has(before.value),
        });
        tokens.push({ type: 'punct', value: '(', offset: i });
        i++;
        continue;
      }
      if (c === ')') {
        const open = innermost();
        const closesCondition = open !== null && open.kind === 'paren' && open.control === true;
        if (open !== null && open.kind === 'paren') brackets.pop();
        tokens.push({ type: 'punct', value: ')', offset: i, afterControlCondition: closesCondition });
        i++;
        continue;
      }
      if (c === '[') {
        brackets.push({ kind: 'bracket' });
        tokens.push({ type: 'punct', value: '[', offset: i });
        i++;
        continue;
      }
      if (c === ']') {
        const open = innermost();
        if (open !== null && open.kind === 'bracket') brackets.pop();
        tokens.push({ type: 'punct', value: ']', offset: i });
        i++;
        continue;
      }
      if (c === '{') {
        depth++;
        brackets.push({ kind: 'brace', block: startsBlock(previous(), innermost()) });
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
        const open = innermost();
        const closesBlock = open !== null && open.kind === 'brace' && open.block === true;
        if (open !== null && open.kind === 'brace') brackets.pop();
        tokens.push({ type: 'punct', value: '}', offset: i, closesBlock });
        i++;
        continue;
      }
      if (c === '?') {
        if (source[i + 1] === '.') {
          tokens.push({ type: 'punct', value: '?.', offset: i });
          i += 2;
          continue;
        }
        // `??` and `??=` are single operators: lexing them as two `?` tokens
        // would leave a phantom pending ternary behind.
        if (source[i + 2] === '=' && source[i + 1] === '?') {
          tokens.push({ type: 'punct', value: '??=', offset: i });
          i += 3;
          continue;
        }
        if (source[i + 1] === '?') {
          tokens.push({ type: 'punct', value: '??', offset: i });
          i += 2;
          continue;
        }
        tokens.push({ type: 'punct', value: '?', offset: i });
        ternaries.push(brackets.length);
        i++;
        continue;
      }
      if (c === ':') {
        // A `:` at the depth of a pending `?` is that ternary's false branch.
        const isTernary = ternaries.length > 0 && ternaries[ternaries.length - 1] === brackets.length;
        if (isTernary) ternaries.pop();
        tokens.push({ type: 'punct', value: ':', offset: i, ternary: isTernary });
        i++;
        continue;
      }
      const three = source.slice(i, i + 3);
      if (three === '...') {
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

/**
 * A specifier is statically known when it is a plain string literal, or a
 * template literal with no interpolation (`require(`./index`)`). Anything
 * computed is a violation.
 */
function isStaticallyKnownString(token) {
  if (!isString(token)) return false;
  if (!token.template) return true;
  return token.templateInterpolated !== true;
}

/**
 * Read a member chain starting at `start` (`a.b?.c['d']`) and report the
 * segment list plus the index of its last token. Returns null when `start` is
 * not an identifier.
 */
function readMemberChain(tokens, start) {
  const first = tokens[start];
  if (!isIdent(first)) return null;
  const segments = [first.value];
  let end = start;
  let computed = false;
  while (end + 1 < tokens.length) {
    let bracket = -1;
    const next = tokens[end + 1];
    if (isMemberDot(next)) {
      if (isIdent(tokens[end + 2])) {
        segments.push(tokens[end + 2].value);
        end += 2;
        continue;
      }
      if (isPunct(tokens[end + 2], '[')) bracket = end + 2;
      else break;
    } else if (isPunct(next, '[')) {
      bracket = end + 1;
    } else {
      break;
    }
    const inner = tokens[bracket + 1];
    const close = tokens[bracket + 2];
    if (isStaticallyKnownString(inner) && isPunct(close, ']')) {
      segments.push(inner.value);
      end = bracket + 2;
      computed = true;
      continue;
    }
    break;
  }
  return { segments, end, computed, token: first };
}

/**
 * Drop trailing `.call`/`.apply`/`.bind` segments, so a forbidden function is
 * matched however it is invoked: `Math.random.call(Math)`, `Date.now.apply(x)`
 * and `Math.random.bind(Math)` all reduce to their two-segment name. Only the
 * invocation helper is dropped, and never the whole chain, so `obj.call(x)` and
 * an ordinary property read are unaffected.
 */
function calledTarget(segments) {
  const target = segments.slice();
  while (target.length > 1 && INVOCATION_METHODS.has(target[target.length - 1])) target.pop();
  return target;
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

function isRelativeSpecifier(value) {
  return value === '.' || value === '..' || value.startsWith('./') || value.startsWith('../');
}

/**
 * Every import-shaped construct, with the specifier token when it is statically
 * known and the call token when it is not.
 *
 * @returns {Array<{kind: 'static'|'dynamic', token: object, call: string}>}
 */
function collectImports(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isIdent(token)) continue;
    if (token.value === 'require' || token.value === 'import') {
      let open = i + 1;
      // `require?.(x)` / `import?.(x)`
      if (isPunct(tokens[open], '?.')) open++;
      // `import.meta`, `require.resolve(...)`, and a bare `require` value are
      // not import calls; `from` still covers `import x from 'y'`.
      if (!isPunct(tokens[open], '(')) continue;
      const argument = tokens[open + 1];
      if (isStaticallyKnownString(argument)) out.push({ kind: 'static', token: argument, call: token.value });
      else out.push({ kind: 'dynamic', token, call: token.value });
      continue;
    }
    if (token.value === 'from' && isStaticallyKnownString(tokens[i + 1])) {
      out.push({ kind: 'static', token: tokens[i + 1], call: 'from' });
    }
  }
  return out;
}

function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch (_err) {
    return null;
  }
}

/**
 * Node-style candidate list for a relative specifier, without loading it:
 * the exact file, then the source/manifest extensions, then a directory index.
 * Every match is returned through `realpath`, so a symbolic link cannot make an
 * outside file look like it lives inside `src/`.
 *
 * @returns {{file: string|null, lexical: string|null, brokenSymlink: string|null}}
 */
function resolveRelative(specifier, fromDir) {
  const base = path.resolve(fromDir, specifier);
  const candidates = [base];
  for (const extension of RESOLUTION_EXTENSIONS) candidates.push(base + extension);
  for (const extension of RESOLUTION_EXTENSIONS) candidates.push(path.join(base, 'index' + extension));

  let brokenSymlink = null;
  for (const candidate of candidates) {
    let entry;
    try {
      entry = fs.lstatSync(candidate);
    } catch (_err) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      const real = realpathOrNull(candidate);
      if (real === null) {
        brokenSymlink = brokenSymlink || candidate;
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(real);
      } catch (_err) {
        brokenSymlink = brokenSymlink || candidate;
        continue;
      }
      if (stat.isFile()) return { file: real, lexical: candidate, brokenSymlink: null };
      // A directory link is followed by the `index` candidates below, whose
      // realpath is then checked against the source root.
      continue;
    }
    if (entry.isFile()) {
      const real = realpathOrNull(candidate);
      if (real === null) return { file: null, lexical: candidate, brokenSymlink: candidate };
      return { file: real, lexical: candidate, brokenSymlink: null };
    }
  }
  return { file: null, lexical: null, brokenSymlink };
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

/**
 * Scan one source string.
 *
 * @param {string} source module text
 * @param {{file?: string, coreRoot: string, sourceRoot?: string}} options
 *   `file` enables relative import resolution (its directory is the resolution
 *   base) and is reported with every violation
 * @returns {Array<{rule: string, detail: string, line: number|null, file: string|null}>}
 */
function scanSource(source, options) {
  const opts = options || {};
  const coreRoot = opts.coreRoot;
  if (typeof coreRoot !== 'string' || coreRoot === '') {
    throw new Error('scanSource requires options.coreRoot');
  }
  const file = opts.file || null;
  const sourceRoot = opts.sourceRoot || path.join(coreRoot, 'src');
  const realSourceRoot = realpathOrNull(sourceRoot);
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

  // 1. Imports. A specifier that cannot be read statically fails closed; a
  //    static one must resolve, through its real path, to a file inside src/.
  for (const entry of collectImports(tokens)) {
    if (entry.kind === 'dynamic') {
      report(
        'dynamic-import',
        entry.call +
          '() takes a specifier that is not a statically known string literal; ' +
          'the import specifier must be statically verifiable as a relative path inside src/',
        entry.token.offset
      );
      continue;
    }

    const specifier = entry.token;
    const value = specifier.value;
    if (!isRelativeSpecifier(value)) {
      report(
        'non-relative-import',
        "'" + value + "' is a " + classifyModule(value) + ' module; core may only import relative paths inside src/',
        specifier.offset
      );
      continue;
    }
    if (!file) continue;

    const resolution = resolveRelative(value, path.dirname(file));
    if (!resolution.file) {
      const why = resolution.brokenSymlink
        ? '; the symbolic link ' +
          displayPath(coreRoot, resolution.brokenSymlink) +
          ' cannot be followed (broken or looping link)'
        : '';
      report('unresolved-import', "'" + value + "' does not resolve to a file" + why, specifier.offset);
      continue;
    }
    if (realSourceRoot === null || !isInsideOrEqual(resolution.file, realSourceRoot)) {
      report(
        'import-outside-package',
        "'" +
          value +
          "' resolves outside the core src/ source boundary (" +
          displayPath(coreRoot, resolution.file) +
          '); an import may only reach a real file under src/, directly or through a symbolic link',
        specifier.offset
      );
    }
  }

  // 2. Structural, token-sequence rules.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const previous = tokens[i - 1];
    const following = tokens[i + 1];

    // 2a. Member chains rooted at a scope object. `globalThis.fetch` reaches
    //     the same binding as `fetch`, so the chain is analysed from the first
    //     property onwards; a chain rooted at any other identifier is that
    //     object's business.
    if (isIdent(token) && !isMemberDot(previous)) {
      const chain = readMemberChain(tokens, i);
      const isGlobalRoot = GLOBAL_OBJECTS.has(chain.segments[0]);
      const members = isGlobalRoot ? chain.segments.slice(1) : chain.segments;
      // `Math.random.call(Math)` and `Date.now.call(Date)` reach the same
      // functions; the rules below read the name without the invocation helper.
      const target = calledTarget(members);
      const after = tokens[chain.end + 1];
      const hasCall = isPunct(after, '(');
      const isEmptyCall = hasCall && isPunct(tokens[chain.end + 2], ')');

      if (target.length > 0) {
        if (target[0] === 'process' && target[1] === 'env') {
          report('process-env', 'reads process.env; core takes its environment as an argument', chain.token.offset);
        } else if (target[0] === 'Date' && target[1] === 'now' && target.length === 2) {
          report('clock-read', 'reads Date.now(); core receives time from its caller', chain.token.offset);
        } else if (target[0] === 'Date' && target.length === 1) {
          // Two forms reach the Date FUNCTION, which returns the current time
          // however it is called: `Date(...)` — including through
          // `.call`/`.apply`, whose arguments are the helper's, not Date's —
          // and the zero-argument construction `new Date()` / `new Date`.
          // `new Date(value)` is the only permitted form, because it parses a
          // value the caller supplied. `globalThis.Date` is the same binding,
          // so it is checked without `new` too.
          const withNew = isIdent(previous, 'new');
          if (withNew) {
            if (isEmptyCall || !hasCall) {
              report(
                'clock-read',
                'constructs a Date with no argument; `new Date(value)` from the caller is the permitted form',
                chain.token.offset
              );
            }
          } else if (hasCall) {
            report(
              'clock-read',
              'reaches the Date function, which returns the current time however it is called; ' +
                '`new Date(value)` from the caller is the only permitted form',
              chain.token.offset
            );
          }
        } else if (target[0] === 'Math' && target[1] === 'random' && target.length === 2) {
          report('randomness', 'calls Math.random(); core must be deterministic', chain.token.offset);
        } else if (target[0] === 'crypto') {
          // `{ crypto: 2 }` / `{ crypto }` in an object literal: a property key
          // named crypto is a name, not a use of the global. A GLOBAL
          // `globalThis.crypto` is always a use.
          if (isGlobalRoot || !isPunct(after, ':')) {
            report(
              'crypto',
              'uses ' + (isGlobalRoot ? chain.segments.slice(0, 2).join('.') : 'crypto') + '; core has no cryptographic or random source',
              chain.token.offset
            );
          }
        } else if (isGlobalRoot && (target[0] === 'require' || target[0] === 'import')) {
          report(
            'global-import',
            'reaches ' +
              chain.segments.join('.') +
              '; an import must be a statically verifiable relative path, not a global call',
            chain.token.offset
          );
        } else if (HTTP_GLOBALS.has(target[0]) && hasCall) {
          report(
            'http-call',
            'calls ' + chain.segments.join('.') + '(); core performs no network I/O',
            chain.token.offset
          );
        }
      }
    }

    if (isIdent(token, 'query') && isMemberDot(previous) && isPunct(following, '(')) {
      report('sql-call', 'calls .query(); core executes no statement', token.offset);
      continue;
    }

    if (isIdent(token) && DB_PARAMETER.test(token.value)) {
      report('db-connection-param', "'" + token.value + "' names a database connection parameter", token.offset);
      continue;
    }

    if (isString(token) && !token.template) {
      const value = token.value;
      for (const pattern of SQL_PATTERNS) {
        if (pattern.test(value)) {
          report('sql-string', 'contains SQL text; core performs no database access', token.offset);
          break;
        }
      }
    }

    if (isString(token)) {
      const value = token.value;
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

  // 3. SQL spanning one template literal's static chunks. Checking chunks in
  //    isolation hides `SELECT ${columns} FROM products`, so the chunks of a
  //    single literal are joined (with a separator, so fragments cannot fuse
  //    into a keyword) before the same focused patterns run.
  const templateText = new Map();
  for (const token of tokens) {
    if (!token.template) continue;
    if (!templateText.has(token.templateGroup)) templateText.set(token.templateGroup, []);
    templateText.get(token.templateGroup).push(token);
  }
  for (const chunks of templateText.values()) {
    const text = chunks.map((chunk) => chunk.value).join(' ');
    for (const pattern of SQL_PATTERNS) {
      if (pattern.test(text)) {
        report('sql-string', 'contains SQL text; core performs no database access', chunks[0].offset);
        break;
      }
    }
  }

  return violations;
}

/** Read and scan one file, and refuse a file whose real path leaves src/. */
function scanFile(file, coreRoot) {
  const source = fs.readFileSync(file, 'utf8');
  const violations = scanSource(source, { file, coreRoot });

  const sourceRoot = path.join(coreRoot, 'src');
  const realSourceRoot = realpathOrNull(sourceRoot);
  const realFile = realpathOrNull(file);
  if (realSourceRoot === null || realFile === null || !isInsideOrEqual(realFile, realSourceRoot)) {
    violations.push({
      rule: 'source-file-outside-root',
      detail:
        'the file resolves outside src/ (' +
        (realFile === null ? 'unresolvable' : displayPath(coreRoot, realFile)) +
        '); a symbolic link must not turn an external file into core source',
      line: null,
      file,
    });
  }

  return violations.map((violation) => ({ file, ...violation }));
}

/**
 * Every JavaScript source file under `directory`, recursively, sorted.
 * Symbolic links are followed rather than skipped: a link that points outside
 * `src/` must surface as a scanned (and rejected) file, not disappear from the
 * gate. A broken or looping link is an error, never a silent omission.
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
