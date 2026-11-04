'use strict';

/**
 * R-04 platform-cost measurement (read-only; shared-DB safe).
 *
 * WHAT IT ANSWERS. `retainTopKPerRole` ranks each role by the candidate's OWN
 * `selected_price`, so a CPU that costs little but forces an expensive board and
 * RAM looks cheap. R-04 records that as "8 of 10 retained CPUs cannot produce an
 * in-budget build at 12 000 @1440p". This script reproduces that figure and
 * shows what a platform-aware reserve would change.
 *
 * HOW. It replicates orchestrator stages 4-11 read-only (the same replication
 * `measure-og01-reach.js` uses - no `recommendation_query` row is written, so
 * Decision 17 is untouched):
 *
 *   loadCandidates -> selectCandidatePool -> selectOfferPrices ->
 *   loadFilteringContext -> filterCandidates -> loadComponentAssessments ->
 *   computeCandidateScores -> retainTopKPerRole
 *
 * and then evaluates, per CPU candidate, the cheapest (motherboard, RAM) pair
 * that is not FAIL against it:
 *
 *   platform(cpu) = cpu price + min over (mb, ram) of mb price + ram price
 *   subject to cpu_motherboard, platform_memory, motherboard_memory,
 *   mb_memory_slots and mb_memory_capacity all != FAIL
 *
 * The pair evaluators are the ones `filtering/filter.js` EXPORTS for the
 * Decision 16 handoff, so this measures the real rules rather than a
 * re-implementation of them.
 *
 * The retention call mirrors `orchestrator/run.js` exactly - `resolveRoleTargets`
 * (E2) and `resolveGpuPolicy` (E6) are not exported there, so they are mirrored
 * here from the same configuration keys, and the script says so rather than
 * quietly measuring a different retention.
 *
 * Approximations, stated rather than hidden:
 *   - the clock is `Date.now()` instead of the orchestrator's transaction
 *     timestamp (same note as measure-og01-reach.js: linear decay makes this
 *     noise between same-day runs);
 *   - ONLY CPU/motherboard/RAM prices enter the platform total. GPU, SSD_BOOT,
 *     PSU, CASE and CPU_COOLER are assumed reachable at their retained cheapest,
 *     which is what makes this a FLOOR on a full build, not a build.
 *
 * THE COMPATIBILITY HALF. A price floor cannot see pair rules that live inside
 * the Engine 3 walk (GPU<->case, GPU<->PSU, cooler<->socket, the E5 VRAM floor),
 * so the script also runs the REAL `assembly.assembleBuildsForRecommendation`
 * over the SAME retention output the orchestrator would hand it, and counts
 * builds per CPU. A CPU whose floor is under budget but whose build count is 0
 * is blocked by COMPATIBILITY, not by cost - a distinction no sum can make.
 *
 * Usage:
 *   node scripts/measure-platform-cost.js [--budget N] [--use-case U]
 *     [--resolution 1080p|1440p|2160p] [--model=<name@version>]
 * Exit codes: 0 = measured; 1 = error; 2 = usage error.
 */

require('dotenv').config();
const path = require('path');
const { Client } = require('pg');

const modelPin = require('./lib/model-pin');

const root = path.join(__dirname, '..', 'src', 'recommendation');
const candidates = require(path.join(root, 'candidates'));
const offers = require(path.join(root, 'offers', 'index.js'));
const filtering = require(path.join(root, 'filtering', 'index.js'));
const scoring = require(path.join(root, 'scoring', 'index.js'));
const retention = require(path.join(root, 'retention', 'index.js'));
const assembly = require(path.join(root, 'assembly', 'index.js'));
const { priceKey } = require(path.join(root, 'assembly', 'prices'));
const {
  FINAL_STATUSES,
  aggregateCompatibilityResults,
  evaluateCpuMotherboardPair,
  evaluatePlatformMemoryPair,
  evaluateMotherboardMemoryPair,
  evaluateMotherboardMemorySlotsPair,
  evaluateMotherboardMemoryCapacityPair,
} = require(path.join(root, 'filtering', 'filter.js'));

const ARGS = process.argv.slice(2);
function valueOf(flag) {
  const i = ARGS.indexOf(flag);
  return i === -1 ? null : ARGS[i + 1];
}
const BUDGET = Number(valueOf('--budget') || 12000);
const USE_CASE = valueOf('--use-case') || 'GAMING';
const RESOLUTION = valueOf('--resolution') || '1440p';
const MODEL_PIN = modelPin.modelPinValue(modelPin.readModelPinFlag(ARGS));
const KNOWN = new Set([
  '--budget', '--use-case', '--resolution', '--model=' + MODEL_PIN,
  String(BUDGET), USE_CASE, RESOLUTION,
]);
const unknown = ARGS.filter((arg) => !KNOWN.has(arg));
if (unknown.length > 0 || !Number.isFinite(BUDGET) || BUDGET <= 0) {
  console.error('usage: node scripts/measure-platform-cost.js [--budget N] [--use-case <use_case>] [--resolution <1080p|1440p|2160p>] [--model=<name@version>]');
  process.exit(2);
}

const INPUT = {
  budget_amount: BUDGET,
  currency: 'MAD',
  use_case: USE_CASE,
  required_roles: ['CPU', 'GPU', 'MOTHERBOARD', 'RAM', 'SSD_BOOT', 'PSU', 'CASE', 'CPU_COOLER'],
};

/** Mirrors orchestrator/run.js resolveGpuPolicy (not exported there). */
function gpuPolicyFor(configuration) {
  const profiles = configuration && configuration.use_case_profiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return null;
  const profile = profiles[USE_CASE];
  if (!profile || typeof profile !== 'object') return null;
  return profile.gpu_policy === 'REQUIRED' || profile.gpu_policy === 'IGPU_ALLOWED'
    ? profile.gpu_policy
    : null;
}

/** Mirrors orchestrator/run.js resolveVramFloorGb (not exported there). */
function vramFloorFor(configuration) {
  const profiles = configuration && configuration.resolution_profiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return null;
  const profile = profiles[RESOLUTION];
  if (!profile || typeof profile !== 'object') return null;
  const floor = profile.vram_floor_gb;
  return typeof floor === 'number' && Number.isInteger(floor) && floor >= 1 ? floor : null;
}

/** Mirrors orchestrator/run.js resolveRoleTargets (not exported there). */
function roleTargetsFor(configuration) {
  const profiles = configuration && configuration.use_case_profiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return null;
  const profile = profiles[USE_CASE];
  if (
    !profile
    || typeof profile !== 'object'
    || !profile.spend_targets
    || typeof profile.spend_targets !== 'object'
  ) {
    return null;
  }
  return retention.computeRoleTargets({
    spendTargets: profile.spend_targets,
    budgetAmount: BUDGET,
    resolution: RESOLUTION,
  });
}

function identity(productId, variantId, role) {
  return JSON.stringify([productId, variantId, role]);
}

function statusOf(result) {
  return result && result.status ? result.status : FINAL_STATUSES.UNKNOWN;
}

/** Non-FAIL means "not excluded": UNKNOWN is a data gap, never an exclusion. */
function notFailed(result) {
  return statusOf(result) !== FINAL_STATUSES.FAIL;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }
  const db = new Client({ connectionString });
  await db.connect();
  try {
    const model = await modelPin.resolvePinnedModel(db, MODEL_PIN);
    const configuration = model.configuration;
    const topK = configuration.candidate_caps.top_k_per_role;

    console.log(
      'R-04 platform-cost measurement (read-only, DATABASE_URL) | budget ' + BUDGET
      + ' ' + INPUT.currency + ' | use_case ' + USE_CASE
      + ' | resolution ' + RESOLUTION
      + ' | model ' + MODEL_PIN + ' | top_k_per_role ' + topK
    );

    const loaded = await candidates.loadCandidates(INPUT, db);
    const poolResult = candidates.selectCandidatePool(loaded.input, loaded.candidates);
    const offerResult = await offers.selectOfferPrices(poolResult, db);
    const filteringContext = await filtering.loadFilteringContext(offerResult, db);
    const filterResult = filtering.filterCandidates(filteringContext);

    const poolIds = new Set(offerResult.pool.map((candidate) => candidate.product_id));
    const assessmentResult = await scoring.loadComponentAssessments([...poolIds], db);
    const candidateScores = scoring.computeCandidateScores({
      candidates: offerResult.pool,
      assessments: assessmentResult.assessments,
      configuration,
      nowMs: Date.now(), // approximation of the tx timestamp - see header
    });

    const gpuPolicy = gpuPolicyFor(configuration);
    const excludedCpuIds = retention.excludedCpuProductIds({ gpuPolicy, filteringContext });
    const retentionResult = retention.retainTopKPerRole({
      filterResult,
      candidateScores,
      topKPerRole: topK,
      prices: offerResult.prices,
      roleTargets: roleTargetsFor(configuration),
      roleExclusions: excludedCpuIds === null ? null : { CPU: excludedCpuIds },
      topKByRole: configuration.candidate_caps.top_k_by_role === undefined
        ? null
        : configuration.candidate_caps.top_k_by_role,
    });

    // Candidate status by identity, so a REJECTed board or RAM cannot enter a platform.
    const statusByIdentity = new Map();
    for (const verdict of filterResult.results) {
      statusByIdentity.set(
        identity(verdict.product_id, verdict.product_variant_id, verdict.component_role),
        verdict.status
      );
    }
    const eligible = (candidate) => {
      const status = statusByIdentity.get(
        identity(candidate.product_id, candidate.product_variant_id, candidate.component_role)
      );
      return status === 'PASS' || status === 'UNKNOWN';
    };
    const priceOf = (candidate) => {
      const key = priceKey(candidate.product_id, candidate.product_variant_id, candidate.component_role);
      const entry = Object.prototype.hasOwnProperty.call(offerResult.prices, key)
        ? offerResult.prices[key]
        : null;
      return entry && typeof entry.selected_price === 'number' ? entry.selected_price : null;
    };

    const cpuPool = (filteringContext.candidates.CPU || []).filter(eligible);
    const boardPool = (filteringContext.candidates.MOTHERBOARD || []).filter(eligible);
    const ramPool = (filteringContext.candidates.RAM || []).filter(eligible);

    const names = new Map();
    const wanted = new Set([...cpuPool, ...boardPool, ...ramPool].map((c) => c.product_id));
    if (wanted.size > 0) {
      const rows = await db.query(
        'SELECT id::text AS id, name FROM product WHERE id::text = ANY($1::text[])',
        [[...wanted]]
      );
      for (const row of rows.rows) names.set(row.id, row.name);
    }

    /**
     * The cheapest compatible (board, RAM) pair for one CPU and its platform
     * total, or `total: null` when nothing compatible exists at all. A CPU with
     * no platform is reported as such rather than priced as if partners were free.
     */
    function platformFor(cpu) {
      const cpuPrice = priceOf(cpu);
      if (cpuPrice === null) return null;
      let best = null;
      for (const board of boardPool) {
        const boardPair = aggregateCompatibilityResults(
          evaluateCpuMotherboardPair(filteringContext, cpu, board)
        );
        if (!notFailed(boardPair)) continue;
        const boardPrice = priceOf(board);
        if (boardPrice === null) continue;
        for (const ram of ramPool) {
          const checks = [
            evaluatePlatformMemoryPair(filteringContext, cpu, ram),
            evaluateMotherboardMemoryPair(filteringContext, board, ram),
            evaluateMotherboardMemorySlotsPair(filteringContext, board, ram),
            evaluateMotherboardMemoryCapacityPair(filteringContext, board, ram),
          ];
          if (!checks.every((checksForPair) => notFailed(aggregateCompatibilityResults(checksForPair)))) {
            continue;
          }
          const ramPrice = priceOf(ram);
          if (ramPrice === null) continue;
          const pairTotal = boardPrice + ramPrice;
          if (best === null || pairTotal < best.pairTotal) {
            best = { pairTotal, boardPrice, ramPrice };
          }
        }
      }
      if (best === null) return { cpu, cpuPrice, total: null };
      return {
        cpu,
        cpuPrice,
        total: cpuPrice + best.pairTotal,
        boardPrice: best.boardPrice,
        ramPrice: best.ramPrice,
      };
    }

    const platforms = cpuPool.map(platformFor).filter((entry) => entry !== null);
    const retainedCpuIds = new Set(
      retentionResult.results
        .filter((verdict) => verdict.component_role === 'CPU')
        .map((verdict) => verdict.product_id)
    );
    const retainedPlatforms = platforms.filter((entry) => retainedCpuIds.has(entry.cpu.product_id));

    const withinBudget = (entry) => entry.total !== null && entry.total <= BUDGET;
    const nameOf = (candidate) => names.get(candidate.product_id) || String(candidate.product_id).slice(0, 8);

    console.log('');
    console.log(
      'pool: cpus=' + cpuPool.length + ' boards=' + boardPool.length + ' ram=' + ramPool.length
      + ' | retained cpus=' + retainedPlatforms.length + ' | budget=' + BUDGET
    );
    console.log('');
    console.log('=== retained CPUs: own price vs platform total (cheapest compatible board+RAM) ===');
    const ordered = retainedPlatforms
      .slice()
      .sort((a, b) => (b.total === null ? Number.MAX_SAFE_INTEGER : b.total) - (a.total === null ? Number.MAX_SAFE_INTEGER : a.total));
    for (const entry of ordered) {
      console.log(
        '  ' + nameOf(entry.cpu).slice(0, 32).padEnd(32)
        + ' cpu=' + String(entry.cpuPrice).padStart(6)
        + (entry.total === null
          ? ' | NO COMPATIBLE BOARD+RAM'
          : ' | board=' + String(entry.boardPrice).padStart(5)
            + ' ram=' + String(entry.ramPrice).padStart(5)
            + ' => platform=' + String(entry.total).padStart(6)
            + (withinBudget(entry) ? '  FEASIBLE' : '  OVER BUDGET'))
      );
    }

    const overBudget = retainedPlatforms.filter((entry) => entry.total !== null && entry.total > BUDGET);
    const noPlatform = retainedPlatforms.filter((entry) => entry.total === null);
    const feasibleCount = retainedPlatforms.filter(withinBudget).length;
    const infeasible = overBudget.length + noPlatform.length;

    console.log('');
    console.log(
      'retained CPUs: ' + retainedPlatforms.length
      + ' | platform within budget: ' + feasibleCount
      + ' | platform over budget: ' + overBudget.length
      + ' | no compatible board+RAM: ' + noPlatform.length
    );
    if (retainedPlatforms.length > 0) {
      const pct = ((infeasible / retainedPlatforms.length) * 100).toFixed(1);
      console.log(
        'RESULT: ' + infeasible + ' of ' + retainedPlatforms.length
        + ' retained CPU(s) (' + pct + '%) cannot form an in-budget CPU+board+RAM platform at '
        + BUDGET + ' ' + INPUT.currency + ' - R-04 claimed 8 of 10.'
      );
    }

    // R-04 claims 8 of 10 retained CPUs cannot produce an in-budget build. Two
    // floors answer that, and they are DIFFERENT quantities: the platform
    // subtotal (CPU+board+RAM, the thing a platform-aware reserve would rank by)
    // and the full build, which adds the cheapest RETAINED price of every other
    // role - the Decision 27 budget-floor convention (role minima, partner pairs
    // ignored). The second is a LOWER BOUND: above the budget no build can exist;
    // below it, a build may still fail on pair compatibility.
    const otherRoles = ['GPU', 'SSD_BOOT', 'PSU', 'CASE', 'CPU_COOLER'];
    const retainedByRole = new Map();
    for (const verdict of retentionResult.results) {
      const price = priceOf(verdict);
      if (price === null) continue;
      if (!retainedByRole.has(verdict.component_role)) retainedByRole.set(verdict.component_role, []);
      retainedByRole.get(verdict.component_role).push(price);
    }
    const minima = new Map();
    const missingRoles = [];
    for (const role of otherRoles) {
      const prices = (retainedByRole.get(role) || []).slice().sort((a, b) => a - b);
      if (prices.length === 0) missingRoles.push(role);
      else minima.set(role, prices[0]);
    }
    console.log('');
    console.log('role minima: ' + otherRoles
      .map((role) => role + '=' + (minima.has(role) ? minima.get(role) : 'NONE'))
      .join(' '));

    const floorFor = (entry) => {
      if (entry.total === null || missingRoles.length > 0) return null;
      let floor = entry.total;
      for (const role of otherRoles) floor += minima.get(role);
      return floor;
    };
    const reportFloors = (entries, title) => {
      console.log('');
      console.log(title);
      let above = 0;
      for (const entry of entries) {
        const floor = floorFor(entry);
        if (floor === null) {
          console.log('  ' + nameOf(entry.cpu).slice(0, 32).padEnd(32) + ' floor=n/a');
          above += 1;
          continue;
        }
        const within = floor <= BUDGET;
        if (!within) above += 1;
        console.log('  ' + nameOf(entry.cpu).slice(0, 32).padEnd(32)
          + ' floor=' + String(floor).padStart(6) + (within ? '  FEASIBLE' : '  OVER BUDGET'));
      }
      console.log('RESULT: ' + above + ' of ' + entries.length + ' above ' + BUDGET + ' - ' + title.replace(/^=+ | =+$/g, ''));
      return above;
    };

    reportFloors(ordered, '=== full-build floor per RETAINED CPU (Decision 27 selection) ===');

    // The contrast that can explain the register figure: plain top-K by score is
    // what retention kept BEFORE Decision 27, so if R-04 was measured there, this
    // is where 8 of 10 lives.
    const scoreByIdentity = new Map(candidateScores.scores.map((entry) => [
      identity(entry.product_id, entry.product_variant_id, entry.component_role),
      entry.candidate_score,
    ]));
    const caps = configuration.candidate_caps;
    const kCpu = (caps.top_k_by_role && caps.top_k_by_role.CPU) || topK;
    const scoreOf = (entry) => scoreByIdentity.get(identity(entry.cpu.product_id, entry.cpu.product_variant_id, 'CPU')) ?? -Infinity;
    const preDecision27 = platforms.slice().sort((a, b) => {
      const delta = scoreOf(b) - scoreOf(a);
      if (delta !== 0) return delta;
      return a.cpu.product_id < b.cpu.product_id ? -1 : a.cpu.product_id > b.cpu.product_id ? 1 : 0;
    }).slice(0, kCpu);
    reportFloors(preDecision27, '=== contrast: full-build floor for the TOP-' + kCpu + '-BY-SCORE CPUs (pre-Decision-27) ===');
    // What a platform-aware reservation would put in the K-1 slice instead.
    const cheapestPlatform = platforms
      .filter((entry) => entry.total !== null)
      .sort((a, b) => a.total - b.total)[0];
    if (cheapestPlatform === undefined) {
      console.log('a platform-aware reserve: no CPU has a compatible board+RAM, so it could reserve nothing.');
    } else {
      console.log(
        'platform-cheapest CPU: ' + nameOf(cheapestPlatform.cpu) + ' at platform '
        + cheapestPlatform.total + ' (cpu ' + cheapestPlatform.cpuPrice + ') - '
        + (retainedCpuIds.has(cheapestPlatform.cpu.product_id)
          ? 'ALREADY retained'
          : 'NOT retained today, so a platform-aware reserve would add it')
      );
      console.log(
        'pool CPUs with an in-budget platform: ' + platforms.filter(withinBudget).length + ' of ' + platforms.length
      );
    }
    // ----------------------------------------------------------------
    // Engine 3: the COMPATIBILITY half. Everything above prices a platform
    // and the cheapest reachable partners; it cannot see whether a real build
    // assembles, because GPU<->case/PSU, cooler<->socket and the E5 VRAM floor
    // are checked INSIDE the walk, not in a sum. So run the real assembly over
    // the same retention output the orchestrator would pass it.
    // ----------------------------------------------------------------
    const vramFloorGb = vramFloorFor(configuration);
    let assemblyBuilds = null;
    let assemblyError = null;
    try {
      assemblyBuilds = assembly.assembleBuildsForRecommendation({
        candidatePoolResult: offerResult,
        filteringContext,
        filterResult: retentionResult,
        scoringModel: model,
        prices: offerResult.prices,
        vramFloorGb,
        gpuPolicy,
      }).builds;
    } catch (err) {
      assemblyError = err && err.message ? err.message : String(err);
    }

    console.log('');
    console.log('=== Engine 3 assembly at ' + BUDGET + ' ' + INPUT.currency
      + ' (vram floor ' + (vramFloorGb === null ? 'none' : vramFloorGb + ' GB')
      + ', gpu policy ' + (gpuPolicy === null ? 'legacy rule' : gpuPolicy) + ') ===');
    if (assemblyBuilds === null) {
      console.log('ASSEMBLY ERROR: ' + assemblyError);
    } else {
      const cpuComponent = (build) => {
        const components = build && build.components ? build.components : null;
        if (!components) return null;
        if (Array.isArray(components)) {
          const found = components.filter((part) => (part.component_role || part.role) === 'CPU');
          return found.length > 0 ? found[0] : null;
        }
        return components.CPU || null;
      };
      const buildsByCpu = new Map();
      let unattributed = 0;
      for (const build of assemblyBuilds) {
        const cpu = cpuComponent(build);
        if (!cpu || cpu.product_id === undefined || cpu.product_id === null) {
          unattributed += 1;
          continue;
        }
        const key = String(cpu.product_id);
        buildsByCpu.set(key, (buildsByCpu.get(key) || 0) + 1);
      }
      console.log('builds assembled: ' + assemblyBuilds.length
        + ' | distinct CPUs inside builds: ' + buildsByCpu.size
        + (unattributed > 0 ? ' | builds with no resolvable CPU component: ' + unattributed : ''));
      let noBuild = 0;
      for (const entry of ordered) {
        const count = buildsByCpu.get(String(entry.cpu.product_id)) || 0;
        if (count === 0) noBuild += 1;
        console.log('  ' + nameOf(entry.cpu).slice(0, 32).padEnd(32)
          + ' builds=' + String(count).padStart(3) + (count === 0 ? '  NO BUILD' : ''));
      }
      console.log('RESULT: ' + noBuild + ' of ' + ordered.length
        + ' retained CPU(s) assemble ZERO build(s) at ' + BUDGET + ' ' + INPUT.currency
        + ' (R-04 claimed 8 of 10 cannot produce an in-budget build)');
    }

    console.log('RESULT: measured (read-only; no rows written)');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err && err.message ? err.message : err);
  process.exit(1);
});
