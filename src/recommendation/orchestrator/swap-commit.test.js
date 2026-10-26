'use strict';

// ---------------------------------------------------------------------------
// Decision 56 (src/recommendation/orchestrator/swap-commit.js): the WRITE half
// of CD-8.
//
// This file proves the WIRING and the ARITHMETIC, not the pair table: that a
// commit asks the preview's own composition (`composeSwap`) and nothing else,
// that the derived build copies the source rows and reprices ONLY the swapped
// role, that the total is the same `persisted - previous + next` the preview
// shows, that the PERSISTED status is the WHOLE build's verdict rather than the
// role-scoped one, and that a refusal writes nothing at all.
//
// The database is faked at the statement boundary on purpose: what a commit
// writes is a row shape, and `apps/api/test/db/swap-commit.db.test.js` proves
// the same shape survives a real schema, a real pass and a real rollback.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  commitSwap,
  commitSwapInTransaction,
  readCommittedSwap,
  BEGIN_SQL,
  COMMIT_SQL,
  ROLLBACK_SQL,
  INSERT_BUILD_CANDIDATE_SQL,
  INSERT_BUILD_COMPONENT_SQL,
  INSERT_RECOMMENDATION_SWAP_SQL,
  SELECT_COMMITTED_SWAP_SQL,
} = require('./swap-commit');
const { SELECT_NOW_SQL } = require('./run');
const queryModule = require('../query');
const candidatesModule = require('../candidates');
const offersModule = require('../offers');
const filteringModule = require('../filtering');
const assemblyModule = require('../assembly');
const scoringModule = require('../scoring');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const V = (n) => '00000000-0000-4000-9000-' + String(n).padStart(12, '0');

const QUERY_ID = U(901);
const RESULT_ID = U(904);
const MODEL_ID = U(902);
const STORE_ID = U(903);

const IDS = {
  CPU: U(1),
  MOTHERBOARD: U(2),
  RAM: U(3),
  GPU: U(4),
  PSU: U(5),
  CASE: U(6),
  CPU_COOLER: U(7),
  SSD_BOOT: U(8),
};
const GPU_VARIANT_ID = V(1);
const ALT_CPU_ID = U(11);
const ALT_GPU_ID = U(14);
const ALT_GPU_VARIANT_ID = V(11);

/** The persisted prices - deliberately NOT the carrier's (see the repricing test). */
const PERSISTED_PRICES = Object.freeze({
  CPU: 1999,
  MOTHERBOARD: 1200,
  RAM: 700,
  GPU: 3200,
  PSU: 650,
  CASE: 900,
  CPU_COOLER: 350,
  SSD_BOOT: 800,
});
const PERSISTED_TOTAL = 9799;

const QUERY_INPUT = Object.freeze({
  query_id: QUERY_ID,
  scoring_model_id: MODEL_ID,
  input: Object.freeze({ budget_amount: 20000, currency: 'MAD', use_case: 'GAMING' }),
  priority: null,
  resolution: null,
});

function verdict(role, productId, variantId, status, reason) {
  return Object.freeze({
    product_id: productId,
    product_variant_id: variantId === undefined ? null : variantId,
    category: candidatesModule.expectedCategoryForRole(role),
    component_role: role,
    status,
    reason: reason === undefined ? null : reason,
    relationships: Object.freeze({}),
    unknown_pairwise_count: 0,
    compatibility_notes: Object.freeze([]),
  });
}

/**
 * The persisted build as the API reads it: identity AND the Decision 35
 * carrier columns, because the commit copies those five values verbatim.
 */
function persistedBuild(omit) {
  const skipped = omit || [];
  return Object.keys(IDS)
    .filter((role) => !skipped.includes(role))
    .map((role) => Object.freeze({
      role,
      product_id: IDS[role],
      product_variant_id: role === 'GPU' ? GPU_VARIANT_ID : null,
      selected_price: String(PERSISTED_PRICES[role].toFixed(2)),
      currency: 'MAD',
      store_id: STORE_ID,
      price_checked_at: '2026-10-01T00:00:00.000Z',
      offer_class: 'SEED_UNVERIFIED',
      store_offer_id: U(500 + Object.keys(IDS).indexOf(role)),
    }));
}

const CARRIER_ROWS = [
  { component_role: 'CPU', product_id: IDS.CPU, product_variant_id: null, selected_price: 1999 },
  { component_role: 'CPU', product_id: ALT_CPU_ID, product_variant_id: null, selected_price: 2400 },
  { component_role: 'MOTHERBOARD', product_id: IDS.MOTHERBOARD, product_variant_id: null, selected_price: 1200 },
  { component_role: 'RAM', product_id: IDS.RAM, product_variant_id: null, selected_price: 700 },
  { component_role: 'GPU', product_id: IDS.GPU, product_variant_id: GPU_VARIANT_ID, selected_price: 3200 },
  {
    component_role: 'GPU',
    product_id: ALT_GPU_ID,
    product_variant_id: ALT_GPU_VARIANT_ID,
    selected_price: 4500,
    offer_class: 'VERIFIED',
  },
  { component_role: 'PSU', product_id: IDS.PSU, product_variant_id: null, selected_price: 650 },
  { component_role: 'CASE', product_id: IDS.CASE, product_variant_id: null, selected_price: 900 },
  { component_role: 'CPU_COOLER', product_id: IDS.CPU_COOLER, product_variant_id: null, selected_price: 350 },
  { component_role: 'SSD_BOOT', product_id: IDS.SSD_BOOT, product_variant_id: null, selected_price: 800 },
];

/** The real Engine 3 Step 2 carrier shape, built from fixtures. */
function carrier(rows) {
  const raw = Object.create(null);
  for (const row of rows) {
    raw[assemblyModule.priceKey(row.product_id, row.product_variant_id, row.component_role)] = {
      selected_price: row.selected_price,
      currency: 'MAD',
      store_id: STORE_ID,
      price_checked_at: '2030-01-01T00:00:00.000Z',
      offer_id: U(600),
      offer_class: row.offer_class === undefined ? 'SEED_UNVERIFIED' : row.offer_class,
    };
  }
  return assemblyModule.validatePrices(raw);
}

const POOL = Object.keys(IDS).map((role) => ({
  component_role: role,
  product_id: IDS[role],
  product_variant_id: role === 'GPU' ? GPU_VARIANT_ID : null,
  category: candidatesModule.expectedCategoryForRole(role),
})).concat([
  { component_role: 'CPU', product_id: ALT_CPU_ID, product_variant_id: null, category: 'CPU' },
  { component_role: 'GPU', product_id: ALT_GPU_ID, product_variant_id: ALT_GPU_VARIANT_ID, category: 'GPU' },
]);

function liveVerdicts(overrides) {
  const replaced = overrides || {};
  return [
    verdict('CPU', IDS.CPU, null, 'PASS'),
    verdict('CPU', ALT_CPU_ID, null, 'PASS'),
    verdict('MOTHERBOARD', IDS.MOTHERBOARD, null, 'PASS'),
    verdict('RAM', IDS.RAM, null, 'PASS'),
    verdict('GPU', IDS.GPU, GPU_VARIANT_ID, 'PASS'),
    verdict('GPU', ALT_GPU_ID, ALT_GPU_VARIANT_ID, replaced.GPU || 'PASS', null),
    verdict('PSU', IDS.PSU, null, 'PASS'),
    verdict('CASE', IDS.CASE, null, 'PASS'),
    verdict('CPU_COOLER', IDS.CPU_COOLER, null, 'PASS'),
    verdict('SSD_BOOT', IDS.SSD_BOOT, null, 'PASS'),
  ];
}

// ---------------------------------------------------------------------------
// The spy seam (the one ./run.js documents: namespace call, plain patch)
// ---------------------------------------------------------------------------

function spyOn(namespace, name, impl) {
  const original = namespace[name];
  const calls = [];
  namespace[name] = function spy(...args) {
    const record = { args, result: null };
    calls.push(record);
    record.result = impl(args, calls, original);
    return record.result;
  };
  return {
    calls,
    restore() {
      namespace[name] = original;
    },
  };
}

/** A database that records every statement and answers the four shapes. */
function fakeDb(state) {
  const s = state || {};
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params: params === undefined ? [] : params });
      if (sql === SELECT_NOW_SQL) {
        return { rows: [{ now: new Date('2026-10-25T12:00:00.000Z') }] };
      }
      if (sql === INSERT_BUILD_CANDIDATE_SQL) {
        return { rows: [{ id: params[0] }] };
      }
      if (sql === INSERT_RECOMMENDATION_SWAP_SQL) {
        if (s.swapInsertRows !== undefined) {
          return { rows: s.swapInsertRows };
        }
        return { rows: [{ created_at: new Date('2026-10-25T12:00:00.000Z') }] };
      }
      if (sql === SELECT_COMMITTED_SWAP_SQL) {
        return { rows: s.committedSwaps || [] };
      }
      return { rows: [] };
    },
    written() {
      return calls.filter((call) => (
        call.sql.startsWith('INSERT') || call.sql.startsWith('UPDATE') || call.sql.startsWith('DELETE')
      ));
    },
  };
}

/** Every collaborator a commit touches, patched to a deterministic answer. */
function install(options) {
  const opts = options || {};
  const order = [];
  const context = Object.freeze({ candidates: Object.freeze({}) });
  const spies = {
    order,
    context,
    query: spyOn(queryModule, 'loadQueryInput', () => {
      order.push('loadQueryInput');
      return QUERY_INPUT;
    }),
    loadCandidates: spyOn(candidatesModule, 'loadCandidates', () => {
      order.push('loadCandidates');
      return { input: QUERY_INPUT.input, candidates: POOL };
    }),
    selectCandidatePool: spyOn(candidatesModule, 'selectCandidatePool', (args) => {
      order.push('selectCandidatePool');
      return { input: args[0], pool: POOL };
    }),
    selectOfferPrices: spyOn(offersModule, 'selectOfferPrices', () => {
      order.push('selectOfferPrices');
      return { input: QUERY_INPUT.input, pool: POOL, prices: carrier(CARRIER_ROWS) };
    }),
    loadFilteringContext: spyOn(filteringModule, 'loadFilteringContext', () => {
      order.push('loadFilteringContext');
      return context;
    }),
    filterCandidates: spyOn(filteringModule, 'filterCandidates', () => {
      order.push('filterCandidates');
      return { results: opts.verdicts || liveVerdicts() };
    }),
    evaluateBuildReplacement: spyOn(assemblyModule, 'evaluateBuildReplacement', () => {
      order.push('evaluateBuildReplacement');
      return { status: 'PASS', pairs: Object.freeze([]), unknown_pairwise_count: 0 };
    }),
    evaluateBuild: spyOn(assemblyModule, 'evaluateBuild', (args) => {
      order.push('evaluateBuild');
      if (opts.buildVerdict !== undefined) {
        return opts.buildVerdict;
      }
      return {
        status: 'PASS',
        pairs: Object.freeze([]),
        unknown_pairwise_count: 2,
      };
    }),
    lookupPrice: spyOn(assemblyModule, 'lookupPrice', (args) => {
      order.push('lookupPrice');
      return args[0][assemblyModule.priceKey(
        args[1].product_id,
        args[1].product_variant_id,
        args[1].component_role
      )];
    }),
    loadScoringModel: spyOn(scoringModule, 'loadScoringModel', () => {
      order.push('loadScoringModel');
      return { id: MODEL_ID, configuration: Object.freeze({ pinned: true }) };
    }),
    loadComponentAssessments: spyOn(scoringModule, 'loadComponentAssessments', () => {
      order.push('loadComponentAssessments');
      return { assessments: Object.freeze({}), loaded_at: null };
    }),
    computeBuildScore: spyOn(scoringModule, 'computeBuildScore', () => {
      order.push('computeBuildScore');
      return opts.score === undefined ? 74.256 : opts.score;
    }),
  };
  return {
    spies,
    restore() {
      for (const key of Object.keys(spies)) {
        if (spies[key] && typeof spies[key].restore === 'function') {
          spies[key].restore();
        }
      }
    },
  };
}

async function withCollaborators(options, body) {
  const installed = install(options);
  try {
    return await body(installed.spies);
  } finally {
    installed.restore();
  }
}

function commitArgs(overrides, omit) {
  return Object.assign({
    db: fakeDb(),
    queryId: QUERY_ID,
    sourceResultId: RESULT_ID,
    role: 'CPU',
    productId: ALT_CPU_ID,
    buildComponents: persistedBuild(omit),
    persistedTotalPrice: PERSISTED_TOTAL,
    catalogVersion: 'a'.repeat(32),
    engineVersion: 'test-deploy',
  }, overrides || {});
}

// ---------------------------------------------------------------------------
// 1. The composition IS the preview's, and the writes follow it.
// ---------------------------------------------------------------------------

test('a commit asks the preview composition once, then writes the three rows in order', async () => {
  await withCollaborators({}, async (spies) => {
    const db = fakeDb();
    const result = await commitSwap(commitArgs({ db }));

    assert.equal(result.committed, true);
    assert.deepEqual(spies.order, [
      'loadQueryInput',
      'loadCandidates',
      'selectCandidatePool',
      'selectOfferPrices',
      'loadFilteringContext',
      'filterCandidates',
      'evaluateBuildReplacement',
      'lookupPrice',
      'evaluateBuild',
      'loadScoringModel',
      'loadComponentAssessments',
      'computeBuildScore',
    ]);
    // ONE filter pass: the commit does not re-run the 2D stage for its own
    // verdict (Decision 56 item 8).
    assert.equal(spies.filterCandidates.calls.length, 1);

    const writes = db.written();
    assert.equal(writes.length, 3);
    assert.equal(writes[0].sql, INSERT_BUILD_CANDIDATE_SQL);
    assert.equal(writes[1].sql, INSERT_BUILD_COMPONENT_SQL);
    assert.equal(writes[2].sql, INSERT_RECOMMENDATION_SWAP_SQL);
    // The clock is read exactly once, before the rows are written, and no
    // UPDATE/DELETE exists at all (Decision 56 item 1).
    assert.equal(db.calls.filter((call) => call.sql === SELECT_NOW_SQL).length, 1);
    assert.equal(db.calls.filter((call) => /^(UPDATE|DELETE)/.test(call.sql)).length, 0);
  });
});

// ---------------------------------------------------------------------------
// 2. The derived build: source rows copied, ONE role repriced.
// ---------------------------------------------------------------------------

test('the derived build copies the persisted carriers and reprices ONLY the swapped role', async () => {
  await withCollaborators({}, async () => {
    const db = fakeDb();
    await commitSwap(commitArgs({ db }));
    const params = db.written()[1].params;
    const roles = params[4];
    const prices = params[5];
    const currencies = params[6];
    const storeIds = params[7];
    const checkedAts = params[8];
    const offerClasses = params[9];
    const offerIds = params[10];

    assert.deepEqual(roles, [
      'CPU',
      'MOTHERBOARD',
      'RAM',
      'GPU',
      'PSU',
      'CASE',
      'CPU_COOLER',
      'SSD_BOOT',
    ], 'assembly order, one row per role');

    const cpu = roles.indexOf('CPU');
    const gpu = roles.indexOf('GPU');
    // The swapped role: the LIVE carrier (2400), its own provenance.
    assert.equal(prices[cpu], 2400, 'the carrier supplies its own number');
    assert.equal(offerClasses[cpu], 'SEED_UNVERIFIED');
    // Every other role: the PERSISTED row, verbatim - a swap must not reprice
    // the whole build at today's offers.
    assert.equal(prices[gpu], '3200.00', 'NUMERIC stays the string pg returned');
    assert.equal(currencies[gpu], 'MAD');
    assert.equal(storeIds[gpu], STORE_ID);
    assert.equal(checkedAts[gpu], '2026-10-01T00:00:00.000Z');
    assert.equal(offerIds[gpu], U(503));
  });
});

test('the total is the preview arithmetic: persisted total - previous + next', async () => {
  await withCollaborators({}, async () => {
    const db = fakeDb();
    const result = await commitSwap(commitArgs({ db }));
    // 9799 - 1999 + 2400
    assert.equal(result.build.total_price, 10200);
    assert.equal(db.written()[0].params[2], 10200);
  });
});

test('a two-decimal total never carries a float artefact', async () => {
  await withCollaborators({}, async () => {
    const db = fakeDb();
    const result = await commitSwap(commitArgs({
      db,
      buildComponents: persistedBuild().map((component) => (component.role === 'CPU'
        ? Object.assign({}, component, { selected_price: '0.10' })
        : component)),
      persistedTotalPrice: 0.1 + 0.2,
    }));
    assert.equal(result.build.total_price, 2400.2);
  });
});

// ---------------------------------------------------------------------------
// 3. Score and status are the engine's, and both are PERSISTED.
// ---------------------------------------------------------------------------

test('the score is Engine 4 under the pass-pinned model, with the WHOLE build UNKNOWN count', async () => {
  await withCollaborators({}, async (spies) => {
    const db = fakeDb();
    const result = await commitSwap(commitArgs({ db }));

    assert.equal(spies.loadScoringModel.calls[0].args[0], MODEL_ID, 'the PASS\'s model, not the active one');
    const scoreArgs = spies.computeBuildScore.calls[0].args[0];
    assert.equal(scoreArgs.configuration.pinned, true);
    assert.equal(scoreArgs.unknownPairwiseCount, 2, 'the whole-build count, from evaluateBuild');
    assert.equal(scoreArgs.build.unknown_pairwise_count, 2);
    assert.equal(scoreArgs.build.components.length, 8);
    assert.equal(result.build.score, 74.26, 'two decimals, like every other stored score');
  });
});

test('the PERSISTED status is the whole-build verdict, not the role-scoped one', async () => {
  await withCollaborators({ buildVerdict: { status: 'UNKNOWN', pairs: Object.freeze([]), unknown_pairwise_count: 1 } }, async () => {
    const db = fakeDb();
    const result = await commitSwap(commitArgs({ db }));
    // UNKNOWN commits - a pass persists UNKNOWN builds too - and it is STORED
    // as UNKNOWN, never laundered into PASS.
    assert.equal(result.committed, true);
    assert.equal(result.compatibility.status, 'UNKNOWN');
    assert.equal(result.build.compatibility_status, 'UNKNOWN');
    assert.equal(db.written()[0].params[4], 'UNKNOWN');
  });
});

test('a FAIL whole-build verdict writes NOTHING and is reported, not thrown', async () => {
  await withCollaborators({ buildVerdict: { status: 'FAIL', pairs: Object.freeze([]), unknown_pairwise_count: 0 } }, async () => {
    const db = fakeDb();
    const result = await commitSwap(commitArgs({ db }));
    assert.equal(result.committed, false);
    assert.equal(result.reason, 'NOT_COMMITTABLE');
    assert.equal(db.written().length, 0, 'no build_candidate, no component, no swap');
  });
});

// ---------------------------------------------------------------------------
// 4. The three other refusals, each with no write.
// ---------------------------------------------------------------------------

test('a role that is not in the persisted build is ROLE_ABSENT, and nothing is written', async () => {
  await withCollaborators({}, async () => {
    const db = fakeDb();
    const result = await commitSwap(commitArgs({
      db,
      role: 'GPU',
      productId: ALT_GPU_ID,
      productVariantId: ALT_GPU_VARIANT_ID,
    }, ['GPU']));
    assert.equal(result.committed, false);
    assert.equal(result.reason, 'ROLE_ABSENT');
    assert.equal(db.written().length, 0);
  });
});

test('a candidate with no eligible offer is INELIGIBLE, with its reason', async () => {
  await withCollaborators({}, async () => {
    const db = fakeDb();
    // A product in the 2C pool that Stage 1 dropped: it has no verdict.
    const result = await commitSwap(commitArgs({
      db,
      role: 'RAM',
      productId: U(77),
    }));
    assert.equal(result.committed, false);
    assert.equal(result.reason, 'INELIGIBLE');
    assert.equal(db.written().length, 0);
  });
});

test('a persisted pick with no live verdict blocks the commit, naming the role', async () => {
  await withCollaborators({
    verdicts: liveVerdicts().filter((entry) => entry.component_role !== 'MOTHERBOARD'),
  }, async () => {
    const db = fakeDb();
    const result = await commitSwap(commitArgs({ db }));
    assert.equal(result.committed, false);
    assert.equal(result.reason, 'NOT_EVALUABLE');
    assert.equal(result.blocked_role, 'MOTHERBOARD');
    assert.equal(db.written().length, 0);
  });
});

// ---------------------------------------------------------------------------
// 5. The snapshot wrapper's transaction contract.
// ---------------------------------------------------------------------------

test('the wrapper commits on success and rolls back on a throw', async () => {
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push(sql);
      if (sql === SELECT_NOW_SQL) return { rows: [{ now: new Date('2026-10-25T12:00:00.000Z') }] };
      if (sql === INSERT_BUILD_CANDIDATE_SQL) return { rows: [{ id: params[0] }] };
      if (sql === INSERT_RECOMMENDATION_SWAP_SQL) {
        return { rows: [{ created_at: new Date('2026-10-25T12:00:00.000Z') }] };
      }
      return { rows: [] };
    },
  };

  await withCollaborators({}, async () => {
    // A successful commit: BEGIN ... COMMIT.
    await commitSwapInTransaction(client, commitArgs({ db: client }));
    // BEGIN first, COMMIT last, and the rows written in between.
    assert.equal(statements[0], BEGIN_SQL);
    assert.equal(statements[statements.length - 1], COMMIT_SQL);
    assert.equal(statements.filter((sql) => sql.startsWith('INSERT')).length, 3);
  });

  statements.length = 0;
  await withCollaborators({}, async () => {
    // A throwing commit: BEGIN ... ROLLBACK, and the error propagates.
    await assert.rejects(
      () => commitSwapInTransaction(client, commitArgs({
        db: client,
        buildComponents: persistedBuild(),
        persistedTotalPrice: null,
      })),
      (error) => error instanceof CandidateSelectionError
        && error.code === ERROR_CODES.INVALID_FIELD_VALUE
    );
    assert.deepEqual(statements, [BEGIN_SQL, ROLLBACK_SQL]);
  });
});

test('a failing BEGIN attempts no ROLLBACK; a failing COMMIT rolls back', async () => {
  const beginFailure = {
    async query(sql) {
      if (sql === BEGIN_SQL) throw new Error('begin failed');
      throw new Error('unexpected ' + sql);
    },
  };
  await assert.rejects(() => commitSwapInTransaction(beginFailure, commitArgs()), /begin failed/);

  const commitFailure = {
    statements: [],
    async query(sql, params) {
      this.statements.push(sql);
      if (sql === COMMIT_SQL) throw new Error('commit failed');
      if (sql === SELECT_NOW_SQL) return { rows: [{ now: new Date('2026-10-25T12:00:00.000Z') }] };
      if (sql === INSERT_BUILD_CANDIDATE_SQL) return { rows: [{ id: params[0] }] };
      if (sql === INSERT_RECOMMENDATION_SWAP_SQL) {
        return { rows: [{ created_at: new Date('2026-10-25T12:00:00.000Z') }] };
      }
      return { rows: [] };
    },
  };
  await withCollaborators({}, async () => {
    await assert.rejects(
      () => commitSwapInTransaction(commitFailure, commitArgs({ db: commitFailure })),
      /commit failed/
    );
  });
  // COMMIT is the failure; the three rows were already written inside the
  // transaction, and ROLLBACK is what makes them not exist.
  assert.equal(commitFailure.statements[0], BEGIN_SQL);
  assert.equal(commitFailure.statements[commitFailure.statements.length - 2], COMMIT_SQL);
  assert.equal(commitFailure.statements[commitFailure.statements.length - 1], ROLLBACK_SQL);
});

test('a client without query() is refused before any statement', async () => {
  await assert.rejects(
    () => commitSwapInTransaction({}, commitArgs()),
    (error) => error instanceof CandidateSelectionError
      && error.code === ERROR_CODES.INVALID_INPUT
      && error.field === 'client'
  );
});

// ---------------------------------------------------------------------------
// 6. The idempotency read, and the arguments a caller must supply.
// ---------------------------------------------------------------------------

test('readCommittedSwap answers found/absent from ONE statement', async () => {
  const db = fakeDb({
    committedSwaps: [{
      id: U(950),
      build_candidate_id: U(951),
      component_role: 'CPU',
      created_at: new Date('2026-10-25T10:00:00.000Z'),
    }],
  });
  const found = await readCommittedSwap(db, RESULT_ID);
  assert.equal(found.found, true);
  assert.equal(found.swap.component_role, 'CPU');
  assert.deepEqual(db.calls[0].params, [RESULT_ID]);

  const empty = await readCommittedSwap(fakeDb(), RESULT_ID);
  assert.deepEqual(empty, { found: false });
});

test('a commit without the result id or the persisted total is refused', async () => {
  await withCollaborators({}, async () => {
    await assert.rejects(
      () => commitSwap(commitArgs({ sourceResultId: undefined })),
      (error) => error instanceof CandidateSelectionError && error.field === 'sourceResultId'
    );
    await assert.rejects(
      () => commitSwap(commitArgs({ persistedTotalPrice: null })),
      (error) => error instanceof CandidateSelectionError && error.field === 'persistedTotalPrice'
    );
  });
});

// ---------------------------------------------------------------------------
// 7. With the REAL Engine 3 export: the persisted status is the engine's.
// ---------------------------------------------------------------------------

test('the engine receives the WHOLE picked map, frozen, with the candidate in place', async () => {
  // The pair table itself is pinned by assembly/assemble.test.js; what this
  // asserts is the handoff: every role of the derived build, and the CANDIDATE
  // (not the replaced product) in the swapped slot.
  await withCollaborators({}, async (spies) => {
    const db = fakeDb();
    await commitSwap(commitArgs({ db }));
    const picked = spies.evaluateBuild.calls[0].args[0].picked;
    assert.deepEqual(Object.keys(picked).sort(), [
      'CASE',
      'CPU',
      'CPU_COOLER',
      'GPU',
      'MOTHERBOARD',
      'PSU',
      'RAM',
      'SSD_BOOT',
    ]);
    assert.equal(picked.CPU.product_id, ALT_CPU_ID, 'the CANDIDATE is in the map');
    assert.ok(Object.isFrozen(picked), 'the map handed to the engine is frozen');
    assert.equal(spies.evaluateBuild.calls[0].args[0].filteringContext, spies.context);
  });
});
