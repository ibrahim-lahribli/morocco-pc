'use strict';

/**
 * apps/api/test/unit/swap-preview.test.js - the Decision 55 preview ROUTE.
 *
 * DB-free: `fastify.inject` against the shared stubs. What is pinned here is the
 * HTTP contract - status codes, the arithmetic a client must not re-derive, the
 * null discipline, the cache header, and the fact that the engine is handed
 * IDENTITIES rather than persisted verdicts. The engine's own judgement is
 * pinned by `src/recommendation/orchestrator/swap-preview.test.js` and by
 * `apps/api/test/db/`.
 *
 * The fixture arithmetic is the plan's worked example: swapping a 1999 CPU for
 * a 3200 candidate is a +1201 delta on a 12000 build, so 13201 and
 * `within_budget: true`. A regression shows up as a number.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Value } = require('@sinclair/typebox/value');

const contracts = require('../../src/contracts');
const stub = require('../helpers/stub');

const QUERY_ID = stub.QUERY_ROW.id;
// Real UUIDs, because the route refuses anything else with a 422 before it
// reads anything (the stub's `p-cpu` identities are fixture labels, not wire ids).
const CPU_PRODUCT = '11111111-1111-4111-8111-000000000001';
const GPU_PRODUCT = '11111111-1111-4111-8111-000000000004';
const GPU_VARIANT = '22222222-2222-4222-8222-000000000004';

/** TypeBox validation errors as readable strings (empty means valid). */
function contractErrors(schema, value) {
  return [...Value.Errors(schema, value)].map((error) => (error.path || '/') + ' ' + error.message);
}

function previewUrl(options) {
  const opts = options || {};
  const params = new URLSearchParams();
  params.set('role', opts.role === undefined ? 'CPU' : opts.role);
  params.set('product_id', opts.productId === undefined ? CPU_PRODUCT : opts.productId);
  if (opts.variant !== undefined) {
    params.set('product_variant_id', opts.variant);
  }
  return '/v1/recommendations/'
    + (opts.id === undefined ? QUERY_ID : opts.id)
    + '/builds/'
    + (opts.rank === undefined ? '1' : opts.rank)
    + '/swap-preview?'
    + params.toString();
}

/** A repository stub whose ONLY job is to answer the swap read. */
function withBuild(build) {
  return stub.createRepositoryStub({
    async readBuildForSwap(_db, queryId, rank) {
      return { found: true, build: Object.assign({}, stub.SWAP_BUILD, { rank }, build || {}) };
    },
  });
}

/** An engine stub whose preview answer is the argument. */
function withPreview(preview) {
  const engine = stub.createEngineStub();
  engine.evaluateSwapPreviewSnapshot = async function evaluate(client, args) {
    this.swapCalls.push({ client, args });
    return preview;
  };
  return engine;
}

/** One pair in the engine's own shape. */
function pair(overrides) {
  return Object.assign({
    check: 'cpu_motherboard',
    role: 'MOTHERBOARD',
    partner_role: 'CPU',
    status: 'PASS',
    reason: null,
    evidence: [],
  }, overrides || {});
}

function preview(overrides) {
  return Object.assign({
    evaluable: true,
    blocked_role: null,
    compatibility: { status: 'PASS', pairs: [pair()], unknown_pairwise_count: 0 },
    price: { next: 3200, offer_class: 'SEED_UNVERIFIED' },
  }, overrides || {});
}

// ---------------------------------------------------------------------------
// 1. The happy path: a 200 with the plan's arithmetic.
// ---------------------------------------------------------------------------

test('a compatible swap answers 200 with exact arithmetic and a no-store cache header', async () => {
  const app = stub.createTestApp({ repository: withBuild() });
  const response = await app.inject({ method: 'GET', url: previewUrl() });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store', 'a preview outlives neither the catalog nor the pass');

  const body = response.json();
  assert.deepEqual(contractErrors(contracts.SwapPreviewResponseSchema, body), []);

  // 1999 -> 3200 on a 12000 build: delta 1201, total 13201, still within 20000.
  assert.deepEqual(body.price, {
    previous: 1999,
    next: 3200,
    delta: 1201,
    offer_class: 'SEED_UNVERIFIED',
    price_status: 'indicative',
  });
  assert.deepEqual(body.budget, {
    budget_amount: 20000,
    total: 13201,
    delta: 1201,
    within_budget: true,
  });
  assert.equal(body.compatibility.status, 'PASS');
  assert.equal(body.compatibility.unknown_pairwise_count, 0);
  assert.deepEqual(body.compatibility.pairs, [pair()]);

  // The LIVE digest and the ANSWERING deploy - never the pass's recorded
  // catalog, which would be a false statement about what this verdict saw.
  assert.equal(body.catalog_version, stub.TEST_CATALOG_VERSION);
  assert.equal(body.engine_version, stub.TEST_ENGINE_VERSION);
});

test('a verified candidate reports a verified price; a seed one never does', async () => {
  const verified = stub.createTestApp({
    repository: withBuild(),
    engine: withPreview(preview({ price: { next: 3200, offer_class: 'VERIFIED' } })),
  });
  const ok = (await verified.inject({ method: 'GET', url: previewUrl() })).json();
  assert.equal(ok.price.price_status, 'verified');

  const seed = (await stub.createTestApp({ repository: withBuild() })
    .inject({ method: 'GET', url: previewUrl() })).json();
  assert.equal(seed.price.price_status, 'indicative', 'a seed price is never advertised as verified');
});

test('the price is served at the currency\'s precision, not at float precision', async () => {
  // 1999.10 -> 1999.30 is 0.1999999999998181 in IEEE arithmetic. The database
  // stores two decimals, so the wire claims two.
  const app = stub.createTestApp({
    repository: withBuild({
      total_price: '1999.10',
      components: [{
        role: 'CPU', product_id: CPU_PRODUCT, product_variant_id: null,
        selected_price: '1999.10', offer_class: 'SEED_UNVERIFIED',
      }],
    }),
    engine: withPreview(preview({ price: { next: 1999.3, offer_class: 'SEED_UNVERIFIED' } })),
  });
  const body = (await app.inject({ method: 'GET', url: previewUrl() })).json();
  assert.equal(body.price.delta, 0.2);
  assert.equal(body.budget.total, 1999.3);
});

// ---------------------------------------------------------------------------
// 2. FAIL and UNKNOWN are 200 RESULTS, not errors.
// ---------------------------------------------------------------------------

test('a FAIL verdict is a 200 result, carrying the pair and its reason code', async () => {
  const app = stub.createTestApp({
    repository: withBuild(),
    engine: withPreview(preview({
      compatibility: {
        status: 'FAIL',
        pairs: [
          pair({ status: 'PASS' }),
          pair({ check: 'platform_memory', role: 'RAM', partner_role: 'CPU', status: 'FAIL', reason: 'MEMORY_TYPE_MISMATCH' }),
        ],
        unknown_pairwise_count: 0,
      },
    })),
  });

  const response = await app.inject({ method: 'GET', url: previewUrl() });
  assert.equal(response.statusCode, 200, 'the caller asked what would happen; "it would not fit" is an answer');
  const body = response.json();
  assert.deepEqual(contractErrors(contracts.SwapPreviewResponseSchema, body), []);
  assert.equal(body.compatibility.status, 'FAIL');
  assert.equal(body.compatibility.pairs[1].reason, 'MEMORY_TYPE_MISMATCH');
  // A FAIL is about compatibility, not about price: the number is still real.
  assert.equal(body.price.next, 3200);
  assert.equal(body.budget.within_budget, true);
});

test('an UNKNOWN verdict is reported with its count and an intact price - never collapsed', async () => {
  const app = stub.createTestApp({
    repository: withBuild(),
    engine: withPreview(preview({
      compatibility: {
        status: 'UNKNOWN',
        pairs: [pair({ check: 'cooler_tdp', role: 'CPU_COOLER', partner_role: 'CPU', status: 'UNKNOWN', reason: 'NO_EVIDENCE' })],
        unknown_pairwise_count: 1,
      },
    })),
  });

  const body = (await app.inject({ method: 'GET', url: previewUrl() })).json();
  assert.equal(body.compatibility.status, 'UNKNOWN');
  assert.equal(body.compatibility.unknown_pairwise_count, 1);
  assert.equal(body.compatibility.pairs[0].status, 'UNKNOWN');
  assert.equal(body.price.next, 3200, 'UNKNOWN is about compatibility, not about the price');
});

// ---------------------------------------------------------------------------
// 3. Null discipline: unknown operands are null, never 0.
// ---------------------------------------------------------------------------

test('an ineligible candidate is a FAIL with an eligibility pair and a null price', async () => {
  const app = stub.createTestApp({
    repository: withBuild(),
    engine: withPreview(preview({
      compatibility: {
        status: 'FAIL',
        pairs: [pair({
          check: 'eligibility',
          role: 'CPU',
          partner_role: null,
          status: 'FAIL',
          reason: 'NO_ELIGIBLE_OFFER',
          evidence: [],
        })],
        unknown_pairwise_count: 0,
      },
      price: { next: null, offer_class: null },
    })),
  });

  const response = await app.inject({ method: 'GET', url: previewUrl() });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(contractErrors(contracts.SwapPreviewResponseSchema, body), []);

  assert.equal(body.compatibility.status, 'FAIL');
  assert.equal(body.compatibility.pairs[0].check, 'eligibility');
  assert.equal(body.compatibility.pairs[0].partner_role, null, 'an eligibility pair has no partner');
  assert.equal(body.compatibility.pairs[0].reason, 'NO_ELIGIBLE_OFFER');

  // Nothing is priced, so nothing is claimed about the money.
  assert.deepEqual(body.price, {
    previous: 1999,
    next: null,
    delta: null,
    offer_class: null,
    price_status: null,
  });
  assert.deepEqual(body.budget, {
    budget_amount: 20000,
    total: null,
    delta: null,
    within_budget: null,
  });
});

test('swapping INTO an omitted role (the GPU-less build) leaves the money null', async () => {
  const app = stub.createTestApp({
    repository: withBuild({
      components: [{
        role: 'CPU', product_id: CPU_PRODUCT, product_variant_id: null,
        selected_price: '1999.00', offer_class: 'SEED_UNVERIFIED',
      }],
    }),
  });
  const body = (await app.inject({
    method: 'GET',
    url: previewUrl({ role: 'GPU', productId: GPU_PRODUCT, variant: GPU_VARIANT }),
  })).json();

  assert.deepEqual(contractErrors(contracts.SwapPreviewResponseSchema, body), []);
  assert.equal(body.price.previous, null, 'the build had no GPU, so there is no previous price');
  assert.equal(body.price.next, 3200, 'the candidate itself IS priced');
  assert.equal(body.price.delta, null);
  assert.equal(body.price.price_status, 'indicative', 'one known price is still describable');
  assert.equal(body.budget.total, null);
  assert.equal(body.budget.delta, null);
  assert.equal(body.budget.within_budget, null, 'an unknown total is never "within budget"');
});

test('a build whose total was not recorded reports an unknown budget, not a zero', async () => {
  const app = stub.createTestApp({ repository: withBuild({ total_price: null }) });
  const body = (await app.inject({ method: 'GET', url: previewUrl() })).json();
  assert.deepEqual(contractErrors(contracts.SwapPreviewResponseSchema, body), []);
  assert.equal(body.price.delta, 1201, 'the two prices are known, so their difference is');
  assert.equal(body.budget.total, null);
  assert.equal(body.budget.delta, null);
  assert.equal(body.budget.within_budget, null);
});

// ---------------------------------------------------------------------------
// 4. A build that no longer reconstructs is a distinct 404.
// ---------------------------------------------------------------------------

test('a build that cannot be rebuilt answers 404 BUILD_NOT_EVALUABLE, naming the role', async () => {
  const app = stub.createTestApp({
    repository: withBuild(),
    engine: withPreview({ evaluable: false, blocked_role: 'RAM', compatibility: null, price: null }),
  });
  const response = await app.inject({ method: 'GET', url: previewUrl() });

  assert.equal(response.statusCode, 404);
  const body = response.json();
  assert.equal(body.error, 'BUILD_NOT_EVALUABLE');
  assert.match(body.message, /RAM/, 'the message names the role that could not be reconstructed');
});

test('a live catalog with no eligible offer is a 404 too, never a 500', async () => {
  const engine = stub.createEngineStub();
  engine.evaluateSwapPreviewSnapshot = async () => {
    const error = new Error('no candidate has an eligible offer');
    error.code = 'EMPTY_CANDIDATE_POOL';
    throw error;
  };
  const app = stub.createTestApp({ repository: withBuild(), engine });
  const response = await app.inject({ method: 'GET', url: previewUrl() });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'BUILD_NOT_EVALUABLE');
});

// ---------------------------------------------------------------------------
// 5. 404 / 422 matrix.
// ---------------------------------------------------------------------------

test('an unknown recommendation, an unknown rank and a non-uuid id are all 404', async () => {
  const app = stub.createTestApp(); // the stub's swap read MISSES by default

  const unknownQuery = await app.inject({ method: 'GET', url: previewUrl() });
  assert.equal(unknownQuery.statusCode, 404);
  assert.equal(unknownQuery.json().error, 'NOT_FOUND');

  const malformed = await app.inject({ method: 'GET', url: previewUrl({ id: 'not-a-uuid' }) });
  assert.equal(malformed.statusCode, 404, 'an id that cannot be a uuid cannot match a row');
  assert.equal(malformed.json().error, 'NOT_FOUND');
});

test('a missing rank segment does not match the route at all', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/' + QUERY_ID + '/builds/swap-preview?role=CPU&product_id=' + CPU_PRODUCT,
  });
  assert.equal(response.statusCode, 404, 'no rank segment, no route');
});

test('an EMPTY rank segment is a schema violation, not a silent rank', async () => {
  const app = stub.createTestApp({ repository: withBuild() });
  const response = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/' + QUERY_ID + '/builds//swap-preview?role=CPU&product_id=' + CPU_PRODUCT,
  });
  assert.equal(response.statusCode, 422, 'the segment is there but names no rank');
});

test('a malformed rank is 422, and no read is attempted', async () => {
  const repository = withBuild();
  const app = stub.createTestApp({ repository });

  for (const rank of ['0', '1.5', '-1', 'abc', '01x']) {
    const response = await app.inject({ method: 'GET', url: previewUrl({ rank }) });
    assert.equal(response.statusCode, 422, 'rank=' + rank + ' must be refused');
    assert.deepEqual(
      response.json().details.map((detail) => detail.field),
      ['rank']
    );
  }
  assert.equal(repository.state.swapReadCalls.length, 0, 'nothing is read for a malformed rank');
});

test('a role outside EXPANSION_ORDER is 422, and the message lists the eight', async () => {
  const app = stub.createTestApp({ repository: withBuild() });
  const response = await app.inject({ method: 'GET', url: previewUrl({ role: 'MEMORY' }) });

  assert.equal(response.statusCode, 422);
  const body = response.json();
  assert.equal(body.details[0].field, 'role');
  assert.match(
    body.details[0].message,
    /CPU, MOTHERBOARD, RAM, GPU, PSU, CASE, CPU_COOLER, SSD_BOOT/,
    'the accepted vocabulary is the engine\'s own order'
  );
});

test('a non-uuid product id is 422', async () => {
  const app = stub.createTestApp({ repository: withBuild() });
  const response = await app.inject({ method: 'GET', url: previewUrl({ productId: 'p-cpu' }) });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().details[0].field, 'product_id');
});

test('a variant is REQUIRED for GPU and REFUSED for every other role', async () => {
  const app = stub.createTestApp({ repository: withBuild() });

  const missing = await app.inject({
    method: 'GET',
    url: previewUrl({ role: 'GPU', productId: GPU_PRODUCT }),
  });
  assert.equal(missing.statusCode, 422);
  assert.equal(missing.json().details[0].field, 'product_variant_id');

  const refused = await app.inject({ method: 'GET', url: previewUrl({ role: 'CPU', variant: GPU_VARIANT }) });
  assert.equal(refused.statusCode, 422);
  assert.equal(refused.json().details[0].field, 'product_variant_id');

  const accepted = await app.inject({
    method: 'GET',
    url: previewUrl({ role: 'GPU', productId: GPU_PRODUCT, variant: GPU_VARIANT }),
  });
  assert.equal(accepted.statusCode, 200, 'the correct pair is accepted');
});

test('an unknown query parameter is rejected rather than ignored', async () => {
  const app = stub.createTestApp({ repository: withBuild() });
  const response = await app.inject({
    method: 'GET',
    url: previewUrl() + '&quantity=2',
  });
  assert.equal(response.statusCode, 422, 'a silently ignored field would look like it was honoured');
});

test('no 422 or 404 path reaches the engine', async () => {
  const engine = stub.createEngineStub();
  const app = stub.createTestApp({ repository: withBuild(), engine });

  await app.inject({ method: 'GET', url: previewUrl({ rank: '0' }) });
  await app.inject({ method: 'GET', url: previewUrl({ role: 'MEMORY' }) });
  await app.inject({ method: 'GET', url: previewUrl({ productId: 'nope' }) });
  assert.equal(engine.swapCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 6. What the engine is handed.
// ---------------------------------------------------------------------------

test('the engine receives IDENTITIES, the requested role, and the API\'s fixed options', async () => {
  const engine = withPreview(preview());
  const app = stub.createTestApp({ repository: withBuild(), engine });
  await app.inject({
    method: 'GET',
    url: previewUrl({ role: 'GPU', productId: GPU_PRODUCT, variant: GPU_VARIANT }),
  });

  assert.equal(engine.swapCalls.length, 1);
  const { args } = engine.swapCalls[0];
  assert.equal(args.queryId, QUERY_ID);
  assert.equal(args.role, 'GPU');
  assert.equal(args.productId, GPU_PRODUCT);
  assert.equal(args.productVariantId, GPU_VARIANT);

  // The persisted build travels exactly as the repository read it. The preview
  // consumes only the IDENTITY (role/product/variant) and re-derives every
  // verdict; the carrier columns travel because the SAME read feeds the COMMIT
  // (Decision 56), which copies them into the derived build's rows.
  assert.deepEqual(args.buildComponents, stub.SWAP_BUILD.components);
  assert.deepEqual(
    Object.keys(args.buildComponents[0]).sort(),
    [
      'currency',
      'offer_class',
      'price_checked_at',
      'product_id',
      'product_variant_id',
      'role',
      'selected_price',
      'store_id',
      'store_offer_id',
    ]
  );

  // The Decision 35 seed waiver is the API's fixed engine option, so a preview
  // prices a seed offer exactly as the pass it previews would.
  assert.deepEqual(args.options, { allow_unverified_seed_offers: true });
});

test('the route uses a dedicated connection and always releases it', async () => {
  const pool = stub.createPoolStub();
  const app = stub.createTestApp({ pool, repository: withBuild(), engine: withPreview(preview()) });
  await app.inject({ method: 'GET', url: previewUrl() });
  assert.equal(pool.client.released, true);
});

// ---------------------------------------------------------------------------
// 7. Contract + OpenAPI surface.
// ---------------------------------------------------------------------------

test('a PASS payload is valid against the published schema, and so is every null branch', async () => {
  const app = stub.createTestApp({ repository: withBuild() });
  const body = (await app.inject({ method: 'GET', url: previewUrl() })).json();
  assert.deepEqual(contractErrors(contracts.SwapPreviewResponseSchema, body), []);

  // The closed status vocabulary is enforced by the schema itself.
  const bad = Object.assign({}, body, {
    compatibility: Object.assign({}, body.compatibility, { status: 'MAYBE' }),
  });
  assert.notDeepEqual(contractErrors(contracts.SwapPreviewResponseSchema, bad), []);
});

test('the preview path is in the served document, with its five responses', async () => {
  const app = stub.createTestApp();
  const document = (await app.inject({ method: 'GET', url: '/v1/docs/json' })).json();

  const previewOperation = document.paths['/v1/recommendations/{id}/builds/{rank}/swap-preview'];
  assert.ok(previewOperation && previewOperation.get, 'the preview path is documented');
  assert.deepEqual(Object.keys(previewOperation.get.responses).sort(), ['200', '404', '422', '429', '500']);
  assert.deepEqual(
    previewOperation.get.parameters.map((parameter) => parameter.name).sort(),
    ['id', 'product_id', 'product_variant_id', 'rank', 'role']
  );
});
