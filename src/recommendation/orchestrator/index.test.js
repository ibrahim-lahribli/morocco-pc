'use strict';

// ---------------------------------------------------------------------------
// Decision 17 (src/recommendation/orchestrator/): barrel contract and the
// module-wide source boundary.
//
// This file proves ONLY that index.js is a thin, boundary-only public surface
// and that no orchestrator source performs a write or reaches for a driver.
// Behaviour is covered by run.test.js / snapshot.test.js.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const orchestrator = require('./index');
const run = require('./run');
const snapshot = require('./snapshot');
const fullRun = require('./full-run');

/** Strip block and line comments so a source assertion cannot self-match docs. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const readSource = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const requiresOf = (file) => [...stripComments(readSource(file)).matchAll(/require\('([^']+)'\)/g)]
  .map((match) => match[1])
  .sort();

test('orchestrator barrel exposes exactly the Decision 17 + 21 entry points', () => {
  assert.deepEqual(Object.keys(orchestrator), ['runRecommendation', 'runRecommendationSnapshot', 'runRecommendationFullRun']);
  assert.equal(typeof orchestrator.runRecommendation, 'function');
  assert.equal(typeof orchestrator.runRecommendationSnapshot, 'function');
  assert.equal(typeof orchestrator.runRecommendationFullRun, 'function');
  assert.equal(orchestrator.runRecommendation.length, 1);
  assert.equal(orchestrator.runRecommendationSnapshot.length, 2);
  assert.equal(orchestrator.runRecommendationFullRun.length, 2);
});

test('orchestrator barrel re-exports by identity - no wrapper, no copy', () => {
  assert.equal(orchestrator.runRecommendation, run.runRecommendation);
  assert.equal(orchestrator.runRecommendationSnapshot, snapshot.runRecommendationSnapshot);
  assert.equal(orchestrator.runRecommendationFullRun, fullRun.runRecommendationFullRun);
});

test('no orchestrator source writes, commits, or reaches for a driver', () => {
  const banned = [
    "require('pg')", "require('node:pg')", 'new Pool', 'new Client',
    'INSERT', 'UPDATE', 'DELETE', 'COMMIT', 'TRUNCATE', 'CREATE TABLE', 'ALTER TABLE',
    'DROP ',
  ];
  for (const file of ['index.js', 'run.js', 'snapshot.js', 'full-run.js']) {
    const source = stripComments(readSource(file));
    for (const token of banned) {
      assert.ok(!source.includes(token), file + ' must not contain ' + token);
    }
  }

  // BEGIN belongs to the snapshot wrapper alone: runRecommendation issues no
  // transaction control at all (Decision 17.5).
  assert.equal(stripComments(readSource('run.js')).includes('BEGIN'), false);
  assert.equal(stripComments(readSource('index.js')).includes('BEGIN'), false);
  assert.equal(stripComments(readSource('full-run.js')).includes('BEGIN'), false);
  assert.ok(stripComments(readSource('snapshot.js')).includes('BEGIN'));
});

test('orchestrator modules import exactly their collaborators', () => {
  assert.deepEqual(requiresOf('run.js'), [
    '../assembly',
    '../candidates',
    '../candidates/errors',
    '../filtering',
    '../offers',
    '../query',
    '../retention',
    '../scoring',
  ]);
  assert.deepEqual(requiresOf('snapshot.js'), ['../candidates/errors', './run']);
  assert.deepEqual(requiresOf('index.js'), ['./full-run', './run', './snapshot']);
  assert.deepEqual(requiresOf('full-run.js'), ['../ranking', './commit', './snapshot']);
});

test('run.js composes the two Engine 2D stages itself (the B2-G helper is never imported)', () => {
  const source = stripComments(readSource('run.js'));
  assert.ok(source.includes('filtering.loadFilteringContext('));
  assert.ok(source.includes('filtering.filterCandidates('));
  assert.equal(source.includes('filterCandidatesForRecommendation'), false);
});

test('the barrel is a boundary only: no logic, no policy', () => {
  const source = stripComments(readSource('index.js'));
  for (const token of ['function ', 'if (', 'for (', 'await ', '=>']) {
    assert.ok(!source.includes(token), 'index.js must stay a boundary-only barrel: ' + token);
  }
});