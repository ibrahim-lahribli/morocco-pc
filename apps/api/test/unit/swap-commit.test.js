'use strict';

/**
 * apps/api/test/unit/swap-commit.test.js - the Decision 56 COMMIT route.
 *
 * DB-free: `fastify.inject` against the shared stubs, so what is pinned here is
 * the HTTP contract - that a commit is a 201, that every refusal has its own
 * status and its own `error` code (a reader's next action differs for each),
 * that nothing is claimed as written when the engine declined, that the engine
 * receives the SAME identities the preview receives plus the link a commit
 * needs, and that the body a 201 carries validates against
 * `SwapCommitResponseSchema`.
 *
 * The arithmetic is the preview's worked example: a 3200 candidate replacing a
 * 1999 CPU on a 12000 build is +1201, so 13201 and `within_budget: true`. The
 * preview route's own suite pins that arithmetic in detail; here it is pinned
 * again because the commit REUSES the presenter, and a presenter that started
 * re-deriving the money would break the promise that the number the reader
 * approved is the number the API reports.
 *
 * The engine's judgement is pinned by
 * `src/recommendation/orchestrator/swap-commit.test.js`; what a real commit
 * writes (and rolls back) is pinned by `apps/api/test/db/swap-commit.db.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Value } = require('@sinclair/typebox/value');

const contracts = require('../../src/contracts');
const stub = require('../helpers/stub');

const QUERY_ID = stub.QUERY_ROW.id;
const CPU_PRODUCT = '11111111-1111-4111-8111-000000000002';
const GPU_PRODUCT = '11111111-1111-4111-8111-000000000004';
const GPU_VARIANT = '22222222-2222-4222-8222-000000000004';

function contractErrors(schema, value) {
  return [...Value.Errors(schema, value)].map((error) => (error.path || '/') + ' ' + error.message);
}

function commitUrl(options) {
  const opts = options || {};
  return '/v1/recommendations/'
    + (opts.id === undefined ? QUERY_ID : opts.id)
    + '/builds/'
    + (opts.rank === undefined ? '1' : opts.rank)
    + '/swap';
}

function commitBody(overrides) {
  return Object.assign({
    role: 'CPU',
    product_id: CPU_PRODUCT,
  }, overrides || {});
}

/** A repository stub that answers the swap read with the fixture build. */
function withBuild(build) {
  return stub.createRepositoryStub({
    async readBuildForSwap(_db, queryId, rank) {
      return { found: true, build: Object.assign({}, stub.SWAP_BUILD, { rank }, build || {}) };
    },
  });
}

/** An engine stub whose COMMIT answer is the argument. */
function withCommit(commit, overrides) {
  const engine = stub.createEngineStub();
  engine.commitSwapInTransaction = async function (client, args) {
    this.commitCalls.push({ client, args });
    return commit;
  };
  return Object.assign(engine, overrides || {});
}

function refusal(reason, fields) {
  return Object.assign({
    committed: false,
    reason,
    role: null,
    blocked_role: null,
    eligibility: null,
    compatibility: null,
    price: null,
    build: null,
    swap: null,
  }, fields || {});
}

// ---------------------------------------------------------------------------
// 1. The happy path: 201, the preview's arithmetic, the persisted link.
// ---------------------------------------------------------------------------

test('a committed swap answers 201 with the preview arithmetic and a no-store header', async () => {
  const app = stub.createTestApp({ repository: withBuild() });
  const response = await app.inject({
    method: 'POST',
    url: commitUrl(),
    payload: commitBody(),
  });

  assert.equal(response.statusCode, 201, 'a commit CREATES a derived build');
  assert.equal(response.headers['cache-control'], 'no-store', 'a commit is never cacheable');

  const body = response.json();
  assert.deepEqual(contractErrors(contracts.SwapCommitResponseSchema, body), []);

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

  // `swapped` is NEVER null on a 201: a response that did not name the commit
  // it just made would be indistinguishable from a preview.
  assert.deepEqual(contractErrors(contracts.SwappedSchema, body.swapped), []);
  assert.equal(body.swapped.role, 'CPU');
  assert.equal(body.swapped.committed_at, '2026-10-25T12:00:00.000Z');
  assert.equal(body.swapped.engine_version, 'test-deploy');

  // The catalog digest is the LIVE one the verdict was judged against, and the
  // version is the deploy that answered - both answered by the API, not the
  // engine's in-memory result.
  assert.equal(body.catalog_version, stub.TEST_CATALOG_VERSION);
  assert.equal(body.engine_version, stub.TEST_ENGINE_VERSION);
});

test('the committed status is the WHOLE build verdict, served as it was persisted', async () => {
  // A UNKNOWN whole-build verdict commits (a pass persists UNKNOWN too), and the
  // wire must report the stored value rather than the role-scoped one.
  const engine = withCommit(Object.assign({}, stub.SAMPLE_SWAP_COMMIT, {
    compatibility: {
      status: 'UNKNOWN',
      pairs: [],
      unknown_pairwise_count: 1,
    },
    build: Object.assign({}, stub.SAMPLE_SWAP_COMMIT.build, { compatibility_status: 'UNKNOWN' }),
  }));
  const app = stub.createTestApp({ repository: withBuild(), engine });
  const body = (await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() })).json();
  assert.equal(body.compatibility.status, 'UNKNOWN');
  assert.equal(body.compatibility.unknown_pairwise_count, 1);
  // UNKNOWN is not a price question: the money is still real.
  assert.equal(body.price.next, 3200);
  assert.equal(body.budget.within_budget, true);
});

// ---------------------------------------------------------------------------
// 2. What the engine is handed: the preview's identities PLUS the link.
// ---------------------------------------------------------------------------

test('the engine receives the persisted components, the result id and the LIVE digest', async () => {
  const engine = withCommit(Object.assign({}, stub.SAMPLE_SWAP_COMMIT));
  const app = stub.createTestApp({ repository: withBuild(), engine });

  await app.inject({
    method: 'POST',
    url: commitUrl(),
    payload: commitBody({ role: 'GPU', product_id: GPU_PRODUCT, product_variant_id: GPU_VARIANT }),
  });

  assert.equal(engine.commitCalls.length, 1);
  const { args } = engine.commitCalls[0];
  assert.equal(args.queryId, QUERY_ID);
  assert.equal(args.role, 'GPU');
  assert.equal(args.productId, GPU_PRODUCT);
  assert.equal(args.productVariantId, GPU_VARIANT);

  // Decision 56 item 2: the derived build derives from a recommendation_result
  // ROW, so the commit is told which one. A preview has no such argument.
  assert.equal(args.sourceResultId, stub.SWAP_BUILD.result_id);

  // The persisted build travels as the repository read it - identity AND the
  // Decision 35 carrier columns the derived rows copy verbatim.
  assert.deepEqual(args.buildComponents, stub.SWAP_BUILD.components);

  // The total is a NUMBER by the time the engine sees it: NUMERIC arrives as a
  // string, and the commit's arithmetic is `persisted - previous + next`.
  assert.equal(args.persistedTotalPrice, 12000);
  assert.equal(typeof args.persistedTotalPrice, 'number');

  // The catalog version is the LIVE digest (Decision 47/55 item 7), never the
  // pass's recorded one - and it is STORED on the swap row.
  assert.equal(args.catalogVersion, stub.TEST_CATALOG_VERSION);
  assert.equal(args.engineVersion, stub.TEST_ENGINE_VERSION);
});

test('the commit runs on a dedicated connection and always releases it', async () => {
  const pool = stub.createPoolStub();
  const app = stub.createTestApp({ pool, repository: withBuild(), engine: withCommit(stub.SAMPLE_SWAP_COMMIT) });
  await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() });
  assert.equal(pool.client.released, true, 'BEGIN/COMMIT is session-scoped: the connection must go back');
});

// ---------------------------------------------------------------------------
// 3. The refusals, each with its own status and code.
// ---------------------------------------------------------------------------

test('a build that already carries a swap is 409 SWAP_ALREADY_COMMITTED, before any composition', async () => {
  const engine = withCommit(stub.SAMPLE_SWAP_COMMIT, {
    async readCommittedSwap(_db, sourceResultId) {
      this.commitReads = this.commitReads || [];
      this.commitReads.push(sourceResultId);
      return { found: true, swap: { id: 'swap-1', component_role: 'CPU' } };
    },
  });
  const app = stub.createTestApp({ repository: withBuild(), engine });
  const response = await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, 'SWAP_ALREADY_COMMITTED');
  assert.equal(engine.commitReads[0], stub.SWAP_BUILD.result_id, 'the read is keyed by the RESULT, not the query');
  assert.equal(engine.commitCalls.length, 0, 'one swap per build: the second attempt costs one statement, not a pass');
});

test('a build that no longer reconstructs is 404 BUILD_NOT_EVALUABLE, naming the role', async () => {
  const app = stub.createTestApp({
    repository: withBuild(),
    engine: withCommit(refusal('NOT_EVALUABLE', { role: 'CPU', blocked_role: 'MOTHERBOARD' })),
  });
  const response = await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'BUILD_NOT_EVALUABLE');
  assert.match(response.json().message, /MOTHERBOARD/, 'the message names what could not be evaluated');
});

test('an ineligible candidate is 409 SWAP_NOT_COMMITTABLE, carrying the engine reason', async () => {
  const app = stub.createTestApp({
    repository: withBuild(),
    engine: withCommit(refusal('INELIGIBLE', {
      role: 'CPU',
      eligibility: { status: 'FAIL', reason: 'NO_ELIGIBLE_OFFER' },
    })),
  });
  const response = await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, 'SWAP_NOT_COMMITTABLE');
  assert.match(response.json().message, /NO_ELIGIBLE_OFFER/);
});

test('a verdict of FAIL is 409 SWAP_NOT_COMMITTABLE and nothing is claimed as written', async () => {
  const app = stub.createTestApp({
    repository: withBuild(),
    engine: withCommit(refusal('NOT_COMMITTABLE', {
      role: 'CPU',
      compatibility: { status: 'FAIL', pairs: [], unknown_pairwise_count: 0 },
      price: { next: 3200, offer_class: 'SEED_UNVERIFIED' },
    })),
  });
  const response = await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() });
  assert.equal(response.statusCode, 409);
  const body = response.json();
  assert.equal(body.error, 'SWAP_NOT_COMMITTABLE');
  assert.equal(body.swapped, undefined, 'a refusal must never look like a commit');
});

test('a role the build does not carry is 409 SWAP_ROLE_ABSENT, naming the role', async () => {
  const app = stub.createTestApp({
    repository: withBuild(),
    engine: withCommit(refusal('ROLE_ABSENT', { role: 'CPU' })),
  });
  const response = await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, 'SWAP_ROLE_ABSENT');
  assert.match(response.json().message, /CPU/);
});

test('a lost race on the UNIQUE index answers the same 409 as the pre-check', async () => {
  const engine = stub.createEngineStub();
  engine.commitSwapInTransaction = async function () {
    const error = new Error('duplicate key value violates unique constraint');
    error.code = '23505';
    throw error;
  };
  const app = stub.createTestApp({ repository: withBuild(), engine });
  const response = await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, 'SWAP_ALREADY_COMMITTED');
});

test('an empty live candidate pool is 404 BUILD_NOT_EVALUABLE, not a 500', async () => {
  const engine = stub.createEngineStub();
  engine.commitSwapInTransaction = async function () {
    const error = new Error('no candidates');
    error.code = 'EMPTY_CANDIDATE_POOL';
    throw error;
  };
  const app = stub.createTestApp({ repository: withBuild(), engine });
  const response = await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'BUILD_NOT_EVALUABLE');
});

// ---------------------------------------------------------------------------
// 4. Addressing and validation.
// ---------------------------------------------------------------------------

test('an unknown build or query is 404, and the engine is never asked', async () => {
  const app = stub.createTestApp();  // readBuildForSwap misses by default
  const response = await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody() });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'NOT_FOUND');

  const engine = stub.createEngineStub();
  const withEngine = stub.createTestApp({ engine });
  const unknownId = await withEngine.inject({
    method: 'POST',
    url: commitUrl({ id: 'not-a-uuid' }),
    payload: commitBody(),
  });
  assert.equal(unknownId.statusCode, 404);
  assert.equal(engine.commitCalls.length, 0);
});

test('a malformed rank, role or product id is 422 and writes nothing', async () => {
  const engine = stub.createEngineStub();
  const app = stub.createTestApp({ repository: withBuild(), engine });

  const cases = [
    { rank: '0' },
    { rank: '1.5' },
    { rank: 'abc' },
  ];
  for (const { rank } of cases) {
    const response = await app.inject({ method: 'POST', url: commitUrl({ rank }), payload: commitBody() });
    assert.equal(response.statusCode, 422, 'rank ' + rank + ' is not a rank');
  }

  const badRole = await app.inject({ method: 'POST', url: commitUrl(), payload: commitBody({ role: 'MEMORY' }) });
  assert.equal(badRole.statusCode, 422);
  assert.match(
    badRole.json().details[0].message,
    /role must be one of/,
    'the refusal names the eight swappable roles'
  );

  const badProduct = await app.inject({
    method: 'POST',
    url: commitUrl(),
    payload: commitBody({ product_id: 'p-cpu' }),
  });
  assert.equal(badProduct.statusCode, 422);

  assert.equal(engine.commitCalls.length, 0);
});

test('a variant is REQUIRED for GPU and REFUSED for every other role', async () => {
  const app = stub.createTestApp({ repository: withBuild(), engine: withCommit(stub.SAMPLE_SWAP_COMMIT) });

  const missing = await app.inject({
    method: 'POST',
    url: commitUrl(),
    payload: commitBody({ role: 'GPU', product_id: GPU_PRODUCT }),
  });
  assert.equal(missing.statusCode, 422, 'GPU candidates are variant-keyed (Decision 9)');
  assert.equal(missing.json().details[0].field, 'product_variant_id');

  const extra = await app.inject({
    method: 'POST',
    url: commitUrl(),
    payload: commitBody({ role: 'CPU', product_id: CPU_PRODUCT, product_variant_id: GPU_VARIANT }),
  });
  assert.equal(extra.statusCode, 422, 'only GPU accepts a variant');
  assert.equal(extra.json().details[0].field, 'product_variant_id');
});

module.exports = { commitUrl, commitBody };
