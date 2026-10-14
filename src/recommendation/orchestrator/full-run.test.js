'use strict';

// Decision 21 (orchestrator/full-run.js): composition only. The three stages
// are stubbed through their module namespaces, so this file proves ONLY what
// the composer owns: exact call order, exact argument threading (selection
// receives the FULL ranked list, never top_n, with the ranking-barrel
// constants), the exact combined frozen return shape, and no short-circuit
// on zero builds or zero selected. Stage behaviour is covered elsewhere.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runRecommendationFullRun } = require('./full-run');
const snapshot = require('./snapshot');
const commit = require('./commit');
const ranking = require('../ranking');
const explanation = require('../explanation');

const QUERY_ID = '00000000-0000-4000-8000-000000000921';

/** Replace the four composed entries with scripted stubs; record call order. */
function stubStages({ snapshotResult, rankResult, selectResult, explainResult, commitResult }) {
  const order = [];
  const snapshotCalls = [];
  const rankCalls = [];
  const selectCalls = [];
  const explainCalls = [];
  const commitCalls = [];
  const originals = {
    snapshot: snapshot.runRecommendationSnapshot,
    rank: ranking.rankBuilds,
    select: ranking.selectArchetypes,
    explain: explanation.explainSelection,
    commit: commit.runRecommendationCommit,
  };
  snapshot.runRecommendationSnapshot = async function stub(client, queryId, options) {
    order.push('snapshot');
    snapshotCalls.push({ client, queryId, options });
    return snapshotResult;
  };
  ranking.rankBuilds = function stub(args) {
    order.push('rank');
    rankCalls.push(args);
    return rankResult;
  };
  ranking.selectArchetypes = function stub(args) {
    order.push('select');
    selectCalls.push(args);
    return selectResult;
  };
  explanation.explainSelection = function stub(args) {
    order.push('explain');
    explainCalls.push(args);
    return explainResult;
  };
  commit.runRecommendationCommit = async function stub(client, queryId, selected) {
    order.push('commit');
    commitCalls.push({ client, queryId, selected });
    return commitResult;
  };
  return {
    order,
    snapshotCalls,
    rankCalls,
    selectCalls,
    explainCalls,
    commitCalls,
    restore() {
      snapshot.runRecommendationSnapshot = originals.snapshot;
      ranking.rankBuilds = originals.rank;
      ranking.selectArchetypes = originals.select;
      explanation.explainSelection = originals.explain;
      commit.runRecommendationCommit = originals.commit;
    },
  };
}

async function withStubbedStages(stubs, body) {
  const stub = stubStages(stubs);
  try {
    return await body(stub);
  } finally {
    stub.restore();
  }
}

function happyStubs() {
  const builds = Object.freeze([{ marker: 'build-1' }]);
  const ranked = Object.freeze([{ marker: 'ranked-1' }, { marker: 'ranked-2' }]);
  const topN = Object.freeze([{ marker: 'ranked-1' }]);
  const selected = Object.freeze([{ persisted_rank: 1 }]);
  const archetypes = Object.freeze([{ strategy_key: 'BALANCED', persisted_rank: 1 }]);
  const reasonCodes = Object.freeze([]);
  const buildContributions = Object.freeze([Object.freeze([])]);
  const explained = Object.freeze([Object.freeze({ persisted_rank: 1, explanation: 'stub-explanation' })]);
  return {
    builds,
    ranked,
    topN,
    selected,
    buildContributions,
    explained,
    budgetFloor: Object.freeze({
      cheapest_total: 7693,
      currency: 'MAD',
      budget_amount: 12000,
      within_budget: true,
      cheapest_by_role: Object.freeze(Object.assign(Object.create(null), {
        CPU: 2699, MOTHERBOARD: 1199, RAM: 649, SSD_BOOT: 799,
        PSU: 899, CASE: 949, CPU_COOLER: 499,
      })),
      missing_roles: Object.freeze([]),
    }),
    snapshotResult: Object.freeze({
      query_id: QUERY_ID,
      scoring_model_id: 'model-1',
      builds,
      budget_amount: 12000,
      currency: 'MAD',
      priority: null,
      build_contributions: buildContributions,
      budget_floor: Object.freeze({
        cheapest_total: 7693,
        currency: 'MAD',
        budget_amount: 12000,
        within_budget: true,
        cheapest_by_role: Object.freeze(Object.assign(Object.create(null), {
          CPU: 2699, MOTHERBOARD: 1199, RAM: 649, SSD_BOOT: 799,
          PSU: 899, CASE: 949, CPU_COOLER: 499,
        })),
        missing_roles: Object.freeze([]),
      }),
    }),
    rankResult: Object.freeze({ ranked, top_n: topN }),
    selectResult: Object.freeze({ archetypes, reason_codes: reasonCodes }),
    explainResult: explained,
    commitResult: Object.freeze({
      query_id: QUERY_ID,
      persisted_ranks: Object.freeze([1]),
      build_candidate_ids: Object.freeze(['bc-1']),
      recommendation_result_ids: Object.freeze(['rr-1']),
    }),
  };
}


test('full-run: snapshot -> rank -> select -> commit in order on one client', async () => {
  const client = { query() {} };
  const fx = happyStubs();
  const out = await withStubbedStages(fx, async (stub) => {
    const result = await runRecommendationFullRun(client, QUERY_ID);
    assert.deepEqual(stub.order, ['snapshot', 'rank', 'select', 'explain', 'commit']);
    assert.equal(stub.snapshotCalls.length, 1);
    assert.equal(stub.snapshotCalls[0].client, client);
    assert.equal(stub.snapshotCalls[0].queryId, QUERY_ID);
    assert.equal(stub.commitCalls.length, 1);
    assert.equal(stub.commitCalls[0].client, client);
    assert.equal(stub.commitCalls[0].queryId, QUERY_ID);
    return result;
  });
  assert.ok(Object.isFrozen(out));
  assert.deepEqual(Object.keys(out), [
    'query_id',
    'scoring_model_id',
    'builds',
    'ranked',
    'top_n',
    'selected',
    'archetypes',
    'archetype_reason_codes',
    'dropped_count',
    'persisted_ranks',
    'build_candidate_ids',
    'recommendation_result_ids',
    // Decision 27: last.
    'budget_floor',
  ]);
  assert.equal(out.query_id, QUERY_ID);
  assert.equal(out.scoring_model_id, 'model-1');
  assert.equal(out.builds, fx.builds);
  assert.equal(out.ranked, fx.ranked);
  assert.equal(out.top_n, fx.topN);
  assert.equal(out.selected, fx.explained);
  assert.equal(out.archetypes, fx.selectResult.archetypes);
  assert.equal(out.archetype_reason_codes, fx.selectResult.reason_codes);
  assert.equal(out.dropped_count, 0);
  assert.deepEqual(out.persisted_ranks, [1]);
  assert.deepEqual(out.build_candidate_ids, ['bc-1']);
  assert.deepEqual(out.recommendation_result_ids, ['rr-1']);
});

test('full-run: rank takes snapshot builds; select takes FULL ranked with budget and priority; write takes selected', async () => {
  const client = { query() {} };
  const fx = happyStubs();
  await withStubbedStages(fx, async (stub) => {
    await runRecommendationFullRun(client, QUERY_ID);
    assert.equal(stub.rankCalls.length, 1);
    assert.deepEqual(Object.keys(stub.rankCalls[0]), ['builds']);
    assert.equal(stub.rankCalls[0].builds, fx.builds);
    assert.equal(stub.selectCalls.length, 1);
    assert.deepEqual(Object.keys(stub.selectCalls[0]).sort(), ['budget', 'priority', 'ranked']);
    assert.equal(stub.selectCalls[0].ranked, fx.ranked);
    assert.ok(stub.selectCalls[0].ranked !== fx.topN, 'selection must not receive top_n');
    assert.deepEqual(stub.selectCalls[0].budget, { amount: 12000, currency: 'MAD' });
    assert.equal(stub.selectCalls[0].priority, null);
    assert.equal(stub.explainCalls.length, 1);
    // E4: Engine 6 now consumes the ARCHAINED selection (selection.archetypes),
    // so the `selected` arg is the archetypes array, reference-equal to it.
    assert.equal(stub.explainCalls[0].selected, fx.selectResult.archetypes);
    assert.equal(stub.explainCalls[0].builds, fx.builds);
    assert.equal(stub.explainCalls[0].contributions, fx.buildContributions);
    assert.deepEqual(stub.explainCalls[0].budget, { amount: 12000, currency: 'MAD' });
    assert.equal(stub.commitCalls[0].selected, fx.explained);
    // Decision 27: budget_floor is passed through to the RESULT but is
    // deliberately NOT an Engine 6 input - the explain call's keys are
    // unchanged, which is what "Out of scope" in Decision 27 means.
    assert.deepEqual(
      Object.keys(stub.explainCalls[0]).sort(),
      ['budget', 'builds', 'contributions', 'selected']
    );
  });
});

test('full-run: budget_floor is passed through by reference, unrendered', async () => {
  const client = { query() {} };
  const fx = happyStubs();
  const out = await withStubbedStages(fx, async () =>
    runRecommendationFullRun(client, QUERY_ID)
  );
  // Same object, not a copy: the pass already froze it and nothing here edits it.
  assert.strictEqual(out.budget_floor, fx.snapshotResult.budget_floor);
  assert.equal(out.budget_floor.cheapest_total, 7693);
  assert.equal(out.budget_floor.within_budget, true);
});

test('full-run: zero builds still flow through rank, select, and commit with empty array', async () => {
  const client = { query() {} };
  const builds = Object.freeze([]);
  const ranked = Object.freeze([]);
  const topN = Object.freeze([]);
  const selected = Object.freeze([]);
  const archetypes = Object.freeze([]);
  const reasonCodes = Object.freeze(['EMPTY_RANKED']);
  const fx = {
    snapshotResult: Object.freeze({
      query_id: QUERY_ID,
      scoring_model_id: 'model-1',
      builds,
      budget_amount: 12000,
      currency: 'MAD',
      priority: null,
      build_contributions: Object.freeze([]),
      // Decision 27: a zero-build pass still reports a floor. This is the case
      // the diagnostic exists for, so the fixture must carry one.
      budget_floor: Object.freeze({
        cheapest_total: null,
        currency: 'MAD',
        budget_amount: 12000,
        within_budget: null,
        cheapest_by_role: Object.freeze(Object.create(null)),
        missing_roles: Object.freeze([
          'CPU', 'MOTHERBOARD', 'RAM', 'PSU', 'CASE', 'CPU_COOLER', 'SSD_BOOT',
        ]),
      }),
    }),
    rankResult: Object.freeze({ ranked, top_n: topN }),
    selectResult: Object.freeze({ archetypes, reason_codes: reasonCodes }),
    explainResult: Object.freeze([]),
    commitResult: Object.freeze({
      query_id: QUERY_ID,
      persisted_ranks: Object.freeze([]),
      build_candidate_ids: Object.freeze([]),
      recommendation_result_ids: Object.freeze([]),
    }),
  };
  const out = await withStubbedStages(fx, async (stub) => {
    const result = await runRecommendationFullRun(client, QUERY_ID);
    assert.deepEqual(stub.order, ['snapshot', 'rank', 'select', 'explain', 'commit']);
    assert.equal(stub.rankCalls[0].builds, builds);
    assert.equal(stub.selectCalls[0].ranked, ranked);
    assert.deepEqual(stub.commitCalls[0].selected, []);
    return result;
  });
  assert.deepEqual(out.builds, []);
  assert.deepEqual(out.selected, []);
  assert.deepEqual(out.archetypes, []);
  assert.deepEqual(out.archetype_reason_codes, ['EMPTY_RANKED']);
  assert.deepEqual(out.persisted_ranks, []);
  // Decision 27: zero builds is still an EXPLAINED outcome, and the floor is
  // null (not 0) because nothing was retained, not because everything is free.
  assert.equal(out.budget_floor.cheapest_total, null);
  assert.equal(out.budget_floor.within_budget, null);
});

test('full-run: zero selected still calls the write wrapper with empty array', async () => {
  const client = { query() {} };
  const fx = happyStubs();
  fx.selectResult = Object.freeze({ archetypes: Object.freeze([]), reason_codes: Object.freeze([]) });
  fx.explainResult = Object.freeze([]);
  fx.commitResult = Object.freeze({
    query_id: QUERY_ID,
    persisted_ranks: Object.freeze([]),
    build_candidate_ids: Object.freeze([]),
    recommendation_result_ids: Object.freeze([]),
  });
  await withStubbedStages(fx, async (stub) => {
    const out = await runRecommendationFullRun(client, QUERY_ID);
    assert.deepEqual(stub.order, ['snapshot', 'rank', 'select', 'explain', 'commit']);
    assert.equal(stub.selectCalls[0].ranked, fx.ranked);
    assert.deepEqual(stub.commitCalls[0].selected, []);
    assert.deepEqual(out.selected, []);
    assert.deepEqual(out.archetypes, []);
    assert.deepEqual(out.archetype_reason_codes, []);
  });
});

test('full-run: a stage error propagates unchanged and later stages never run', async () => {
  const client = { query() {} };
  const fx = happyStubs();
  const expectedPrefix = {
    snapshot: [],
    rank: ['snapshot'],
    select: ['snapshot', 'rank'],
    explain: ['snapshot', 'rank', 'select'],
    commit: ['snapshot', 'rank', 'select', 'explain'],
  };
  for (const stage of ['snapshot', 'rank', 'select', 'explain', 'commit']) {
    const sentinel = new Error('fail-at-' + stage);
    const stub = stubStages(fx);
    try {
      if (stage === 'snapshot') {
        snapshot.runRecommendationSnapshot = async () => { stub.order.push('snapshot'); throw sentinel; };
      } else if (stage === 'rank') {
        ranking.rankBuilds = () => { stub.order.push('rank'); throw sentinel; };
      } else if (stage === 'select') {
        ranking.selectArchetypes = () => { stub.order.push('select'); throw sentinel; };
      } else if (stage === 'explain') {
        explanation.explainSelection = () => { stub.order.push('explain'); throw sentinel; };
      } else {
        commit.runRecommendationCommit = async () => { stub.order.push('commit'); throw sentinel; };
      }
      await assert.rejects(runRecommendationFullRun(client, QUERY_ID), (error) => error === sentinel);
      const prefix = expectedPrefix[stage];
      assert.deepEqual(stub.order.slice(0, prefix.length), prefix);
      assert.equal(stub.order.length, prefix.length + 1);
    } finally {
      stub.restore();
    }
  }
});

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('full-run.js keeps its source boundary (no SQL, no tx control, no driver)', () => {
  const source = stripComments(fs.readFileSync(path.join(__dirname, 'full-run.js'), 'utf8'));
  for (const token of [
    "require('pg')", "require('node:pg')", 'new Pool', 'new Client', '.query(',
    'BEGIN', 'COMMIT', 'ROLLBACK', 'INSERT', 'UPDATE', 'DELETE', 'SELECT',
    'TRUNCATE', 'CREATE TABLE', 'ALTER TABLE', 'DROP ',
  ]) {
    assert.ok(!source.includes(token), 'full-run.js must not contain ' + token);
  }
  // Decision 35: the engine options object is forwarded unchanged to the read
  // wrapper, which forwards it to Stage 1.
  assert.ok(source.includes('snapshot.runRecommendationSnapshot(client, queryId, options)'));
  assert.ok(source.includes('ranking.rankBuilds({ builds: snap.builds })'));
  assert.ok(source.includes('ranked: rankedResult.ranked'));
  // E4 (Decision 41): the archetype call replaces the selectDiverseTop call.
  assert.ok(source.includes('ranking.selectArchetypes({'));
  assert.ok(source.includes('budget: { amount: snap.budget_amount, currency: snap.currency }'));
  assert.ok(source.includes('priority: snap.priority'));
  assert.ok(source.includes('explanation.explainSelection('));
  // OG-04: the pass's Engine 2D verdicts are forwarded as the 4th argument so
  // the commit wrapper can persist rejection reasons in the same transaction.
  assert.ok(source.includes('commit.runRecommendationCommit('));
  assert.ok(source.includes('snap.filter_verdicts'));
  // The DiverseTop walking mode is gone from this file (E4 replaces it).
  assert.ok(!source.includes('selectDiverseTop'));
  assert.ok(!source.includes('maxPerPair'));
});

test('full-run.js imports exactly the snapshot wrapper, the commit wrapper, the ranking barrel, and Engine 6', () => {
  const source = stripComments(fs.readFileSync(path.join(__dirname, 'full-run.js'), 'utf8'));
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]).sort();
  assert.deepEqual(requires, ['../explanation', '../ranking', './commit', './snapshot']);
});

test("Decision 38: full-run forwards explicit asOf unchanged into the snapshot", async () => {
  const options = Object.freeze({ asOf: "2026-10-08T20:00:00.000Z" });
  await withStubbedStages(happyStubs(), async (stub) => {
    await runRecommendationFullRun({ query() {} }, QUERY_ID, options);
    assert.equal(stub.snapshotCalls[0].options, options);
  });
});
