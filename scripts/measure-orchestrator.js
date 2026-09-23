'use strict';

// scripts/measure-orchestrator.js - Decision 20 measurement harness.
//
// Purpose: exercise the Decision 17 no-writes orchestrator (runRecommendation /
// runRecommendationSnapshot) against the minimal seed on an ISOLATED test
// branch, and MEASURE the Decision 20 assembly-diversity question. This script
// decides nothing: it prints facts and a factual summary only.
//
// Second measurement (added 2026-09-23, run 2): the number Decision 20 section
// 1 actually turns on - the (CPU, GPU) pair concentration of the ranked top-10.
// Per query and per cap variant it ranks that run's builds with the real
// Decision 18 rankBuilds(), takes the first TOP_N_PERSISTED (10) entries, groups
// them by the Decision 20 section 2 pair `(CPU product_id, GPU
// product_variant_id-or-OMITTED)` read from each build's component list (the
// same by-role lookup roleValue() already uses) and cross-checked against the
// entry's Decision 18 signature, then prints the distinct-pair count, the
// per-pair counts and a keyword comparison against Decision 20 section 1's
// wording. Facts only; no recommendation is derived.
//
// Safety contract (mirrors scripts/lib/db-url.js):
//   * Target is TEST_DATABASE_URL only. getWriteTestDbUrl() throws unless
//     TEST_DATABASE_URL is set, DATABASE_URL is set, and the two hosts differ
//     (pooled vs direct counts as the same endpoint). The shared DATABASE_URL
//     is never contacted, never printed.
//   * Only the HOST of TEST_DATABASE_URL is printed - never credentials,
//     user, port or path.
//   * Writes: exactly two INSERTs into recommendation_query (one transaction)
//     and one DELETE of those same captured ids in a finally block. Nothing
//     else is written; the orchestrator itself writes nothing (Decision 17).
//   * Reads add exactly two seed-scoped, read-only SELECTs (product name /
//     product_variant sku) used only as DISPLAY LABELS for the measured pairs;
//     no other statement is issued beyond the preflight counts and the reads
//     the orchestrator's own loaders/scoring already perform.
//   * Preflight READ-ONLY counts must match the seed exactly (15 Seed %
//     products, 1 active seed-minimal-v1 model, 16 seed offers, 25 seed
//     assessments, 0 recommendation_query rows) - the run aborts otherwise,
//     before any insert.
//   * Cleanup is idempotent by id: only rows this run inserted are deleted,
//     and the post-delete counts are verified and printed. If the script dies
//     between INSERT and DELETE, the next run aborts in preflight and prints
//     the leftover ids for a human decision (it never deletes rows it did not
//     create).
//   * The high-cap variant never touches the stored scoring_model value: the
//     cap is raised on an IN-MEMORY COPY of the row returned to the loader
//     (a read-only db decorator that forwards every statement unchanged).
//
// Run: node scripts/measure-orchestrator.js   (only after the operator asks)

require('dotenv').config();
const { Client } = require('pg');

const { getWriteTestDbUrl } = require('./lib/db-url');
const { runRecommendationSnapshot } = require('../src/recommendation/orchestrator');
const { rankBuilds, TOP_N_PERSISTED } = require('../src/recommendation/ranking');
const { EXPANSION_ORDER } = require('../src/recommendation/assembly');
const { SELECT_SCORING_MODEL_SQL } = require('../src/recommendation/scoring');

/** The uncapped variant cap: never written anywhere, only seen by the loader. */
const HIGH_CAP = 100000;

/** Budgets proposed from the seed prices (see the seed plan); MAD throughout. */
const QUERIES = [
  { useCase: 'GAMING', budget: '15000' },
  { useCase: 'OFFICE', budget: '10000' },
];

/**
 * Decision 20 section 1's top-10 claims, exactly as the doc words them, with a
 * projector onto the measured concentration. Nothing beyond the count the claim
 * names is inferred; `claimed` is the doc's number, never a target set here.
 */
const DECISION_20_TOP10_CLAIMS = {
  GAMING: [
    { label: 'distinct CPU product_ids in the top-10', claimed: 1, measure: (c) => c.distinctCpus },
    { label: 'distinct GPU pair values in the top-10', claimed: 2, measure: (c) => c.distinctGpuValues },
  ],
  OFFICE: [
    { label: 'top-10 slots held by the largest single pair', claimed: 7, measure: (c) => c.largestPairCount },
  ],
};

/** The same claims in the doc's own words (Decision 20 section 1). */
const DECISION_20_TOP10_TEXT = {
  GAMING: 'the ranked top-10 still collapsed to 1 CPU / 2 GPU pairs',
  OFFICE: 'OFFICE collapsed to 1 CPU-GPU pairing in 7/10 top slots',
};

/** Printed comparison band: delta 0 = exact, |delta| <= close = close, else off. */
const CLAIM_BAND = { exact: 0, close: 2 };

/** Exact seed expectations (database/seeds/001_minimal_builds.sql). */
const EXPECTED = { products: 15, models: 1, offers: 16, assessments: 25, queries: 0 };

function fail(message) {
  throw new Error(message);
}

/** Hostname only - never credentials, user, port or path. */
function hostOf(connectionString) {
  return new URL(connectionString).hostname;
}

async function count(client, sql, params = []) {
  const result = await client.query(sql, params);
  return Number(result.rows[0].count);
}

/**
 * Read-only preflight. Aborts (before any write) unless every count matches
 * the seed exactly; returns the pinned seed scoring-model id.
 */
async function preflight(client) {
  const products = await count(client, "SELECT count(*)::int AS count FROM product WHERE name LIKE 'Seed %'");
  const models = await count(client,
    "SELECT count(*)::int AS count FROM scoring_model WHERE name = 'seed-minimal-v1' AND version = '1.0.0' AND is_active = true");
  const offers = await count(client,
    "SELECT count(*)::int AS count FROM store_offer o JOIN product p ON p.id = o.product_id WHERE p.name LIKE 'Seed %'");
  const assessments = await count(client,
    "SELECT count(*)::int AS count FROM component_assessment a JOIN product p ON p.id = a.product_id WHERE p.name LIKE 'Seed %'");
  const queries = await count(client, 'SELECT count(*)::int AS count FROM recommendation_query');
  const buildCandidates = await count(client, 'SELECT count(*)::int AS count FROM build_candidate');

  const observed = { products, models, offers, assessments, queries };
  const mismatches = [];
  for (const key of Object.keys(EXPECTED)) {
    if (observed[key] !== EXPECTED[key]) {
      mismatches.push(key + ': expected ' + EXPECTED[key] + ', found ' + observed[key]);
    }
  }
  if (mismatches.length > 0) {
    fail('PREFLIGHT FAILED (no write was performed): ' + mismatches.join('; ')
      + ' - reset the test branch from its parent and run the seeds first');
  }
  if (buildCandidates !== 0) {
    fail('PREFLIGHT FAILED: build_candidate is not empty (' + buildCandidates + ' rows)');
  }

  const model = await client.query(
    "SELECT id FROM scoring_model WHERE name = 'seed-minimal-v1' AND version = '1.0.0' AND is_active = true");
  return { observed, scoringModelId: model.rows[0].id };
}

/** The two measurement queries, inserted in ONE transaction; ids captured. */
async function insertQueries(client, scoringModelId) {
  const ids = [];
  await client.query('BEGIN');
  try {
    for (const query of QUERIES) {
      const inserted = await client.query(
        'INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency, use_case)'
        + " VALUES ($1, $2, 'MAD', $3) RETURNING id",
        [scoringModelId, query.budget, query.useCase]
      );
      ids.push(inserted.rows[0].id);
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('cleanup note: ROLLBACK after the failed insert also failed:', rollbackError.message);
    }
    throw error;
  }
  return ids;
}

/** Delete ONLY the rows this run inserted, then verify Layer 4 is empty again. */
async function deleteQueries(client, ids) {
  if (ids.length === 0) return;
  await client.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [ids]);
  const remaining = await count(client, 'SELECT count(*)::int AS count FROM recommendation_query');
  if (remaining !== EXPECTED.queries) {
    console.error('CLEANUP WARNING: recommendation_query still holds ' + remaining
      + ' row(s); inserted ids were: ' + ids.join(', '));
  } else {
    console.log('cleanup verified: recommendation_query back to ' + remaining + ' rows');
  }
}
// ---------------------------------------------------------------------------
// Decision 20 measurement helpers (in memory, read-only).
// ---------------------------------------------------------------------------

/**
 * Read-only db decorator: every statement is forwarded unchanged EXCEPT the
 * Decision 11 scoring-model lookup, whose returned rows are replaced by an
 * IN-MEMORY COPY with candidate_caps.max_builds_per_query raised. The stored
 * scoring_model value is never written; the loader re-validates the copy, and
 * a positive integer cap stays a valid closed two-key candidate_caps object.
 */
function withRaisedCap(client, cap) {
  return {
    query(sql, params) {
      return client.query(sql, params).then((resolved) => {
        if (sql !== SELECT_SCORING_MODEL_SQL) return resolved;
        const rows = resolved.rows.map((row) => ({
          ...row,
          configuration: {
            ...row.configuration,
            candidate_caps: {
              ...row.configuration.candidate_caps,
              max_builds_per_query: cap,
            },
          },
        }));
        return { ...resolved, rows };
      });
    },
  };
}

const round2 = (value) => Math.round(value * 100) / 100;

/** One role's value in a build; '(omitted)' is a legitimate value (GPU-omit). */
function roleValue(build, role) {
  const component = build.components.find((entry) => entry.component_role === role);
  if (!component) return '(omitted)';
  return component.product_variant_id
    ? component.product_id + ' variant ' + component.product_variant_id
    : component.product_id;
}

/**
 * Decision 20 section 2 pair values for a build, read from the build's component
 * list with the same by-role lookup roleValue() / structureRows() already use.
 *
 *   withGpuVariant = true  -> the Decision 20 pair: (CPU product_id, GPU
 *                             product_variant_id-or-OMITTED). An omitted GPU
 *                             (iGPU path) is its own pair value, exactly as the
 *                             decision words it.
 *   withGpuVariant = false -> the coarser (CPU product_id, GPU product_id)
 *                             reading, which merges every variant of one GPU
 *                             product into a single pair.
 */
function pairParts(build, withGpuVariant) {
  const byRole = new Map(build.components.map((component) => [component.component_role, component]));
  const cpu = byRole.get('CPU');
  const gpu = byRole.get('GPU');
  const cpuId = cpu === undefined ? '(no CPU component)' : String(cpu.product_id);
  let gpuValue;
  if (gpu === undefined) {
    gpuValue = 'OMITTED';
  } else if (!withGpuVariant) {
    gpuValue = String(gpu.product_id);
  } else if (gpu.product_variant_id === null || gpu.product_variant_id === undefined) {
    gpuValue = '(no GPU variant)';
  } else {
    gpuValue = String(gpu.product_variant_id);
  }
  return { cpuId, gpuValue, key: cpuId + '||' + gpuValue };
}

/**
 * The same two pair values read out of the ranked entry's Decision 18 signature
 * (`ROLE:product_id:variant_or_empty`, an omitted GPU being its empty slot
 * `GPU::`). Used ONLY as a cross-check that the component-list path above agrees
 * with what rankBuilds() itself computed - never as the reported key.
 */
function signaturePairParts(entry) {
  const byRole = Object.create(null);
  for (const segment of entry.signature.split('|')) {
    const first = segment.indexOf(':');
    const second = segment.indexOf(':', first + 1);
    byRole[segment.slice(0, first)] = {
      productId: segment.slice(first + 1, second),
      variant: segment.slice(second + 1),
    };
  }
  const cpu = byRole.CPU === undefined ? { productId: '' } : byRole.CPU;
  const gpu = byRole.GPU === undefined ? { productId: '', variant: '' } : byRole.GPU;
  let gpuValue;
  if (gpu.productId === '') {
    gpuValue = 'OMITTED';
  } else if (gpu.variant === '') {
    gpuValue = '(no GPU variant)';
  } else {
    gpuValue = gpu.variant;
  }
  return { cpuId: cpu.productId === '' ? '(no CPU component)' : cpu.productId, gpuValue };
}

/**
 * Histogram of one ranked list's top-10 over one pair definition. Facts only.
 * Histogram rows are ordered count DESC, then pair key by code unit, so the
 * output is deterministic and never depends on discovery order.
 */
function topPairConcentration(ranked, withGpuVariant) {
  const top = ranked.slice(0, TOP_N_PERSISTED);
  const pairs = new Map();
  const cpus = new Set();
  const gpuValues = new Set();
  let crossCheckMismatches = 0;
  for (const entry of top) {
    const parts = pairParts(entry.build, withGpuVariant);
    if (withGpuVariant) {
      const fromSignature = signaturePairParts(entry);
      if (parts.cpuId !== fromSignature.cpuId || parts.gpuValue !== fromSignature.gpuValue) {
        crossCheckMismatches += 1;
      }
    }
    cpus.add(parts.cpuId);
    gpuValues.add(parts.gpuValue);
    const existing = pairs.get(parts.key);
    if (existing === undefined) {
      pairs.set(parts.key, { cpuId: parts.cpuId, gpuValue: parts.gpuValue, count: 1 });
    } else {
      existing.count += 1;
    }
  }
  const rows = [...pairs.values()].sort((left, right) => {
    if (left.count !== right.count) return right.count - left.count;
    const leftKey = left.cpuId + '||' + left.gpuValue;
    const rightKey = right.cpuId + '||' + right.gpuValue;
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
  return {
    rankedCount: ranked.length,
    sliceSize: top.length,
    distinctPairs: rows.length,
    distinctCpus: cpus.size,
    distinctGpuValues: gpuValues.size,
    largestPairCount: rows.length > 0 ? rows[0].count : 0,
    rows,
    crossCheckMismatches,
    crossCheckTotal: withGpuVariant ? top.length : 0,
  };
}

/**
 * Decision 20 section 1's number compared against a measurement. The band is
 * printed with every comparison: delta 0 -> HOLDS EXACTLY, |delta| <= 2 ->
 * CLOSE, anything else -> WAY OFF. A number comparison, not a verdict on the
 * decision itself.
 */
function claimComparison(actual, claimed) {
  const delta = actual - claimed;
  let verdict;
  if (delta === CLAIM_BAND.exact) {
    verdict = 'HOLDS EXACTLY (delta 0)';
  } else if (Math.abs(delta) <= CLAIM_BAND.close) {
    verdict = 'CLOSE (delta ' + (delta > 0 ? '+' : '') + delta + ')';
  } else {
    verdict = 'WAY OFF (delta ' + (delta > 0 ? '+' : '') + delta + ')';
  }
  return { actual, claimed, delta, verdict };
}

/** Display text for one pair: seed name / SKU when the read-only lookup has it. */
function pairText(cpuId, gpuValue, labels, withGpuVariant) {
  const cpuText = 'CPU ' + (labels.productNames.get(cpuId) || cpuId) + ' (' + cpuId + ')';
  if (gpuValue === 'OMITTED') return cpuText + ' | GPU OMITTED (no GPU component)';
  const gpuLabel = withGpuVariant
    ? (labels.variantSkus.get(gpuValue) || gpuValue)
    : (labels.productNames.get(gpuValue) || gpuValue);
  return cpuText + ' | GPU ' + gpuLabel + ' (' + gpuValue + ')';
}

/**
 * Mixed-radix structure check over EXPANSION_ORDER. In the pure discovery
 * order the first change of a role happens at the product of the option
 * counts of the roles AFTER it. Deviations are reported factually (budget
 * pruning, pair-FAIL pruning, GPU-omit paths, the build cap) and are never
 * labelled a verdict: with 2 candidates per role the LAST roles are expected
 * to vary inside 25 builds, which does not contradict Decision 18.4.
 */
function structureRows(builds) {
  const optionCount = new Map();
  for (const role of EXPANSION_ORDER) {
    optionCount.set(role, new Set(builds.map((build) => roleValue(build, role))).size);
  }
  const rows = [];
  for (let index = 0; index < EXPANSION_ORDER.length; index += 1) {
    const role = EXPANSION_ORDER[index];
    const base = roleValue(builds[0], role);
    let firstChange = null;
    for (let buildIndex = 1; buildIndex < builds.length; buildIndex += 1) {
      if (roleValue(builds[buildIndex], role) !== base) {
        firstChange = buildIndex;
        break;
      }
    }
    let predicted = 1;
    for (let later = index + 1; later < EXPANSION_ORDER.length; later += 1) {
      predicted *= optionCount.get(EXPANSION_ORDER[later]);
    }
    const distinct = optionCount.get(role);
    let deviation;
    if (firstChange === null) {
      deviation = distinct > 1 ? 'never changes within the run' : 'single value in the run';
    } else if (firstChange < predicted) {
      deviation = 'earlier than predicted (pruning / GPU-omit shorten later chains)';
    } else if (firstChange > predicted) {
      deviation = 'later than predicted (option combinations pruned)';
    } else {
      deviation = 'matches the mixed-radix prediction';
    }
    rows.push({ role, distinct, firstChange, predicted, deviation });
  }
  return rows;
}

function scoreSpread(builds) {
  if (builds.length === 0) return null;
  const scores = builds.map((build) => build.build_score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return {
    min,
    max,
    mean: scores.reduce((sum, value) => sum + value, 0) / scores.length,
    distinct: new Set(scores.map(round2)).size,
    gap: max - min,
  };
}

function spreadText(label, spread) {
  if (spread === null) return '  ' + label + ': (no builds)';
  return '  ' + label + ': build_score min ' + spread.min.toFixed(2)
    + ' | max ' + spread.max.toFixed(2)
    + ' | mean ' + spread.mean.toFixed(2)
    + ' | distinct ' + spread.distinct
    + ' | gap ' + spread.gap.toFixed(2);
}
/**
 * Read-only display labels (seed product names / variant SKUs) for the ids that
 * appear in the measured pairs. Two seed-scoped SELECTs; no parameter, no write.
 */
async function loadPairLabels(client) {
  const products = await client.query("SELECT id, name FROM product WHERE name LIKE 'Seed %'");
  const variants = await client.query(
    "SELECT v.id, v.sku FROM product_variant v JOIN product p ON p.id = v.product_id"
    + " WHERE p.name LIKE 'Seed %'");
  return {
    productNames: new Map(products.rows.map((row) => [row.id, row.name])),
    variantSkus: new Map(variants.rows.map((row) => [row.id, row.sku])),
  };
}

/**
 * Print one run variant's top-10 (CPU, GPU) pair concentration: the Decision 20
 * section 2 pair definition first (that IS what MAX_PER_PAIR / selectDiverseTop
 * cap on), then the coarser product-keyed reading, then - for the raised-cap
 * variant only - the 10 ranked rows the histogram was built from. Returns the
 * Decision-20-definition concentration so the summary can reuse it.
 */
function printPairConcentration(useCase, capTag, ranked, labels, withListing) {
  const primary = topPairConcentration(ranked, true);
  const coarse = topPairConcentration(ranked, false);

  console.log('    top-10 (CPU, GPU) pair concentration (' + capTag + '; real rankBuilds,'
    + ' TOP_N_PERSISTED = ' + TOP_N_PERSISTED + '):');
  console.log('      ranked ' + primary.rankedCount + ' build(s); top-10 slice ' + primary.sliceSize
    + ' (rank 1..' + primary.sliceSize + '); component-list pair keys cross-checked against the'
    + ' Decision 18 signature: ' + (primary.sliceSize - primary.crossCheckMismatches) + '/'
    + primary.crossCheckTotal + ' identical');
  if (primary.crossCheckMismatches > 0) {
    console.log('      WARNING: ' + primary.crossCheckMismatches
      + ' top-10 pair key(s) disagree between the component list and the signature');
  }
  if (primary.sliceSize < TOP_N_PERSISTED) {
    console.log('      fewer than ' + TOP_N_PERSISTED + ' valid builds (' + primary.sliceSize
      + '), so the Decision 20 top-10 arithmetic below is NOT comparable');
  }
  console.log('      Decision 20 pair definition (CPU product_id, GPU product_variant_id-or-OMITTED):');
  console.log('        distinct pairs ' + primary.distinctPairs
    + ' | distinct CPU product_ids ' + primary.distinctCpus
    + ' | distinct GPU pair values ' + primary.distinctGpuValues);
  console.log('        pair counts, descending:');
  for (const row of primary.rows) {
    console.log('          ' + String(row.count).padStart(2) + ' of ' + primary.sliceSize + '  '
      + pairText(row.cpuId, row.gpuValue, labels, true));
  }

  const claims = DECISION_20_TOP10_CLAIMS[useCase] || [];
  if (claims.length === 0) {
    console.log('      Decision 20 section 1: no top-10 claim is recorded for this use case');
  } else {
    console.log('      Decision 20 section 1, as written: "' + DECISION_20_TOP10_TEXT[useCase] + '"');
    for (const claim of claims) {
      const comparison = claimComparison(claim.measure(primary), claim.claimed);
      console.log('        ' + claim.label + ': actual ' + comparison.actual
        + ' | claimed ' + comparison.claimed + ' -> ' + comparison.verdict);
    }
  }

  console.log('      coarser reading (CPU product_id, GPU product_id) - the variants of one GPU product'
    + ' merge into one pair:');
  console.log('        distinct pairs ' + coarse.distinctPairs + '; pair counts, descending:');
  for (const row of coarse.rows) {
    console.log('          ' + String(row.count).padStart(2) + ' of ' + coarse.sliceSize + '  '
      + pairText(row.cpuId, row.gpuValue, labels, false));
  }

  if (withListing) {
    console.log('      top-10 listing (rank | build_score | total_price | Decision 20 pair):');
    for (const entry of ranked.slice(0, TOP_N_PERSISTED)) {
      const parts = pairParts(entry.build, true);
      console.log('        rank ' + String(entry.rank).padStart(2)
        + ' | score ' + entry.build_score.toFixed(2)
        + ' | total ' + entry.total_price.toFixed(2)
        + ' | ' + pairText(parts.cpuId, parts.gpuValue, labels, true));
    }
  }

  return primary;
}

// ---------------------------------------------------------------------------
// Reporting (plain text; facts only).
// ---------------------------------------------------------------------------

const SUMMARY = [];

function printQueryReport(query, queryId, runs, labels) {
  const title = 'query ' + query.useCase + ' | budget ' + query.budget + ' MAD | id ' + queryId;
  console.log('');
  console.log('== ' + title);

  const record = { useCase: query.useCase, runs: [], pairConcentrations: [], rank1: null };
  for (const run of runs) {
    const builds = run.result.builds;
    const spread = scoreSpread(builds);
    console.log('');
    console.log('  ' + run.label + ': ' + builds.length + ' build(s)');
    console.log(spreadText('    scores', spread));

    const varying = [];
    if (builds.length > 0) {
      console.log('    structure (role / distinct / first-change / predicted / deviation):');
      for (const row of structureRows(builds)) {
        console.log('      ' + row.role.padEnd(13)
          + ' distinct ' + String(row.distinct).padStart(2)
          + '  first-change ' + (row.firstChange === null ? '   -' : String(row.firstChange).padStart(4))
          + '  predicted ' + String(row.predicted).padStart(6)
          + '  | ' + row.deviation);
        if (row.distinct > 1) varying.push(row.role + '(' + row.distinct + ')');
      }
    } else {
      console.log('    structure: (no builds)');
    }

    // Top-10 concentration for THIS run variant: rank the same build set the
    // structure rows above describe, with the real Decision 18 module. The
    // 10-row listing is printed for the raised-cap variant only - that is the
    // Decision-20-comparable enumeration (cap=100 in the doc, 100000 here; both
    // exhaust the seed, GAMING 113 builds / OFFICE 18).
    const rankedBuilds = rankBuilds({ builds }).ranked;
    const concentration = printPairConcentration(
      query.useCase,
      run.cap === null ? 'configured cap' : 'raised cap ' + run.cap,
      rankedBuilds,
      labels,
      run.cap !== null
    );
    record.pairConcentrations.push({ label: run.label, cap: run.cap, concentration });

    record.runs.push({ label: run.label, cap: run.cap, buildCount: builds.length, spread, varying });
  }

  const ranked = runs.map((run) => ({ run, rank1: rankBuilds({ builds: run.result.builds }).ranked[0] || null }));
  const capped = ranked[0];
  const raised = ranked[1];
  console.log('');
  console.log('  rank 1 (real Decision 18 ranking/ module):');
  if (capped.rank1 && raised.rank1) {
    const sameScore = round2(capped.rank1.build_score) === round2(raised.rank1.build_score);
    const sameSignature = capped.rank1.signature === raised.rank1.signature;
    console.log('    configured cap : score ' + capped.rank1.build_score.toFixed(2)
      + ' | total ' + capped.rank1.total_price.toFixed(2)
      + ' | signature ' + capped.rank1.signature);
    console.log('    raised cap     : score ' + raised.rank1.build_score.toFixed(2)
      + ' | total ' + raised.rank1.total_price.toFixed(2)
      + ' | signature ' + raised.rank1.signature);
    console.log('    rank 1 is ' + (sameSignature ? 'THE SAME build' : 'a DIFFERENT build')
      + ' capped vs uncapped (score ' + (sameScore ? 'equal' : 'differs') + ')');
    record.rank1 = { sameSignature, sameScore };
  } else {
    console.log('    not comparable (a run produced no builds)');
  }
  SUMMARY.push(record);
}

function printKExtrapolation(cap) {
  console.log('');
  console.log('== K=5 extrapolation (arithmetic only; the synthetic run was SKIPPED - see note)');
  for (let index = 0; index < EXPANSION_ORDER.length; index += 1) {
    const role = EXPANSION_ORDER[index];
    let predicted = 1;
    for (let later = index + 1; later < EXPANSION_ORDER.length; later += 1) predicted *= 5;
    console.log('  ' + role.padEnd(13) + ' first change at build ' + predicted
      + (predicted <= cap ? ' (within the cap)' : ' (beyond the cap)'));
  }
  console.log('  With K=5 options per role and cap 25 the only roles that can vary inside the cap are');
  console.log('  SSD_BOOT (every build) and CPU_COOLER (every 5th build); CASE changes at build 26, the');
  console.log('  first build beyond the cap. That is the shape Decision 18.4 describes (vary only');
  console.log('  CPU_COOLER and SSD_BOOT), and each additional varying role costs K times more builds.');
  console.log('  SKIPPED-RUN NOTE: the synthetic in-memory K=5 assembleBuilds run was NOT executed: its');
  console.log('  fixture builders live inside assemble.test.js / pipeline.test.js (not exported), so');
  console.log('  reusing them would have required editing existing test files. These numbers are');
  console.log('  arithmetic, not a run.');
}

function printSummary() {
  console.log('');
  console.log('== FACTUAL SUMMARY (a measurement; NOT a Decision 20 outcome)');
  for (const record of SUMMARY) {
    const capped = record.runs[0];
    const raised = record.runs[1];
    console.log('  ' + record.useCase + ': configured cap -> ' + capped.buildCount + ' build(s); raised cap -> '
      + raised.buildCount + ' build(s); rank 1 '
      + (record.rank1
        ? (record.rank1.sameSignature ? 'SAME build' : 'DIFFERENT build') + ' capped vs uncapped'
        : 'not comparable'));
    console.log('    varying roles at the configured cap: '
      + (capped.varying.length > 0 ? capped.varying.join(', ') : '(none)'));
    console.log('    varying roles at the raised cap:     '
      + (raised.varying.length > 0 ? raised.varying.join(', ') : '(none)'));
    const raisedPair = record.pairConcentrations.find((entry) => entry.cap !== null);
    if (raisedPair) {
      const c = raisedPair.concentration;
      console.log('    raised cap top-10 pairs (Decision 20 definition): ' + c.distinctPairs
        + ' distinct | largest pair ' + c.largestPairCount + ' of ' + c.sliceSize
        + ' | distinct CPU product_ids ' + c.distinctCpus
        + ' | distinct GPU pair values ' + c.distinctGpuValues);
      for (const claim of DECISION_20_TOP10_CLAIMS[record.useCase] || []) {
        const comparison = claimComparison(claim.measure(c), claim.claimed);
        console.log('    Decision 20 "' + claim.label + '": actual ' + comparison.actual
          + ' | claimed ' + comparison.claimed + ' -> ' + comparison.verdict);
      }
    }
  }
  console.log('  With 2 candidates per role on this seed, the last roles of EXPANSION_ORDER are expected');
  console.log('  to vary inside 25 builds (mixed-radix discovery order); that is not a contradiction of');
  console.log('  Decision 18.4, whose K-scaling half needs K at or below the per-role option counts - the');
  console.log('  K=5 arithmetic above stands in for it (synthetic run skipped, see its note).');
  console.log('  No Decision 20 outcome is recommended or implied by this output.');
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  const dbConfig = getWriteTestDbUrl();
  const client = new Client({
    connectionString: dbConfig.connectionString,
    connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
  });
  const insertedIds = [];
  try {
    await client.connect();
    console.log('target: test-scratch only (host: ' + hostOf(dbConfig.connectionString) + ')');
    console.log('the shared DATABASE_URL is never contacted and never printed');

    const pre = await preflight(client);
    console.log('preflight ok: ' + JSON.stringify(pre.observed)
      + ' (seed scoring_model ' + pre.scoringModelId + ')');

    const labels = await loadPairLabels(client);
    console.log('pair labels loaded (read-only): ' + labels.productNames.size + ' product name(s), '
      + labels.variantSkus.size + ' variant SKU(s)');

    insertedIds.push(...(await insertQueries(client, pre.scoringModelId)));
    console.log('inserted measurement queries: ' + insertedIds.join(', '));

    for (let index = 0; index < QUERIES.length; index += 1) {
      const runs = [];
      for (const variant of [
        { label: 'configured cap', cap: null },
        { label: 'raised cap ' + HIGH_CAP + ' (in-memory copy; DB value untouched)', cap: HIGH_CAP },
      ]) {
        const db = variant.cap === null ? client : withRaisedCap(client, variant.cap);
        const result = await runRecommendationSnapshot(db, insertedIds[index]);
        runs.push({ label: variant.label, cap: variant.cap, result });
      }
      printQueryReport(QUERIES[index], insertedIds[index], runs, labels);
    }

    printKExtrapolation(25);
    printSummary();
  } finally {
    try {
      await deleteQueries(client, insertedIds);
    } catch (cleanupError) {
      console.error('CLEANUP FAILED:', cleanupError.message, '- inserted ids were:', insertedIds.join(', '));
    }
    try {
      await client.end();
    } catch (endError) {
      void endError;
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('MEASUREMENT FAILED:', error.message);
    process.exit(1);
  }
);