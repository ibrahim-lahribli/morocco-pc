'use strict';

// test/golden/loaders.test.js — the real loaders against the frozen fixtures.
//
// Runs in the ephemeral-eval CI job AFTER `npm run eval:scenarios`, on the same
// freshly migrated and seeded throwaway postgres. For every frozen scenario it
// creates a recommendation_query from the fixture's own resolved budget, runs
// the real orchestrator, observes the six loader seams capture.js observes,
// and compares the live loader outputs to test/golden/fixtures on that
// database. The comparison is by content identity (see loader-identity.js),
// because the fixtures hold TEST-branch UUIDs while the fresh database has its
// own random UUIDs.
//
// It also checks the one thing the returned values cannot show: the SQL ORDER
// BY. Every loader either re-sorts in JavaScript or keys a map that is
// re-sorted, so a reversed ORDER BY changes no output; the statement order is
// inspected directly (loader-order.js).
//
// The database is the write target from packages/database-guard
// (TEST_DATABASE_URL, never DATABASE_URL). Rows this suite creates hang off a
// `golden-loaders-` profile - deliberately NOT `golden-capture-` and NOT
// `golden-eval-` - and are deleted by id; eval-scenarios.js refuses to start
// while unmarked rows exist, which is why this suite runs after it.
//
//   npm run test:loaders:ephemeral

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { getWriteTestDbUrl, describeTarget } = require('../../packages/database-guard/src');

const orchestrator = require('../../src/recommendation/orchestrator/run');
const queryNs = require('../../src/recommendation/query');
const scoringNs = require('../../src/recommendation/scoring');
const offersNs = require('../../src/recommendation/offers');
const filteringNs = require('../../src/recommendation/filtering');
const identity = require('./loader-identity');
const order = require('./loader-order');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GOLDEN_DIR = path.join(REPO_ROOT, 'test', 'golden');
const FIXTURE_DIR = path.join(GOLDEN_DIR, 'fixtures');
const SUITE_FILE = path.join(GOLDEN_DIR, 'scenarios.json');

const MODEL_KEY = 'launch-v2@2.5.0';
const PROFILE_PREFIX = 'golden-loaders-';
const RYZEN_7500F = 'Seed Ryzen 5 7500F';

// The only two filter-verdict relaxations in this suite: these two GPUs fail
// BOTH cooling rules, and filtering/filter.js firstReasonWithStatus reports the
// first failing partner in candidate-pool order - which depends on the
// database's random ids. The verdict is REJECT either way; the reason may be
// either rule. Every other reason is compared exactly.
const BOTH_FAIL_GPU = new Set([
  'Seed GIGABYTE GeForce RTX 5080 16 GB GAMING OC / SEED-GB-RTX5080-GAMINGOC',
  'Seed ASUS GeForce RTX 5090 32 GB TUF GAMING / SEED-ASUS-RTX5090-TUF',
]);
const ALLOWED_GPU_REASONS = new Set(['GPU_TOO_THICK', 'GPU_TOO_LONG']);
const GPU_REASON_PLACEHOLDER = '<GPU_BOTH_RULES_FAIL>';

const OBSERVED = [
  [queryNs, 'loadQueryInput', 'query'],
  [scoringNs, 'loadScoringModel', 'scoringModel'],
  [offersNs, 'selectOfferPrices', 'candidatePoolResult'],
  [filteringNs, 'loadFilteringContext', 'filteringContext'],
  [filteringNs, 'filterCandidates', 'filterResult'],
  [scoringNs, 'loadComponentAssessments', 'assessments'],
];

// The suite and fixture files are static, and the per-scenario tests are
// enumerated when this describe body is built - before any hook runs - so they
// are read at module scope rather than in `before`.
const suite = JSON.parse(fs.readFileSync(SUITE_FILE, 'utf8'));
suite.engine_options = Object.freeze({ allow_unverified_seed_offers: true });
suite.scoring_model = MODEL_KEY;

const fixtures = new Map();
for (const file of fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort()) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
  fixtures.set(fixture.meta.scenario_id, fixture);
}

let client;
let modelId;
let profileId = null;
let catalog;
let assessmentTypeRank;
let identityMap;
let sigs;
const queryIds = [];
const seenClasses = new Set();

// ---------------------------------------------------------------------------
// Observation seam (same mechanism as capture.js: run.js looks the method up
// on the namespace object at call time, so replacing the property is seen by
// production code; every wrapper is restored in a finally).
// ---------------------------------------------------------------------------

function observe(namespace, method, record, key) {
  const original = namespace[method];
  if (typeof original !== 'function') {
    throw new Error('cannot observe ' + key + ': ' + method + ' is not a function');
  }
  namespace[method] = function observedSeam(...args) {
    const out = original.apply(this, args);
    if (out && typeof out.then === 'function') {
      return out.then((value) => { record[key] = value; return value; });
    }
    record[key] = out;
    return out;
  };
  return function restore() { namespace[method] = original; };
}

// ---------------------------------------------------------------------------
// Row lifecycle (id-scoped; copy of capture.js's proven cleanup)
// ---------------------------------------------------------------------------

async function createProfile(runId) {
  const res = await client.query(
    'INSERT INTO recommendation_profile (name, description) VALUES ($1, $2) RETURNING id',
    [PROFILE_PREFIX + runId, 'golden loaders suite ' + runId + ' (id-scoped cleanup; safe to delete)']
  );
  return res.rows[0].id;
}

async function createQuery(meta) {
  const res = await client.query(
    'INSERT INTO recommendation_query (recommendation_profile_id, scoring_model_id, budget_amount, currency,'
    + ' use_case, priority, resolution) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [profileId, modelId, String(meta.budget_resolved), 'MAD', meta.use_case, meta.priority, meta.resolution]
  );
  return res.rows[0].id;
}

async function cleanupQuery(queryId) {
  const ids = [queryId];
  await client.query('DELETE FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])', [ids]);
  await client.query(
    'DELETE FROM build_component WHERE build_candidate_id IN'
    + ' (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))',
    [ids]
  );
  await client.query('DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [ids]);
}

async function queryResidue(queryIdsToCheck) {
  if (queryIdsToCheck.length === 0) return 0;
  const q = await client.query(
    'SELECT count(*)::int AS n FROM recommendation_query WHERE id = ANY($1::uuid[])', [queryIdsToCheck]);
  const bc = await client.query(
    'SELECT count(*)::int AS n FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])',
    [queryIdsToCheck]
  );
  return q.rows[0].n + bc.rows[0].n;
}

async function runObserved(queryId, fixture) {
  const record = {};
  const restores = OBSERVED.map(([ns, method, key]) => observe(ns, method, record, key));
  const instrumented = order.instrument(client);
  try {
    await orchestrator.runRecommendation({
      db: client,
      queryId,
      options: { ...suite.engine_options, asOf: fixture.meta.as_of },
    });
  } finally {
    instrumented.restore();
    restores.forEach((restore) => restore());
  }
  for (const [, , key] of OBSERVED) {
    assert.ok(Object.prototype.hasOwnProperty.call(record, key), 'loader seam not observed: ' + key);
  }
  return {
    statements: instrumented.records,
    observed: {
      query: record.query,
      scoringModel: record.scoringModel,
      candidatePoolResult: record.candidatePoolResult,
      filteringContext: record.filteringContext,
      filterResult: record.filterResult,
      assessments: record.assessments.assessments,
    },
  };
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

function requireLabel(map, key, what) {
  const value = map.get(String(key));
  assert.ok(value !== undefined, 'no identity label for ' + what + ' ' + key);
  return value;
}

const fLabel = (candidate) => requireLabel(identityMap.fixtureLabel, identity.keyOf(candidate), 'fixture candidate');
const dLabel = (candidate) => requireLabel(identityMap.dbLabel, identity.keyOf(candidate), 'database candidate');
const fProductLabel = (productId) => requireLabel(
  identityMap.fixtureProductLabel, String(productId), 'fixture product');
const dProductLabel = (productId) => requireLabel(
  identityMap.dbProductLabel, String(productId), 'database product');

function priceLabelOf(key, labelMap) {
  const parts = JSON.parse(key);
  assert.equal(parts.length, 3,
    'price key must be [product_id, product_variant_id, component_role]: ' + key);
  const [productId, variantId, role] = parts;
  const label = identity.labelForCandidateIds(productId, variantId, labelMap);
  assert.equal(identityMap.labelRole.get(label), role,
    'price key component_role does not match the candidate label role for ' + label);
  return label;
}

function specLabelMap(pool, labelMap) {
  const out = new Map();
  for (const candidate of pool) {
    out.set(identity.specKey(candidate), requireLabel(labelMap, identity.keyOf(candidate), 'spec candidate'));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output-order checks (independent of cross-database ids)
// ---------------------------------------------------------------------------

function roleMajorViolations(candidates, label) {
  const roles = candidates.map((c) => c.component_role);
  const unique = [...new Set(roles)];
  const expected = unique.flatMap((role) => roles.filter((r) => r === role));
  for (let i = 0; i < roles.length; i += 1) {
    if (roles[i] !== expected[i]) {
      return [label + ' is not role-major at row ' + i + ': ' + roles[i] + ' vs ' + expected[i]];
    }
  }
  return [];
}

function withinRoleAscending(candidates, label) {
  const out = [];
  for (const [role, list] of identity.groupBy(candidates, (c) => c.component_role)) {
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const cur = list[i];
      const prevProduct = String(prev.product_id);
      const curProduct = String(cur.product_id);
      if (prevProduct > curProduct) {
        out.push(label + ' ' + role + ': product_id not ascending at row ' + i);
      } else if (prevProduct === curProduct) {
        const prevVariant = prev.product_variant_id === null || prev.product_variant_id === undefined
          ? '' : String(prev.product_variant_id);
        const curVariant = cur.product_variant_id === null || cur.product_variant_id === undefined
          ? '' : String(cur.product_variant_id);
        if (prevVariant > curVariant) {
          out.push(label + ' ' + role + ': product_variant_id not ascending at row ' + i);
        }
      }
    }
  }
  return out;
}

function bucketAscending(candidates, label) {
  const out = [];
  for (let i = 1; i < candidates.length; i += 1) {
    const prev = candidates[i - 1];
    const cur = candidates[i];
    const prevProduct = String(prev.product_id);
    const curProduct = String(cur.product_id);
    if (prevProduct > curProduct) {
      out.push(label + ': product_id not ascending at row ' + i);
    } else if (prevProduct === curProduct) {
      const prevVariant = prev.product_variant_id === null || prev.product_variant_id === undefined
        ? '' : String(prev.product_variant_id);
      const curVariant = cur.product_variant_id === null || cur.product_variant_id === undefined
        ? '' : String(cur.product_variant_id);
      if (prevVariant > curVariant) out.push(label + ': product_variant_id not ascending at row ' + i);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diff collection
// ---------------------------------------------------------------------------

function eqDiff(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    return null;
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return label + '\n' + message.split('\n').slice(0, 14).join('\n');
  }
}

function collect(diffs) {
  const real = diffs.filter(Boolean);
  assert.deepEqual(real, [], '\n' + real.join('\n\n'));
}

// ---------------------------------------------------------------------------
// Scenario comparison
// ---------------------------------------------------------------------------

function comparePool(fixture, observed, diffs) {
  const fPool = fixture.candidatePoolResult.pool;
  const dPool = observed.candidatePoolResult.pool;
  assert.equal(dPool.length, fPool.length, 'candidate pool size differs');

  const fPriceKeys = Object.keys(fixture.candidatePoolResult.prices).sort();
  const fPoolKeys = fPool
    .map((c) => JSON.stringify([c.product_id, c.product_variant_id, c.component_role])).sort();
  diffs.push(eqDiff('fixture price key set vs its own pool', fPriceKeys, fPoolKeys));
  const dPriceKeys = Object.keys(observed.candidatePoolResult.prices).sort();
  const dPoolKeys = dPool
    .map((c) => JSON.stringify([c.product_id, c.product_variant_id, c.component_role])).sort();
  diffs.push(eqDiff('database price key set vs its own pool', dPriceKeys, dPoolKeys));

  const fRoles = [...new Set(fPool.map((c) => c.component_role))];
  const dRoles = [...new Set(dPool.map((c) => c.component_role))];
  diffs.push(eqDiff('pool role order', dRoles, fRoles));
  for (const role of fRoles) {
    const fLabels = fPool.filter((c) => c.component_role === role).map(fLabel).sort();
    const dLabels = dPool.filter((c) => c.component_role === role).map(dLabel).sort();
    diffs.push(eqDiff('pool '+role+' labels (multiset)', dLabels, fLabels));
  }

  diffs.push(...roleMajorViolations(fPool, 'fixture pool'));
  diffs.push(...roleMajorViolations(dPool, 'database pool'));
  diffs.push(...withinRoleAscending(fPool, 'fixture pool'));
  diffs.push(...withinRoleAscending(dPool, 'database pool'));

  diffs.push(eqDiff('candidatePoolResult.input', observed.candidatePoolResult.input,
    fixture.candidatePoolResult.input));
}

function storePartitions(entries) {
  const byStore = new Map();
  for (const entry of entries) {
    if (entry.label === RYZEN_7500F) continue;
    if (!byStore.has(entry.entry.store_id)) byStore.set(entry.entry.store_id, new Set());
    byStore.get(entry.entry.store_id).add(entry.label);
  }
  return [...byStore.values()]
    .map((labels) => [...labels].sort())
    .filter((labels) => labels.length > 0)
    .map((labels) => JSON.stringify(labels))
    .sort();
}

async function comparePrices(fixture, observed, diffs) {
  const fEntries = Object.entries(fixture.candidatePoolResult.prices)
    .map(([key, entry]) => ({ key, entry, label: priceLabelOf(key, identityMap.fixtureLabel) }));
  const dEntries = Object.entries(observed.candidatePoolResult.prices)
    .map(([key, entry]) => ({ key, entry, label: priceLabelOf(key, identityMap.dbLabel) }));

  const fByLabel = identity.groupBy(fEntries, (e) => e.label);
  const dByLabel = identity.groupBy(dEntries, (e) => e.label);
  const fLabels = [...fByLabel.keys()].sort();
  const dLabels = [...dByLabel.keys()].sort();
  diffs.push(eqDiff('price labels (multiset)', dEntries.map((e) => e.label).sort(),
    fEntries.map((e) => e.label).sort()));
  diffs.push(eqDiff('price label set', dLabels, fLabels));

  // The ONE path-scoped exception: the 7500F. Its TEST offer is VERIFIED at
  // 1899; the seeds carry only an unverified 1800 offer, and the loader's
  // provenance-first order picks the verified one on TEST and the seed one
  // here. Nothing else about the entry is relaxed.
  const f7500 = fByLabel.get(RYZEN_7500F);
  const d7500 = dByLabel.get(RYZEN_7500F);
  assert.ok(f7500 && f7500.length === 1, 'fixture must carry exactly one 7500F price entry');
  assert.ok(d7500 && d7500.length === 1, 'database must carry exactly one 7500F price entry');
  const fixtureEntry = f7500[0].entry;
  const dbEntry = d7500[0].entry;
  identity.canonicalPrice(fixtureEntry);
  identity.canonicalPrice(dbEntry);
  assert.equal(Number(fixtureEntry.selected_price), 1899, 'fixture 7500F price');
  assert.equal(fixtureEntry.offer_class, 'VERIFIED', 'fixture 7500F offer class');
  assert.equal(Number(dbEntry.selected_price), 1800, 'seeded 7500F price');
  assert.equal(dbEntry.offer_class, 'SEED_UNVERIFIED', 'seeded 7500F offer class');
  assert.equal(new Date(fixtureEntry.price_checked_at).toISOString(), suite.as_of);
  assert.equal(new Date(dbEntry.price_checked_at).toISOString(), suite.as_of);
  // The fixture's offer carries no availability at all (the loader never
  // carries it); the seeded DB offer's availability is asserted in the DB.
  assert.equal(Object.prototype.hasOwnProperty.call(fixtureEntry, 'availability'), false,
    'the frozen price entry must not carry availability');
  assert.equal(Object.prototype.hasOwnProperty.call(dbEntry, 'availability'), false,
    'the live price entry must not carry availability');

  const verifiedFixture = fEntries.filter((e) => e.entry.offer_class === 'VERIFIED');
  assert.equal(verifiedFixture.length, 1, 'the fixture must select exactly one VERIFIED price');
  assert.equal(verifiedFixture[0].label, RYZEN_7500F, 'the fixture VERIFIED price must be the 7500F');
  const verifiedDb = dEntries.filter((e) => e.entry.offer_class === 'VERIFIED');
  assert.equal(verifiedDb.length, 0, 'a freshly seeded database must select zero VERIFIED prices');

  for (const label of fLabels) {
    if (label === RYZEN_7500F) continue;
    const fc = fByLabel.get(label);
    const dc = dByLabel.get(label);
    assert.ok(dc, 'no database price entry for ' + label);
    assert.equal(dc.length, fc.length, 'price entry count differs for ' + label);
    diffs.push(eqDiff('price '+label, identity.multiset(dc.map((e) => identity.canonicalPrice(e.entry))),
      identity.multiset(fc.map((e) => identity.canonicalPrice(e.entry)))));
  }

  diffs.push(eqDiff('selected-price store partitions', storePartitions(dEntries), storePartitions(fEntries)));

  const offer = await client.query(
    'SELECT o.price, o.availability, o.ingestion_record_id, s.name AS store_name'
    + ' FROM store_offer o JOIN store s ON s.id = o.store_id WHERE o.id = $1',
    [dbEntry.offer_id]
  );
  assert.equal(offer.rows.length, 1, 'the seeded 7500F selected offer must exist');
  assert.equal(Number(offer.rows[0].price), 1800);
  assert.equal(offer.rows[0].availability, 'IN_STOCK');
  assert.equal(offer.rows[0].ingestion_record_id, null);
  assert.equal(offer.rows[0].store_name, 'Seed NextGamer');
}

// The order dependence is NOT limited to the two GPUs. Per relationship,
// `firstReasonWithStatus` reads the reason of the FIRST partner in
// candidate-pool order that carries the relationship's status. A relationship
// that aggregates UNKNOWN can be UNKNOWN for two different reasons - measured:
// CPU_MOTHERBOARD_SUPPORT_UNKNOWN from a SUPPORT_UNKNOWN partner against
// CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE from a CONDITIONAL one - so which
// reason the candidate reports follows the database's random ids. Where the
// candidate carries a CONDITIONAL note naming that relationship and the
// relationship is UNKNOWN, the reason is compared BY RELATIONSHIP rather than by
// value; status, notes, partner, relationships and every count are still
// compared exactly, and every other candidate keeps an exact reason. This is the
// documented core defect (out of scope to fix), scoped to the one place it is
// observable without absorbing a different defect.
function orderDependentReason(result) {
  if (result.status !== 'UNKNOWN' || result.reason === null || result.reason === undefined) {
    return result;
  }
  for (const note of result.compatibility_notes || []) {
    const relationship = note.relationship;
    if (relationship === null || relationship === undefined) continue;
    if ((result.relationships || {})[relationship] !== 'UNKNOWN') continue;
    if (String(result.reason).startsWith(String(relationship).toUpperCase() + '_')) {
      return { ...result, reason: '<ORDER_DEPENDENT:' + relationship + '>' };
    }
  }
  return result;
}

function compareFilter(fixture, observed, diffs) {
  const fPool = fixture.candidatePoolResult.pool;
  const dPool = observed.candidatePoolResult.pool;
  const fResults = fixture.filterResult.results;
  const dResults = observed.filterResult.results;
  assert.equal(fResults.length, fPool.length, 'fixture filter result count');
  assert.equal(dResults.length, dPool.length, 'database filter result count');
  assert.equal(dResults.length, fResults.length, 'filter result count differs');

  diffs.push(eqDiff('fixture filter order (pool order)',
    fResults.map((r) => identity.keyOf(r)), fPool.map((c) => identity.keyOf(c))));
  diffs.push(eqDiff('database filter order (pool order)',
    dResults.map((r) => identity.keyOf(r)), dPool.map((c) => identity.keyOf(c))));

  const fByLabel = identity.groupBy(fResults, (r) => identity.labelForCandidateIds(
    r.product_id, r.product_variant_id, identityMap.fixtureLabel));
  const dByLabel = identity.groupBy(dResults, (r) => identity.labelForCandidateIds(
    r.product_id, r.product_variant_id, identityMap.dbLabel));
  const fLabels = [...fByLabel.keys()].sort();
  const dLabels = [...dByLabel.keys()].sort();
  diffs.push(eqDiff('filter result labels (multiset)',
    dResults.map((r) => identity.labelForCandidateIds(r.product_id, r.product_variant_id, identityMap.dbLabel)).sort(),
    fResults.map((r) => identity.labelForCandidateIds(r.product_id, r.product_variant_id, identityMap.fixtureLabel)).sort()));
  diffs.push(eqDiff('filter result label set', dLabels, fLabels));

  const hasGpu = fPool.some((c) => c.component_role === 'GPU');
  const gpuFailLabels = (results, labelMap) => results
    .filter((r) => r.component_role === 'GPU' && r.relationships && r.relationships.gpu_case === 'FAIL')
    .map((r) => identity.labelForCandidateIds(r.product_id, r.product_variant_id, labelMap));
  const fGpuFails = gpuFailLabels(fResults, identityMap.fixtureLabel);
  const dGpuFails = gpuFailLabels(dResults, identityMap.dbLabel);
  if (hasGpu) {
    assert.deepEqual([...new Set(fGpuFails)].sort(), [...BOTH_FAIL_GPU].sort(),
      'the fixture GPU case-rule failures must be exactly the two named variants');
    assert.deepEqual([...new Set(dGpuFails)].sort(), [...BOTH_FAIL_GPU].sort(),
      'the database GPU case-rule failures must be exactly the two named variants');
  } else {
    assert.equal(fGpuFails.length, 0, 'a pool without GPUs cannot carry a GPU failure');
    assert.equal(dGpuFails.length, 0);
  }
  const relax = new Set(hasGpu ? BOTH_FAIL_GPU : []);

  for (const label of fLabels) {
    const fc = fByLabel.get(label);
    const dc = dByLabel.get(label);
    assert.ok(dc, 'no database filter result for ' + label);
    assert.equal(dc.length, fc.length, 'filter result count differs for ' + label);
    if (relax.has(label)) {
      // Both verdicts are REJECT/gpu_case FAIL; the decisive CASE and the rule
      // (thickness vs length) follow candidate-pool order, so both are
      // relaxed. Everything else is still compared exactly.
      for (const [side, results, labelMap] of [
        ['fixture', fc, identityMap.fixtureLabel],
        ['database', dc, identityMap.dbLabel],
      ]) {
        for (const result of results) {
          assert.equal(result.status, 'REJECT', side + ' ' + label + ' must be REJECT');
          assert.equal(result.relationships.gpu_case, 'FAIL', side + ' ' + label + ' must fail the case rule');
          assert.ok(ALLOWED_GPU_REASONS.has(result.reason),
            side + ' ' + label + ' reason must be a case rule, got ' + result.reason);
          const canon = identity.canonicalFilterResult(result, labelMap);
          assert.equal(identityMap.labelRole.get(canon.partner), 'CASE',
            side + ' ' + label + ' decisive partner must be a CASE candidate, got ' + canon.partner);
        }
      }
      const relaxed = (results, labelMap) => results.map((r) => ({
        ...identity.canonicalFilterResult({ ...r, reason: GPU_REASON_PLACEHOLDER }, labelMap),
        partner: '<GPU_CASE_PARTNER>',
      }));
      diffs.push(eqDiff('filter '+label,
        identity.multiset(relaxed(dc, identityMap.dbLabel)),
        identity.multiset(relaxed(fc, identityMap.fixtureLabel))));
    } else {
      const fCanon = fc.map((r) => identity.canonicalFilterResult(orderDependentReason(r), identityMap.fixtureLabel));
      const dCanon = dc.map((r) => identity.canonicalFilterResult(orderDependentReason(r), identityMap.dbLabel));
      diffs.push(eqDiff('filter '+label, identity.multiset(dCanon), identity.multiset(fCanon)));
    }
  }
}

function compareAssessments(fixture, observed, diffs) {
  const fMap = fixture.assessments;
  const dMap = observed.assessments;
  for (const [side, map] of [['fixture', fMap], ['database', dMap]]) {
    const keys = Object.keys(map);
    diffs.push(eqDiff(side+' assessment map keys sorted', keys, [...keys].sort()));
  }
  const groups = (map, labelFor) => {
    const out = new Map();
    for (const [productId, rows] of Object.entries(map)) {
      const label = labelFor(productId);
      if (!out.has(label)) out.set(label, []);
      out.get(label).push(identity.canonicalAssessmentRows(rows));
    }
    return out;
  };
  const fGroups = groups(fMap, fProductLabel);
  const dGroups = groups(dMap, dProductLabel);
  const fLabels = [...fGroups.keys()].sort();
  const dLabels = [...dGroups.keys()].sort();
  diffs.push(eqDiff('assessment product labels', dLabels, fLabels));

  for (const label of fLabels) {
    const fa = fGroups.get(label);
    const da = dGroups.get(label);
    assert.ok(da, 'database has no assessments for ' + label);
    assert.equal(da.length, fa.length, 'assessment groups differ for ' + label);
    if (fa.length === 1) {
      diffs.push(eqDiff('assessments '+label, da[0], fa[0]));
    } else {
      diffs.push(eqDiff('assessments '+label, identity.multiset(da), identity.multiset(fa)));
    }
  }

  if (fixture.meta.scenario_id === 'S03') {
    // The committed S03 fixture has 112 assessed products; the one compact
    // CASE product (f60f0866...) is unassessed on both sides.
    const unassessed = identityMap.fixtureProductLabel.get('f60f0866-1e33-4ef6-87bd-d467c78086a5');
    assert.ok(unassessed, 'the unassessed CASE product must have an identity label');
    assert.equal(fGroups.has(unassessed), false, 'the compact CASE must stay unassessed in the fixture');
    assert.equal(dGroups.has(unassessed), false, 'the compact CASE must stay unassessed in the database');
    assert.equal(Object.keys(fMap).length, 112, 'the committed S03 fixture assesses 112 products');
  }
}

function compareContext(fixture, observed, diffs) {
  const fContext = fixture.filteringContext;
  const dContext = observed.filteringContext;
  const fPool = fixture.candidatePoolResult.pool;
  const dPool = observed.candidatePoolResult.pool;

  diffs.push(eqDiff('context candidate role keys',
    Object.keys(dContext.candidates), Object.keys(fContext.candidates)));
  for (const role of Object.keys(fContext.candidates)) {
    const fc = fContext.candidates[role] || [];
    const dc = dContext.candidates[role] || [];
    diffs.push(eqDiff('context bucket '+role, dc.map(dLabel).sort(), fc.map(fLabel).sort()));
    diffs.push(...bucketAscending(fc, 'fixture bucket '+role));
    diffs.push(...bucketAscending(dc, 'database bucket '+role));
  }

  // Every spec-bearing candidate has exactly one spec; SSDs carry none.
  for (const [side, pool, specs] of [
    ['fixture', fPool, fContext.specs],
    ['database', dPool, dContext.specs],
  ]) {
    const bearing = pool.filter((c) => identity.SPEC_BEARING_ROLES.includes(c.component_role));
    const expected = [...new Set(bearing.map((c) => identity.specKey(c)))].sort();
    const actual = Object.keys(specs).sort();
    diffs.push(eqDiff(side+' spec key set (spec-bearing candidates only)', actual, expected));
  }

  const fSpecLabels = specLabelMap(fPool, identityMap.fixtureLabel);
  const dSpecLabels = specLabelMap(dPool, identityMap.dbLabel);
  const fSpecByLabel = identity.groupBy(Object.entries(fContext.specs)
    .map(([key, spec]) => ({ key, spec, label: requireLabel(fSpecLabels, key, 'fixture spec key') })),
  (e) => e.label);
  const dSpecByLabel = identity.groupBy(Object.entries(dContext.specs)
    .map(([key, spec]) => ({ key, spec, label: requireLabel(dSpecLabels, key, 'database spec key') })),
  (e) => e.label);
  const fSpecLabelSet = [...fSpecByLabel.keys()].sort();
  const dSpecLabelSet = [...dSpecByLabel.keys()].sort();
  diffs.push(eqDiff('spec candidate labels', dSpecLabelSet, fSpecLabelSet));
  for (const label of fSpecLabelSet) {
    const fc = fSpecByLabel.get(label);
    const dc = dSpecByLabel.get(label);
    assert.ok(dc, 'no database spec for ' + label);
    assert.equal(dc.length, fc.length, 'spec count differs for ' + label);
    diffs.push(eqDiff('spec '+label,
      identity.multiset(dc.map((e) => identity.canonicalSpec(e.spec, sigs.db))),
      identity.multiset(fc.map((e) => identity.canonicalSpec(e.spec, sigs.fixture)))));
  }

  diffs.push(eqDiff('compat keys', Object.keys(dContext.compat), Object.keys(fContext.compat)));
  const fCompat = identity.canonicalCompat(fContext.compat, {
    productLabelFor: (id) => requireLabel(identityMap.fixtureProductLabel, id, 'fixture compat product'),
    socketSig: sigs.fixture.socketSig,
    memorySig: sigs.fixture.memorySig,
    familySig: sigs.fixture.familySig,
    platformSig: sigs.fixture.platformSig,
  });
  const dCompat = identity.canonicalCompat(dContext.compat, {
    productLabelFor: (id) => requireLabel(identityMap.dbProductLabel, id, 'database compat product'),
    socketSig: sigs.db.socketSig,
    memorySig: sigs.db.memorySig,
    familySig: sigs.db.familySig,
    platformSig: sigs.db.platformSig,
  });
  const fOwners = [...fCompat.keys()].sort();
  const dOwners = [...dCompat.keys()].sort();
  diffs.push(eqDiff('compat owner keys', dOwners, fOwners));
  for (const owner of fOwners) {
    diffs.push(eqDiff('compat '+owner, dCompat.get(owner), fCompat.get(owner)));
  }

  diffs.push(eqDiff('platform_by_socket',
    identity.canonicalPlatformBySocket(dContext.platform_by_socket, sigs.db.socketSig, sigs.db.platformSig),
    identity.canonicalPlatformBySocket(fContext.platform_by_socket, sigs.fixture.socketSig, sigs.fixture.platformSig)));
}

function compareScenario(fixture, observed) {
  assert.equal(fixture.nowMs, Date.parse(fixture.meta.as_of), 'fixture nowMs must be its as_of');
  const diffs = [];
  diffs.push(eqDiff('query',
    identity.canonicalQuery(observed.query, MODEL_KEY),
    identity.canonicalQuery(fixture.query, MODEL_KEY)));
  diffs.push(eqDiff('scoringModel',
    identity.canonicalModel(observed.scoringModel, MODEL_KEY),
    identity.canonicalModel(fixture.scoringModel, MODEL_KEY)));
  comparePool(fixture, observed, diffs);
  return { diffs };
}

// ---------------------------------------------------------------------------
// Statement-order invariant
// ---------------------------------------------------------------------------

function checkStatementOrder(statements, scenarioId) {
  const classes = order.classify(statements);
  assert.equal(classes.has('now'), false, scenarioId + ': an asOf run issued SELECT CURRENT_TIMESTAMP AS now');
  for (const [key, records] of classes) {
    if (key === 'now') continue;
    seenClasses.add(key);
    const problems = order.violations(key, records, { assessmentTypeRank });
    assert.deepEqual(problems, [], scenarioId + ' ' + key + ' violates its SQL order:\n' + problems.join('\n'));
  }
  for (const key of ['query', 'model', 'candidates_integrity', 'offers', 'assessments']) {
    assert.equal((classes.get(key) || []).length, 1,
      scenarioId + ': expected exactly one ' + key + ' statement, seen ' + (classes.get(key) || []).length);
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('golden loaders on a freshly seeded database', () => {
  before(async () => {
    assert.deepEqual([...fixtures.keys()].sort(), suite.scenarios.map((s) => s.id).sort(),
      'the fixture set must be exactly the suite scenarios');
    for (const scenario of suite.scenarios) {
      const fixture = fixtures.get(scenario.id);
      assert.equal(fixture.meta.as_of, suite.as_of, scenario.id + ' as_of pin');
      assert.deepEqual(fixture.meta.engine_options, suite.engine_options, scenario.id + ' engine options pin');
      assert.equal(fixture.meta.scoring_model, MODEL_KEY, scenario.id + ' model pin');
      assert.equal(fixture.meta.use_case, scenario.use_case, scenario.id + ' use_case');
      assert.equal(fixture.meta.resolution, scenario.resolution, scenario.id + ' resolution');
      assert.equal(fixture.meta.priority, scenario.priority, scenario.id + ' priority');
    }

    const guardTarget = getWriteTestDbUrl();
    process.stdout.write('target: ' + JSON.stringify(describeTarget(guardTarget.connectionString)) + '\n');
    client = new Client({
      connectionString: guardTarget.connectionString,
      connectionTimeoutMillis: guardTarget.connectionTimeoutMillis || 10000,
    });
    await client.connect();

    const model = await client.query(
      "SELECT id FROM scoring_model WHERE name || '@' || version = $1", [MODEL_KEY]);
    assert.equal(model.rows.length, 1, 'expected exactly one scoring model ' + MODEL_KEY);
    modelId = model.rows[0].id;

    const products = await client.query('SELECT id::text AS id, name FROM product');
    const variants = await client.query('SELECT id::text AS id, sku FROM product_variant');
    const stores = await client.query('SELECT id::text AS id, name FROM store');
    const sockets = await client.query('SELECT id::text AS id, name FROM socket');
    const memoryTypes = await client.query('SELECT id::text AS id, name FROM memory_type');
    assert.equal(new Set(stores.rows.map((row) => row.name)).size, stores.rows.length,
      'store.name must be unique for store partitions to identify a store');
    assert.equal(new Set(sockets.rows.map((row) => row.name)).size, sockets.rows.length,
      'socket.name must be unique');
    assert.equal(new Set(memoryTypes.rows.map((row) => row.name)).size, memoryTypes.rows.length,
      'memory_type.name must be unique');
    catalog = {
      productName: new Map(products.rows.map((row) => [row.id, row.name])),
      variantSku: new Map(variants.rows.map((row) => [row.id, row.sku])),
      storeName: new Map(stores.rows.map((row) => [row.id, row.name])),
    };

    const enumRows = await client.query(
      "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid"
      + " WHERE t.typname = 'assessment_type' ORDER BY e.enumsortorder");
    assessmentTypeRank = new Map(enumRows.rows.map((row, index) => [row.enumlabel, index]));
    assert.ok(assessmentTypeRank.size > 0, 'assessment_type enum must exist');

    const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + '-' + process.pid;
    profileId = await createProfile(runId);

    // One dedicated S03 pass builds the cross-database identity once. Every
    // scenario's pool is a role subset of this GAMING pool, so its labels and
    // dimension signatures cover the whole suite.
    const identityFixture = fixtures.get('S03');
    assert.ok(identityFixture, 'the suite must contain S03');
    const identityQueryId = await createQuery(identityFixture.meta);
    queryIds.push(identityQueryId);
    try {
      const { observed } = await runObserved(identityQueryId, identityFixture);
      identityMap = identity.buildIdentity({
        fixtureCandidates: identityFixture.candidatePoolResult.pool,
        fixtureSpecs: identityFixture.filteringContext.specs,
        fixtureAssessments: identityFixture.assessments,
        dbCandidates: observed.candidatePoolResult.pool,
        dbSpecs: observed.filteringContext.specs,
        dbAssessments: observed.assessments,
        catalog,
      });
      assert.ok(identityMap.uniqueLabels.has(RYZEN_7500F), 'the 7500F must map to ' + RYZEN_7500F);
      for (const key of BOTH_FAIL_GPU) {
        assert.ok(identityMap.uniqueLabels.has(key), 'both-fail GPU must map to ' + key);
      }

      const fPool = identityFixture.candidatePoolResult.pool;
      const dPool = observed.candidatePoolResult.pool;
      const fSigs = identity.buildDimensionSignatures(
        fPool, identityFixture.filteringContext.specs, fLabel);
      const dSigs = identity.buildDimensionSignatures(
        dPool, observed.filteringContext.specs, dLabel);
      sigs = {
        fixture: {
          ...fSigs,
          platformSig: identity.buildPlatformSignatures(
            identityFixture.filteringContext.compat.platform_memory, fSigs.memorySig),
        },
        db: {
          ...dSigs,
          platformSig: identity.buildPlatformSignatures(
            observed.filteringContext.compat.platform_memory, dSigs.memorySig),
        },
      };
      process.stdout.write('identity: ' + identityMap.pairs.length + ' unique candidates, '
        + identityMap.classes.length + ' duplicate classes ('
        + identityMap.classes.map((c) => c.label).join('; ') + ')\n');
    } finally {
      await cleanupQuery(identityQueryId);
      const left = await queryResidue([identityQueryId]);
      assert.equal(left, 0, 'identity-run rows must be deleted by id');
    }
  });

  after(async () => {
    if (client === undefined) return;
    if (profileId !== null) {
      await client.query('DELETE FROM recommendation_profile WHERE id = $1', [profileId]);
    }
    const left = await queryResidue(queryIds);
    const profileLeft = profileId === null
      ? 0
      : (await client.query(
        'SELECT count(*)::int AS n FROM recommendation_profile WHERE id = $1', [profileId])).rows[0].n;
    await client.end();
    assert.equal(left + profileLeft, 0, 'the suite must leave no golden-loaders rows');
  });

  for (const scenario of suite.scenarios) {
    test(scenario.id + ': live loaders reproduce the frozen loader fixture', async () => {
      const fixture = fixtures.get(scenario.id);
      const queryId = await createQuery(fixture.meta);
      queryIds.push(queryId);
      try {
        const { observed, statements } = await runObserved(queryId, fixture);
        const { diffs } = compareScenario(fixture, observed);
        await comparePrices(fixture, observed, diffs);
        compareFilter(fixture, observed, diffs);
        compareAssessments(fixture, observed, diffs);
        compareContext(fixture, observed, diffs);
        collect(diffs);
        checkStatementOrder(statements, scenario.id);
      } finally {
        await cleanupQuery(queryId);
        const left = await queryResidue([queryId]);
        assert.equal(left, 0, scenario.id + ': rows must be deleted by id');
      }
    });
  }

  test('every loader statement was observed at least once across the suite', () => {
    const missing = order.EXPECTED_CLASSES.filter((key) => !seenClasses.has(key));
    assert.deepEqual(missing, [], 'loader statements never observed: ' + missing.join(', '));
    process.stdout.write('statement classes observed: ' + seenClasses.size + '/'
      + order.EXPECTED_CLASSES.length + '\n');
  });
});
