'use strict';

/**
 * scripts/audit-pr2-test-ownership.js - reproducible ownership audit for the
 * step 4B extractions.
 *
 * The PR moves pure test files into packages/recommendation-core/test/ and
 * leaves runtime-dependent ones in src/recommendation/. "Which test went
 * where, and why" must be checkable rather than asserted, so this script reads
 * the files themselves.
 *
 * The inventory below carries the PR 2 rows and, since step 4B PR 3, the seven
 * Engine 3 assembly rows: assembly's implementation moved into the core package
 * while its tests stayed in the runtime tree (they import ../ranking,
 * ../filtering/context-loader and ../offers/select). `--base` selects the
 * revision the before-counts come from; it never changes the inventory.
 *
 * How it measures:
 *   * tests and assertions are counted from the TOKEN STREAM (the core package's
 *     own lexer, packages/recommendation-core/test/purity-scanner.js), not from
 *     a line regex: `test()` and `it()` are both recognised, at any nesting
 *     depth inside `describe()`, and occurrences inside comments, strings or
 *     regex literals are not counted at all;
 *   * assertions repeated by a `for (const x of [ ... ])` loop are expanded
 *     STRUCTURALLY from the loop's literal case list - see deriveLoopExpansion -
 *     so an "effective" figure is computed from the source, never declared;
 *   * before-counts are read from a RESOLVED revision (see "Which revision"
 *     below), after-counts from the working tree;
 *   * every row is classified MOVED / STAYED / SPLIT / ADDED, so a newly added
 *     test can never be presented as a relocated one;
 *   * every core-owned test file is scanned with the SAME purity scanner that
 *     gates core's src/, under an allowance that is deliberately small: the test
 *     runner, the assertion library and the path library. Filesystem access is
 *     NOT a blanket allowance - it is granted to named files in
 *     FILESYSTEM_EXCEPTIONS, each with a reason, and an exception that stops
 *     being used fails the audit as stale. Network-capable modules are never
 *     allowed;
 *   * the L2/L3 provenance claims are delegated to scripts/verify-pr2-provenance.js
 *     rather than re-implemented here.
 *
 * Which revision supplies the BEFORE-counts is an input, never the working tree:
 *   * with no argument it is the baseline of the `step-4b-pr2` batch in
 *     extraction-manifest.json - the same immutable commit the L2 fixture was
 *     captured at;
 *   * `--base=<git-ref>` selects another revision explicitly. The reference must
 *     resolve to a commit that is an ancestor of HEAD, and the resolved
 *     40-character SHA is printed so a run is reproducible.
 * The flag changes the revision and nothing else: the inventory, the structural
 * counting, the purity scan and the invariants are identical for every base. A
 * base that does not contain a baseline file FAILS the audit instead of
 * measuring that file as zero, so a bad base can never be mistaken for a clean
 * relocation.
 *
 * DB-free, dependency-free, read-only. Run from the repository root:
 *   node scripts/audit-pr2-test-ownership.js
 *   node scripts/audit-pr2-test-ownership.js --base=581ee73
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CORE_ROOT = path.join(REPO_ROOT, 'packages', 'recommendation-core');
const CORE_TEST_REL = 'packages/recommendation-core/test';
const CORE_TEST_DIR = path.join(REPO_ROOT, CORE_TEST_REL);
const SCANNER = path.join(CORE_TEST_DIR, 'purity-scanner.js');
const PROVENANCE_SCRIPT = path.join(__dirname, 'verify-pr2-provenance.js');

/**
 * The manifest batch that supplies the DEFAULT baseline. PR 2 is the batch this
 * inventory was measured against; a later extraction batch appends to the
 * manifest and does not move this pointer.
 */
const DEFAULT_BASELINE_BATCH = 'step-4b-pr2';

const { lex, scanSource } = require(SCANNER);
const {
  MANIFEST_REL,
  isAncestor,
  isGitRepository,
  loadManifest,
  manifestFile,
  resolveCommit,
  tryGit,
} = require('./lib/extraction-manifest');

/**
 * What a core TEST may import from outside the package.
 *
 *   node:test            - the runner itself
 *   node:assert[/strict] - assertions
 *   node:path            - pure string manipulation, no filesystem access
 *
 * Anything else - a database driver, node:fs, node:os, node:net, node:https, an
 * npm module, a source tree outside the package - is a purity violation. There
 * is no category-level allowance here: widening it is a visible edit.
 */
const TEST_ALLOWED_BARE = new Set([
  'node:test',
  'node:assert',
  'node:assert/strict',
  'node:path',
]);

/**
 * The ONLY files that may touch the filesystem, and only through these exact
 * specifiers. Every entry names the call site's purpose; the audit fails if an
 * entry becomes unused (a stale exception is an unjustified one) or if a file
 * not listed here imports a filesystem module.
 */
const FILESYSTEM_EXCEPTIONS = new Map([
  [
    'filter.test.js',
    {
      specifiers: ['node:fs'],
      reason: 'read-only: reads its own filter.js source to assert a structural property',
    },
  ],
  [
    'pool.test.js',
    {
      specifiers: ['node:fs'],
      reason: 'read-only: reads its own pool source to assert a structural property',
    },
  ],
  [
    'index.test.js',
    {
      specifiers: ['node:fs'],
      reason: 'read-only: reads package.json to assert the declared main entry',
    },
  ],
  [
    'hermetic-run.test.js',
    {
      specifiers: ['node:fs', 'node:os'],
      reason: 'builds the hermetic fixture trees (temp dir, symlinks) and removes them; writes only under os.tmpdir()',
    },
  ],
  [
    'purity.test.js',
    {
      specifiers: ['node:fs', 'node:os'],
      reason: 'the scanner\'s own regression suite: builds fixture trees for it to scan; writes only under os.tmpdir()',
    },
  ],
]);

/**
 * `require('..')` names the package's own entry point. Node resolves it through
 * package.json `main`; the purity scanner resolves relative specifiers by file
 * and index only, so it reports this one as unresolved. The allowance is the
 * single specifier, not the rule.
 */
const TEST_ALLOWED_UNRESOLVED = new Set(['..']);

/**
 * The ownership inventory. `kind` is what the row is allowed to do:
 *   moved  - same content at a new path: counts must be identical
 *   stayed - untouched: counts must be identical
 *   split  - one file whose barrel contract is now asserted by two owners:
 *            assertions must be identical, tests may be redistributed
 *   added  - a new file with no baseline: counted, never called "moved"
 */
const INVENTORY = [
  // --- moved into the core package (pure: no loader, no environment) ---
  { kind: 'moved', baseline: 'src/recommendation/candidates/candidates.test.js', current: 'packages/recommendation-core/test/candidates.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/candidates/pool.test.js', current: 'packages/recommendation-core/test/pool.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/filtering/filter.test.js', current: 'packages/recommendation-core/test/filter.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/compatibility/case-radiator-memory.test.js', current: 'packages/recommendation-core/test/compatibility-case-radiator-memory.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/compatibility/compatibility.test.js', current: 'packages/recommendation-core/test/compatibility-compatibility.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/compatibility/cooler-height.test.js', current: 'packages/recommendation-core/test/compatibility-cooler-height.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/compatibility/cooler-tdp.test.js', current: 'packages/recommendation-core/test/compatibility-cooler-tdp.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/compatibility/cpu-motherboard-cooler.test.js', current: 'packages/recommendation-core/test/compatibility-cpu-motherboard-cooler.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/compatibility/gpu-psu.test.js', current: 'packages/recommendation-core/test/compatibility-gpu-psu.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/compatibility/memory-capacity.test.js', current: 'packages/recommendation-core/test/compatibility-memory-capacity.test.js' },
  { kind: 'moved', baseline: 'src/recommendation/compatibility/memory-slots.test.js', current: 'packages/recommendation-core/test/compatibility-memory-slots.test.js' },

  // --- stayed: runtime-dependent, or mixed but un-splittable in this PR ---
  { kind: 'stayed', baseline: 'src/recommendation/candidates/loader.test.js', current: 'src/recommendation/candidates/loader.test.js' },
  { kind: 'stayed', baseline: 'src/recommendation/filtering/context-loader.test.js', current: 'src/recommendation/filtering/context-loader.test.js' },
  { kind: 'stayed', baseline: 'src/recommendation/filtering/integration.test.js', current: 'src/recommendation/filtering/integration.test.js' },
  { kind: 'stayed', baseline: 'src/recommendation/filtering/pipeline.test.js', current: 'src/recommendation/filtering/pipeline.test.js' },
  { kind: 'stayed', baseline: 'src/recommendation/filtering/igpu-map.test.js', current: 'src/recommendation/filtering/igpu-map.test.js' },

  // --- stayed (step 4B PR 3): the Engine 3 tests stay in the runtime tree ---
  // The implementation moved to packages/recommendation-core/src/assembly/,
  // but these seven files cannot follow it byte-identically: assemble.test.js
  // imports ../ranking/select-diverse, gpu-input.test.js and pipeline.test.js
  // import ../filtering/context-loader and ../offers/select, and six of them
  // read the implementation SOURCE through __dirname. Repointing that read at
  // the core path is what keeps the assertion honest after the move (a shim
  // would pass every "must not contain" check vacuously). No test or assertion
  // was removed or weakened - the counts below prove it.
  { batch: 'step-4b-pr3', kind: 'stayed', baseline: 'src/recommendation/assembly/assemble.test.js', current: 'src/recommendation/assembly/assemble.test.js' },
  { batch: 'step-4b-pr3', kind: 'stayed', baseline: 'src/recommendation/assembly/gpu-input.test.js', current: 'src/recommendation/assembly/gpu-input.test.js' },
  { batch: 'step-4b-pr3', kind: 'stayed', baseline: 'src/recommendation/assembly/gpu-policy.test.js', current: 'src/recommendation/assembly/gpu-policy.test.js' },
  { batch: 'step-4b-pr3', kind: 'stayed', baseline: 'src/recommendation/assembly/index.test.js', current: 'src/recommendation/assembly/index.test.js' },
  { batch: 'step-4b-pr3', kind: 'stayed', baseline: 'src/recommendation/assembly/input.test.js', current: 'src/recommendation/assembly/input.test.js' },
  { batch: 'step-4b-pr3', kind: 'stayed', baseline: 'src/recommendation/assembly/pipeline.test.js', current: 'src/recommendation/assembly/pipeline.test.js' },
  { batch: 'step-4b-pr3', kind: 'stayed', baseline: 'src/recommendation/assembly/prices.test.js', current: 'src/recommendation/assembly/prices.test.js' },

  // --- split: the same barrel contract, now asserted by two owners ---
  { kind: 'split', baseline: 'src/recommendation/filtering/index.test.js', current: 'src/recommendation/filtering/index.test.js' },

  // --- added: no baseline, so never counted as relocated ---
  { kind: 'added', current: 'packages/recommendation-core/test/filtering-barrel.test.js' },
  { kind: 'added', current: 'packages/recommendation-core/test/surface.test.js' },
  { kind: 'added', current: 'packages/recommendation-core/test/characterization.test.js' },
];

/**
 * Named inventories. `--inventory` selects which batch's rows are measured;
 * the default is the PR 2 set, so an existing run keeps its exact meaning.
 * Each batch is measured against ITS OWN baseline (-base), because a row's
 * baseline path stops existing once that batch has moved it.
 */
const INVENTORIES = {
  pr2: INVENTORY.filter((row) => row.batch !== 'step-4b-pr3'),
  pr3: INVENTORY.filter((row) => row.batch === 'step-4b-pr3'),
};

/**
 * Facts from the review of this split, kept as the EXPECTATION the tree is
 * measured against. The effective count is not compared to another constant:
 * deriveLoopExpansion recomputes it from the loop in the test source, and the
 * structural checks below pin the shape that produces it (one loop, three
 * literal cases, one assertion expression). Change the test, and the audit
 * fails until these numbers are re-derived and updated.
 */
const SPLIT_FACTS = {
  coreBarrel: {
    path: 'packages/recommendation-core/test/filtering-barrel.test.js',
    tests: 3,
    loops: 1,
    loopCases: 3,
    assertionsInLoop: 1,
    effectiveAssertions: 7,
  },
  runtimeBarrel: { path: 'src/recommendation/filtering/index.test.js', assertions: 7 },
};

const RUNTIME_SPECIFIERS = [
  /context-loader/,
  /\/loader(\.js)?['"]/,
  /\/pipeline(\.js)?['"]/,
  /load-assessments/,
  /load-scoring-model/,
  /offers\/select/,
];

const RUNTIME_IDENTIFIERS = [
  'loadFilteringContext',
  'loadCandidates',
  'filterCandidatesForRecommendation',
  'selectOfferPrices',
  'loadScoringModel',
  'loadComponentAssessments',
];

const TEST_MODIFIERS = new Set(['skip', 'only', 'todo', 'concurrent']);

function isPunct(token, value) {
  return Boolean(token) && token.type === 'punct' && token.value === value;
}

function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

/** Token-based test/assertion counting: comments, strings and regexes excluded. */
function countSitesFromTokens(tokens) {
  let tests = 0;
  let assertions = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'ident') continue;
    const next = tokens[i + 1];
    const afterNext = tokens[i + 2];
    const afterNext2 = tokens[i + 3];

    // test(...) / it(...) / test.skip(...) / it.only(...)
    if (token.value === 'test' || token.value === 'it') {
      const directCall = isPunct(next, '(');
      const modifiedCall =
        isPunct(next, '.') &&
        afterNext && afterNext.type === 'ident' && TEST_MODIFIERS.has(afterNext.value) &&
        isPunct(afterNext2, '(');
      if (directCall || modifiedCall) tests += 1;
      continue;
    }

    // assert.equal(...) / assert.deepEqual(...) / assert(...)
    if (token.value === 'assert' && (isPunct(next, '.') || isPunct(next, '('))) assertions += 1;
  }

  return { tests, assertions };
}

function countDeclarations(source) {
  return countSitesFromTokens(lex(source));
}

/** Bare (non-relative) specifiers a file requires, from the token stream. */
function bareSpecifiers(tokens) {
  const specifiers = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'ident' || token.value !== 'require') continue;
    if (!isPunct(tokens[i + 1], '(')) continue;
    const argument = tokens[i + 2];
    if (argument && argument.type === 'string' && !argument.template && !argument.value.startsWith('.')) {
      specifiers.add(argument.value);
    }
  }
  return specifiers;
}

/**
 * Expand assertions/tests repeated by `for (const x of [a, b, c])` loops.
 *
 * The count is DERIVED from the source: the iterable must be a literal array
 * (its top-level element count is the case count), the loop body's assertion and
 * test sites are counted token-by-token, and each site contributes `cases`
 * executions instead of one. A loop over a non-literal iterable (a fixture
 * object, a function call) cannot be expanded, so it is reported as
 * underivable instead of being guessed at.
 */
function deriveLoopExpansion(source) {
  const tokens = lex(source);
  const sites = countSitesFromTokens(tokens);
  const loops = [];
  let extraAssertions = 0;
  let extraTests = 0;
  let assertionsComplete = true;
  let testsComplete = true;

  for (let i = 0; i < tokens.length; i += 1) {
    if (!(tokens[i].type === 'ident' && tokens[i].value === 'for')) continue;
    if (!isPunct(tokens[i + 1], '(')) continue;

    // header: for ( <pattern> of <iterable> )
    let depth = 0;
    let headerEnd = -1;
    let ofIndex = -1;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const token = tokens[j];
      if (token.type === 'punct' && (token.value === '(' || token.value === '[' || token.value === '{')) depth += 1;
      else if (token.type === 'punct' && (token.value === ')' || token.value === ']' || token.value === '}')) {
        depth -= 1;
        if (depth === 0) {
          headerEnd = j;
          break;
        }
      } else if (depth === 1 && token.type === 'ident' && token.value === 'of' && ofIndex < 0) {
        ofIndex = j;
      }
    }
    if (headerEnd < 0) {
      assertionsComplete = false;
      testsComplete = false;
      continue;
    }

    // body: { ... }
    if (!isPunct(tokens[headerEnd + 1], '{')) {
      assertionsComplete = false;
      testsComplete = false;
      continue;
    }
    let bodyDepth = 0;
    let bodyEnd = -1;
    for (let j = headerEnd + 1; j < tokens.length; j += 1) {
      const token = tokens[j];
      if (token.type === 'punct' && (token.value === '(' || token.value === '[' || token.value === '{')) bodyDepth += 1;
      else if (token.type === 'punct' && (token.value === ')' || token.value === ']' || token.value === '}')) {
        bodyDepth -= 1;
        if (bodyDepth === 0) {
          bodyEnd = j;
          break;
        }
      }
    }
    if (bodyEnd < 0) {
      assertionsComplete = false;
      testsComplete = false;
      continue;
    }

    // A classic `for (let i = 0; ...)` has no iterable to expand; it falls into
    // the non-literal case below, and only then does an assertion inside it make
    // the assertion count underivable.
    const iterable = ofIndex >= 0 ? tokens.slice(ofIndex + 1, headerEnd) : [];
    const isArrayLiteral = isPunct(iterable[0], '[') && isPunct(iterable[iterable.length - 1], ']');
    let cases = null;
    if (isArrayLiteral) {
      const inner = iterable.slice(1, iterable.length - 1);
      if (inner.length === 0) {
        cases = 0;
      } else {
        let nested = 0;
        let commas = 0;
        for (const token of inner) {
          if (token.type === 'punct' && (token.value === '(' || token.value === '[' || token.value === '{')) nested += 1;
          else if (token.type === 'punct' && (token.value === ')' || token.value === ']' || token.value === '}')) nested -= 1;
          else if (nested === 0 && isPunct(token, ',')) commas += 1;
        }
        const trailingComma = isPunct(inner[inner.length - 1], ',');
        cases = commas + (trailingComma ? 0 : 1);
      }
    }

    const body = tokens.slice(headerEnd + 2, bodyEnd);
    const bodySites = countSitesFromTokens(body);
    const nestedLoop = body.some((token) => token.type === 'ident' && token.value === 'for');
    if (nestedLoop) {
      assertionsComplete = false;
      testsComplete = false;
      continue;
    }
    if (bodySites.assertions === 0 && bodySites.tests === 0) continue;

    if (cases === null) {
      // A non-literal iterable cannot be expanded. Assertions and tests are
      // tracked separately: a loop that only generates TESTS over a fixture
      // object leaves the assertion count fully derivable.
      if (bodySites.assertions > 0) assertionsComplete = false;
      if (bodySites.tests > 0) {
        testsComplete = false;
        loops.push({
          line: lineAt(source, tokens[i].offset),
          cases: null,
          tests: bodySites.tests,
          assertions: bodySites.assertions,
          underivable: true,
        });
      }
      continue;
    }

    extraAssertions += bodySites.assertions * (cases - 1);
    extraTests += bodySites.tests * (cases - 1);
    loops.push({
      line: lineAt(source, tokens[i].offset),
      cases,
      tests: bodySites.tests,
      assertions: bodySites.assertions,
      underivable: false,
    });
  }

  return {
    testsStatic: sites.tests,
    assertionsStatic: sites.assertions,
    testsEffective: sites.tests + extraTests,
    assertionsEffective: sites.assertions + extraAssertions,
    loops,
    assertionsComplete,
    testsComplete,
  };
}

/** Every `*.test.js` under the core test directory, recursively. */
function listCoreTestFiles(dir, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      found.push(...listCoreTestFiles(path.join(dir, entry.name), relative));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      found.push(relative);
    }
  }
  return found.sort();
}

/**
 * Detect runtime coupling from the TOKEN STREAM; never from the file's name.
 * Token-level detection matters: a file that merely NAMES a runtime export in a
 * string - `assert.equal('loadCandidates' in core.candidates, false)` - is
 * asserting its absence, not depending on it, and must not be reported as
 * coupled.
 */
function detectDependencies(source) {
  const tokens = lex(source);
  const found = [];
  const specifiers = [];
  const identifiers = new Set();
  let stringMentionsFixtureError = false;
  let injectsQueryClient = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'ident') {
      identifiers.add(token.value);
      if (
        token.value === 'require' &&
        isPunct(tokens[i + 1], '(') &&
        tokens[i + 2] && tokens[i + 2].type === 'string'
      ) {
        specifiers.push(tokens[i + 2].value);
      }
      if (
        token.value === 'async' &&
        tokens[i + 1] && tokens[i + 1].type === 'ident' && tokens[i + 1].value === 'query' &&
        isPunct(tokens[i + 2], '(')
      ) {
        injectsQueryClient = true;
      }
    }
    if (token.type === 'string' && token.value.includes('unexpected query')) {
      stringMentionsFixtureError = true;
    }
  }

  if (specifiers.includes('pg')) found.push("require('pg')");
  for (const identifier of RUNTIME_IDENTIFIERS) {
    if (identifiers.has(identifier)) found.push(identifier);
  }
  if (specifiers.some((spec) => RUNTIME_SPECIFIERS.some((re) => re.test(spec)))) {
    found.push('loader-pipeline import');
  }
  if (stringMentionsFixtureError) found.push('fake db fixture');
  if (injectsQueryClient) found.push('injected db client');
  if (identifiers.has('readFileSync')) found.push('source-text assertion');
  return [...new Set(found)];
}

function ownerOf(currentPath) {
  return currentPath.startsWith('packages/') ? 'core' : 'runtime';
}

function reasonFor(kind, owner, dependencies) {
  if (kind === 'added') {
    return 'introduced by this PR: core-side assertions that did not exist at the baseline';
  }
  if (kind === 'split') {
    return 'one barrel contract asserted by two owners; the runtime half keeps the original assertions';
  }
  const runtimeCoupled = dependencies.some((dep) =>
    dep === "require('pg')" ||
    dep === 'fake db fixture' ||
    dep === 'injected db client' ||
    dep === 'loader-pipeline import' ||
    RUNTIME_IDENTIFIERS.includes(dep)
  );
  if (!runtimeCoupled) {
    return 'pure contracts and in-memory fixtures: no loader, no db, nothing environment-shaped';
  }
  if (owner === 'core') {
    return 'runtime coupling reached only through a test fixture that was removed before the move';
  }
  if (dependencies.includes('fake db fixture') || dependencies.includes('injected db client')) {
    return 'runtime integration: drives the DB-backed loader through an injected client';
  }
  if (dependencies.some((dep) => RUNTIME_IDENTIFIERS.includes(dep))) {
    return 'loads the DB-backed module at import time; its assertions are about the barrel, not the loader';
  }
  return 'runtime reachability only (imports the loader/pipeline module)';
}

/**
 * Core-test purity, using the package's own scanner. Returns the violations that
 * the test allowance does NOT excuse. A core test that reaches a database, the
 * network, the environment, a clock, a source file outside the package or any
 * bare module it was not granted fails here.
 */
function corePurityViolations(source, file, relativePath) {
  const exception = FILESYSTEM_EXCEPTIONS.get(relativePath);
  const extraBare = exception ? new Set(exception.specifiers) : new Set();
  const violations = scanSource(source, { file, coreRoot: CORE_ROOT, sourceRoot: CORE_ROOT });

  return violations.filter((violation) => {
    // A test's STRING LITERALS are fixture data, not capabilities. purity.test.js
    // exists to hold forbidden constructs (`'SELECT id FROM products'`, a
    // postgres:// URL) and assert that the scanner catches them; flagging those
    // literals here would punish the gate for doing its job. What a core test
    // must never do is REACH a capability - require a runtime module, import
    // outside the package, read the environment, or call a database/network.
    if (violation.rule === 'sql-string' || violation.rule === 'db-connection-param') {
      return false;
    }
    if (violation.rule === 'non-relative-import') {
      const match = /^'([^']+)' is a/.exec(violation.detail);
      if (!match) return true;
      return !(TEST_ALLOWED_BARE.has(match[1]) || extraBare.has(match[1]));
    }
    if (violation.rule === 'unresolved-import') {
      const match = /^'([^']+)' does not resolve/.exec(violation.detail);
      return !(match && TEST_ALLOWED_UNRESOLVED.has(match[1]));
    }
    return true;
  });
}

function parseArgs(argv) {
  const options = { base: null, inventory: 'pr2', errors: [] };
  for (const arg of argv) {
    if (arg === '--base=') {
      options.errors.push('--base= needs a git reference');
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
    } else if (arg.startsWith('--inventory=')) {
      const value = arg.slice('--inventory='.length);
      if (!Object.prototype.hasOwnProperty.call(INVENTORIES, value)) {
        options.errors.push('--inventory=' + value + ' is not one of ' + Object.keys(INVENTORIES).join(', '));
      } else {
        options.inventory = value;
      }
    } else {
      options.errors.push('unknown argument ' + JSON.stringify(arg));
    }
  }
  return options;
}

/**
 * Resolve the revision the before-counts are read from. The default comes from
 * the manifest, so there is one versioned baseline instead of a second copy in
 * this file; --base overrides it for a deliberate comparison.
 */
function resolveBaseline(options) {
  if (options.base) {
    const resolved = resolveCommit(REPO_ROOT, options.base);
    if (!resolved.ok) {
      return { ok: false, sha: null, source: null, error: '--base=' + options.base + ' is not a commit in this repository' };
    }
    if (!isAncestor(REPO_ROOT, resolved.sha, 'HEAD')) {
      return {
        ok: false,
        sha: null,
        source: null,
        error: '--base=' + options.base + ' (' + resolved.sha + ') is not an ancestor of HEAD; before-counts must come from an earlier revision',
      };
    }
    return { ok: true, sha: resolved.sha, source: '--base=' + options.base, error: null };
  }

  const loaded = loadManifest(manifestFile(REPO_ROOT));
  if (loaded.errors.length > 0) {
    return {
      ok: false,
      sha: null,
      source: null,
      error: 'cannot read the default baseline from ' + MANIFEST_REL + ': ' + loaded.errors.join('; '),
    };
  }
  const batch = loaded.batches.find((entry) => entry.id === DEFAULT_BASELINE_BATCH);
  if (!batch) {
    return {
      ok: false,
      sha: null,
      source: null,
      error: 'the manifest declares no batch ' + JSON.stringify(DEFAULT_BASELINE_BATCH) + '; pass --base=<git-ref>',
    };
  }
  const resolved = resolveCommit(REPO_ROOT, batch.baseline_sha);
  if (!resolved.ok) {
    return {
      ok: false,
      sha: null,
      source: null,
      error: 'the manifest baseline ' + batch.baseline_sha + ' is not a commit in this repository',
    };
  }
  return { ok: true, sha: resolved.sha, source: 'manifest batch ' + batch.id + ' (default)', error: null };
}

/** Baseline text for one inventory row; a missing file FAILS rather than counting 0. */
function readAtBaseline(baseline, file, failures) {
  const result = tryGit(REPO_ROOT, ['show', baseline + ':' + file]);
  if (!result.ok) {
    failures.push(
      'baseline ' + baseline.slice(0, 7) + ' has no file at ' + file +
      ', so this row cannot be measured against it'
    );
    return '';
  }
  return result.out;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.errors.length > 0) {
    process.stderr.write('audit-pr2-test-ownership: ' + options.errors.join('\n  ') + '\n');
    process.stderr.write('usage: node scripts/audit-pr2-test-ownership.js [--base=<git-ref>] [--inventory=pr2|pr3]\n');
    return 2;
  }
  if (!isGitRepository(REPO_ROOT)) {
    process.stderr.write('audit: FAIL\n  - ' + REPO_ROOT + ' is not a git repository\n');
    return 1;
  }
  const selection = resolveBaseline(options);
  if (!selection.ok) {
    process.stderr.write('audit: FAIL\n  - ' + selection.error + '\n');
    return 1;
  }
  const baseline = selection.sha;
  const failures = [];

  const inventory = INVENTORIES[options.inventory];
  process.stdout.write('inventory: ' + options.inventory + ' (' + inventory.length + ' file(s))\n');
  const rows = inventory.map((entry) => {
    const before = entry.baseline ? readAtBaseline(baseline, entry.baseline, failures) : '';
    const file = path.join(REPO_ROOT, entry.current);
    const after = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (after === null) failures.push('inventory file is missing: ' + entry.current);

    const expansion = deriveLoopExpansion(after || '');
    const baselineMeasured = entry.baseline ? countDeclarations(before) : { tests: 0, assertions: 0 };
    const dependencies = detectDependencies(after || '');

    return {
      ...entry,
      testsBefore: baselineMeasured.tests,
      testsAfter: expansion.testsStatic,
      assertsBefore: baselineMeasured.assertions,
      assertsAfter: expansion.assertionsStatic,
      testsEffective: expansion.testsEffective,
      assertsEffective: expansion.assertionsEffective,
      loops: expansion.loops,
      assertsComplete: expansion.assertionsComplete,
      testsComplete: expansion.testsComplete,
      dependencies,
      owner: ownerOf(entry.current),
      reason: reasonFor(entry.kind, ownerOf(entry.current), dependencies),
    };
  });

  process.stdout.write('baseline: ' + baseline + '\n');
  process.stdout.write('baseline source: ' + selection.source + '\n\n');
  process.stdout.write('| Class | Test file (baseline -> current) | Tests | Assertions | Runtime dependency | Owner | Reason |\n');
  process.stdout.write('|---|---|---|---|---|---|---|\n');
  for (const row of rows) {
    const location =
      row.kind === 'added'
        ? '`' + row.current + '` (new)'
        : row.baseline === row.current
          ? '`' + row.current + '`'
          : '`' + row.baseline + '` -> `' + row.current + '`';
    process.stdout.write(
      '| ' + row.kind +
      ' | ' + location +
      ' | ' + row.testsBefore + ' -> ' + row.testsAfter +
      ' | ' + row.assertsBefore + ' -> ' + row.assertsAfter +
      ' | ' + (row.dependencies.length ? row.dependencies.join(', ') : 'none') +
      ' | ' + row.owner +
      ' | ' + row.reason + ' |\n'
    );
  }

  // --- invariants ---------------------------------------------------------
  for (const row of rows) {
    if (row.kind === 'moved' || row.kind === 'stayed') {
      if (row.testsAfter !== row.testsBefore) {
        failures.push(row.current + ': ' + row.kind + ' changed its test count (' + row.testsBefore + ' -> ' + row.testsAfter + ')');
      }
      if (row.assertsAfter !== row.assertsBefore) {
        failures.push(row.current + ': ' + row.kind + ' changed its assertion count (' + row.assertsBefore + ' -> ' + row.assertsAfter + ')');
      }
    }
    if (row.kind === 'split') {
      if (row.assertsAfter !== row.assertsBefore) {
        failures.push(row.current + ': a split must preserve every assertion (' + row.assertsBefore + ' -> ' + row.assertsAfter + ')');
      }
      if (row.testsAfter < row.testsBefore) {
        failures.push(row.current + ': a split must not reduce its test count (' + row.testsBefore + ' -> ' + row.testsAfter + ')');
      }
    }
    if (row.kind === 'added' && (row.testsAfter === 0 || row.assertsAfter === 0)) {
      failures.push(row.current + ': an added test file contributes no test or no assertion');
    }
  }

  // --- core test purity: every core test file, inventoried or not ----------
  // The package's own test command is `node --test "test/*.test.js"`, which is
  // flat. This scan is RECURSIVE: the files it covers are a superset of the ones
  // that run, so a test parked in a subdirectory is still held to the rule.
  const coreTestFiles = listCoreTestFiles(CORE_TEST_DIR);
  const coreTestExceptionsUsed = new Set();
  process.stdout.write('\n### Core test purity (recursive: every *.test.js under ' + CORE_TEST_REL + '/)' + '\n');
  let purityViolations = 0;
  for (const relative of coreTestFiles) {
    const absolute = path.join(CORE_TEST_DIR, relative);
    const source = fs.readFileSync(absolute, 'utf8');
    const exception = FILESYSTEM_EXCEPTIONS.get(relative);
    if (exception) {
      coreTestExceptionsUsed.add(relative);
      const specifiers = bareSpecifiers(lex(source));
      const used = exception.specifiers.filter((specifier) => specifiers.has(specifier));
      if (used.length === 0) {
        failures.push(
          'filesystem exception for ' + relative + ' is stale: it no longer imports ' +
          exception.specifiers.join(' or ') + ', so the exception is not justified'
        );
      }
    }
    const violations = corePurityViolations(source, absolute, relative);
    purityViolations += violations.length;
    for (const violation of violations) {
      failures.push(
        'core test purity: ' + CORE_TEST_REL + '/' + relative +
        ':' + (violation.line === null ? '?' : violation.line) +
        ' ' + violation.rule + ' — ' + violation.detail
      );
    }
  }
  for (const relative of FILESYSTEM_EXCEPTIONS.keys()) {
    if (!coreTestFiles.includes(relative)) {
      failures.push('filesystem exception names a file that does not exist: ' + CORE_TEST_REL + '/' + relative);
    }
  }
  process.stdout.write(
    '* scanned ' + coreTestFiles.length + ' files recursively with packages/recommendation-core/test/purity-scanner.js; ' +
    purityViolations + ' violation(s)\n' +
    '* allowed everywhere: bare ' + [...TEST_ALLOWED_BARE].join(', ') + ", plus require('..') (the package main, which the scanner does not read)\n" +
    '* filesystem access is NOT blanket-allowed; ' + FILESYSTEM_EXCEPTIONS.size + ' file(s) hold a scoped exception:\n'
  );
  for (const [relative, exception] of FILESYSTEM_EXCEPTIONS) {
    const state = coreTestExceptionsUsed.has(relative) ? 'used' : 'UNUSED';
    process.stdout.write('    - ' + relative + ' [' + exception.specifiers.join(', ') + ', ' + state + '] ' + exception.reason + '\n');
  }
  process.stdout.write(
    '* everything else - a database driver, node:net, node:https, an npm module, a source tree outside the package - fails the audit\n' +
    '* fixture literals (sql-string, db-connection-param) are inert data, not capabilities\n'
  );

  // --- the split's declared facts, with the effective count DERIVED --------
  const splitSelected = rows.some((row) => row.current === SPLIT_FACTS.runtimeBarrel.path);
  const coreBarrel = splitSelected ? rows.find((row) => row.current === SPLIT_FACTS.coreBarrel.path) : null;
  const runtimeBarrel = splitSelected ? rows.find((row) => row.current === SPLIT_FACTS.runtimeBarrel.path) : null;
  const coreFacts = SPLIT_FACTS.coreBarrel;

  process.stdout.write('\n### Derived from source (loop expansion)\n');
  for (const row of rows.filter((entry) => entry.kind === 'added')) {
    const expandable = row.loops.filter((loop) => !loop.underivable);
    const expanded = expandable
      .map((loop) => loop.assertions + ' site(s) x (' + loop.cases + ' - 1) at line ' + loop.line)
      .join(' + ');
    if (row.assertsComplete) {
      process.stdout.write(
        '* `' + row.current + '`: ' + row.assertsAfter + ' static -> **' + row.assertsEffective +
        '** effective assertions (' + (expanded || 'no loop-repeated assertion') + ')\n'
      );
    } else {
      process.stdout.write(
        '* `' + row.current + '`: ' + row.assertsAfter + ' static -> effective count NOT derivable: ' +
        'an assertion sits in a loop over a non-literal iterable (line ' +
        row.loops.filter((loop) => loop.underivable).map((loop) => loop.line).join(', ') +
        '), so ' + row.assertsAfter + ' is a lower bound\n'
      );
    }
    const underivable = row.loops.filter((loop) => loop.underivable);
    if (underivable.length > 0) {
      process.stdout.write(
        '    NOTE: ' + underivable.length + ' loop(s) iterate a non-literal value and generate cases ' +
        '(line ' + underivable.map((loop) => loop.line).join(', ') + '); those run N times at runtime and are counted once here\n'
      );
    }
  }

  const derivedBarrel = coreBarrel ? coreBarrel.assertsEffective : null;
  if (!splitSelected) {
    process.stdout.write('* split facts not asserted: they belong to the pr2 inventory\n');
  } else if (!coreBarrel) {
    failures.push('the core filtering-barrel test is missing from the inventory: ' + coreFacts.path);
  } else {
    if (coreBarrel.testsAfter !== coreFacts.tests) {
      failures.push('core filtering-barrel tests: expected ' + coreFacts.tests + ', found ' + coreBarrel.testsAfter);
    }
    if (!coreBarrel.assertsComplete) {
      failures.push('core filtering-barrel assertion count cannot be derived: a loop in it is not a literal array or is nested');
    }
    if (coreBarrel.loops.length !== coreFacts.loops) {
      failures.push('core filtering-barrel loops: expected ' + coreFacts.loops + ', found ' + coreBarrel.loops.length);
    }
    for (const loop of coreBarrel.loops) {
      if (loop.cases !== coreFacts.loopCases) {
        failures.push('core filtering-barrel loop at line ' + loop.line + ': expected ' + coreFacts.loopCases + ' literal cases, found ' + loop.cases);
      }
      if (loop.assertions !== coreFacts.assertionsInLoop) {
        failures.push('core filtering-barrel loop at line ' + loop.line + ': expected ' + coreFacts.assertionsInLoop + ' assertion expression(s), found ' + loop.assertions);
      }
    }
    if (derivedBarrel !== coreFacts.effectiveAssertions) {
      failures.push(
        'core filtering-barrel effective assertions: derived ' + derivedBarrel +
        ' from source, but the review figure is ' + coreFacts.effectiveAssertions +
        ' - re-derive and update the expectation'
      );
    }
    process.stdout.write(
      '* `' + coreFacts.path + '` structural check: ' + coreBarrel.loops.length + ' loop(s), ' +
      coreBarrel.loops.map((loop) => loop.cases + ' literal cases / ' + loop.assertions + ' assertion expression').join(', ') +
      ' -> derived ' + derivedBarrel + ' effective assertions (review\'s figure: ' + coreFacts.effectiveAssertions + ')\n'
    );
  }
  if (!splitSelected) {
    // nothing to check: not this inventory
  } else if (!runtimeBarrel) {
    failures.push('the runtime filtering-barrel test is missing from the inventory: ' + SPLIT_FACTS.runtimeBarrel.path);
  } else if (runtimeBarrel.assertsAfter !== SPLIT_FACTS.runtimeBarrel.assertions) {
    failures.push('runtime filtering-barrel assertions: expected ' + SPLIT_FACTS.runtimeBarrel.assertions + ', found ' + runtimeBarrel.assertsAfter);
  }

  const splitFamilyAssertions =
    (runtimeBarrel ? runtimeBarrel.assertsAfter : 0) + (derivedBarrel === null ? 0 : derivedBarrel);
  process.stdout.write(
    '* split family (barrel contract): ' + (runtimeBarrel ? runtimeBarrel.assertsBefore : '?') +
    ' -> ' + splitFamilyAssertions + ' assertions across the runtime and core halves\n'
  );

  // --- totals -------------------------------------------------------------
  const byKind = (kind) => rows.filter((row) => row.kind === kind);
  const sum = (list, field) => list.reduce((total, row) => total + (row[field] || 0), 0);
  const moved = byKind('moved');
  const stayed = byKind('stayed');
  const split = byKind('split');
  const added = byKind('added');

  const testsBefore = sum(rows, 'testsBefore');
  const testsAfter = sum(rows, 'testsAfter');
  const assertsBefore = sum(rows, 'assertsBefore');
  const assertsAfter = sum(rows, 'assertsAfter');
  const addedEffective = added.reduce(
    (total, row) => total + (row.assertsComplete ? row.assertsEffective : row.assertsAfter),
    0
  );

  process.stdout.write('\n### Totals (static counts, inventory ' + options.inventory + ')\n');
  process.stdout.write(
    '* files: ' + rows.length + ' (moved ' + moved.length + ', stayed ' + stayed.length +
    ', split ' + split.length + ', added ' + added.length + ')\n'
  );
  process.stdout.write(
    '* relocated tests: ' + sum(moved, 'testsBefore') + ' moved, ' + sum(stayed, 'testsBefore') +
    ' stayed (both classes must keep their counts)\n'
  );
  process.stdout.write(
    '* split: `' + (runtimeBarrel ? runtimeBarrel.current : '?') + '` ' +
    (runtimeBarrel ? runtimeBarrel.testsBefore + ' -> ' + runtimeBarrel.testsAfter + ' tests, ' +
      runtimeBarrel.assertsBefore + ' -> ' + runtimeBarrel.assertsAfter + ' assertions' : '?') + '\n'
  );
  const underivableFiles = added.filter((row) => !row.assertsComplete).length;
  process.stdout.write(
    '* added (new files, never counted as moved): ' + sum(added, 'testsAfter') + ' tests, ' +
    sum(added, 'assertsAfter') + ' static assertions, ' + addedEffective +
    ' effective assertions at minimum' +
    (underivableFiles > 0 ? ' (' + underivableFiles + ' file(s) loop over non-literal data, counted statically)' : '') + '\n'
  );
  process.stdout.write(
    '* totals: tests ' + testsBefore + ' -> ' + testsAfter + ' (+' + (testsAfter - testsBefore) + '), ' +
    'assertions ' + assertsBefore + ' -> ' + assertsAfter + ' (+' + (assertsAfter - assertsBefore) + ' static)\n'
  );

  const addedAsserts = sum(added, 'assertsAfter');
  const relocatedUntouched =
    moved.every((row) => row.testsAfter === row.testsBefore && row.assertsAfter === row.assertsBefore) &&
    stayed.every((row) => row.testsAfter === row.testsBefore && row.assertsAfter === row.assertsBefore) &&
    split.every((row) => row.assertsAfter === row.assertsBefore);

  process.stdout.write(
    '* reconciliation: the static assertion delta equals the added rows (' + (assertsAfter - assertsBefore) +
    ' == ' + addedAsserts + ') and every moved/stayed row is unchanged: ' +
    (relocatedUntouched && assertsAfter - assertsBefore === addedAsserts ? 'PASS' : 'FAIL') + '\n'
  );
  const staticTestsDelta = testsAfter - (testsBefore + sum(added, 'testsAfter'));
  const splitTestDelta = split.reduce((total, row) => total + (row.testsAfter - row.testsBefore), 0);
  process.stdout.write(
    '* test-count note: beyond the added files the static count moves by +' + staticTestsDelta +
    ', which is exactly the split\'s redistributed tests (+' + splitTestDelta + '); ' +
    (staticTestsDelta === splitTestDelta ? 'nothing is unaccounted for' : 'MISMATCH') + '\n'
  );

  // --- provenance, delegated ---------------------------------------------
  const provenance = spawnSync(process.execPath, [PROVENANCE_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
  const provenanceVerdict = provenance.status === 0 ? 'PASS' : 'FAIL';
  if (provenance.status !== 0) {
    failures.push('scripts/verify-pr2-provenance.js failed (L2/L3)');
  }
  process.stdout.write(
    '\n### Provenance (delegated to scripts/verify-pr2-provenance.js)\n' +
    '* manifest baseline and fixture origin, every declared move blob-identical (extraction-manifest.json): **' +
    provenanceVerdict + '**\n'
  );

  if (failures.length > 0) {
    process.stderr.write('\naudit: FAIL\n');
    for (const failure of failures) process.stderr.write('  - ' + failure + '\n');
    return 1;
  }

  process.stdout.write(
    '\naudit: PASS - ' + rows.length + ' files classified; no moved or split assertion was dropped; ' +
    sum(added, 'testsAfter') + ' added tests (' + addedEffective +
    ' effective assertions derived from source, at minimum) accounted for; ' + coreTestFiles.length +
    ' core test files pure with ' + FILESYSTEM_EXCEPTIONS.size + ' scoped filesystem exception(s)\n'
  );
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

// Exported for inspection: requiring this file must not run the audit, so the
// counting/purity helpers can be exercised directly.
module.exports = {
  DEFAULT_BASELINE_BATCH,
  countDeclarations,
  deriveLoopExpansion,
  corePurityViolations,
  listCoreTestFiles,
  parseArgs,
  resolveBaseline,
  TEST_ALLOWED_BARE,
  FILESYSTEM_EXCEPTIONS,
};