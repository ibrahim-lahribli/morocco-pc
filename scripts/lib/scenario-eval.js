'use strict';

// scripts/lib/scenario-eval.js - pure golden-scenario assertion evaluators.
//
// E0 (docs/briefs/engine.md). This module is deliberately DB-free and
// side-effect-free: it receives the engine's in-memory output (already ranked and
// diversity-selected by the caller) plus two read-only lookup maps, projects a
// machine-checkable ARTIFACT, and evaluates the assertions A1-A9. The runner
// (scripts/eval-scenarios.js) owns every database concern, so this file is
// unit-testable with synthetic artifacts and can never write anything.
//
// Vocabulary (mirrors the engine, never re-invented):
//   status      PASS | FAIL | UNKNOWN - the project's status vocabulary.
//               UNKNOWN means "this assertion cannot be judged from the data"
//               and is NEVER collapsed into PASS or FAIL.
//   pair        (CPU product_id, GPU product_variant_id-or-OMITTED) - the SAME
//               pair definition selectDiverseTop caps on (ranking/select-diverse
//               pairKey): a missing GPU component is the literal 'OMITTED', a
//               GPU whose variant id is NULL is the empty string.
//   signature   the Decision 18 rankBuilds signature
//               (ROLE:product_id:variant_or_empty over EXPANSION_ORDER) - the
//               identity used for cross-scenario set comparisons, so no raw
//               float ever decides "do these two runs differ".
//
// Clock note (ENGINE_BEHAVIOR_FINDINGS_2026-10.md Table F): the engine reads
// CURRENT_TIMESTAMP once per pass and scoring decays by assessment age, so two
// passes seconds apart differ at ~1e-5. A8 compares SIGNATURE LISTS exactly and
// scores only within a tolerance (default 1e-3), never raw float equality.

const DEFAULT_SCORE_TOLERANCE = 1e-3;

/** Status vocabulary - the only three values any evaluator may return. */
const STATUSES = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN' });

// ---------------------------------------------------------------------------
// Projection (pure)
// ---------------------------------------------------------------------------

/** role -> component map for one build (last write wins; roles are unique. */
function roleMap(build) {
  const map = Object.create(null);
  for (const component of build.components) {
    map[component.component_role] = component;
  }
  return map;
}

/**
 * The Decision 20 pair key of a build: `<cpu product_id>|<gpu variant or
 * OMITTED>`. Mirrors ranking/select-diverse.js pairKey exactly. Returns null
 * only for a contract violation (no CPU component), which callers treat as
 * unmeasurable rather than as a value.
 */
function pairKeyOf(build) {
  const byRole = roleMap(build);
  const cpu = byRole.CPU;
  if (cpu === undefined || cpu === null) return null;
  const gpu = byRole.GPU;
  let gpuValue;
  if (gpu === undefined || gpu === null) {
    gpuValue = 'OMITTED';
  } else if (gpu.product_variant_id === null || gpu.product_variant_id === undefined) {
    gpuValue = '';
  } else {
    gpuValue = String(gpu.product_variant_id);
  }
  return String(cpu.product_id) + '|' + gpuValue;
}

/** The Stage 1 selected_price of one component, or null (UNKNOWN, never 0). */
function priceOf(component) {
  if (component === undefined || component === null) return null;
  const price = component.price;
  if (price === null || typeof price !== 'object') return null;
  return Number.isFinite(price.selected_price) ? price.selected_price : null;
}

/** Project one ranked/selected entry (they share the same entry shape). */
function projectEntry(entry, maps) {
  const build = entry.build;
  const byRole = roleMap(build);
  const cpu = byRole.CPU === undefined ? null : byRole.CPU;
  const gpu = byRole.GPU === undefined ? null : byRole.GPU;
  const ram = byRole.RAM === undefined ? null : byRole.RAM;
  const gpuPrice = priceOf(gpu);
  const cpuPrice = priceOf(cpu);
  const ramPrice = priceOf(ram);
  const total = Number.isFinite(entry.total_price) ? entry.total_price : build.total_price;

  let vram = null;
  if (gpu !== null && gpu.product_variant_id !== null && gpu.product_variant_id !== undefined) {
    const found = maps.vramByVariant.get(String(gpu.product_variant_id));
    vram = found === undefined ? null : found;
  }
  let igpu = null;
  if (cpu !== null) {
    const found = maps.igpuByCpu.get(String(cpu.product_id));
    igpu = found === undefined ? null : found;
  }

  return {
    signature: entry.signature,
    build_score: entry.build_score,
    total_price: total,
    compatibility_status: entry.compatibility_status,
    has_gpu: gpu !== null,
    gpu_price: gpuPrice,
    cpu_price: cpuPrice,
    ram_price: ramPrice,
    gpu_vram_gb: vram,
    cpu_integrated_gpu_present: igpu,
    pair_key: pairKeyOf(build),
  };
}

/**
 * Project one scenario's engine output. Pure: `maps` carries the two read-only
 * lookups the caller loaded (gpu variant -> vram_capacity_gb, cpu product ->
 * integrated_gpu_present).
 *
 * @param {string} id scenario id
 * @param {object} snapshot the frozen runRecommendation result
 * @param {object} rankedResult rankBuilds({ builds }) result
 * @param {object} selection selectDiverseTop({ ranked, limit, maxPerPair }) result
 * @param {object} maps { vramByVariant: Map, igpuByCpu: Map }
 */
function projectArtifact(id, snapshot, rankedResult, selection, maps) {
  const ranked = rankedResult.ranked;
  const selected = selection.selected;
  const best = ranked.length > 0 ? ranked[0] : null;
  const bestProjected = best === null ? null : projectEntry(best, maps);
  const selectedProjected = selected.map((entry) => projectEntry(entry, maps));

  const pairSet = new Set();
  for (const entry of selectedProjected) {
    if (entry.pair_key !== null) pairSet.add(entry.pair_key);
  }

  const bestGpuShare = bestProjected !== null && bestProjected.total_price > 0 && bestProjected.gpu_price !== null
    ? bestProjected.gpu_price / bestProjected.total_price
    : null;
  const bestCpuRamShare = bestProjected !== null && bestProjected.total_price > 0
    && bestProjected.cpu_price !== null && bestProjected.ram_price !== null
    ? (bestProjected.cpu_price + bestProjected.ram_price) / bestProjected.total_price
    : null;

  // A8 compares RAW scores, not the ranked entry's score. rankBuilds rounds the
  // entry's build_score to 2 dp for ordering/presentation, but the ORIGINAL
  // build object it references carries the unrounded Engine 4 value
  // (ranking/rank.js header: `build` = the Engine 3 build "by reference").
  // Comparing the rounded value reintroduces a 0.01 quantization step: a raw
  // score sitting on a .005 boundary flips its rounded value by a full 0.01
  // under a ~1e-5 clock drift, which made A8 flaky. Raw values keep the 1e-3
  // tolerance meaningful (drift only).
  const scoresBySignature = {};
  for (const entry of ranked) {
    const raw = entry.build !== null && entry.build !== undefined && Number.isFinite(entry.build.build_score)
      ? entry.build.build_score
      : entry.build_score;
    scoresBySignature[entry.signature] = raw;
  }

  return {
    scenario_id: id,
    build_count: snapshot.builds.length,
    ranked_count: ranked.length,
    ranked_signatures: ranked.map((entry) => entry.signature),
    scores_by_signature: scoresBySignature,
    best: bestProjected,
    selected: selectedProjected,
    selected_pair_count: pairSet.size,
    selected_has_reject: selectedProjected.some((entry) => entry.compatibility_status === 'REJECT'),
    best_gpu_price_share: bestGpuShare,
    best_cpu_ram_share: bestCpuRamShare,
    budget_floor: snapshot.budget_floor,
    budget_amount: snapshot.budget_amount,
    currency: snapshot.currency,
  };
}

// ---------------------------------------------------------------------------
// Result rows
// ---------------------------------------------------------------------------

function row(assertion, status, scenarioIds, measured, expected, detail) {
  return {
    assertion,
    status,
    scenario_ids: scenarioIds,
    measured,
    expected,
    detail: detail === undefined ? '' : detail,
  };
}

/** Combine sub-check statuses: any FAIL -> FAIL, else any UNKNOWN -> UNKNOWN. */
function combine(subStatuses) {
  if (subStatuses.some((s) => s === STATUSES.FAIL)) return STATUSES.FAIL;
  if (subStatuses.some((s) => s === STATUSES.UNKNOWN)) return STATUSES.UNKNOWN;
  return STATUSES.PASS;
}

function missing(get, ids) {
  return ids.some((id) => get(id) === null);
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** A1 - distinct (CPU,GPU) pairs in the SELECTED (persisted) set >= min. */
function a1(assertion, min, get) {
  const rows = [];
  for (const sid of assertion.scenarios) {
    const a = get(sid);
    const expected = '>= ' + min + ' distinct (CPU,GPU) pairs in the selected set';
    if (a === null) {
      rows.push(row('A1', STATUSES.UNKNOWN, [sid], null, expected, 'artifact missing'));
      continue;
    }
    if (a.selected.length === 0) {
      rows.push(row('A1', STATUSES.UNKNOWN, [sid], 0, expected, 'no selected builds to measure'));
      continue;
    }
    rows.push(row(
      'A1',
      a.selected_pair_count >= min ? STATUSES.PASS : STATUSES.FAIL,
      [sid],
      a.selected_pair_count,
      expected,
      'selected builds: ' + a.selected.length
    ));
  }
  return rows;
}

/** A2 - best-build price non-decreasing across a budget series, and spend >= X. */
function a2(assertion, spendMin, get) {
  const rows = [];
  for (const series of assertion.series) {
    const expected = 'best-build total_price non-decreasing across budgets; spend ratio >= ' + spendMin;
    if (missing(get, series)) {
      rows.push(row('A2', STATUSES.UNKNOWN, series, null, expected, 'artifact missing'));
      continue;
    }
    const arts = series.map((id) => get(id));
    if (arts.some((a) => a.best === null)) {
      rows.push(row('A2', STATUSES.UNKNOWN, series, null, expected, 'a budget in the series has no builds'));
      continue;
    }
    const prices = arts.map((a) => a.best.total_price);
    const ratios = arts.map((a) => (a.budget_amount > 0 ? a.best.total_price / a.budget_amount : null));
    let nonDecreasing = true;
    for (let i = 1; i < prices.length; i += 1) {
      if (!(prices[i] >= prices[i - 1])) nonDecreasing = false;
    }
    const spendOk = ratios.every((ratio) => ratio !== null && ratio >= spendMin);
    rows.push(row(
      'A2',
      nonDecreasing && spendOk ? STATUSES.PASS : STATUSES.FAIL,
      series,
      { best_total_prices: prices, spend_ratios: ratios },
      expected,
      'budgets: ' + arts.map((a) => a.budget_amount).join(' -> ')
    ));
  }
  return rows;
}

/** A3 - use-case divergence: signature overlap, GPU share band, CPU+RAM shift. */
function a3(assertion, thresholds, byId, get) {
  const maxOverlap = thresholds.A3_signature_overlap_max.value;
  const shareBand = thresholds.A3_gaming_gpu_share;
  const rows = [];
  for (const pair of assertion.pairs) {
    const gaming = get(pair.gaming);
    const workstation = get(pair.workstation);
    const ids = [pair.gaming, pair.workstation];
    const expected = 'signature overlap < ' + maxOverlap
      + '; GAMING GPU share in [' + shareBand.min + ', ' + shareBand.max + ']'
      + '; WORKSTATION CPU+RAM share > GAMING';
    if (gaming === null || workstation === null) {
      rows.push(row('A3', STATUSES.UNKNOWN, ids, null, expected, 'artifact missing'));
      continue;
    }
    const gamingSignatures = new Set(gaming.ranked_signatures);
    const workstationSignatures = new Set(workstation.ranked_signatures);
    const larger = Math.max(gamingSignatures.size, workstationSignatures.size);
    let overlap = null;
    if (larger > 0) {
      let intersection = 0;
      for (const signature of gamingSignatures) {
        if (workstationSignatures.has(signature)) intersection += 1;
      }
      overlap = intersection / larger;
    }
    const gamingGpuShare = gaming.best === null ? null : gaming.best_gpu_price_share;
    const gamingCpuRam = gaming.best === null ? null : gaming.best_cpu_ram_share;
    const workstationCpuRam = workstation.best === null ? null : workstation.best_cpu_ram_share;

    const sub = [];
    sub.push(overlap === null ? STATUSES.UNKNOWN : (overlap < maxOverlap ? STATUSES.PASS : STATUSES.FAIL));
    sub.push(gamingGpuShare === null
      ? STATUSES.UNKNOWN
      : (gamingGpuShare >= shareBand.min && gamingGpuShare <= shareBand.max ? STATUSES.PASS : STATUSES.FAIL));
    sub.push(gamingCpuRam === null || workstationCpuRam === null
      ? STATUSES.UNKNOWN
      : (workstationCpuRam > gamingCpuRam ? STATUSES.PASS : STATUSES.FAIL));

    rows.push(row(
      'A3',
      combine(sub),
      ids,
      {
        signature_overlap: overlap,
        gaming_gpu_price_share: gamingGpuShare,
        gaming_cpu_ram_share: gamingCpuRam,
        workstation_cpu_ram_share: workstationCpuRam,
      },
      expected,
      'same-budget GAMING vs WORKSTATION'
    ));
  }
  return rows;
}

/**
 * A4 - resolution divergence: top-build GPU price non-decreasing across an
 * increasing-resolution series, a strict increase for a named pair, and every
 * selected GPU meeting the resolution's VRAM floor.
 */
function a4(assertion, thresholds, byId, get) {
  const floorByResolution = thresholds.A4_vram_floor_gb.value;
  const rows = [];

  for (const series of assertion.series) {
    const expected = 'top-build GPU price non-decreasing across increasing resolution';
    if (missing(get, series)) {
      rows.push(row('A4', STATUSES.UNKNOWN, series, null, expected, 'artifact missing'));
      continue;
    }
    const arts = series.map((id) => get(id));
    if (arts.some((a) => a.best === null || a.best.gpu_price === null)) {
      rows.push(row('A4', STATUSES.UNKNOWN, series, null, expected, 'a budget in the series has no GPU-priced best build'));
      continue;
    }
    const prices = arts.map((a) => a.best.gpu_price);
    let nonDecreasing = true;
    for (let i = 1; i < prices.length; i += 1) {
      if (!(prices[i] >= prices[i - 1])) nonDecreasing = false;
    }
    rows.push(row(
      'A4',
      nonDecreasing ? STATUSES.PASS : STATUSES.FAIL,
      series,
      { best_gpu_prices: prices },
      expected,
      'resolutions: ' + series.map((id) => (byId.get(id) || {}).resolution).join(' -> ')
    ));
  }

  if (Array.isArray(assertion.strict_pair)) {
    const [low, high] = assertion.strict_pair;
    const expected = 'top-build GPU price strictly greater at the higher resolution, same budget';
    if (missing(get, [low, high])) {
      rows.push(row('A4', STATUSES.UNKNOWN, [low, high], null, expected, 'artifact missing'));
    } else {
      const a = get(low);
      const b = get(high);
      if (a.best === null || b.best === null || a.best.gpu_price === null || b.best.gpu_price === null) {
        rows.push(row('A4', STATUSES.UNKNOWN, [low, high], null, expected, 'GPU price not measurable'));
      } else {
        rows.push(row(
          'A4',
          b.best.gpu_price > a.best.gpu_price ? STATUSES.PASS : STATUSES.FAIL,
          [low, high],
          { low: a.best.gpu_price, high: b.best.gpu_price },
          expected,
          'strict pair'
        ));
      }
    }
  }

  for (const sid of assertion.vram_scenarios) {
    const a = get(sid);
    const resolution = (byId.get(sid) || {}).resolution;
    const floor = floorByResolution[resolution];
    const expected = 'every selected GPU has vram_capacity_gb >= ' + floor + ' at ' + resolution;
    if (a === null) {
      rows.push(row('A4', STATUSES.UNKNOWN, [sid], null, expected, 'artifact missing'));
      continue;
    }
    const withGpu = a.selected.filter((entry) => entry.has_gpu);
    if (withGpu.length === 0) {
      rows.push(row('A4', STATUSES.UNKNOWN, [sid], null, expected, 'no selected build carries a GPU'));
      continue;
    }
    const unknown = withGpu.some((entry) => entry.gpu_vram_gb === null);
    const tooSmall = withGpu.some((entry) => entry.gpu_vram_gb !== null && entry.gpu_vram_gb < floor);
    const status = tooSmall ? STATUSES.FAIL : (unknown ? STATUSES.UNKNOWN : STATUSES.PASS);
    rows.push(row(
      'A4',
      status,
      [sid],
      { vram_gb: withGpu.map((entry) => entry.gpu_vram_gb), floor },
      expected,
      'selected GPUs: ' + withGpu.length
    ));
  }
  return rows;
}

/** A5 - priority divergence: price-first ranks a strictly cheaper build than performance-first. */
function a5(assertion, byId, get) {
  const rows = [];
  for (const pair of assertion.pairs) {
    const low = get(pair.price_first);
    const high = get(pair.performance_first);
    const ids = [pair.price_first, pair.performance_first];
    const expected = 'rank-1 total_price at price-first < at performance-first, and signatures differ';
    if (low === null || high === null) {
      rows.push(row('A5', STATUSES.UNKNOWN, ids, null, expected, 'artifact missing'));
      continue;
    }
    if (low.best === null || high.best === null) {
      rows.push(row('A5', STATUSES.UNKNOWN, ids, null, expected, 'no ranked build'));
      continue;
    }
    const cheaper = low.best.total_price < high.best.total_price;
    const differ = low.best.signature !== high.best.signature;
    rows.push(row(
      'A5',
      cheaper && differ ? STATUSES.PASS : STATUSES.FAIL,
      ids,
      {
        price_first_total: low.best.total_price,
        performance_first_total: high.best.total_price,
        signatures_differ: differ,
      },
      expected,
      'same budget, priorities'
    ));
  }
  return rows;
}

/** A6 - OFFICE: no discrete GPU, iGPU CPU, top-build price <= ratio x reference. */
function a6(assertion, maxRatio, get) {
  const reference = get(assertion.reference);
  const referencePrice = reference !== null && reference.best !== null ? reference.best.total_price : null;
  const rows = [];
  for (const sid of assertion.scenarios) {
    const a = get(sid);
    const expected = 'no discrete GPU; CPU integrated_gpu_present = true; top price <= '
      + maxRatio + ' x ' + assertion.reference + ' top price';
    if (a === null || referencePrice === null) {
      rows.push(row('A6', STATUSES.UNKNOWN, [sid], null, expected, 'artifact or reference missing'));
      continue;
    }
    if (a.selected.length === 0 || a.best === null) {
      rows.push(row('A6', STATUSES.UNKNOWN, [sid], null, expected, 'no builds at this budget'));
      continue;
    }
    const noGpu = a.selected.every((entry) => !entry.has_gpu);
    const igpu = a.best.cpu_integrated_gpu_present;
    const ratio = a.best.total_price / referencePrice;
    const sub = [];
    sub.push(noGpu ? STATUSES.PASS : STATUSES.FAIL);
    sub.push(igpu === true ? STATUSES.PASS : (igpu === null ? STATUSES.UNKNOWN : STATUSES.FAIL));
    sub.push(ratio <= maxRatio ? STATUSES.PASS : STATUSES.FAIL);
    rows.push(row(
      'A6',
      combine(sub),
      [sid],
      { selected_builds_with_gpu: a.selected.filter((entry) => entry.has_gpu).length, cpu_integrated_gpu_present: igpu, price_ratio_vs_reference: ratio },
      expected,
      'OFFICE iGPU path'
    ));
  }
  return rows;
}

/** A7 - below floor: zero builds, budget_floor present, within_budget as expected. */
function a7(assertion, get) {
  const rows = [];
  for (const testCase of assertion.cases) {
    const a = get(testCase.scenario);
    const expected = 'zero builds; budget_floor present; within_budget === ' + testCase.within_budget;
    if (a === null) {
      rows.push(row('A7', STATUSES.UNKNOWN, [testCase.scenario], null, expected, 'artifact missing'));
      continue;
    }
    const hasFloor = a.budget_floor !== null && a.budget_floor !== undefined && typeof a.budget_floor === 'object';
    const within = hasFloor ? a.budget_floor.within_budget : null;
    const sub = [];
    sub.push(a.build_count === 0 ? STATUSES.PASS : STATUSES.FAIL);
    sub.push(hasFloor ? STATUSES.PASS : STATUSES.FAIL);
    sub.push(within === null ? STATUSES.UNKNOWN : (within === testCase.within_budget ? STATUSES.PASS : STATUSES.FAIL));
    rows.push(row(
      'A7',
      combine(sub),
      [testCase.scenario],
      { build_count: a.build_count, cheapest_total: hasFloor ? a.budget_floor.cheapest_total : null, within_budget: within },
      expected,
      'Decision 27 budget_floor'
    ));
  }
  return rows;
}

/** A8 - determinism: identical signature lists, scores within tolerance. */
function a8(assertion, tolerance, get, getSecond) {
  const rows = [];
  for (const sid of assertion.scenarios) {
    const first = get(sid);
    const second = getSecond(sid);
    const expected = 'identical signature lists and build_scores within ' + tolerance;
    if (first === null || second === null) {
      rows.push(row('A8', STATUSES.UNKNOWN, [sid], null, expected, 'artifact missing'));
      continue;
    }
    const listsEqual = first.ranked_signatures.length === second.ranked_signatures.length
      && first.ranked_signatures.every((signature, index) => signature === second.ranked_signatures[index]);
    if (!listsEqual) {
      rows.push(row('A8', STATUSES.FAIL, [sid],
        { first: first.ranked_signatures.length, second: second.ranked_signatures.length },
        expected, 'signature lists differ (order-sensitive)'));
      continue;
    }
    let maxDelta = 0;
    let measured = true;
    for (const signature of first.ranked_signatures) {
      const a = first.scores_by_signature[signature];
      const b = second.scores_by_signature[signature];
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        measured = false;
        break;
      }
      maxDelta = Math.max(maxDelta, Math.abs(a - b));
    }
    const status = !measured ? STATUSES.UNKNOWN : (maxDelta <= tolerance ? STATUSES.PASS : STATUSES.FAIL);
    rows.push(row('A8', status, [sid],
      { ranked_count: first.ranked_signatures.length, max_score_delta: measured ? maxDelta : null },
      expected, 'two consecutive no-write passes'));
  }
  return rows;
}

/** A9 - safety: no selected build is REJECT; external PI-1 result when provided. */
function a9(assertion, get, pi1) {
  const rows = [];
  for (const sid of assertion.scenarios) {
    const a = get(sid);
    const expected = 'no selected build has compatibility_status = REJECT';
    if (a === null) {
      rows.push(row('A9', STATUSES.UNKNOWN, [sid], null, expected, 'artifact missing'));
      continue;
    }
    rows.push(row(
      'A9',
      a.selected_has_reject ? STATUSES.FAIL : STATUSES.PASS,
      [sid],
      { selected_builds: a.selected.length, rejected: a.selected_has_reject },
      expected,
      'selected-set status'
    ));
  }
  const pi1Expected = 'npm run verify:pi1 passes (Decision 23 criterion 3)';
  if (pi1 === null || pi1 === undefined) {
    rows.push(row('A9', STATUSES.UNKNOWN, [], null, pi1Expected, 'not run (pass --with-pi1)'));
  } else {
    rows.push(row('A9', pi1.status === 'PASS' ? STATUSES.PASS : STATUSES.FAIL, [], { exit_code: pi1.code }, pi1Expected, 'spawned verify-pool-independence.js'));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

function summarize(results) {
  const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
  for (const result of results) counts[result.status] += 1;
  return {
    total: results.length,
    pass: counts.PASS,
    fail: counts.FAIL,
    unknown: counts.UNKNOWN,
    exit_ok: counts.FAIL === 0,
  };
}

/**
 * Evaluate the whole suite. Pure.
 *
 * @param {object} suite { scenarios, thresholds, assertions }
 * @param {Map<string, object>} artifacts first-pass projections
 * @param {Map<string, object>} artifactsSecond second-pass projections (A8)
 * @param {object|null} pi1 { status, code } from the caller, or null
 */
function evaluateSuite({ suite, artifacts, artifactsSecond, pi1 }) {
  const byId = new Map(suite.scenarios.map((scenario) => [scenario.id, scenario]));
  const get = (id) => (artifacts.has(id) ? artifacts.get(id) : null);
  const getSecond = (id) => (artifactsSecond.has(id) ? artifactsSecond.get(id) : null);
  const thresholds = suite.thresholds;
  const results = [];

  for (const assertion of suite.assertions) {
    switch (assertion.type) {
      case 'min_distinct_cpu_gpu_pairs':
        results.push(...a1(assertion, thresholds.A1_min_distinct_pairs.value, get));
        break;
      case 'budget_response':
        results.push(...a2(assertion, thresholds.A2_spend_ratio_min.value, get));
        break;
      case 'use_case_divergence':
        results.push(...a3(assertion, thresholds, byId, get));
        break;
      case 'resolution_divergence':
        results.push(...a4(assertion, thresholds, byId, get));
        break;
      case 'priority_divergence':
        results.push(...a5(assertion, byId, get));
        break;
      case 'office_igpu':
        results.push(...a6(assertion, thresholds.A6_office_price_ratio_max.value, get));
        break;
      case 'below_floor':
        results.push(...a7(assertion, get));
        break;
      case 'determinism':
        results.push(...a8(assertion, thresholds.A8_score_tolerance.value, get, getSecond));
        break;
      case 'safety':
        results.push(...a9(assertion, get, pi1));
        break;
      default:
        throw new Error('scenario-eval: unknown assertion type "' + assertion.type + '"');
    }
  }

  return { results, summary: summarize(results) };
}

module.exports = {
  STATUSES,
  DEFAULT_SCORE_TOLERANCE,
  pairKeyOf,
  projectEntry,
  projectArtifact,
  evaluateSuite,
  summarize,
};
