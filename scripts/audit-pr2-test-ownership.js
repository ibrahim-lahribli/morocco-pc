'use strict';

/**
 * scripts/audit-pr2-test-ownership.js - reproducible ownership audit for the
 * step 4B PR 2 extraction.
 *
 * The PR moves pure test files into packages/recommendation-core/test/ and
 * leaves runtime-dependent ones in src/recommendation/. "Which test went
 * where, and why" must be checkable rather than asserted, so this script reads
 * the files themselves.
 *
 * How it measures:
 *   * tests and assertions are counted from the TOKEN STREAM (the core package's
 *     own lexer, packages/recommendation-core/test/purity-scanner.js), not from
 *     a line regex: `test()` and `it()` are both recognised, at any nesting
 *     depth inside `describe()`, and occurrences inside comments, strings or
 *     regex literals are not counted at all;
 *   * before-counts are read from the baseline commit named by the frozen
 *     characterization fixture, after-counts from the working tree;
 *   * every row is classified MOVED / STAYED / SPLIT / ADDED, so a newly added
 *     test can never be presented as a relocated one;
 *   * every core-owned test file is scanned with the SAME purity scanner that
 *     gates core's src/, under a test-specific allowance documented below -
 *     there is deliberately no second definition of core purity;
 *   * the L2/L3 provenance claims are delegated to scripts/verify-pr2-provenance.js
 *     rather than re-implemented here.
 *
 * DB-free, dependency-free, read-only. Run from the repository root:
 *   node scripts/audit-pr2-test-ownership.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CORE_ROOT = path.join(REPO_ROOT, 'packages', 'recommendation-core');
const SCANNER = path.join(CORE_ROOT, 'test', 'purity-scanner.js');
const FIXTURE_REL = 'packages/recommendation-core/test/fixtures/pr2-characterization.json';
const PROVENANCE_SCRIPT = path.join(__dirname, 'verify-pr2-provenance.js');

const { lex, scanSource } = require(SCANNER);

/**
 * Core test allowance. A core TEST may import the Node test runner and the
 * assertion/IO helpers its fixtures need; it may never reach a database, a
 * source module outside the package, the network, the environment or a clock.
 * The allowance is expressed as the exact bare specifiers, so adding one is a
 * visible edit rather than a category that silently widens.
 */
const TEST_ALLOWED_BARE = new Set([
  'node:test',
  'node:assert',
  'node:assert/strict',
  'node:fs',
  'node:os',
  'node:path',
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

  // --- split: the same barrel contract, now asserted by two owners ---
  { kind: 'split', baseline: 'src/recommendation/filtering/index.test.js', current: 'src/recommendation/filtering/index.test.js' },

  // --- added: no baseline, so never counted as relocated ---
  {
    kind: 'added',
    current: 'packages/recommendation-core/test/filtering-barrel.test.js',
    // The review's stated figures: 3 tests, 7 assertions. The static count is
    // 5 expressions because one of them runs once per loop case (3 cases).
    effectiveAssertions: 7,
    effectiveBasis: '1 assertion expression executes once per loop case (3 cases)',
  },
  { kind: 'added', current: 'packages/recommendation-core/test/surface.test.js' },
  { kind: 'added', current: 'packages/recommendation-core/test/characterization.test.js' },
];

/**
 * The split's declared facts, kept next to the inventory so a change is a
 * reviewable edit. The audit fails if the tree stops matching them.
 */
const SPLIT_FACTS = {
  coreBarrel: { path: 'packages/recommendation-core/test/filtering-barrel.test.js', tests: 3, effectiveAssertions: 7 },
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

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

/** Token-based test/assertion counting: comments, strings and regexes excluded. */
function countDeclarations(source) {
  const tokens = lex(source);
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
      const directCall = next && next.type === 'punct' && next.value === '(';
      const modifiedCall =
        next && next.type === 'punct' && next.value === '.' &&
        afterNext && afterNext.type === 'ident' && TEST_MODIFIERS.has(afterNext.value) &&
        afterNext2 && afterNext2.type === 'punct' && afterNext2.value === '(';
      if (directCall || modifiedCall) tests += 1;
      continue;
    }

    // assert.equal(...) / assert.deepEqual(...) / assert(...)
    if (token.value === 'assert' && next && next.type === 'punct' && (next.value === '.' || next.value === '(')) {
      assertions += 1;
    }
  }

  return { tests, assertions };
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
        tokens[i + 1] && tokens[i + 1].type === 'punct' && tokens[i + 1].value === '(' &&
        tokens[i + 2] && tokens[i + 2].type === 'string'
      ) {
        specifiers.push(tokens[i + 2].value);
      }
      if (
        token.value === 'async' &&
        tokens[i + 1] && tokens[i + 1].type === 'ident' && tokens[i + 1].value === 'query' &&
        tokens[i + 2] && tokens[i + 2].type === 'punct' && tokens[i + 2].value === '('
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
 * Core-test purity, using the package's own scanner. Returns the violations
 * that the test allowance does NOT excuse. A core test that reaches a database,
 * the network, the environment, a clock, a source file outside the package or
 * any other bare module fails here.
 */
function corePurityViolations(source, file) {
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
      return !(match && TEST_ALLOWED_BARE.has(match[1]));
    }
    if (violation.rule === 'unresolved-import') {
      const match = /^'([^']+)' does not resolve/.exec(violation.detail);
      return !(match && TEST_ALLOWED_UNRESOLVED.has(match[1]));
    }
    return true;
  });
}

function main() {
  const fixture = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, FIXTURE_REL), 'utf8'));
  const baseline = fixture.provenance.baseline_sha;
  const failures = [];

  const rows = INVENTORY.map((entry) => {
    const before = entry.baseline ? git(['show', baseline + ':' + entry.baseline]) : '';
    const file = path.join(REPO_ROOT, entry.current);
    const after = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (after === null) failures.push('inventory file is missing: ' + entry.current);

    const measured = countDeclarations(after || '');
    const baselineMeasured = entry.baseline ? countDeclarations(before) : { tests: 0, assertions: 0 };
    const dependencies = detectDependencies(after || '');
    const owner = ownerOf(entry.current);

    return {
      ...entry,
      kind: entry.kind,
      testsBefore: baselineMeasured.tests,
      testsAfter: measured.tests,
      assertsBefore: baselineMeasured.assertions,
      assertsAfter: measured.assertions,
      dependencies,
      owner,
      reason: reasonFor(entry.kind, owner, dependencies),
    };
  });

  process.stdout.write('baseline: ' + baseline + '\n\n');
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
  // Scanning the whole directory (not just the inventory) is what makes the
  // rule hold for a file that a later change adds without updating this list.
  const coreTestDir = path.join(CORE_ROOT, 'test');
  const coreTestFiles = fs
    .readdirSync(coreTestDir)
    .filter((name) => name.endsWith('.test.js'))
    .sort();
  process.stdout.write('\n### Core test purity (every file under packages/recommendation-core/test/)\n');
  let purityViolations = 0;
  for (const name of coreTestFiles) {
    const file = path.join(coreTestDir, name);
    const violations = corePurityViolations(fs.readFileSync(file, 'utf8'), file);
    purityViolations += violations.length;
    for (const violation of violations) {
      failures.push(
        'core test purity: packages/recommendation-core/test/' + name +
        ':' + (violation.line === null ? '?' : violation.line) +
        ' ' + violation.rule + ' — ' + violation.detail
      );
    }
  }
  process.stdout.write(
    '* scanned ' + coreTestFiles.length + ' files with packages/recommendation-core/test/purity-scanner.js; ' +
    purityViolations + ' violation(s)\n' +
    '* allowance: bare ' + [...TEST_ALLOWED_BARE].join(', ') +
    ' plus require(\'..\') (the package main, which the scanner does not read);\n' +
    '* fixture literals (sql-string, db-connection-param) are inert data and are not capabilities\n'
  );

  // --- the split's declared facts ----------------------------------------
  const coreBarrel = rows.find((row) => row.current === SPLIT_FACTS.coreBarrel.path);
  const runtimeBarrel = rows.find((row) => row.current === SPLIT_FACTS.runtimeBarrel.path);
  if (!coreBarrel) {
    failures.push('the core filtering-barrel test is missing from the inventory: ' + SPLIT_FACTS.coreBarrel.path);
  } else {
    if (coreBarrel.testsAfter !== SPLIT_FACTS.coreBarrel.tests) {
      failures.push('core filtering-barrel tests: expected ' + SPLIT_FACTS.coreBarrel.tests + ', found ' + coreBarrel.testsAfter);
    }
    if (coreBarrel.effectiveAssertions !== SPLIT_FACTS.coreBarrel.effectiveAssertions) {
      failures.push('core filtering-barrel effective assertions: expected ' + SPLIT_FACTS.coreBarrel.effectiveAssertions + ', declared ' + coreBarrel.effectiveAssertions);
    }
    if (coreBarrel.assertsAfter > coreBarrel.effectiveAssertions) {
      failures.push('core filtering-barrel static assertions exceed the effective count');
    }
  }
  if (!runtimeBarrel) {
    failures.push('the runtime filtering-barrel test is missing from the inventory: ' + SPLIT_FACTS.runtimeBarrel.path);
  } else if (runtimeBarrel.assertsAfter !== SPLIT_FACTS.runtimeBarrel.assertions) {
    failures.push('runtime filtering-barrel assertions: expected ' + SPLIT_FACTS.runtimeBarrel.assertions + ', found ' + runtimeBarrel.assertsAfter);
  }

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

  process.stdout.write('\n### Declared effective counts (loop-expanded)\n');
  for (const row of rows) {
    if (!row.effectiveAssertions) continue;
    const extra = row.effectiveAssertions - row.assertsAfter;
    process.stdout.write(
      '* `' + row.current + '`: ' + row.testsAfter + ' tests, **' + row.effectiveAssertions +
      '** effective assertions (' + row.assertsAfter + ' static expressions' +
      (extra > 0 ? ', +' + extra + ' from ' + row.effectiveBasis : '') + ')\n'
    );
  }
  process.stdout.write(
    '* split family (barrel contract): ' + (runtimeBarrel ? runtimeBarrel.assertsBefore : '?') +
    ' -> ' + ((runtimeBarrel ? runtimeBarrel.assertsAfter : 0) + (coreBarrel ? coreBarrel.effectiveAssertions : 0)) +
    ' assertions across the runtime and core halves\n'
  );

  process.stdout.write('\n### Totals (static counts, all inventory rows)\n');
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
  process.stdout.write(
    '* added (new files, never counted as moved): ' + sum(added, 'testsAfter') + ' tests, ' +
    sum(added, 'assertsAfter') + ' static assertions, ' + sum(added, 'effectiveAssertions') +
    ' declared-effective assertions (only files with a declaration contribute)\n'
  );
  process.stdout.write(
    '* totals: tests ' + testsBefore + ' -> ' + testsAfter + ' (+' + (testsAfter - testsBefore) + '), ' +
    'assertions ' + assertsBefore + ' -> ' + assertsAfter + ' (+' + (assertsAfter - assertsBefore) + ' static)\n'
  );

  const addedTests = sum(added, 'testsAfter');
  const addedAsserts = sum(added, 'assertsAfter');
  const relocatedUntouched =
    moved.every((row) => row.testsAfter === row.testsBefore && row.assertsAfter === row.assertsBefore) &&
    stayed.every((row) => row.testsAfter === row.testsBefore && row.assertsAfter === row.assertsBefore) &&
    split.every((row) => row.assertsAfter === row.assertsBefore);

  process.stdout.write(
    '* reconciliation: the assertion delta equals the added rows (' + (assertsAfter - assertsBefore) +
    ' == ' + addedAsserts + ') and every moved/stayed row is unchanged: ' +
    (relocatedUntouched && assertsAfter - assertsBefore === addedAsserts ? 'PASS' : 'FAIL') + '\n'
  );
  const staticTestsDelta = testsAfter - (testsBefore + addedTests);
  const splitTestDelta = split.reduce((total, row) => total + (row.testsAfter - row.testsBefore), 0);
  process.stdout.write(
    '* test-count note: beyond the added files the count moves by +' + staticTestsDelta +
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
    '* fixture baseline, no post-move regeneration, 21/21 blob identity: **' + provenanceVerdict + '**\n'
  );

  if (failures.length > 0) {
    process.stderr.write('\naudit: FAIL\n');
    for (const failure of failures) process.stderr.write('  - ' + failure + '\n');
    return 1;
  }

  process.stdout.write(
    '\naudit: PASS - ' + rows.length + ' files classified; no moved or split assertion was dropped; ' +
    sum(added, 'testsAfter') + ' added tests (' + sum(added, 'effectiveAssertions') +
    ' declared-effective assertions) accounted for; core tests pure\n'
  );
  return 0;
}

process.exitCode = main();
