'use strict';

// packages/recommendation-runtime/test/composite-lifecycle-scanner.js — the pure
// half of the F1 lifecycle gate (owner decision of 2026-11-26).
//
// WHY THIS IS ITS OWN FILE, AND WHY IT TAKES DATA RATHER THAN A TREE.
// The owner approved the three composite barrels as an unpublished, step-6-scoped
// exception with one condition no test executed: step 6 must DELETE them once the
// orchestrator's specifiers are rewritten (docs/MIXED_BARRELS.md §5.4, condition
// 5). A test that only asserts today's directory listing can never enforce that:
// the removal branch would be dead code nobody has ever run, and a half-finished
// migration would look exactly like a passing one.
//
// So the decision logic lives here as a pure function over an OBSERVATION, and
// composite-lifecycle.test.js both (a) feeds it the real tree and (b) feeds it
// synthetic trees in each of the three possible states. The MIGRATED branch is
// therefore executable today, and a reviewer can see it fail.
//
// Three states, no fourth:
//   ACTIVE   - the orchestrator still requires the composites from exactly the
//              four committed modules, and every condition of the exception holds.
//   MIGRATED - no orchestrator module requires a composite any more, and nothing
//              of the exception survives (files, spreaders, SHIM FILES, legacy
//              importers).
//   PARTIAL  - anything in between. Deliberately a FAILURE: a tree where some
//              consumers were rewritten and others were not is mid-migration, and
//              treating it as either end state would let the other half rot.
//
// WHAT THE DETECTORS DELIBERATELY DO, because each one has a way of being wrong:
//   * Shim EXISTENCE is observed separately from shim CONTENTS. A shim that
//     survives step 6 but re-points elsewhere is still an undeleted compatibility
//     path, so MIGRATED fails on the file, not on what it re-exports.
//   * Legacy-path consumers are found from SPECIFIERS, not prose: a `require` /
//     `import` whose path segments are `recommendation/<stage>` counts, a path
//     string in a script's own data or a sentence in a comment does not.
//   * Core spreaders are found by the RE-EXPORT BEHAVIOUR (`...require(...)`,
//     `...core`, `Object.assign({}, core)`, `module.exports = core`), at any depth
//     under the runtime source, at ANY depth (`runtimeSurfacePublishers` judges every
//     file the caller walked, so a nested composite is not invisible), in any quote
//     style and any spacing. Importing one core function for internal use is not a
//     spread and is not flagged.
//   * Comments are removed by a small lexer, not a regex, so a string containing
//     `//` (a URL) cannot swallow the rest of a real line.
//
// DB-free and dependency-free: no fs and no require of the package. The caller
// supplies the bytes and the observations. `node:path`'s POSIX half is used for
// exactly one job - RESOLVING a relative specifier against the directory of the
// file that wrote it - because that is the one thing a string match cannot do:
// the same composite file is `../candidates` from `src/orchestrator/run.js`,
// `../../candidates` from `src/orchestrator/lib/x.js`, and `../candidates/index`
// or `../candidates/index.js` in the spellings Node also accepts.

const STAGES = Object.freeze(['candidates', 'filtering', 'scoring']);

// The in-package consumers of the exception, committed on purpose. The owner's
// condition 6 says no future module may use this exception as precedent, so this
// is an EXACT map: a fifth module gaining a composite `require` fails the gate
// rather than quietly joining the set.
const EXPECTED_ACTIVE_DEPENDENCIES = Object.freeze({
  'run.js': Object.freeze(['candidates', 'filtering', 'scoring']),
  'swap-preview.js': Object.freeze(['candidates', 'filtering']),
  'swap-commit.js': Object.freeze(['scoring']),
  'compute.js': Object.freeze(['scoring']),
});

// The suites that must stay discoverable while the exception is active: the
// key-set/identity/order proof, and this gate itself.
const REQUIRED_SUITES = Object.freeze(['composite-lifecycle.test.js', 'namespace-barrels.test.js']);

// The specifier forms that can reach a Core entry adapter, e.g. `../core-entry`,
// `../../core-entry', `../../core-entry.js` (the runtime tree nests one level
// deeper than the legacy tree, so the relative depth must not be hard-coded).
// No captured quote and no backreference here on purpose: this constant is
// concatenated into regexes that have groups of their own, and a `\1` would
// then point at the wrong group (the binding name, in the `const core = ...`
// form) instead of the quote - which read as "not a spread" for exactly the
// shape the three composites are written in.
const CORE_ENTRY_SPECIFIER = String.raw`['"][^'"\n]*core-entry(?:\.js)?['"]`;

// A `/` can start a regex literal only where a value may begin.
const REGEX_PRECEDERS = '(,=:[!&|?{};+-*%<>~^';

/**
 * Comments removed, everything else preserved byte for byte.
 *
 * A lexer rather than a regex on purpose. The regex this replaced treated `//`
 * as a comment wherever it was not preceded by a quote or a colon, so a line such
 * as `const s = 'see // notes'; const c = require('../candidates');` lost the
 * require - a false negative in exactly the direction that matters, because the
 * missed `require` is the evidence a gate exists to find.
 *
 * String literals (single, double and template) are kept verbatim, escapes are
 * respected, and regex literals are skipped as literals so a quote inside a
 * character class cannot open a phantom string. Line structure is preserved:
 * a `//` comment is skipped up to, not including, its newline.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  const text = String(source);
  let out = '';
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const char = text[i];
    if (quote === null) {
      if (char === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i += 1;
        continue;
      }
      if (char === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
        i += 2;
        out += ' ';
        continue;
      }
      if (char === '/' && REGEX_PRECEDERS.indexOf(lastSignificant(out)) !== -1) {
        out += char;
        i += 1;
        let inClass = false;
        while (i < text.length) {
          const inner = text[i];
          if (inner === '\\') {
            out += inner;
            if (i + 1 < text.length) out += text[i + 1];
            i += 2;
            continue;
          }
          out += inner;
          i += 1;
          if (inner === '\n') break;
          if (inner === '[') inClass = true;
          else if (inner === ']') inClass = false;
          else if (inner === '/' && !inClass) break;
        }
        continue;
      }
      if (char === "'" || char === '"' || char === '`') quote = char;
      out += char;
      i += 1;
      continue;
    }
    if (char === '\\') {
      out += char;
      if (i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    out += char;
    if (char === quote) quote = null;
    i += 1;
  }
  return out;
}

/** The last non-whitespace character emitted so far, or '' at the start. */
function lastSignificant(text) {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return '';
}

const POSIX = require('node:path').posix;

// The composite implementation files, as package-relative POSIX paths. This is
// the only definition of "is a composite" the detectors use: identity is the
// RESOLVED file, never the shape of the specifier that reached it.
const COMPOSITE_FILES = Object.freeze({
  candidates: 'src/candidates/index.js',
  filtering: 'src/filtering/index.js',
  scoring: 'src/scoring/index.js',
});

/**
 * The forms Node resolves for a relative specifier without a known extension set:
 * the path itself, then `<path>.js`, then `<path>/index.js`. Anything outside
 * that list is not a module this package can reach by a relative path.
 *
 * @param {string} fromFile package-relative path of the importing file
 * @param {string} specifier the literal written in the source
 * @returns {string[] | null} package-relative candidates, or null when the
 *   specifier is bare (`node:path`, a package name) and cannot name a composite
 */
function resolveSpecifier(fromFile, specifier) {
  if (typeof specifier !== 'string' || specifier.startsWith('.') === false) return null;
  const from = '/' + String(fromFile).replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = POSIX.resolve(POSIX.dirname(from), specifier).replace(/^\/+/, '');
  return [resolved, resolved + '.js', resolved + '/index.js'];
}

/**
 * The stage whose composite implementation one resolved specifier names.
 *
 * @param {string[]} candidates
 * @returns {string | null}
 */
function stageOfCandidates(candidates) {
  for (const stage of STAGES) {
    if (candidates.includes(COMPOSITE_FILES[stage])) return stage;
  }
  return null;
}

/**
 * Every literal specifier a module writes, with its position: `require(...)`,
 * `require.resolve(...)`, `import x from '...'` and the bare `import '...'`
 * side-effect form. All four can reach a composite, and a detector that only
 * knew `require('../<stage>')` would miss the other three.
 *
 * @param {string} code comment-stripped source
 * @returns {{specifier: string, index: number}[]}
 */
function specifierMatches(code) {
  const patterns = [
    /\brequire(?:\s*\.\s*resolve)?\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /\bfrom\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*(['"])([^'"\n]+)\1/g,
    // Dynamic `import('./x')`: an ESM load with a literal specifier is as
    // resolvable as `require`, and leaving it out made a `.mjs` consumer
    // invisible even once the walk reached the file.
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ];
  const found = [];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      found.push({ specifier: match[2], index: match.index });
    }
  }
  return found;
}

/**
 * Requires whose argument is not a literal: `require(path.join(...))`,
 * `require(someVariable)`, `` require(`../scoring`) `` with a substitution.
 *
 * FAIL CLOSED. A gate that shrugs at what it cannot read is a gate a caller can
 * walk past by computing the path; the tree this repository accepts today has no
 * such require in the package source, so a problem here is a NEW construct that
 * must be rewritten as a literal or reviewed deliberately.
 *
 * @param {string} code comment-stripped source
 * @returns {string[]} the unresolved argument text, trimmed
 */
function unresolvableRequires(code) {
  const found = [];
  const pattern = /\b(?:require(?:\s*\.\s*resolve)?|import)\s*\(\s*/g;
  for (const match of code.matchAll(pattern)) {
    const rest = code.slice(match.index + match[0].length);
    if (/^['"]/.test(rest)) continue;
    found.push(rest.slice(0, 48).replace(/\s+/g, ' ').trim());
  }
  // `require` used as a VALUE (`const r = require; r('../x')`) and
  // `createRequire(...)` both load a module through a name this scanner cannot
  // follow. They fail closed for the same reason a computed argument does: a
  // gate that cannot see the load cannot judge it, and silence there is how a
  // caller walks a composite past the gate.
  const alias = /\brequire\b(?!\s*(?:\.\s*resolve)?\s*\()/g;
  for (const match of code.matchAll(alias)) {
    found.push('(aliased require) ' + code.slice(match.index, match.index + 32).replace(/\s+/g, ' ').trim());
  }
  const createRequire = /\bcreateRequire\s*\(/g;
  for (const match of code.matchAll(createRequire)) {
    found.push('(createRequire) ' + code.slice(match.index, match.index + 32).replace(/\s+/g, ' ').trim());
  }
  return found;
}

/**
 * The composite stages one source file requires, by resolution.
 *
 * Only the exact barrel counts: the resolved file must BE
 * `src/<stage>/index.js`. A subpath require such as `../candidates/errors` is a
 * different module and is not a consumer of the exception; so is `./candidates`
 * written beside a file that is not the barrel.
 *
 * @param {string} source
 * @param {string} [fromFile] package-relative path of the importing file; the
 *   committed consumer depth is the default so a one-argument call keeps its
 *   historical meaning
 * @returns {string[]} stages, in STAGES order
 */
function stagesRequiredBy(source, fromFile) {
  const file = typeof fromFile === 'string' && fromFile.length > 0
    ? fromFile
    : 'src/orchestrator/consumer.js';
  const found = new Set();
  for (const { specifier } of specifierMatches(stripComments(source))) {
    const candidates = resolveSpecifier(file, specifier);
    if (candidates === null) continue;
    const stage = stageOfCandidates(candidates);
    if (stage !== null) found.add(stage);
  }
  return STAGES.filter((stage) => found.has(stage));
}

/**
 * Does this file spread or re-export the Core entry SURFACE?
 *
 * The rule is about exposure, not about Core usage: the three composites earn
 * their exception by publishing a Core namespace beside this package's own
 * members (`module.exports = { ...core.candidates, loadCandidates }`). A module
 * that imports one Core function to call it internally is legitimate and is not
 * flagged - that is why the detectors below key on the EXPORT POSITION and on the
 * spread/re-export forms rather than on the bare `core-entry` specifier.
 *
 * Forms detected, in any quote style and any spacing:
 *   - `module.exports = { ...require('../core-entry') }`      (inline spread)
 *   - `module.exports = require('../core-entry')`             (whole re-export)
 *   - `module.exports = Object.assign({}, require('...'))`    (merged re-export)
 *   - `const core = require(...)` then `...core` / `...core.candidates` inside
 *     `module.exports`, or `module.exports = core`, or
 *     `Object.assign({}, core)`.
 *   - MEMBER-BY-MEMBER re-export: `pure.a`, `pure.b` written out inside
 *     `module.exports`. This is the `scoring` composite's shape: it cannot
 *     spread without reordering a pinned key set, so it names every core member
 *     explicitly. A core member READ as a value there is the same publication as
 *     a spread; a core member CALLED (`pure.a()`) is internal use, not exposure,
 *     and stays unflagged.
 *
 * @param {string} source
 * @returns {boolean}
 */
function coreEntrySpread(source) {
  const code = stripComments(source);
  const exportAt = code.indexOf('module.exports');
  const exported = (index) => exportAt >= 0 && typeof index === 'number' && index > exportAt;

  const inlineSpread = new RegExp(String.raw`\.\.\.\s*require\s*\(\s*` + CORE_ENTRY_SPECIFIER + String.raw`\s*\)`, 'g');
  for (const match of code.matchAll(inlineSpread)) {
    if (exported(match.index)) return true;
  }

  const directReexport = new RegExp(String.raw`module\.exports\s*=\s*require\s*\(\s*` + CORE_ENTRY_SPECIFIER + String.raw`\s*\)`);
  if (directReexport.test(code)) return true;

  const assignInline = new RegExp(
    String.raw`Object\.assign\s*\(\s*\{\s*\}\s*,\s*require\s*\(\s*` + CORE_ENTRY_SPECIFIER + String.raw`\s*\)`
  );
  if (assignInline.test(code)) return true;

  const binding = new RegExp(
    String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*` + CORE_ENTRY_SPECIFIER + String.raw`\s*\)`,
    'g'
  );
  for (const match of code.matchAll(binding)) {
    for (const name of surfaceBindings(code, match[1])) {
      if (publishesSurface(code, name, exportAt)) return true;
    }
  }
  return false;
}

/**
 * The local names that hold a core surface: the `require` binding itself, plus
 * each name assigned directly from it (`const pure = core.scoring;` — the
 * `scoring` composite's shape).
 *
 * One level, iterated to a fixed point, and no further: this repository's forms
 * are direct, and chasing arbitrary assignment chains would turn a detector into
 * a guesser that flags code it cannot actually justify.
 *
 * @param {string} code comment-stripped source
 * @param {string} rootName the variable bound to the core entry
 * @returns {string[]}
 */
function surfaceBindings(code, rootName) {
  const names = [rootName];
  for (let i = 0; i < names.length; i += 1) {
    const pattern = new RegExp(
      String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*`
        + escapeRegExp(names[i])
        + String.raw`(?:\s*\.\s*[A-Za-z_$][\w$]*)?\s*;`
    );
    const match = code.match(pattern);
    if (match !== null && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * Does one bound name publish the core surface in an exported position?
 *
 * Spreads, whole re-exports, `Object.assign` merges and member-by-member
 * re-exports all count. A member that is CALLED (`pure.a()`) does not: that is a
 * module using Core, not a module handing Core's names to its consumers.
 *
 * @param {string} code comment-stripped source
 * @param {string} name a local name holding a core surface
 * @param {number} exportAt index of the first `module.exports`, or -1
 * @returns {boolean}
 */
function publishesSurface(code, name, exportAt) {
  const escaped = escapeRegExp(name);
  const boundary = String.raw`(?![A-Za-z0-9_$])`;
  const exported = (index) => exportAt >= 0 && typeof index === 'number' && index > exportAt;

  const spread = new RegExp(String.raw`\.\.\.\s*` + escaped + boundary, 'g');
  for (const match of code.matchAll(spread)) {
    if (exported(match.index)) return true;
  }
  if (new RegExp(String.raw`module\.exports\s*=\s*` + escaped + String.raw`\s*(?:;|$)`).test(code)) return true;
  if (new RegExp(String.raw`Object\.assign\s*\(\s*\{\s*\}\s*,\s*` + escaped + boundary).test(code)) return true;
  if (new RegExp(String.raw`Object\.assign\s*\(\s*` + escaped + String.raw`\s*,`).test(code)) return true;

  const member = new RegExp(
    String.raw`(?<![\w$])` + escaped + String.raw`\s*\.\s*[A-Za-z_$][\w$]*`,
    'g'
  );
  for (const match of code.matchAll(member)) {
    if (!exported(match.index)) continue;
    const after = code.slice(match.index + match[0].length);
    if (!/^\s*\(/.test(after)) return true;
  }
  return false;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every specifier a module actually imports: `require(...)`,
 * `require.resolve(...)`, `import x from '...'` and the bare
 * `import '...'` side-effect form.
 *
 * Deliberately specifier-based. The repository contains path strings that look
 * identical but mean something else - `scripts/audit-pr2-test-ownership.js`
 * records old test paths as DATA, and the docs describe the paths in prose - and
 * neither is a consumer.
 *
 * @param {string} code comment-stripped source
 * @returns {string[]}
 */
function specifiersIn(code) {
  return specifierMatches(code).map((match) => match.specifier);
}

/**
 * The stages whose LEGACY compatibility path this file imports, e.g.
 * `require('../../../src/recommendation/candidates')`.
 *
 * Matched on PATH SEGMENTS, so `recommendation-runtime/src/candidates` (the new
 * composite) and `recommendation/candidates/loader` (a module that still lives in
 * the old tree) are not mistaken for the legacy barrel itself.
 *
 * @param {string} source
 * @returns {string[]} stages, in STAGES order
 */
function legacyBarrelStagesIn(source) {
  const found = new Set();
  for (const specifier of specifiersIn(stripComments(source))) {
    const segments = specifier.split(/[\\/]+/).filter((segment) => segment.length > 0);
    for (let i = 0; i < segments.length - 1; i += 1) {
      if (segments[i] !== 'recommendation') continue;
      const stage = segments[i + 1];
      if (!STAGES.includes(stage)) continue;
      const rest = segments.slice(i + 2);
      const isBarrel = rest.length === 0
        || (rest.length === 1 && (rest[0] === 'index' || rest[0] === 'index.js'));
      if (isBarrel) found.add(stage);
    }
  }
  return STAGES.filter((stage) => found.has(stage));
}

/**
 * The runtime source files that spread or re-export a core surface, at ANY
 * depth under the package's `src/`.
 *
 * Depth matters: a composite that step 6 forgets, or a future module that
 * re-creates one, does not have to sit at `src/<stage>/index.js`. A detector
 * that only ever looked one level down would call a nested composite clean, so
 * the caller hands in every source file it found and this function judges each
 * one on its BEHAVIOUR instead of on its path.
 *
 * @param {{path: string, source: string}[]} sources package-relative paths under `src/`
 * @returns {string[]} paths, sorted, so the verdict cannot depend on walk order
 */
function runtimeSurfacePublishers(sources) {
  return (sources || [])
    .filter((entry) => coreEntrySpread(entry.source))
    .map((entry) => entry.path)
    .sort();
}

/**
 * Every in-package file that reaches a composite, directly or by re-export.
 *
 * The key is the bare file name for the orchestrator's own directory - that is
 * the shape of the committed map - and the package-relative path for anything
 * elsewhere, so a nested file can never borrow a committed name and pass.
 *
 * A RELAY counts: a file whose `module.exports` IS another module hands that
 * module's surface to its consumers, so `module.exports = require('./impl')`
 * over a file that requires a composite is a compatibility path in disguise and
 * must be reported even though it writes no composite specifier itself.
 *
 * @param {{path: string, source: string}[]} sources package-relative paths under `src/`
 * @returns {{dependencies: Record<string, string[]>, problems: string[]}}
 */
function compositeDependencies(sources) {
  const list = (sources || []).map((entry) => ({
    path: String(entry.path).replace(/\\/g, '/'),
    code: stripComments(entry.source),
  }));
  const codeByPath = new Map(list.map((entry) => [entry.path, entry.code]));
  const dependencies = {};
  const problems = [];
  const relays = new Map();

  for (const entry of list) {
    const stages = new Set();
    for (const { specifier } of specifierMatches(entry.code)) {
      const candidates = resolveSpecifier(entry.path, specifier);
      if (candidates === null) continue;
      const stage = stageOfCandidates(candidates);
      if (stage !== null) stages.add(stage);
      const target = candidates.find((candidate) => codeByPath.has(candidate));
      if (target === undefined) continue;
      if (reexportsSpecifier(entry.code, specifier)) relays.set(entry.path, target);
    }
    if (stages.size > 0) dependencies[dependencyKey(entry.path)] = STAGES.filter((s) => stages.has(s));
    for (const text of unresolvableRequires(entry.code)) {
      problems.push(
        entry.path + ' requires a module through a non-literal expression (`' + text
          + '`), so whether it reaches a composite cannot be decided statically. The gate fails closed: '
          + 'write the specifier as a literal, or review the new construct deliberately.'
      );
    }
  }

  for (const start of relays.keys()) {
    if (dependencies[dependencyKey(start)] !== undefined) continue;
    let current = relays.get(start);
    const seen = new Set([start]);
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      if (dependencies[dependencyKey(current)] !== undefined) {
        dependencies[dependencyKey(start)] = dependencies[dependencyKey(current)].slice();
        break;
      }
      current = relays.get(current);
    }
  }

  return { dependencies, problems };
}

/**
 * Does this file hand another module's surface to its own consumers?
 *
 * Four shapes reach the same result, and a detector that knew only the first one
 * would miss a compatibility path written the other three ways:
 *
 *   module.exports = require('X')
 *   module.exports = { ...require('X') }
 *   Object.assign(module.exports, require('X'))
 *   module.exports = Object.assign({}, require('X'))
 *
 * @param {string} code comment-stripped source
 * @param {string} specifier the literal the re-export names
 * @returns {boolean}
 */
function reexportsSpecifier(code, specifier) {
  const quoted = String.raw`['"]` + escapeRegExp(specifier) + String.raw`['"]`;
  const forms = [
    String.raw`module\.exports\s*=\s*require\s*\(\s*` + quoted + String.raw`\s*\)`,
    String.raw`module\.exports\s*=\s*\{\s*\.\.\.\s*require\s*\(\s*` + quoted + String.raw`\s*\)\s*\}`,
    String.raw`Object\.assign\s*\(\s*module\.exports\s*,\s*require\s*\(\s*` + quoted + String.raw`\s*\)`,
    String.raw`module\.exports\s*=\s*Object\.assign\s*\(\s*\{\s*\}\s*,\s*require\s*\(\s*` + quoted + String.raw`\s*\)`,
  ];
  return forms.some((form) => new RegExp(form).test(code));
}

function dependencyKey(file) {
  return /^src\/orchestrator\/[^/]+\.js$/.test(file) ? file.slice('src/orchestrator/'.length) : file;
}

/**
 * Runtime source files that reach a composite, at any depth.
 *
 * The composite itself is not its own consumer, so `src/<stage>/index.js` is
 * skipped. Everything else counts: a nested module that still imports a
 * composite is exactly the specifier step 6 has to rewrite, whatever its depth
 * and whatever spelling Node accepts for it.
 *
 * @param {{path: string, source: string}[]} sources package-relative paths under `src/`
 * @returns {string[]} one line per offending file, sorted
 */
function runtimeCompositeConsumers(sources) {
  const { dependencies } = compositeDependencies(sources);
  const found = [];
  for (const entry of sources || []) {
    const file = String(entry.path).replace(/\\/g, '/');
    if (STAGES.some((stage) => COMPOSITE_FILES[stage] === file)) continue;
    const stages = dependencies[dependencyKey(file)];
    if (stages === undefined) continue;
    found.push(file + ' requires ' + stages.map((stage) => 'src/' + stage).join(', '));
  }
  return found.sort();
}

/**
 * Consumers of a LEGACY compatibility barrel, from real import specifiers only.
 *
 * This is the detector half of the MIGRATED condition: step 6 can delete every
 * composite and every shim and still leave `apps/api/src/engine.js` importing a
 * path that no longer exists. A path recorded as data or written in a comment is
 * not a consumer and is not reported.
 *
 * @param {{path: string, source: string}[]} sources repo-relative paths
 * @returns {string[]} one line per offending file, sorted
 */
function legacyConsumerReferences(sources) {
  const found = [];
  for (const entry of sources || []) {
    const stages = legacyBarrelStagesIn(entry.source);
    if (stages.length === 0) continue;
    found.push(
      entry.path + ' imports ' + stages.map((stage) => 'src/recommendation/' + stage).join(', ')
    );
  }
  return found.sort();
}

/** Stages in canonical order, so source order cannot change the verdict. */
function canonical(stages) {
  const set = new Set(stages || []);
  return STAGES.filter((stage) => set.has(stage));
}

function normalizeDependencies(byFile) {
  const normalized = {};
  for (const [file, stages] of Object.entries(byFile || {})) {
    const list = canonical(stages);
    if (list.length > 0) normalized[file] = list;
  }
  return normalized;
}

function describeDependencies(dependencies) {
  const files = Object.keys(dependencies).sort();
  if (files.length === 0) return '(none)';
  return files.map((file) => file + ' -> ' + dependencies[file].join('+')).join('; ');
}

/**
 * The state of the exception, from the per-file require map alone.
 *
 * @param {Record<string, string[]>} byFile orchestrator file name -> stages it requires
 * @returns {{state: 'ACTIVE'|'MIGRATED'|'PARTIAL', dependencies: object, union: string[]}}
 */
function classifyLifecycle(byFile) {
  const dependencies = normalizeDependencies(byFile);
  const files = Object.keys(dependencies).sort();
  const union = STAGES.filter((stage) => files.some((file) => dependencies[file].includes(stage)));

  if (files.length === 0) return { state: 'MIGRATED', dependencies: {}, union };

  const expectedFiles = Object.keys(EXPECTED_ACTIVE_DEPENDENCIES).sort();
  const sameKeys = files.length === expectedFiles.length && files.every((file, i) => file === expectedFiles[i]);
  const sameStages = sameKeys && expectedFiles.every((file) => {
    const observed = dependencies[file];
    const expected = EXPECTED_ACTIVE_DEPENDENCIES[file];
    return observed.length === expected.length && observed.every((stage, i) => stage === expected[i]);
  });

  return { state: sameStages ? 'ACTIVE' : 'PARTIAL', dependencies, union };
}

function sameSet(left, right) {
  const a = (left || []).slice().sort();
  const b = (right || []).slice().sort();
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function mentionsStage(keys, stage) {
  return (keys || []).includes(stage) || (keys || []).includes('./' + stage);
}

/**
 * Judge one observation. Returns the state and every problem it found; an empty
 * `problems` is the only PASS.
 *
 * @param {object} observation
 * @param {Record<string, string[]>} observation.dependencies orchestrator file -> stages required
 * @param {string[]} observation.compositeFiles composite implementation paths that exist
 * @param {string[]} observation.coreSpreaders runtime source files that spread or re-export a core surface
 * @param {string[]} observation.shimFiles stages whose legacy shim FILE exists, whatever it contains
 * @param {Record<string, boolean>} observation.shimRefsRuntime stage -> that shim re-exports the runtime composite
 * @param {string[]} [observation.legacyReferences] consumers importing `src/recommendation/<stage>`
 * @param {string[]} [observation.exportsKeys] package.json exports keys
 * @param {string[]} [observation.rootKeys] root namespace keys
 * @param {string[]} [observation.snapshotExports] committed export-surface snapshot
 * @param {string[]} [observation.discoveryRequired] assert-discovery REQUIRED list
 * @param {boolean} [observation.compositeSuitePresent]
 * @param {string[]} [observation.references] repo-wide references to a runtime composite
 * @returns {{state: 'ACTIVE'|'MIGRATED'|'PARTIAL', problems: string[], dependencies: object}}
 */
function assess(observation) {
  const obs = observation || {};
  const { state, dependencies } = classifyLifecycle(obs.dependencies);
  const problems = [];
  const compositeFiles = (obs.compositeFiles || []).slice().sort();
  const coreSpreaders = (obs.coreSpreaders || []).slice().sort();
  const shims = obs.shimRefsRuntime || {};
  const shimFiles = obs.shimFiles || [];
  const legacyReferences = obs.legacyReferences || [];
  const published = [
    ['package.json exports', obs.exportsKeys],
    ['the root namespace', obs.rootKeys],
    ['test/export-surface.json', obs.snapshotExports],
  ];

  // A require the gate cannot read is a hole in every verdict, ACTIVE included,
  // so it is collected exactly once, before any branch can return.
  for (const text of obs.unresolved || []) problems.push(text);

  if (state === 'PARTIAL') {
    const committed = Object.keys(EXPECTED_ACTIVE_DEPENDENCIES);
    const extra = Object.keys(dependencies).filter((file) => !committed.includes(file)).sort();
    problems.push(
      'PARTIAL MIGRATION: the orchestrator requires a composite from a set of files that is neither the four '
        + 'committed consumers nor none. Observed: ' + describeDependencies(dependencies) + '. Either restore '
        + 'the four committed consumers (ACTIVE) or finish the step 6 migration completely (MIGRATED); a '
        + 'half-migrated tree is not a valid state.'
        + (extra.length === 0 ? '' : ' UNEXPECTED CONSUMERS (any depth, any spelling): ' + extra.join(', ') + '.')
    );
    return { state, problems, dependencies };
  }

  if (state === 'ACTIVE') {
    // Condition 1 + the file set: exactly the three expected composites, no more.
    const expectedComposites = STAGES.map((stage) => 'src/' + stage + '/index.js');
    if (!sameSet(compositeFiles, expectedComposites)) {
      problems.push(
        'the composite file set must be exactly ' + expectedComposites.join(', ') + '; found '
          + (compositeFiles.length === 0 ? '(none)' : compositeFiles.join(', '))
      );
    }
    // A fourth file that spreads a core surface would be a new use of the
    // exception, which condition 6 forbids without a separate decision.
    if (!sameSet(coreSpreaders, STAGES.map((stage) => 'src/' + stage + '/index.js'))) {
      problems.push(
        'the only runtime files that may spread or re-export a core surface are '
          + STAGES.map((stage) => 'src/' + stage + '/index.js').join(', ') + '; found '
          + (coreSpreaders.length === 0 ? '(none)' : coreSpreaders.join(', '))
      );
    }
    // Condition 1's compatibility half: the old paths must still EXIST and be
    // identity shims to the composite, or the documented patch seam is detached.
    for (const stage of STAGES) {
      const shimPath = 'src/recommendation/' + stage + '/index.js';
      if (!shimFiles.includes(stage)) {
        problems.push(
          shimPath + ' must exist (it is the identity shim the patch seam depends on); it is missing'
        );
      } else if (shims[stage] !== true) {
        problems.push(shimPath + ' must re-export the runtime composite; it does not');
      }
    }
    // Condition 1's publication half: none of the three may be reachable through
    // the package name.
    for (const [label, keys] of published) {
      for (const stage of STAGES) {
        if (mentionsStage(keys, stage)) {
          problems.push(label + ' publishes ' + stage + '; the composites must stay unpublished');
        }
      }
    }
    // "Keep the existing key-set, identity and order tests active" is enforced as
    // a discovery fact: a rename that removes the proof fails here too.
    const required = obs.discoveryRequired || [];
    for (const suite of REQUIRED_SUITES) {
      if (!required.includes(suite)) {
        problems.push('assert-discovery.js REQUIRED no longer names ' + suite + ', so the proof can vanish silently');
      }
    }
    if (obs.compositeSuitePresent === false) {
      problems.push('test/composite-lifecycle.test.js is missing, so the gate is not discoverable');
    }
    // Legacy importers are TOLERATED here and only here: they are the documented
    // patch seam, and their existence is why the shims exist at all. MIGRATED
    // treats the same observation as a failure, which is where it belongs.
    return { state, problems, dependencies };
  }

  // MIGRATED: the exception is over, so every trace of it must be gone.
  if (compositeFiles.length > 0) {
    problems.push(
      'step 6 rewrote the consumers but these composite implementation files remain: '
        + compositeFiles.join(', ') + '. Owner condition 5 requires them DELETED, not left behind.'
    );
  }
  if (coreSpreaders.length > 0) {
    problems.push(
      'step 6 rewrote the consumers but these runtime files still spread or re-export a core surface: '
        + coreSpreaders.join(', ') + '. The exception is over; a composite that outlives it is a plain RFC §6.4 violation.'
    );
  }
  // EXISTENCE, not contents. A shim that outlives step 6 and re-points somewhere
  // else is still an undeleted compatibility path: the owner's condition says
  // DELETED, and "now it points at the core" is the repoint the condition names.
  for (const stage of STAGES) {
    if (shimFiles.includes(stage)) {
      const detail = shims[stage] === true
        ? 'it still re-exports the runtime composite'
        : 'it no longer re-exports the runtime composite, but the file itself must be DELETED, not repointed';
      problems.push(
        'the legacy shim src/recommendation/' + stage + '/index.js still exists (' + detail + ')'
      );
    }
  }
  if (legacyReferences.length > 0) {
    problems.push(
      'consumers still import a legacy compatibility barrel: ' + legacyReferences.join('; ')
        + '. Step 6 requires every consumer migrated off src/recommendation/{'
        + STAGES.join(',') + '}, not merely the shim file changed or removed.'
    );
  }
  if ((obs.references || []).length > 0) {
    problems.push(
      'obsolete compatibility consumers still reference a runtime composite: ' + obs.references.join('; ')
    );
  }
  return { state, problems, dependencies };
}

module.exports = {
  COMPOSITE_FILES,
  EXPECTED_ACTIVE_DEPENDENCIES,
  REQUIRED_SUITES,
  STAGES,
  assess,
  classifyLifecycle,
  compositeDependencies,
  coreEntrySpread,
  resolveSpecifier,
  stageOfCandidates,
  describeDependencies,
  legacyBarrelStagesIn,
  legacyConsumerReferences,
  reexportsSpecifier,
  runtimeCompositeConsumers,
  runtimeSurfacePublishers,
  stagesRequiredBy,
  stripComments,
};
