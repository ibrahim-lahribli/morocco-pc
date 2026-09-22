'use strict';

// ---------------------------------------------------------------------------
// Decision 18 (src/recommendation/ranking/): focused barrel-contract test.
//
// This file proves ONLY the boundary decision: index.js is the canonical
// public surface and re-exports the ranking function and the top-N constant
// by identity without duplicating logic. Ranking/sorting/rounding/validation
// semantics are NOT re-tested here (see rank.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ranking = require('./index');
const rank = require('./rank');

test('ranking barrel exposes exactly the two-export public API, in order', () => {
  assert.deepEqual(Object.keys(ranking), ['rankBuilds', 'TOP_N_PERSISTED']);
  assert.equal(typeof ranking.rankBuilds, 'function');
  assert.equal(ranking.rankBuilds.length, 1); // { builds }
  assert.equal(ranking.TOP_N_PERSISTED, 10);
});

test('ranking barrel re-exports by identity - no wrapper, no copy', () => {
  assert.strictEqual(ranking.rankBuilds, rank.rankBuilds);
  assert.strictEqual(ranking.TOP_N_PERSISTED, rank.TOP_N_PERSISTED);
});

test('TOP_N_PERSISTED is a frozen code constant (Decision 18.4)', () => {
  assert.ok(Object.isFrozen(ranking.TOP_N_PERSISTED));
  assert.equal(ranking.TOP_N_PERSISTED, 10);
});

test('ranking is a boundary only: no logic, no extra imports, no DB/persistence', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

  // No logic of its own.
  for (const token of ['function ', 'if (', 'for (', 'await ', '=>', '.query(', 'async ']) {
    assert.ok(!source.includes(token), `index.js must not contain ${token}`);
  }

  // Exactly one require: the rank module. No pg / fs / dotenv / scripts /
  // orchestrator / persistence / query / offers / filtering / retention /
  // scoring / candidates access.
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(requires, ['./rank']);

  const banned = [
    "require('pg')",
    "require('node:pg')",
    "require('dotenv')",
    "require('fs')",
    'new Pool',
    '.query(',
    '../orchestrator',
    '../persistence',
    '../query',
    '../offers',
    '../filtering',
    '../retention',
    '../scoring',
    '../candidates',
  ];
  for (const token of banned) {
    assert.ok(!source.includes(token), `index.js must not contain ${token}`);
  }
});
