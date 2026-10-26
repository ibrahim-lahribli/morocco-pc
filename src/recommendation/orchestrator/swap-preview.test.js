'use strict';

// ---------------------------------------------------------------------------
// Decision 55 item 4 (src/recommendation/orchestrator/swap-preview.js):
// focused tests for the read-only swap PREVIEW composition.
//
// This file proves the WIRING, not the pair logic: that the preview takes the
// same 2B -> 2C -> Stage 1 -> 2D path a pass takes (once each, in order), that
// `picked` is rebuilt from the LIVE verdicts rather than from the persisted
// rows, that an ineligible candidate is REFUSED before any pair is evaluated,
// that the substituted price comes from Stage 1's own carrier, and that the
// snapshot wrapper always ends its transaction with ROLLBACK.
//
// The compatibility table itself is Engine 3's, and is pinned by
// assembly/assemble.test.js - a preview must not re-test it. Where the
// composition's answer has to be the ENGINE's, the real export runs (see the
// last test), so this file cannot agree with a stub while the served answer
// disagrees with the engine.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateSwapPreview,
  evaluateSwapPreviewSnapshot,
  BEGIN_SQL,
  ROLLBACK_SQL,
  ELIGIBILITY_CHECK,
  NO_ELIGIBLE_OFFER,
  PRODUCT_NOT_CANDIDATE,
} = require('./swap-preview');
const queryModule = require('../query');
const candidatesModule = require('../candidates');
const offersModule = require('../offers');
const filteringModule = require('../filtering');
const assemblyModule = require('../assembly');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const V = (n) => '00000000-0000-4000-9000-' + String(n).padStart(12, '0');

const QUERY_ID = U(901);
const MODEL_ID = U(902);
const STORE_ID = U(903);

const CPU_ID = U(1);
const MB_ID = U(2);
const RAM_ID = U(3);
const GPU_ID = U(4);
const GPU_VARIANT_ID = V(1);
const PSU_ID = U(5);
const CASE_ID = U(6);
const COOLER_ID = U(7);
const SSD_ID = U(8);

/** The alternative components a preview substitutes. */
const ALT_CPU_ID = U(11);
const ALT_GPU_ID = U(14);
const ALT_GPU_VARIANT_ID = V(11);
const ALT_RAM_ID = U(13);
const ORPHAN_RAM_ID = U(23); // a 2C candidate Stage 1 drops (no eligible offer)

const QUERY_INPUT = Object.freeze({
  query_id: QUERY_ID,
  scoring_model_id: MODEL_ID,
  input: Object.freeze({ budget_amount: 20000, currency: 'MAD', use_case: 'GAMING' }),
  priority: null,
  resolution: null,
});

/**
 * One Engine 2D verdict with the eight fields Engine 3's own gate requires. The
 * extras (`partner_product_id`, `compatibility_notes`) are the fields the real
 * filter emits and Engine 3 ignores, so the fixtures stay wire-faithful.
 */
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
    partner_product_id: null,
    partner_product_variant_id: null,
    compatibility_notes: Object.freeze([]),
  });
}

/** The persisted build: identity only, exactly what `build_component` holds. */
function persistedBuild(overrides) {
  const components = {
    CPU: CPU_ID,
    MOTHERBOARD: MB_ID,
    RAM: RAM_ID,
    GPU: GPU_ID,
    PSU: PSU_ID,
    CASE: CASE_ID,
    CPU_COOLER: COOLER_ID,
    SSD_BOOT: SSD_ID,
  };
  return Object.keys(components)
    .filter((role) => !(overrides || []).includes(role))
    .map((role) => Object.freeze({
      role,
      product_id: components[role],
      product_variant_id: role === 'GPU' ? GPU_VARIANT_ID : null,
      selected_price: 1000,
      offer_class: 'SEED_UNVERIFIED',
    }));
}

/** The live Engine 2C pool (pre-price). */
function candidatePool(extra) {
  const rows = [
    { component_role: 'CPU', product_id: CPU_ID, product_variant_id: null, category: 'CPU' },
    { component_role: 'CPU', product_id: ALT_CPU_ID, product_variant_id: null, category: 'CPU' },
    { component_role: 'MOTHERBOARD', product_id: MB_ID, product_variant_id: null, category: 'MOTHERBOARD' },
    { component_role: 'RAM', product_id: RAM_ID, product_variant_id: null, category: 'MEMORY' },
    { component_role: 'RAM', product_id: ALT_RAM_ID, product_variant_id: null, category: 'MEMORY' },
    { component_role: 'RAM', product_id: ORPHAN_RAM_ID, product_variant_id: null, category: 'MEMORY' },
    { component_role: 'GPU', product_id: GPU_ID, product_variant_id: GPU_VARIANT_ID, category: 'GPU' },
    { component_role: 'GPU', product_id: ALT_GPU_ID, product_variant_id: ALT_GPU_VARIANT_ID, category: 'GPU' },
    { component_role: 'PSU', product_id: PSU_ID, product_variant_id: null, category: 'PSU' },
    { component_role: 'CASE', product_id: CASE_ID, product_variant_id: null, category: 'CASE' },
    { component_role: 'CPU_COOLER', product_id: COOLER_ID, product_variant_id: null, category: 'COOLER' },
    { component_role: 'SSD_BOOT', product_id: SSD_ID, product_variant_id: null, category: 'STORAGE' },
  ];
  return rows.concat(extra || []);
}

/** The reason code a rejection carries; a REJECT verdict is never reason-less. */
const REJECT_REASONS = Object.freeze({ CPU: 'CPU_SOCKET_MISMATCH', GPU: 'GPU_CASE_LENGTH' });

/** The live Engine 2D verdicts, over the Stage 1 pool. */
function liveVerdicts(overrides) {
  const replaced = overrides || {};
  const cpuStatus = replaced.CPU || 'PASS';
  const gpuStatus = replaced.GPU || 'PASS';
  const rows = [
    verdict('CPU', CPU_ID, null, cpuStatus, cpuStatus === 'REJECT' ? REJECT_REASONS.CPU : null),
    verdict('CPU', ALT_CPU_ID, null, 'PASS'),
    verdict('MOTHERBOARD', MB_ID, null, 'PASS'),
    verdict('RAM', RAM_ID, null, 'PASS'),
    verdict('RAM', ALT_RAM_ID, null, 'PASS'),
    verdict('GPU', GPU_ID, GPU_VARIANT_ID, 'PASS'),
    verdict(
      'GPU',
      ALT_GPU_ID,
      ALT_GPU_VARIANT_ID,
      gpuStatus,
      gpuStatus === 'REJECT' ? REJECT_REASONS.GPU : null
    ),
    verdict('PSU', PSU_ID, null, 'PASS'),
    verdict('CASE', CASE_ID, null, 'PASS'),
    verdict('CPU_COOLER', COOLER_ID, null, 'PASS'),
    verdict('SSD_BOOT', SSD_ID, null, 'PASS'),
  ];
  return rows;
}

/** A validated size-6 price carrier (the real Engine 3 Step 2 contract). */
function carrier(prices) {
  const raw = Object.create(null);
  for (const entry of prices) {
    raw[assemblyModule.priceKey(entry.product_id, entry.product_variant_id, entry.component_role)] = {
      selected_price: entry.selected_price,
      currency: 'MAD',
      store_id: STORE_ID,
      price_checked_at: '2030-01-01T00:00:00.000Z',
      offer_id: U(500 + (entry.offer || 1)),
      offer_class: entry.offer_class === undefined ? 'SEED_UNVERIFIED' : entry.offer_class,
    };
  }
  return assemblyModule.validatePrices(raw);
}

const DEFAULT_PRICES = [
  { component_role: 'CPU', product_id: CPU_ID, product_variant_id: null, selected_price: 1999 },
  { component_role: 'CPU', product_id: ALT_CPU_ID, product_variant_id: null, selected_price: 2400 },
  { component_role: 'MOTHERBOARD', product_id: MB_ID, product_variant_id: null, selected_price: 1200 },
  { component_role: 'RAM', product_id: RAM_ID, product_variant_id: null, selected_price: 700 },
  { component_role: 'RAM', product_id: ALT_RAM_ID, product_variant_id: null, selected_price: 990 },
  { component_role: 'GPU', product_id: GPU_ID, product_variant_id: GPU_VARIANT_ID, selected_price: 3200 },
  { component_role: 'GPU', product_id: ALT_GPU_ID, product_variant_id: ALT_GPU_VARIANT_ID, selected_price: 4500, offer_class: 'VERIFIED' },
  { component_role: 'PSU', product_id: PSU_ID, product_variant_id: null, selected_price: 650 },
  { component_role: 'CASE', product_id: CASE_ID, product_variant_id: null, selected_price: 900 },
  { component_role: 'CPU_COOLER', product_id: COOLER_ID, product_variant_id: null, selected_price: 350 },
  { component_role: 'SSD_BOOT', product_id: SSD_ID, product_variant_id: null, selected_price: 800 },
];

// ---------------------------------------------------------------------------
// The spy seam (the one ./run.js documents: namespace call, plain patch)
// ---------------------------------------------------------------------------

function spyOn(namespace, name, impl) {
  const original = namespace[name];
  const calls = [];
  namespace[name] = function spy(...args) {
    const record = { args, result: null };
    calls.push(record);
    record.result = impl ? impl(args, calls, original) : original.apply(namespace, args);
    return record.result;
  };
  return {
    calls,
    restore() {
      namespace[name] = original;
    },
  };
}

/**
 * The default collaborator wiring: every loader and pure stage patched to a
 * deterministic fixture, plus `order` recording the sequence they ran in.
 *
 * The loaders are patched rather than backed by a fake database because this
 * file tests the COMPOSITION; the SQL those loaders issue is pinned by their own
 * suites (and by `apps/api/test/db/`).
 */
function install(options) {
  const opts = options || {};
  const order = [];
  const context = Object.freeze({ candidates: Object.freeze({}) });
  const spies = {
    order,
    context,
    query: spyOn(queryModule, 'loadQueryInput', () => {
      order.push('loadQueryInput');
      return opts.queryInput || QUERY_INPUT;
    }),
    loadCandidates: spyOn(candidatesModule, 'loadCandidates', () => {
      order.push('loadCandidates');
      return { input: QUERY_INPUT.input, candidates: candidatePool() };
    }),
    selectCandidatePool: spyOn(candidatesModule, 'selectCandidatePool', (args) => {
      order.push('selectCandidatePool');
      return { input: args[0], pool: opts.pool || candidatePool() };
    }),
    selectOfferPrices: spyOn(offersModule, 'selectOfferPrices', () => {
      order.push('selectOfferPrices');
      return {
        input: QUERY_INPUT.input,
        pool: opts.pricedPool || candidatePool().filter((candidate) => candidate.product_id !== ORPHAN_RAM_ID),
        prices: opts.prices || carrier(DEFAULT_PRICES),
      };
    }),
    loadFilteringContext: spyOn(filteringModule, 'loadFilteringContext', () => {
      order.push('loadFilteringContext');
      return context;
    }),
    filterCandidates: spyOn(filteringModule, 'filterCandidates', () => {
      order.push('filterCandidates');
      return { results: opts.verdicts || liveVerdicts() };
    }),
    evaluateBuildReplacement: spyOn(assemblyModule, 'evaluateBuildReplacement', (args) => {
      order.push('evaluateBuildReplacement');
      if (opts.replacement !== undefined) {
        return opts.replacement;
      }
      return {
        status: 'PASS',
        pairs: Object.freeze([]),
        unknown_pairwise_count: 0,
      };
    }),
    lookupPrice: spyOn(assemblyModule, 'lookupPrice', (args) => {
      order.push('lookupPrice');
      return args[0][assemblyModule.priceKey(args[1].product_id, args[1].product_variant_id, args[1].component_role)];
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

/** The argument object a route hands the composition. */
function previewArgs(overrides, buildOverrides) {
  return Object.assign({
    db: { async query() { return { rows: [] }; } },
    queryId: QUERY_ID,
    role: 'CPU',
    productId: ALT_CPU_ID,
    buildComponents: persistedBuild(buildOverrides),
  }, overrides || {});
}

// ---------------------------------------------------------------------------
// 1. The composition is the pass's read path, once each, in order.
// ---------------------------------------------------------------------------

test('the preview takes the same 2B -> 2C -> Stage 1 -> 2D path a pass takes, once each', async () => {
  await withCollaborators({}, async (spies) => {
    await evaluateSwapPreview(previewArgs());

    assert.deepEqual(spies.order, [
      'loadQueryInput',
      'loadCandidates',
      'selectCandidatePool',
      'selectOfferPrices',
      'loadFilteringContext',
      'filterCandidates',
      'evaluateBuildReplacement',
      'lookupPrice',
    ]);
    assert.equal(spies.filterCandidates.calls.length, 1, 'ONE filter pass, never a per-role second one');
    assert.equal(spies.loadFilteringContext.calls.length, 1);
    // The ONE context object travels to the engine by reference - the same
    // object identity the pass relies on (run.js).
    assert.equal(spies.evaluateBuildReplacement.calls[0].args[0].filteringContext, spies.context);
  });
});

test('the candidate pool handed to Stage 1 is Engine 2C\'s own output, never a narrowed one', async () => {
  await withCollaborators({}, async (spies) => {
    await evaluateSwapPreview(previewArgs());
    const offered = spies.selectOfferPrices.calls[0].args[0];
    assert.equal(offered.pool, spies.selectCandidatePool.calls[0].result.pool);
    assert.equal(offered.input, QUERY_INPUT.input);
  });
});

// ---------------------------------------------------------------------------
// 2. `picked` is rebuilt from the live VERDICTS, never from the rows.
// ---------------------------------------------------------------------------

test('picked carries the live verdicts for the kept roles and excludes the replaced one', async () => {
  await withCollaborators({}, async (spies) => {
    const result = await evaluateSwapPreview(previewArgs({ role: 'RAM', productId: ALT_RAM_ID }));

    assert.equal(result.evaluable, true);
    const call = spies.evaluateBuildReplacement.calls[0].args[0];
    assert.deepEqual(Object.keys(call.picked).sort(), [
      'CASE', 'CPU', 'CPU_COOLER', 'GPU', 'MOTHERBOARD', 'PSU', 'SSD_BOOT',
    ]);
    assert.equal(call.role, 'RAM');
    assert.equal(call.candidate.product_id, ALT_RAM_ID);
    assert.equal(call.candidate.status, 'PASS');

    // The entries ARE the verdict objects the filter produced - not a verdict
    // fabricated from a `build_component` row (which carries no status at all).
    const ramVerdict = spies.filterCandidates.calls[0].result.results
      .find((entry) => entry.component_role === 'CPU');
    assert.equal(call.picked.CPU, ramVerdict, 'the verdict travels by reference');
  });
});

test('a persisted pick with no live verdict blocks the preview, naming the EXPANSION_ORDER-first role', async () => {
  const verdicts = liveVerdicts().filter(
    (entry) => !(entry.component_role === 'RAM' && entry.product_id === RAM_ID)
  );
  await withCollaborators({ verdicts }, async (spies) => {
    const result = await evaluateSwapPreview(previewArgs({ role: 'CPU', productId: ALT_CPU_ID }));

    assert.deepEqual(result, {
      evaluable: false,
      blocked_role: 'RAM',
      compatibility: null,
      price: null,
    });
    assert.equal(spies.evaluateBuildReplacement.calls.length, 0, 'no pair is judged over an incomplete build');
    assert.equal(spies.lookupPrice.calls.length, 0);
  });
});

test('when two kept roles are missing, the block names the FIRST in EXPANSION_ORDER', async () => {
  // RAM precedes SSD_BOOT in EXPANSION_ORDER, so RAM wins even though SSD_BOOT
  // is the last role walked - the answer must not depend on iteration luck.
  const verdicts = liveVerdicts().filter(
    (entry) => !(
      (entry.component_role === 'RAM' && entry.product_id === RAM_ID) ||
      (entry.component_role === 'SSD_BOOT' && entry.product_id === SSD_ID)
    )
  );
  await withCollaborators({ verdicts }, async () => {
    const result = await evaluateSwapPreview(previewArgs({ role: 'CPU', productId: ALT_CPU_ID }));
    assert.equal(result.evaluable, false);
    assert.equal(result.blocked_role, 'RAM');
  });
});

test('a kept role whose live verdict is REJECT blocks the preview instead of being judged', async () => {
  await withCollaborators({ verdicts: liveVerdicts({ CPU: 'REJECT' }) }, async (spies) => {
    const result = await evaluateSwapPreview(previewArgs({ role: 'GPU', productId: ALT_GPU_ID, productVariantId: ALT_GPU_VARIANT_ID }));
    assert.equal(result.evaluable, false);
    assert.equal(result.blocked_role, 'CPU');
    assert.equal(spies.evaluateBuildReplacement.calls.length, 0);
  });
});

test('the role being replaced is never required to have a live verdict', async () => {
  // A GPU-less build has no GPU row at all; supplying one must still work.
  await withCollaborators({ verdicts: liveVerdicts() }, async (spies) => {
    const result = await evaluateSwapPreview(previewArgs(
      { role: 'GPU', productId: ALT_GPU_ID, productVariantId: ALT_GPU_VARIANT_ID },
      ['GPU']
    ));
    assert.equal(result.evaluable, true);
    const picked = spies.evaluateBuildReplacement.calls[0].args[0].picked;
    assert.equal(Object.prototype.hasOwnProperty.call(picked, 'GPU'), false, 'the supply path replaces nothing');
  });
});

// ---------------------------------------------------------------------------
// 3. An ineligible candidate is REFUSED, before any pair is evaluated.
// ---------------------------------------------------------------------------

test('a REJECT candidate short-circuits: eligibility pair, FAIL, no pair evaluation, null price', async () => {
  await withCollaborators({ verdicts: liveVerdicts({ GPU: 'REJECT' }) }, async (spies) => {
    const result = await evaluateSwapPreview(previewArgs({
      role: 'GPU',
      productId: ALT_GPU_ID,
      productVariantId: ALT_GPU_VARIANT_ID,
    }));

    assert.equal(result.evaluable, true);
    assert.equal(result.compatibility.status, 'FAIL');
    assert.equal(result.compatibility.unknown_pairwise_count, 0);
    assert.deepEqual(result.compatibility.pairs, [{
      check: ELIGIBILITY_CHECK,
      role: 'GPU',
      partner_role: null,
      status: 'FAIL',
      reason: REJECT_REASONS.GPU, // the verdict's own reason, never a synthesized one
      evidence: [],
    }]);
    assert.deepEqual(result.price, { next: null, offer_class: null });
    assert.equal(spies.evaluateBuildReplacement.calls.length, 0, 'no pair is judged for a rejected candidate');
    assert.equal(spies.lookupPrice.calls.length, 0, 'and no price is looked up for one');
  });
});

test('a candidate in the 2C pool that Stage 1 dropped answers NO_ELIGIBLE_OFFER', async () => {
  // ORPHAN_RAM_ID is in the 2C pool and in no Stage 1 pool entry: it has no
  // eligible offer, which is a different fact from "not a candidate".
  await withCollaborators({}, async (spies) => {
    const result = await evaluateSwapPreview(previewArgs({ role: 'RAM', productId: ORPHAN_RAM_ID }));
    assert.equal(result.compatibility.status, 'FAIL');
    assert.equal(result.compatibility.pairs[0].reason, NO_ELIGIBLE_OFFER);
    assert.equal(result.compatibility.pairs[0].check, ELIGIBILITY_CHECK);
    assert.equal(result.price.next, null);
    assert.equal(spies.evaluateBuildReplacement.calls.length, 0);
  });
});

test('a product that is not a candidate at all answers PRODUCT_NOT_CANDIDATE', async () => {
  await withCollaborators({}, async (spies) => {
    const result = await evaluateSwapPreview(previewArgs({ role: 'CPU', productId: U(777) }));
    assert.equal(result.compatibility.status, 'FAIL');
    assert.equal(result.compatibility.pairs[0].reason, PRODUCT_NOT_CANDIDATE);
    assert.equal(result.compatibility.pairs[0].role, 'CPU');
    assert.equal(spies.evaluateBuildReplacement.calls.length, 0);
  });
});

test('the three eligibility answers are distinguishable on the wire', async () => {
  const reasons = [];
  await withCollaborators({}, async () => {
    reasons.push((await evaluateSwapPreview(previewArgs({ role: 'CPU', productId: U(777) }))).compatibility.pairs[0].reason);
    reasons.push((await evaluateSwapPreview(previewArgs({ role: 'RAM', productId: ORPHAN_RAM_ID }))).compatibility.pairs[0].reason);
  });
  await withCollaborators({ verdicts: liveVerdicts({ GPU: 'REJECT' }) }, async () => {
    reasons.push((await evaluateSwapPreview(previewArgs({
      role: 'GPU', productId: ALT_GPU_ID, productVariantId: ALT_GPU_VARIANT_ID,
    }))).compatibility.pairs[0].reason);
  });
  assert.deepEqual(reasons, [PRODUCT_NOT_CANDIDATE, NO_ELIGIBLE_OFFER, REJECT_REASONS.GPU]);
  assert.equal(new Set(reasons).size, 3, 'three different situations, three different codes');
});

// ---------------------------------------------------------------------------
// 4. The price of the substituted candidate comes from Stage 1's carrier.
// ---------------------------------------------------------------------------

test('price.next and price.offer_class are the carrier entry lookupPrice returns', async () => {
  await withCollaborators({}, async (spies) => {
    const result = await evaluateSwapPreview(previewArgs({
      role: 'GPU',
      productId: ALT_GPU_ID,
      productVariantId: ALT_GPU_VARIANT_ID,
    }));
    assert.deepEqual(result.price, { next: 4500, offer_class: 'VERIFIED' });
    // The candidate handed to lookupPrice is the LIVE verdict, not the request.
    const candidate = spies.lookupPrice.calls[0].args[1];
    assert.equal(candidate.product_variant_id, ALT_GPU_VARIANT_ID);
    assert.equal(candidate.component_role, 'GPU');
  });
});

test('an UNKNOWN verdict is passed through as UNKNOWN - never collapsed to PASS', async () => {
  await withCollaborators({
    replacement: Object.freeze({
      status: 'UNKNOWN',
      pairs: Object.freeze([Object.freeze({
        check: 'cooler_socket',
        role: 'CPU_COOLER',
        partner_role: 'CPU',
        status: 'UNKNOWN',
        reason: 'NO_EVIDENCE',
        evidence: Object.freeze([]),
      })]),
      unknown_pairwise_count: 1,
    }),
  }, async () => {
    const result = await evaluateSwapPreview(previewArgs({ role: 'CPU', productId: ALT_CPU_ID }));
    assert.equal(result.compatibility.status, 'UNKNOWN');
    assert.equal(result.compatibility.unknown_pairwise_count, 1);
    assert.equal(result.compatibility.pairs[0].status, 'UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// 5. Result shape, freezing and the argument contract.
// ---------------------------------------------------------------------------

test('an evaluable preview is frozen, and so is everything it carries', async () => {
  await withCollaborators({}, async () => {
    const result = await evaluateSwapPreview(previewArgs());
    assert.deepEqual(Object.keys(result), ['evaluable', 'blocked_role', 'compatibility', 'price']);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.compatibility));
    assert.ok(Object.isFrozen(result.price));
  });
});

test('a role outside EXPANSION_ORDER fails fast with the shared vocabulary', async () => {
  for (const role of ['MEMORY', 'SSD_SECONDARY', 'cpu', '']) {
    await assert.rejects(
      evaluateSwapPreview(previewArgs({ role })),
      (error) => error instanceof CandidateSelectionError
        && error.code === ERROR_CODES.INVALID_FIELD_VALUE
        && error.field === 'role'
        && /CPU, MOTHERBOARD, RAM, GPU, PSU, CASE, CPU_COOLER, SSD_BOOT/.test(error.message),
      role + ' must be refused'
    );
  }
});

test('a malformed argument object is refused before any statement is issued', async () => {
  await assert.rejects(
    evaluateSwapPreview({ db: {}, queryId: QUERY_ID, role: 'CPU', productId: CPU_ID }),
    (error) => error.code === ERROR_CODES.INVALID_INPUT && error.field === 'buildComponents'
  );
  await assert.rejects(
    evaluateSwapPreview(null),
    (error) => error.code === ERROR_CODES.INVALID_INPUT
  );
  await assert.rejects(
    evaluateSwapPreview(previewArgs({ buildComponents: [{ product_id: CPU_ID }] })),
    (error) => error.code === ERROR_CODES.INVALID_FIELD_VALUE && error.field === 'buildComponents'
  );
});

// ---------------------------------------------------------------------------
// 6. The snapshot wrapper owns BEGIN/ROLLBACK, and never a COMMIT.
// ---------------------------------------------------------------------------

function recordingClient(options) {
  const opts = options || {};
  const statements = [];
  return {
    statements,
    async query(sql) {
      statements.push(sql);
      if (opts.beginError && sql === BEGIN_SQL) {
        throw opts.beginError;
      }
      if (opts.rollbackError && sql === ROLLBACK_SQL) {
        throw opts.rollbackError;
      }
      return { rows: [] };
    },
  };
}

test('the snapshot wrapper opens the 17.5 transaction and ALWAYS rolls back', async () => {
  await withCollaborators({}, async () => {
    const client = recordingClient();
    const result = await evaluateSwapPreviewSnapshot(client, previewArgs({ db: undefined }));
    assert.equal(result.evaluable, true);
    assert.deepEqual(client.statements, [BEGIN_SQL, ROLLBACK_SQL]);
    assert.equal(client.statements.includes('COMMIT'), false, 'a preview commits nothing');
  });
});

test('a failing preview still rolls back, and its own error wins', async () => {
  const sentinel = new Error('boom');
  await withCollaborators({}, async () => {
    // Overwrite the spy with a throwing collaborator: the same namespace seam,
    // so the failure lands exactly where the composition calls it.
    const working = filteringModule.filterCandidates;
    filteringModule.filterCandidates = () => { throw sentinel; };
    const client = recordingClient({ rollbackError: new Error('rollback failed') });
    try {
      await assert.rejects(
        evaluateSwapPreviewSnapshot(client, previewArgs({ db: undefined })),
        (error) => error === sentinel,
        'the preview error must win over a failing ROLLBACK'
      );
    } finally {
      filteringModule.filterCandidates = working;
    }
    assert.deepEqual(client.statements, [BEGIN_SQL, ROLLBACK_SQL]);
  });
});

test('a failing BEGIN propagates and no ROLLBACK is attempted', async () => {
  const sentinel = new Error('no transaction');
  const client = recordingClient({ beginError: sentinel });
  await assert.rejects(
    evaluateSwapPreviewSnapshot(client, previewArgs()),
    (error) => error === sentinel
  );
  assert.deepEqual(client.statements, [BEGIN_SQL], 'there was no transaction to end');
});

test('a snapshot client without query() is refused before any statement', async () => {
  await assert.rejects(
    evaluateSwapPreviewSnapshot({}, previewArgs()),
    (error) => error.code === ERROR_CODES.INVALID_INPUT && error.field === 'client'
  );
});

// ---------------------------------------------------------------------------
// 7. The answer is the ENGINE's, not this module's.
// ---------------------------------------------------------------------------

test('with the REAL Engine 3 export, an eligible swap is judged by the engine itself', async () => {
  // No assembly spy here: `evaluateBuildReplacement` and the carrier's
  // `lookupPrice` are the real ones, so the fixture verdicts must pass Engine 3's
  // own validatePicked/validateVerdict gate. Replacing SSD_BOOT keeps the
  // traversal empty (SSD_BOOT keys no PAIRWISE_CHECKS entry and is nobody's
  // partner), which is the walk's own zero-partners answer.
  const installed = install({});
  installed.spies.evaluateBuildReplacement.restore();
  installed.spies.lookupPrice.restore();
  try {
    const result = await evaluateSwapPreview(previewArgs({ role: 'SSD_BOOT', productId: SSD_ID }));
    assert.equal(result.evaluable, true);
    assert.equal(result.compatibility.status, 'PASS');
    assert.deepEqual(result.compatibility.pairs, []);
    assert.equal(result.compatibility.unknown_pairwise_count, 0);
    assert.deepEqual(result.price, { next: 800, offer_class: 'SEED_UNVERIFIED' });
  } finally {
    installed.restore();
  }
});
