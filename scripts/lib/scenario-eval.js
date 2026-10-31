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

// Expectation statuses (docs/briefs/engine.md E0 fixes; the "manifest design").
// Each ASSERTION entry in scenarios.json declares how its outcome is expected to
// be judged:
//   hypothesis  DEFAULT; an UNREVIEWED expectation. A failing check reports
//               EXPECTED-RED and does NOT fail the run - the point is to record a
//               believed-but-unproven target without turning CI red.
//   approved    a human-reviewed expectation. Requires `reviewer` and
//               `reviewed_on`; a failing check is a HARD FAIL (exit 1).
//   waived      a reviewed expectation whose failure is accepted. Requires
//               `reviewer`, `reviewed_on` AND `reason`; a failing check reports
//               WAIVED and does not fail the run.
// An approved/waived entry missing its required fields makes the evaluator THROW
// (fail fast) rather than silently degrade to lenient.
//
// Disposition - what a row MEANS, as distinct from its raw status:
//   PASS | EXPECTED-RED | FAIL | WAIVED | UNKNOWN
// A raw FAIL becomes EXPECTED-RED (hypothesis), WAIVED, or stays FAIL (approved);
// a raw UNKNOWN is escalated to a HARD FAIL when the row's scenario expects
// builds and that epic has LANDED (see `expect_builds_after`) - ANY UNKNOWN, not
// only an empty build set, because a landed epic means the harness should be able
// to judge the row.

const DEFAULT_SCORE_TOLERANCE = 1e-3;

/** Status vocabulary - the only three values any evaluator may return. */
const STATUSES = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN' });

/** Expectation statuses (the manifest design). */
const EXPECTATION_STATUSES = Object.freeze({
  HYPOTHESIS: 'hypothesis',
  APPROVED: 'approved',
  WAIVED: 'waived',
});

/** Result dispositions - what a row means once its expectation is applied. */
const DISPOSITIONS = Object.freeze({
  PASS: 'PASS',
  EXPECTED_RED: 'EXPECTED-RED',
  FAIL: 'FAIL',
  WAIVED: 'WAIVED',
  UNKNOWN: 'UNKNOWN',
});

// ---------------------------------------------------------------------------
// Expectations (the manifest design)
// ---------------------------------------------------------------------------

/** "E6" -> 6. Throws on a malformed epic label so a typo never disables a gate. */
function epicIndex(epic) {
  const match = /^E(\d+)$/.exec(String(epic));
  if (match === null) {
    throw new Error('scenario-eval: epic label must look like "E6", got ' + JSON.stringify(epic));
  }
  return Number(match[1]);
}

/**
 * Validate one assertion's expectation. Pure; THROWS on a malformed entry.
 * A missing status defaults to hypothesis (unreviewed).
 */
function validateExpectation(entry, path) {
  const source = entry === undefined || entry === null ? {} : entry;
  const status = source.status === undefined ? EXPECTATION_STATUSES.HYPOTHESIS : source.status;
  if (
    status !== EXPECTATION_STATUSES.HYPOTHESIS
    && status !== EXPECTATION_STATUSES.APPROVED
    && status !== EXPECTATION_STATUSES.WAIVED
  ) {
    throw new Error('scenario-eval: ' + path + ' has unknown expectation status ' + JSON.stringify(status));
  }
  const normalized = { status };
  if (status === EXPECTATION_STATUSES.APPROVED || status === EXPECTATION_STATUSES.WAIVED) {
    if (typeof source.reviewer !== 'string' || source.reviewer.trim() === '') {
      throw new Error('scenario-eval: ' + path + ' is "' + status + '" and requires a non-empty "reviewer"');
    }
    if (typeof source.reviewed_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.reviewed_on)) {
      throw new Error('scenario-eval: ' + path + ' is "' + status + '" and requires "reviewed_on" (YYYY-MM-DD)');
    }
    normalized.reviewer = source.reviewer;
    normalized.reviewed_on = source.reviewed_on;
  }
  if (status === EXPECTATION_STATUSES.WAIVED) {
    if (typeof source.reason !== 'string' || source.reason.trim() === '') {
      throw new Error('scenario-eval: ' + path + ' is "waived" and requires a non-empty "reason"');
    }
    normalized.reason = source.reason;
  }
  return normalized;
}

/**
 * Decision 58 follow-up: a pin-scoped assertion applies ONLY to its own model
 * pin, and REPLACES an unscoped assertion with the same id for that run. That
 * is what lets two pins carry separate approved expectations (the A10 strategy
 * order) without double-emitting rows, and without dropping the assertion on
 * every other pin. A malformed pin is refused rather than matching nothing.
 */
function assertionApplies(assertion, modelPin) {
  if (assertion.model_pin === undefined) return true;
  if (typeof assertion.model_pin !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(assertion.model_pin)) {
    throw new Error('scenario-eval: assertion[' + assertion.id + '] has a malformed "model_pin" '
      + JSON.stringify(assertion.model_pin) + ' (expected "name@version")');
  }
  return modelPin !== undefined && modelPin !== null && assertion.model_pin === modelPin;
}

/**
 * A scenario's builds are expected once the epic named by `expect_builds_after`
 * has LANDED, i.e. `current_epic >= that label`. Before then an UNKNOWN outcome
 * is pending; once the epic lands, ANY UNKNOWN row for that scenario escalates to
 * a HARD FAIL - the check is NOT limited to an empty build set.
 */
function scenarioExpectsBuilds(scenario, currentEpicIndex) {
  if (scenario === undefined || scenario === null || scenario.expect_builds_after === undefined) return false;
  return currentEpicIndex >= epicIndex(scenario.expect_builds_after);
}

/**
 * If a row is UNKNOWN and one of its scenarios expects builds whose epic has
 * LANDED (`expect_builds_after` reached), return that scenario id - the row
 * escalates to a hard FAIL. ANY MEASURED UNKNOWN escalates once the epic has
 * landed; the check is deliberately NOT limited to `build_count === 0`, because
 * a row can be UNKNOWN for reasons other than an empty build set (e.g. no
 * selected build carries a GPU) and a landed epic means the harness should be
 * able to judge it.
 *
 * A row marked `unmeasured` (see UNMEASURED) never escalates: it is UNKNOWN
 * because an artifact it needs was not produced in this invocation, which is
 * what `--filter` does by construction. Escalating it would make every narrowed
 * run exit 1 once the epic pointer landed, while saying nothing about the
 * scenarios that DID run.
 */
function rowEscalation(result, scenarioById, currentEpicIndex) {
  if (result.unmeasured === true) return null;
  for (const sid of result.scenario_ids) {
    if (scenarioExpectsBuilds(scenarioById.get(sid), currentEpicIndex)) return sid;
  }
  return null;
}

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

/**
 * A price SHARE (numerator / total). A genuinely absent numerator (no such
 * component, or no price) is undefined and returns null. A non-positive or
 * non-finite total with a real numerator is a BUILD INVARIANT VIOLATION and
 * THROWS: the unit tests pin that a zero-total build errors rather than
dividing by zero (a NaN/Infinity share would silently poison every assertion).
 */
function shareOf(numerator, total, label, scenarioId) {
  if (numerator === null) return null;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('scenario-eval: ' + label + ' needs a positive finite total_price, got '
      + total + ' for ' + scenarioId);
  }
  return numerator / total;
}

/** Project one ranked/selected entry (they share the same entry shape). */
/** Project one run entry into the shared artifact shape (E4: archetypes, legacy selectDiverseTop: selected[]). */
function projectArtifactEntry(entry, maps) {
  return projectEntry(entry, maps);
}

function projectEntry(entry, maps) {
  const build = entry.build;
  const byRole = roleMap(build);
  const cpu = byRole.CPU === undefined ? null : byRole.CPU;
  const gpu = byRole.GPU === undefined ? null : byRole.GPU;
  const ram = byRole.RAM === undefined ? null : byRole.RAM;
  const cooler = byRole.CPU_COOLER === undefined ? null : byRole.CPU_COOLER;
  const nameOf = (component) => component === null || maps.productNames === undefined
    ? null : (maps.productNames.get(String(component.product_id)) ?? null);
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
    cpu_name: nameOf(cpu),
    gpu_name: nameOf(gpu),
    cooler_name: nameOf(cooler),
    cooler_price: priceOf(cooler),
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
 * @param {object} selection selectArchetypes({ ranked, budget, priority }) result (E4)
 * @param {object} maps { vramByVariant: Map, igpuByCpu: Map }
 */
function projectArtifact(id, snapshot, rankedResult, selection, maps) {
  const ranked = rankedResult.ranked;
  // E4 (Decision 41): `selection.archetypes` is the new pre-persistence
  // showcase. Its entries already carry every component price/role, so the
  // A3 A4 A5 and pair assertions can read `selected` straight off the
  // archetypes (this function is shared by the old selectDiverseTop path,
  // which still emits `{ selected: [...] }` — selection.selected stays
  // consumable here without duplicating the projector).
  const selected = Array.isArray(selection.archetypes)
    ? selection.archetypes
    : (selection.selected || []);
  const best = ranked.length > 0 ? ranked[0] : null;
  const bestProjected = best === null ? null : projectEntry(best, maps);
  const selectedProjected = selected.map((entry) => projectArtifactEntry(entry, maps));

  const pairSet = new Set();
  for (const entry of selectedProjected) {
    if (entry.pair_key !== null) pairSet.add(entry.pair_key);
  }

  // A3: rank-1 GPU selected_price / build total_price (the rank-1 of interest is
  // the BALANCED archetype after E4; today rank-1 is simply the top-ranked
  // build). Both shares THROW on a non-positive total rather than dividing by
  // zero, and return null when the numerator is genuinely absent (no GPU / no
  // price).
  const bestGpuShare = bestProjected === null
    ? null
    : shareOf(bestProjected.gpu_price, bestProjected.total_price, 'rank-1 GPU price share', id);
  const bestCpuRamShare = bestProjected === null || bestProjected.cpu_price === null || bestProjected.ram_price === null
    ? null
    : shareOf(
      bestProjected.cpu_price + bestProjected.ram_price,
      bestProjected.total_price,
      'rank-1 CPU+RAM price share',
      id
    );

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

  // A2 (OG-59): the ceiling a budget can actually SPEND here - the largest
  // total_price among the RANKED entries `best` is drawn from, so rankBuilds
  // applies round2 once and the ratio cannot drift against its own numerator.
  // Math.max() on an empty list is -Infinity, hence the explicit null.
  const rankedPrices = ranked
    .map((entry) => entry.total_price)
    .filter((price) => Number.isFinite(price));
  const maxTotalPrice = rankedPrices.length === 0 ? null : Math.max(...rankedPrices);

  return {
    scenario_id: id,
    build_count: snapshot.builds.length,
    ranked_count: ranked.length,
    ranked_signatures: ranked.map((entry) => entry.signature),
    scores_by_signature: scoresBySignature,
    best: bestProjected,
    max_total_price: maxTotalPrice,
    selected: selectedProjected,
    selected_pair_count: pairSet.size,
    // E4: the strategies the selection actually returned (output order) and
    // its degradation codes, for the A10 archetype assertions.
    archetype_strategies: selected.map((archetype) => archetype.strategy_key),
    archetype_reason_codes: Array.isArray(selection.reason_codes) ? selection.reason_codes : [],
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

function row(assertion, status, scenarioIds, measured, expected, detail, flags) {
  const result = {
    assertion,
    status,
    scenario_ids: scenarioIds,
    measured,
    expected,
    detail: detail === undefined ? '' : detail,
  };
  if (flags !== undefined && flags.unmeasured === true) result.unmeasured = true;
  return result;
}

/**
 * The flag that marks a row this run could not MEASURE because an artifact it
 * needs was never produced - as opposed to a row that was measured and came
 * back inconclusive. Two causes, both structural: the scenario itself was
 * filtered out of the invocation, or a scenario the assertion COMPARES against
 * (A6's reference, A4/A5's pair) was. Such a row stays UNKNOWN and is never
 * escalated to a hard FAIL, so `--filter=S06,S17,S18` reports the rows it can
 * measure and does not turn its own missing inputs into RED.
 */
const UNMEASURED = Object.freeze({ unmeasured: true });

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
      rows.push(row('A1', STATUSES.UNKNOWN, [sid], null, expected, 'artifact missing', UNMEASURED));
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
    const expected = 'best-build total_price non-decreasing across budgets; best/priciest-assembled ratio >= ' + spendMin;
    if (missing(get, series)) {
      rows.push(row('A2', STATUSES.UNKNOWN, series, null, expected, 'artifact missing', UNMEASURED));
      continue;
    }
    const arts = series.map((id) => get(id));
    if (arts.some((a) => a.best === null)) {
      rows.push(row('A2', STATUSES.UNKNOWN, series, null, expected, 'a budget in the series has no builds'));
      continue;
    }
    const prices = arts.map((a) => a.best.total_price);
    // OG-59: the denominator is what the catalog can ASSEMBLE at this budget
    // (the priciest ranked build), never the budget the caller asked for.
    // `build_score` carries no budget term, so "the top-scoring build is not
    // the most expensive one" is the engine working as designed; dividing by
    // the request measured that design instead of the recommendation.
    const ceilings = arts.map((a) => a.max_total_price);
    const budgetRatios = arts.map((a) => (a.budget_amount > 0 ? a.best.total_price / a.budget_amount : null));
    let nonDecreasing = true;
    for (let i = 1; i < prices.length; i += 1) {
      if (!(prices[i] >= prices[i - 1])) nonDecreasing = false;
    }
    // A price REGRESSION keeps its own verdict: checking it first stops a
    // healthy ratio from masking a build that got cheaper at a higher budget.
    if (!nonDecreasing) {
      rows.push(row(
        'A2',
        STATUSES.FAIL,
        series,
        { best_total_prices: prices, priciest_total_prices: ceilings, budget_ratios: budgetRatios },
        expected,
        'best-build price DECREASED across budgets'
      ));
      continue;
    }
    // No ceiling means there is nothing to measure against - UNKNOWN, never a
    // divide by zero and never a PASS.
    if (!ceilings.every((ceiling) => Number.isFinite(ceiling) && ceiling > 0)) {
      rows.push(row('A2', STATUSES.UNKNOWN, series, null, expected, 'a budget in the series has no builds'));
      continue;
    }
    const ratios = arts.map((a, i) => a.best.total_price / ceilings[i]);
    const spendOk = ratios.every((ratio) => Number.isFinite(ratio) && ratio >= spendMin);
    rows.push(row(
      'A2',
      spendOk ? STATUSES.PASS : STATUSES.FAIL,
      series,
      { best_total_prices: prices, priciest_total_prices: ceilings, ceiling_ratios: ratios, budget_ratios: budgetRatios },
      expected,
      'budgets: ' + arts.map((a) => a.budget_amount).join(' -> ')
      + '; ceilings: ' + ceilings.join(' -> ')
    ));
  }
  return rows;
}

/**
 * A2b - GPU price GROWTH with budget: at the same use_case / resolution /
 * priority the rank-1 GPU price at the higher budget must be at least
 * `growthMin` x the rank-1 GPU price at the lower budget. Only the budget
 * differs, so a flat GPU price across budgets FAILs (this is the shape OG-38
 * describes). A missing GPU price on either side is UNKNOWN, never a FAIL.
 */
function a2b(assertion, growthMin, get) {
  const rows = [];
  for (const pair of assertion.pairs) {
    const low = get(pair.low);
    const high = get(pair.high);
    const ids = [pair.low, pair.high];
    const expected = 'rank-1 GPU price at ' + pair.high + ' >= ' + growthMin + ' x at ' + pair.low
      + ' (same use_case/resolution/priority)';
    if (low === null || high === null) {
      rows.push(row('A2b', STATUSES.UNKNOWN, ids, null, expected, 'artifact missing', UNMEASURED));
      continue;
    }
    if (low.best === null || high.best === null || low.best.gpu_price === null || high.best.gpu_price === null) {
      rows.push(row('A2b', STATUSES.UNKNOWN, ids, null, expected, 'rank-1 GPU price not measurable'));
      continue;
    }
    const lowPrice = low.best.gpu_price;
    const highPrice = high.best.gpu_price;
    const ratio = lowPrice > 0 ? highPrice / lowPrice : null;
    const ok = lowPrice > 0 && highPrice >= growthMin * lowPrice;
    rows.push(row(
      'A2b',
      ok ? STATUSES.PASS : STATUSES.FAIL,
      ids,
      { low_gpu_price: lowPrice, high_gpu_price: highPrice, ratio },
      expected,
      'budgets ' + low.budget_amount + ' -> ' + high.budget_amount
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
      rows.push(row('A3', STATUSES.UNKNOWN, ids, null, expected, 'artifact missing', UNMEASURED));
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
      rows.push(row('A4', STATUSES.UNKNOWN, series, null, expected, 'artifact missing', UNMEASURED));
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
      rows.push(row('A4', STATUSES.UNKNOWN, [low, high], null, expected, 'artifact missing', UNMEASURED));
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
      rows.push(row('A4', STATUSES.UNKNOWN, [sid], null, expected, 'artifact missing', UNMEASURED));
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

/**
 * The rank-1 build of an artifact: the FIRST archetype in output order.
 *
 * E4 (Decision 41) made `priority` an OUTPUT ordering: selectArchetypes returns
 * BALANCED first at priority 3, VALUE first at 1-2 and PERFORMANCE first at 4-5.
 * `best` is ranked[0] (highest build_score), which priority never touches, so an
 * assertion that claims to test priority must read `selected[0]`. Before
 * 2026-10-24 A5 read `best` and therefore measured the same build for priority 1
 * and 5 in every pair - it could not pass whatever the engine did (deviation
 * recorded in test/golden/CHANGELOG.md).
 */
function topSelected(artifact) {
  if (artifact === null || artifact === undefined) return null;
  const selected = Array.isArray(artifact.selected) ? artifact.selected : [];
  return selected.length === 0 ? null : selected[0];
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
      rows.push(row('A5', STATUSES.UNKNOWN, ids, null, expected, 'artifact missing', UNMEASURED));
      continue;
    }
    const lowTop = topSelected(low);
    const highTop = topSelected(high);
    if (lowTop === null || highTop === null) {
      rows.push(row('A5', STATUSES.UNKNOWN, ids, null, expected, 'no archetype selected'));
      continue;
    }
    const cheaper = lowTop.total_price < highTop.total_price;
    const differ = lowTop.signature !== highTop.signature;
    rows.push(row(
      'A5',
      cheaper && differ ? STATUSES.PASS : STATUSES.FAIL,
      ids,
      {
        price_first_total: lowTop.total_price,
        performance_first_total: highTop.total_price,
        signatures_differ: differ,
      },
      expected,
      'same budget, priorities'
    ));
  }
  return rows;
}

/**
 * A6 - OFFICE: no discrete GPU, iGPU CPU, top-build price <= ratio x reference.
 *
 * Every clause reads the SAME build: the rank-1 archetype (`selected[0]`), the
 * recommendation the OFFICE query actually leads with. Before 2026-10-24 the
 * "no discrete GPU" clause scanned `selected` while the CPU and price clauses
 * read `best` (ranked[0]) - two different builds wearing one row's decision, so
 * a GPU-less recommendation could still FAIL on a rank-1 entry that was never
 * assessed for the iGPU clause (deviation recorded in test/golden/CHANGELOG.md).
 * "no discrete GPU" is the one clause that must stay suite-wide: a single
 * GPU-bearing entry in the recommended set is a failure even if the top one is
 * GPU-less.
 */
function a6(assertion, maxRatio, get) {
  const referenceTop = topSelected(get(assertion.reference));
  const referencePrice = referenceTop === null ? null : referenceTop.total_price;
  const rows = [];
  for (const sid of assertion.scenarios) {
    const a = get(sid);
    const expected = 'no discrete GPU; rank-1 CPU integrated_gpu_present = true; rank-1 price <= '
      + maxRatio + ' x ' + assertion.reference + ' rank-1 price';
    if (a === null || referencePrice === null) {
      rows.push(row('A6', STATUSES.UNKNOWN, [sid], null, expected, 'artifact or reference missing', UNMEASURED));
      continue;
    }
    const top = topSelected(a);
    if (top === null) {
      rows.push(row('A6', STATUSES.UNKNOWN, [sid], null, expected, 'no builds at this budget'));
      continue;
    }
    const noGpu = a.selected.every((entry) => !entry.has_gpu);
    const igpu = top.cpu_integrated_gpu_present;
    const ratio = top.total_price / referencePrice;
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

/**
 * A7 - below floor, corrected to the engine's Decision 27 semantics (no
 * hard-coded expectation): when a scenario assembles ZERO builds, its
 * `budget_floor` must be present and `within_budget` must equal
 * `(budget >= cheapest_total)` - read from the engine AT RUN TIME. Both branches
 * are covered: a budget above the floor (within_budget true, still zero builds
 * because the floor is a lower bound, not a build) and one below it (false).
 */
function a7(assertion, get) {
  const rows = [];
  for (const testCase of assertion.cases) {
    const sid = testCase.scenario;
    const a = get(sid);
    if (a === null) {
      rows.push(row('A7', STATUSES.UNKNOWN, [sid], null,
        'zero builds; budget_floor present; within_budget === (budget >= cheapest_total)', 'artifact missing', UNMEASURED));
      continue;
    }
    const hasFloor = a.budget_floor !== null && a.budget_floor !== undefined && typeof a.budget_floor === 'object';
    const cheapest = hasFloor ? a.budget_floor.cheapest_total : null;
    const within = hasFloor ? a.budget_floor.within_budget : null;
    const budget = a.budget_amount;
    const expectedWithin = Number.isFinite(cheapest) && Number.isFinite(budget) ? budget >= cheapest : null;
    const sub = [];
    sub.push(a.build_count === 0 ? STATUSES.PASS : STATUSES.FAIL);
    sub.push(hasFloor && Number.isFinite(cheapest) ? STATUSES.PASS : STATUSES.FAIL);
    sub.push(
      expectedWithin === null || within === null
        ? STATUSES.UNKNOWN
        : (within === expectedWithin ? STATUSES.PASS : STATUSES.FAIL)
    );
    rows.push(row(
      'A7',
      combine(sub),
      [sid],
      {
        build_count: a.build_count,
        budget,
        cheapest_total: cheapest,
        within_budget: within,
        expected_within_budget: expectedWithin,
      },
      'zero builds; budget_floor present; within_budget === (budget >= cheapest_total)',
      'Decision 27 budget_floor; expectation computed at run time'
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
      rows.push(row('A8', STATUSES.UNKNOWN, [sid], null, expected, 'artifact missing', UNMEASURED));
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
      rows.push(row('A9', STATUSES.UNKNOWN, [sid], null, expected, 'artifact missing', UNMEASURED));
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
  const dispositions = { PASS: 0, 'EXPECTED-RED': 0, FAIL: 0, WAIVED: 0, UNKNOWN: 0 };
  for (const result of results) {
    counts[result.status] += 1;
    dispositions[result.disposition] += 1;
  }
  return {
    total: results.length,
    pass: counts.PASS,
    fail: counts.FAIL,
    unknown: counts.UNKNOWN,
    disposition_pass: dispositions.PASS,
    expected_red: dispositions['EXPECTED-RED'],
    hard_fail: dispositions.FAIL,
    waived: dispositions.WAIVED,
    disposition_unknown: dispositions.UNKNOWN,
    exit_ok: dispositions.FAIL === 0,
  };
}

/**
 * A10 - E4 archetypes: exactly the expected strategy triple in expected order;
 * optional max_answerable check (archetype count) and reason-code sanity.
 * Pure.
 */
function a10(assertion, get) {
  const rows = [];
  for (const scenario of assertion.scenarios) {
    const sid = scenario.id;
    const a = get(sid);
    const expected = 'archetype strategies exactly ' + JSON.stringify(scenario.expected_strategies)
      + ' in output order, distinct pairs, and no UNKNOWN degradation codes';
    if (a === null) {
      rows.push(row('A10', STATUSES.UNKNOWN, [sid], null, expected, 'artifact missing', UNMEASURED));
      continue;
    }
    const measured = a.archetype_strategies;
    const orderOk = JSON.stringify(measured) === JSON.stringify(scenario.expected_strategies);
    // Archetypes must be pairwise pair-distinct (the E4 contract).
    const pairKeys = a.selected.map((entry) => entry.pair_key).filter((k) => k !== null);
    const distinctOk = new Set(pairKeys).size === pairKeys.length;
    // Reason codes present but EMPTY_RANKED means the scenario has nothing,
    // else every degradation code must be one of the three NO_<STRATEGY>_CANDIDATE
    // codes (the honest shortfall). Spelling the vocabulary out rather than
    // matching /^NO_[A-Z]+$/ matters: E4's codes carry an underscore
    // (NO_VALUE_CANDIDATE), which the old pattern rejected, so every real
    // degradation FAILed A10 until 2026-10-24.
    const codesOk = a.archetype_reason_codes.every((code) => code === 'EMPTY_RANKED'
      || /^NO_(PERFORMANCE|BALANCED|VALUE)_CANDIDATE$/.test(code));
    rows.push(row(
      'A10',
      orderOk && distinctOk && codesOk ? STATUSES.PASS : STATUSES.FAIL,
      [sid],
      {
        strategies: measured,
        reason_codes: a.archetype_reason_codes,
        distinct_pairs: new Set(pairKeys).size,
      },
      expected,
      'E4 selectArchetypes output'
    ));
  }
  return rows;
}

/**
 * Evaluate the whole suite. Pure.
 *
 * @param {object} suite { scenarios, thresholds, assertions }
 * @param {Map<string, object>} artifacts first-pass projections
 * @param {Map<string, object>} artifactsSecond second-pass projections (A8)
 * @param {object|null} pi1 { status, code } from the caller, or null
 * @param {string} [modelPin] the resolved `name@version` this run measures;
 *        required to apply a pin-scoped assertion (Decision 58 follow-up)
 */
function evaluateSuite({ suite, artifacts, artifactsSecond, pi1, modelPin }) {
  const byId = new Map(suite.scenarios.map((scenario) => [scenario.id, scenario]));
  const get = (id) => (artifacts.has(id) ? artifacts.get(id) : null);
  const getSecond = (id) => (artifactsSecond.has(id) ? artifactsSecond.get(id) : null);
  const thresholds = suite.thresholds === undefined || suite.thresholds === null ? {} : suite.thresholds;
  const results = [];

  // Validate every THRESHOLD entry's expectation up front, on the same contract
  // as assertions (item 2c): a status must be one of hypothesis/approved/waived,
  // and an approved/waived entry must carry its reviewer/reviewed_on (and reason
  // when waived), or the evaluator THROWS rather than running lenient.
  for (const key of Object.keys(thresholds)) {
    const entry = thresholds[key];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || entry.status === undefined) {
      throw new Error('scenario-eval: threshold[' + key + '] requires an explicit expectation status');
    }
    validateExpectation(entry, 'threshold[' + key + ']');
  }

  // Validate every assertion's expectation up front - INCLUDING a pin-scoped
  // entry this run will not use - so a malformed approval fails fast instead of
  // sitting dormant until someone pins that model.
  const expectationByAssertionObject = new Map();
  for (const assertion of suite.assertions) {
    expectationByAssertionObject.set(
      assertion,
      validateExpectation(assertion, 'assertion[' + assertion.id + ']')
    );
  }

  // A pin-scoped assertion REPLACES the unscoped assertion with the same id on
  // its own pin (Decision 58 follow-up): exactly one row per assertion per run,
  // judged by that pin's own approved expectation.
  const applicable = suite.assertions.filter((assertion) => assertionApplies(assertion, modelPin));
  const pinnedIds = new Set(applicable
    .filter((assertion) => assertion.model_pin !== undefined)
    .map((assertion) => assertion.id));
  const runAssertions = applicable.filter(
    (assertion) => assertion.model_pin !== undefined || !pinnedIds.has(assertion.id)
  );
  const expectationByAssertion = new Map();
  for (const assertion of runAssertions) {
    expectationByAssertion.set(assertion.id, expectationByAssertionObject.get(assertion));
  }

  for (const assertion of runAssertions) {
    switch (assertion.type) {
      case 'min_distinct_cpu_gpu_pairs':
        results.push(...a1(assertion, thresholds.A1_min_distinct_pairs.value, get));
        break;
      case 'budget_response':
        results.push(...a2(assertion, thresholds.A2_spend_ratio_min.value, get));
        break;
      case 'gpu_price_growth':
        results.push(...a2b(assertion, thresholds.A2b_gpu_price_growth_min.value, get));
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
      case 'archetype_strategies':
        results.push(...a10(assertion, get));
        break;
      default:
        throw new Error('scenario-eval: unknown assertion type "' + assertion.type + '"');
    }
  }

  // Apply expectations: turn each raw status into a disposition. A FAIL is a
  // HARD FAIL only for an `approved` expectation; a hypothesis FAIL is
  // EXPECTED-RED and does not fail the run. An UNKNOWN escalates to a HARD FAIL
  // when its scenario is expected to produce builds but produced none.
  const currentEpicIndex = suite.current_epic === undefined ? 0 : epicIndex(suite.current_epic);
  for (const result of results) {
    const expectation = expectationByAssertion.get(result.assertion) || { status: EXPECTATION_STATUSES.HYPOTHESIS };
    result.expectation_status = expectation.status;
    if (result.status === STATUSES.PASS) {
      result.disposition = DISPOSITIONS.PASS;
    } else if (result.status === STATUSES.FAIL) {
      result.disposition = expectation.status === EXPECTATION_STATUSES.APPROVED
        ? DISPOSITIONS.FAIL
        : (expectation.status === EXPECTATION_STATUSES.WAIVED ? DISPOSITIONS.WAIVED : DISPOSITIONS.EXPECTED_RED);
    } else {
      const escalatedBy = rowEscalation(result, byId, currentEpicIndex);
      if (escalatedBy !== null) {
        result.disposition = DISPOSITIONS.FAIL;
        result.escalated = true;
        result.detail = (result.detail === '' ? '' : result.detail + '; ')
          + 'UNKNOWN escalated to FAIL: ' + escalatedBy + ' expects builds and expect_builds_after has landed';
      } else {
        result.disposition = DISPOSITIONS.UNKNOWN;
      }
    }
  }

  return { results, summary: summarize(results) };
}

module.exports = {
  STATUSES,
  EXPECTATION_STATUSES,
  DISPOSITIONS,
  DEFAULT_SCORE_TOLERANCE,
  epicIndex,
  validateExpectation,
  pairKeyOf,
  projectEntry,
  projectArtifact,
  evaluateSuite,
  summarize,
};
