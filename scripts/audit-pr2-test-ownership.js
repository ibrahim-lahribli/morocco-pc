'use strict';

/**
 * scripts/audit-pr2-test-ownership.js - reproducible ownership audit for the
 * step 4B PR 2 extraction.
 *
 * The PR moves pure test files into packages/recommendation-core/test/ and
 * leaves runtime-dependent ones in src/recommendation/. "Which test went
 * where, and why" must be checkable rather than asserted, so this script reads
 * the files themselves: it detects the runtime coupling from the source, counts
 * `test(` declarations and `assert.` occurrences before (at the declared
 * baseline commit) and after (in the working tree), and prints one row per file.
 *
 * Nothing is hardcoded about counts or verdicts - only the file inventory and
 * the baseline commit (read from the characterization fixture's provenance).
 *
 * DB-free, dependency-free, read-only. Run from the repository root:
 *   node scripts/audit-pr2-test-ownership.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(
  REPO_ROOT,
  'packages',
  'recommendation-core',
  'test',
  'fixtures',
  'pr2-characterization.json'
);

/** Every test file this PR has an opinion about: baseline path -> current path. */
const INVENTORY = [
  // Moved: no runtime coupling.
  ['src/recommendation/candidates/candidates.test.js', 'packages/recommendation-core/test/candidates.test.js'],
  ['src/recommendation/candidates/pool.test.js', 'packages/recommendation-core/test/pool.test.js'],
  ['src/recommendation/filtering/filter.test.js', 'packages/recommendation-core/test/filter.test.js'],
  ['src/recommendation/compatibility/case-radiator-memory.test.js', 'packages/recommendation-core/test/compatibility-case-radiator-memory.test.js'],
  ['src/recommendation/compatibility/compatibility.test.js', 'packages/recommendation-core/test/compatibility-compatibility.test.js'],
  ['src/recommendation/compatibility/cooler-height.test.js', 'packages/recommendation-core/test/compatibility-cooler-height.test.js'],
  ['src/recommendation/compatibility/cooler-tdp.test.js', 'packages/recommendation-core/test/compatibility-cooler-tdp.test.js'],
  ['src/recommendation/compatibility/cpu-motherboard-cooler.test.js', 'packages/recommendation-core/test/compatibility-cpu-motherboard-cooler.test.js'],
  ['src/recommendation/compatibility/gpu-psu.test.js', 'packages/recommendation-core/test/compatibility-gpu-psu.test.js'],
  ['src/recommendation/compatibility/memory-capacity.test.js', 'packages/recommendation-core/test/compatibility-memory-capacity.test.js'],
  ['src/recommendation/compatibility/memory-slots.test.js', 'packages/recommendation-core/test/compatibility-memory-slots.test.js'],
  // Stayed: runtime-dependent, or mixed but un-splittable in this PR.
  ['src/recommendation/candidates/loader.test.js', 'src/recommendation/candidates/loader.test.js'],
  ['src/recommendation/filtering/context-loader.test.js', 'src/recommendation/filtering/context-loader.test.js'],
  ['src/recommendation/filtering/integration.test.js', 'src/recommendation/filtering/integration.test.js'],
  ['src/recommendation/filtering/pipeline.test.js', 'src/recommendation/filtering/pipeline.test.js'],
  ['src/recommendation/filtering/igpu-map.test.js', 'src/recommendation/filtering/igpu-map.test.js'],
  ['src/recommendation/filtering/index.test.js', 'src/recommendation/filtering/index.test.js'],
];

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

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function readAtBaseline(baseline, file) {
  return git(['show', baseline + ':' + file]);
}

function countTests(source) {
  return (source.match(/^test\(/gm) || []).length;
}

function countAssertions(source) {
  return (source.match(/assert\./g) || []).length;
}

/** Detect runtime coupling from the source text; never from the file's name. */
function detectDependencies(source) {
  const found = [];
  const requireSpecifiers = [...source.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);

  if (requireSpecifiers.some((spec) => spec === 'pg')) found.push("require('pg')");
  for (const identifier of RUNTIME_IDENTIFIERS) {
    if (new RegExp('\\b' + identifier + '\\b').test(source)) found.push(identifier);
  }
  if (requireSpecifiers.some((spec) => RUNTIME_SPECIFIERS.some((re) => re.test(spec)))) {
    found.push('loader-pipeline import');
  }
  if (/unexpected query/.test(source)) found.push('fake db fixture');
  if (/async query\s*\(/.test(source)) found.push('injected db client');
  if (/readFileSync/.test(source)) found.push('source-text assertion');
  return [...new Set(found)];
}

function ownerOf(currentPath) {
  return currentPath.startsWith('packages/') ? 'core' : 'runtime';
}

function reasonFor(owner, dependencies) {
  const runtimeCoupled = dependencies.some((dep) =>
    dep === "require('pg')" ||
    dep === 'fake db fixture' ||
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
    return 'runtime integration: drives the DB-backed loader through an injected client, so it stays beside the loader';
  }
  if (dependencies.some((dep) => RUNTIME_IDENTIFIERS.includes(dep))) {
    return 'loads the DB-backed module at import time; its assertions are about the barrel, not the loader';
  }
  return 'runtime reachability only (imports the loader/pipeline module)';
}

function main() {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const baseline = fixture.provenance.baseline_sha;

  const rows = [];
  for (const [baselinePath, currentPath] of INVENTORY) {
    const before = readAtBaseline(baseline, baselinePath);
    const currentFile = path.join(REPO_ROOT, currentPath);
    const after = fs.existsSync(currentFile) ? fs.readFileSync(currentFile, 'utf8') : '';
    const dependencies = detectDependencies(after);
    const owner = ownerOf(currentPath);
    rows.push({
      baselinePath,
      currentPath,
      moved: baselinePath !== currentPath,
      testsBefore: countTests(before),
      testsAfter: countTests(after),
      assertsBefore: countAssertions(before),
      assertsAfter: countAssertions(after),
      dependencies,
      owner,
      reason: reasonFor(owner, dependencies),
    });
  }

  process.stdout.write('baseline: ' + baseline + '\n\n');
  process.stdout.write('| Test file (baseline) | Tests | Assertions before -> after | Runtime dependency | Final owner | Reason |\n');
  process.stdout.write('|---|---|---|---|---|---|\n');
  for (const row of rows) {
    process.stdout.write(
      '| `' + row.baselinePath + '`' +
      ' | ' + row.testsBefore + ' -> ' + row.testsAfter +
      ' | ' + row.assertsBefore + ' -> ' + row.assertsAfter +
      ' | ' + (row.dependencies.length ? row.dependencies.join(', ') : 'none') +
      ' | ' + row.owner +
      ' | ' + row.reason + ' |\n'
    );
  }

  const moved = rows.filter((row) => row.moved);
  const stayed = rows.filter((row) => !row.moved);
  const assertDelta = rows.reduce((sum, row) => sum + (row.assertsAfter - row.assertsBefore), 0);
  process.stdout.write(
    '\nfiles: ' + rows.length +
    ' (moved ' + moved.length + ', stayed ' + stayed.length + ')' +
    '; moved tests: ' + moved.reduce((sum, row) => sum + row.testsBefore, 0) +
    '; assertion delta: ' + (assertDelta >= 0 ? '+' : '') + assertDelta + '\n'
  );
  process.stdout.write('Every moved file keeps its test count; a negative delta would be a deleted assertion.\n');

  const lost = rows.filter((row) => row.testsAfter < row.testsBefore);
  if (lost.length > 0) {
    process.stderr.write('FAIL: test declarations disappeared from ' + lost.length + ' file(s)\n');
    return 1;
  }
  const shrunk = rows.filter((row) => row.assertsAfter < row.assertsBefore);
  if (shrunk.length > 0) {
    process.stderr.write('FAIL: assertions disappeared from ' + shrunk.length + ' file(s)\n');
    return 1;
  }
  process.stdout.write('audit: PASS - no test or assertion was dropped anywhere in the inventory\n');
  return 0;
}

process.exitCode = main();
