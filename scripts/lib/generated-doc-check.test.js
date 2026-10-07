'use strict';

/**
 * Regression tests for the generated-doc freshness comparison.
 *
 * Pins the 2026-10-07 CI failure (commit 8ffeee4): `gen-decision-index --check`
 * compared the committed docs/DECISION_INDEX.md byte-for-byte against a fresh
 * generation. The repository stores the file as LF, the generator writes CRLF, so
 * a clean Linux checkout (core.autocrlf=false, i.e. GitHub Actions) read as STALE
 * while a Windows CRLF checkout read as OK.
 *
 * Two layers:
 *   1. unit tests of the shared helper (both directions, BOM, dates, real drift);
 *   2. an end-to-end test that runs the REAL scripts/gen-decision-index.js --check
 *      against a throwaway copy of the repo layout, materializing the committed
 *      index as CRLF, as LF and as BOM-prefixed, and asserting a real content
 *      change still fails.
 *
 * No DB, no network: only Node built-ins.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { isStale, firstDiff, normLineEndings, normalizeForCompare } = require('./generated-doc-check');

const ROOT = path.join(__dirname, '..', '..');
const GEN = path.join(ROOT, 'scripts', 'gen-decision-index.js');
const DECISIONS = path.join(ROOT, 'docs', 'RECOMMENDATION_ENGINE_DECISIONS.md');

const SAMPLE = [
  '# Decision Index (generated)',
  '',
  'Generated 2026-10-07 from RECOMMENDATION_ENGINE_DECISIONS.md (4300 lines).',
  '',
  '| # | Title |',
  '| 1 | Engine 1 |',
].join('\n');

// ---------------------------------------------------------------- unit tests

test('normLineEndings normalizes CRLF and strips a leading BOM only', () => {
  assert.equal(normLineEndings('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(normLineEndings('\uFEFFa\nb\n'), 'a\nb\n');
  // A U+FEFF that is real content (not leading) must survive.
  assert.equal(normLineEndings('a\uFEFFb\n'), 'a\uFEFFb\n');
});

test('committed LF vs generated CRLF compares equal (the CI failure)', () => {
  const lf = SAMPLE.replace(/\n/g, '\n');
  const crlf = SAMPLE.replace(/\n/g, '\r\n');
  assert.equal(isStale(lf, crlf), false);
});

test('committed CRLF vs generated LF compares equal (reverse direction)', () => {
  const lf = SAMPLE;
  const crlf = SAMPLE.replace(/\n/g, '\r\n');
  assert.equal(isStale(crlf, lf), false);
});

test('a leading BOM on either side does not read as stale', () => {
  const plain = SAMPLE.replace(/\n/g, '\r\n');
  assert.equal(isStale('\uFEFF' + plain, plain), false);
  assert.equal(isStale(plain, '\uFEFF' + plain), false);
});

test('a differing Generated <date> / as of <date> does not read as stale', () => {
  const a = SAMPLE.replace('2026-10-07', '2026-01-01') + '\nAll RESOLVED as of 2026-01-01.\n';
  const b = SAMPLE.replace('2026-10-07', '2026-12-31') + '\nAll RESOLVED as of 2026-12-31.\n';
  assert.equal(isStale(a, b), false);
});

test('a real content difference is still detected (not papered over)', () => {
  const a = SAMPLE.replace(/\n/g, '\r\n');
  const b = a.replace('Engine 1', 'Engine 1 CHANGED');
  assert.equal(isStale(a, b), true);
  const diff = firstDiff(a, b);
  assert.match(diff, /@@ line 6 @@/);
  assert.match(diff, /- \| 1 \| Engine 1 \|/);
  assert.match(diff, /\+ \| 1 \| Engine 1 CHANGED \|/);
});

test('a line added at the end is detected and reported', () => {
  const a = SAMPLE.replace(/\n/g, '\r\n');
  const b = a + 'extra trailing line\n';
  assert.equal(isStale(a, b), true);
  assert.match(firstDiff(a, b), /line counts differ/);
});

test('normalizeForCompare is symmetric for equal content on different endings', () => {
  assert.equal(
    normalizeForCompare('\uFEFFa\r\nb\r\n'),
    normalizeForCompare('a\nb\n')
  );
});

// ------------------------------------------------------- end-to-end (real CLI)

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-index-test-'));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.copyFileSync(GEN, path.join(dir, 'scripts', 'gen-decision-index.js'));
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'generated-doc-check.js'),
    path.join(dir, 'scripts', 'lib', 'generated-doc-check.js')
  );
  fs.copyFileSync(DECISIONS, path.join(dir, 'docs', 'RECOMMENDATION_ENGINE_DECISIONS.md'));
  return dir;
}

function runCheck(dir) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(dir, 'scripts', 'gen-decision-index.js'), '--check'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function writeIndex(dir, text) {
  fs.writeFileSync(path.join(dir, 'docs', 'DECISION_INDEX.md'), text, 'utf8');
}

test('end-to-end: --check accepts the committed index as CRLF, LF, and BOM-prefixed', (t) => {
  const dir = makeFixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Generate the index exactly as the real CLI does (CRLF on disk).
  execFileSync(process.execPath, [path.join(dir, 'scripts', 'gen-decision-index.js')], { cwd: dir, stdio: 'pipe' });
  const generated = fs.readFileSync(path.join(dir, 'docs', 'DECISION_INDEX.md'), 'utf8');
  assert.ok(generated.includes('\r\n'), 'generator should write CRLF');

  // Sanity: a same-content CRLF file passes.
  assert.equal(runCheck(dir).status, 0, 'CRLF committed index should pass');

  // The exact CI case: a clean Linux checkout materializes the file as LF.
  writeIndex(dir, generated.replace(/\r\n/g, '\n'));
  const lf = runCheck(dir);
  assert.equal(lf.status, 0, 'LF committed index should pass --check (this was the CI failure)');

  // A BOM-prefixed file (some editors add one) must not read as stale either.
  writeIndex(dir, '\uFEFF' + generated);
  assert.equal(runCheck(dir).status, 0, 'BOM-prefixed committed index should pass --check');

  // But a REAL content change must still fail, and print why.
  writeIndex(dir, generated.replace('| 1 |', '| 1 | tampered |'));
  const tampered = runCheck(dir);
  assert.equal(tampered.status, 1, 'real content drift must fail');
  assert.match(tampered.stderr, /STALE/);
  assert.match(tampered.stderr, /@@ line \d+ @@/);
});

test('end-to-end: --check fails cleanly when the index is missing', (t) => {
  const dir = makeFixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = runCheck(dir);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /does not exist/);
});

test('end-to-end: source doc CRLF vs LF generates identical output, line-count footer included', (t) => {
  const dir = makeFixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const docPath = path.join(dir, 'docs', 'RECOMMENDATION_ENGINE_DECISIONS.md');
  const genPath = path.join(dir, 'scripts', 'gen-decision-index.js');
  const indexPath = path.join(dir, 'docs', 'DECISION_INDEX.md');
  const source = fs.readFileSync(docPath, 'utf8');

  const generate = () => {
    execFileSync(process.execPath, [genPath], { cwd: dir, stdio: 'pipe' });
    return fs.readFileSync(indexPath, 'utf8');
  };

  // Materialize both endings explicitly, so the test is independent of how this
  // checkout materialized the source doc (LF on a clean Linux/GitHub clone, CRLF
  // on Windows). The BOM, if present, is preserved either way.
  const lf = source.replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  fs.writeFileSync(docPath, lf, 'utf8');
  const fromLf = generate();
  fs.writeFileSync(docPath, crlf, 'utf8');
  const fromCrlf = generate();

  // Whatever the source materialization, the derived output (including the
  // '(N lines)' footer, which is a parse-derived value) must be identical.
  assert.equal(normalizeForCompare(fromCrlf), normalizeForCompare(fromLf));
  const countOf = (s) => (s.match(/RECOMMENDATION_ENGINE_DECISIONS\.md \((\d+) lines\)/) || [])[1];
  assert.ok(countOf(fromCrlf), 'footer line count should be present');
  assert.equal(countOf(fromCrlf), countOf(fromLf));
});
