'use strict';

// ---------------------------------------------------------------------------
// Decision 18 (2026-09-21) + Decision 20 (2026-09-22) — ranking + post-ranking
// pair-diversity selection barrel-contract test.
//
// This file proves ONLY the boundary decision: index.js is the canonical
// public surface and re-exports the ranking function, the top-N constant,
// the pair-diversity selection function, and the max-per-pair constant by
// identity without duplicating logic. Ranking/sorting/rounding/validation
// semantics are NOT re-tested here (see rank.test.js and select-diverse.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ranking = require('./index');
const rank = require('./rank');
const selectDiverse = require('./select-diverse');

test('ranking barrel exposes exactly the E4 eight-export public API, in order', () => {
  assert.deepEqual(
    Object.keys(ranking),
    [
      'rankBuilds', 'TOP_N_PERSISTED', 'selectDiverseTop', 'MAX_PER_PAIR',
      'selectArchetypes', 'PERFORMANCE_FLOOR', 'STRATEGIES', 'REASON_CODES',
    ]
  );
  assert.equal(typeof ranking.rankBuilds, 'function');
  assert.equal(ranking.rankBuilds.length, 1); // { builds }
  assert.equal(ranking.TOP_N_PERSISTED, 10);
  assert.equal(typeof ranking.selectDiverseTop, 'function');
  // selectDiverseTop has a default parameter, so length is 0
  assert.ok(ranking.selectDiverseTop.length === 0 || ranking.selectDiverseTop.length === 1);
  assert.equal(ranking.MAX_PER_PAIR, 3);
  // E4 (Decision 41).
  assert.equal(typeof ranking.selectArchetypes, 'function');
  assert.equal(ranking.selectArchetypes.length, 0); // all args optional/destructured
  assert.equal(ranking.PERFORMANCE_FLOOR, 0.85);
  assert.deepEqual(ranking.STRATEGIES, ['PERFORMANCE', 'BALANCED', 'VALUE']);
  assert.deepEqual(Object.keys(ranking.REASON_CODES).sort(), ['EMPTY_RANKED', 'NO_BALANCED_CANDIDATE', 'NO_PERFORMANCE_CANDIDATE', 'NO_VALUE_CANDIDATE']);
});

test('ranking barrel re-exports by identity - no wrapper, no copy', () => {
  assert.strictEqual(ranking.rankBuilds, rank.rankBuilds);
  assert.strictEqual(ranking.TOP_N_PERSISTED, rank.TOP_N_PERSISTED);
  assert.strictEqual(ranking.selectDiverseTop, selectDiverse.selectDiverseTop);
  assert.strictEqual(ranking.MAX_PER_PAIR, selectDiverse.MAX_PER_PAIR);
  const archetypes = require('./select-archetypes');
  assert.strictEqual(ranking.selectArchetypes, archetypes.selectArchetypes);
  assert.strictEqual(ranking.PERFORMANCE_FLOOR, archetypes.PERFORMANCE_FLOOR);
  assert.strictEqual(ranking.STRATEGIES, archetypes.STRATEGIES);
  assert.strictEqual(ranking.REASON_CODES, archetypes.REASON_CODES);
});

test('TOP_N_PERSISTED is a frozen code constant (Decision 18.4)', () => {
  assert.ok(Object.isFrozen(ranking.TOP_N_PERSISTED));
  assert.equal(ranking.TOP_N_PERSISTED, 10);
});

test('MAX_PER_PAIR is a frozen code constant (Decision 20 section 3)', () => {
  assert.ok(Object.isFrozen(ranking.MAX_PER_PAIR));
  assert.equal(ranking.MAX_PER_PAIR, 3);
});

test('ranking is a boundary only: no logic, no extra imports, no DB/persistence', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

  // No logic of its own.
  for (const token of ['function ', 'if (', 'for (', 'await ', '=>', '.query(', 'async ']) {
    assert.ok(!source.includes(token), `index.js must not contain ${token}`);
  }

  // Exactly the three rank-stage siblings. No pg / fs / dotenv / scripts /
  // orchestrator / persistence / query / offers / filtering / retention /
  // scoring / candidates access.
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(requires, ['./rank', './select-diverse', './select-archetypes']);

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
