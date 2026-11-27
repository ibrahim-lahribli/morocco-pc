'use strict';

// packages/recommendation-runtime/test/transaction-ownership.test.js — the
// transaction contract from docs/ORCHESTRATOR_ENTRY_POINTS.md, checked against
// the source instead of trusted to prose.
//
// Step 5 preserves transaction ownership exactly; this test is what "preserve"
// means in executable form. Each orchestrator file may contain only the
// transaction keywords its entry point owns — a stray `COMMIT` in the
// snapshot wrapper, or a `BEGIN` inside `runRecommendation`, fails here even
// though it might still pass every behavioural test on the happy path.
//
// Step 5 W3 moved all EIGHT orchestrator files here (`run.js`, `snapshot.js`,
// `full-run.js`, `commit.js`, `swap-preview.js`, `swap-commit.js`, `compute.js`
// and `index.js`), so the move is complete and this suite analyses the real
// tree. Four of the eight own a transaction boundary — `snapshot.js` and
// `swap-preview.js` read (REPEATABLE READ READ ONLY, ROLLBACK only), `commit.js`
// and `swap-commit.js` write (COMMIT on success, ROLLBACK on error) — while
// `run.js`, `full-run.js`, `compute.js` and `index.js` own none. The test
// therefore (a) pins the contract document, (b) proves the analyzer against
// synthetic sources, and (c) requires the move to stay all-or-nothing: either
// all eight files are absent (pre-extraction) or all eight are present and
// analysed. A partial move fails.
//
// DB-free and dependency-free: node:test + node:assert only.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { lex } = require('./boundary-scanner');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const DOC = path.join(PACKAGE_ROOT, 'docs', 'ORCHESTRATOR_ENTRY_POINTS.md');
const ORCHESTRATOR_DIR = path.join(PACKAGE_ROOT, 'src', 'orchestrator');

const ENTRY_POINTS = [
  'runRecommendation',
  'runRecommendationSnapshot',
  'runRecommendationFullRun',
  'evaluateSwapPreview',
  'evaluateSwapPreviewSnapshot',
  'commitSwap',
  'commitSwapInTransaction',
  'readCommittedSwap',
];

// What each file may contain. `readOnlyBegin` means its BEGIN carries
// ISOLATION LEVEL REPEATABLE READ READ ONLY.
const EXPECTED = {
  'run.js': { begin: false, commit: false, rollback: false, readOnlyBegin: false },
  'snapshot.js': { begin: true, commit: false, rollback: true, readOnlyBegin: true },
  'full-run.js': { begin: false, commit: false, rollback: false, readOnlyBegin: false },
  'commit.js': { begin: true, commit: true, rollback: true, readOnlyBegin: false },
  'swap-preview.js': { begin: true, commit: false, rollback: true, readOnlyBegin: true },
  'swap-commit.js': { begin: true, commit: true, rollback: true, readOnlyBegin: false },
  // The barrel and the pure assemble-and-score seam moved with the six above in
  // step 5 W3, and neither owns a transaction: index.js only re-exports, and
  // compute.js is the pure half (its own purity gate is
  // src/recommendation/orchestrator/compute.purity.test.js).
  'index.js': { begin: false, commit: false, rollback: false, readOnlyBegin: false },
  'compute.js': { begin: false, commit: false, rollback: false, readOnlyBegin: false },
};

/**
 * The transaction keywords a module actually issues. Only string tokens count:
 * comments are dropped by the lexer, so a comment that discusses ROLLBACK is
 * not a statement, and a SQL constant is.
 */
function transactionKeywords(source) {
  const found = new Set();
  let readOnlyBegin = false;
  for (const token of lex(source)) {
    if (token.type !== 'string') continue;
    if (/\bBEGIN\b/.test(token.value)) found.add('BEGIN');
    if (/\bCOMMIT\b/.test(token.value)) found.add('COMMIT');
    if (/\bROLLBACK\b/.test(token.value)) found.add('ROLLBACK');
    if (/\bBEGIN\b[\s\S]*\bISOLATION LEVEL REPEATABLE READ\b[\s\S]*\bREAD ONLY\b/i.test(token.value)) {
      readOnlyBegin = true;
    }
  }
  return { keywords: found, readOnlyBegin };
}

const KEYWORD_ORDER = ['BEGIN', 'COMMIT', 'ROLLBACK'];

function expectedKeywords(name) {
  const rule = EXPECTED[name];
  return KEYWORD_ORDER.filter((keyword) => rule[keyword.toLowerCase()]);
}

function assertOwnership(name, source) {
  const actual = transactionKeywords(source);
  assert.deepEqual(
    KEYWORD_ORDER.filter((keyword) => actual.keywords.has(keyword)),
    expectedKeywords(name),
    name + ': the transaction keywords in the source disagree with docs/ORCHESTRATOR_ENTRY_POINTS.md'
  );
  assert.equal(
    actual.readOnlyBegin,
    EXPECTED[name].readOnlyBegin,
    name + ': the BEGIN form disagrees with docs/ORCHESTRATOR_ENTRY_POINTS.md'
  );
}

describe('transaction ownership: the documented contract', () => {
  const doc = fs.readFileSync(DOC, 'utf8');

  it('names every entry point', () => {
    for (const entry of ENTRY_POINTS) {
      assert.ok(doc.includes(entry), 'docs/ORCHESTRATOR_ENTRY_POINTS.md must name ' + entry);
    }
  });

  it('names the owner file of every entry point', () => {
    for (const name of Object.keys(EXPECTED)) {
      assert.ok(
        doc.includes('orchestrator/' + name),
        'docs/ORCHESTRATOR_ENTRY_POINTS.md must name orchestrator/' + name
      );
    }
  });

  it('records the internal commit wrapper as internal, not as a ninth entry point', () => {
    assert.ok(doc.includes('runRecommendationCommit'), 'the document must name runRecommendationCommit');
    assert.match(doc, /runRecommendationCommit` is \*\*internal\*\*/);
  });
});

describe('transaction ownership: the source', () => {
  const present = fs.existsSync(ORCHESTRATOR_DIR)
    ? fs.readdirSync(ORCHESTRATOR_DIR).filter((name) => name.endsWith('.js')).sort()
    : [];

  it('ships all eight orchestrator files or none (a partial move fails)', () => {
    assert.ok(
      present.length === 0 || present.length === Object.keys(EXPECTED).length,
      'the orchestrator move is partial: found ' + JSON.stringify(present) +
        '. Land all eight files with their shims in the same commit.'
    );
    for (const name of present) {
      assert.ok(name in EXPECTED, 'unexpected module in src/orchestrator: ' + name);
    }
  });

  it('every present orchestrator file owns exactly its documented transaction', () => {
    for (const name of present) {
      const source = fs.readFileSync(path.join(ORCHESTRATOR_DIR, name), 'utf8');
      assertOwnership(name, source);
    }
  });
});

describe('transaction ownership: the analyzer', () => {
  it('detects the keywords a transaction owner issues', () => {
    const found = transactionKeywords(
      ["await client.query('BEGIN');", "await client.query('COMMIT');", "await client.query('ROLLBACK');"].join('\n')
    );
    assert.deepEqual(KEYWORD_ORDER.filter((keyword) => found.keywords.has(keyword)), KEYWORD_ORDER);
  });

  it('recognises the read-only repeatable-read BEGIN', () => {
    const found = transactionKeywords("const BEGIN_SQL = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';");
    assert.deepEqual([...found.keywords], ['BEGIN']);
    assert.equal(found.readOnlyBegin, true);
  });

  it('does not count a keyword that appears only in a comment', () => {
    const found = transactionKeywords('// Decision 19.1: COMMIT is wrapper-owned.\nmodule.exports = {};');
    assert.deepEqual([...found.keywords], []);
  });

  it('fails the documented contract when a file gains a keyword it must not own', () => {
    assert.throws(() => assertOwnership('run.js', "await client.query('BEGIN');"), /run\.js/);
    assert.throws(() => assertOwnership('snapshot.js', "await client.query('COMMIT');"), /snapshot\.js/);
    assert.throws(() => assertOwnership('full-run.js', "await client.query('ROLLBACK');"), /full-run\.js/);
  });

  it('fails when a write transaction loses its COMMIT', () => {
    assert.throws(
      () => assertOwnership('commit.js', "await client.query('BEGIN');\nawait client.query('ROLLBACK');"),
      /commit\.js/
    );
  });

  it('fails when a read transaction is documented as a plain BEGIN', () => {
    assert.throws(
      () => assertOwnership('snapshot.js', "await client.query('BEGIN');\nawait client.query('ROLLBACK');"),
      /BEGIN form/
    );
  });
});
