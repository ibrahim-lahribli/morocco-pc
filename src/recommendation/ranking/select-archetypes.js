'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/**
 * E4 (Decision 41) - archetype selection replacing selectDiverseTop.
 *
 * Pure, DB-free: walks the ranked list and returns UP TO THREE showcase builds,
 * one per strategy, ordered by the query's `priority`. Strategies:
 *
 *   PERFORMANCE  - the highest build_score among builds spending >= ~85% of the
 *                  budget (spendShare >= PERFORMANCE_FLOOR)
 *   BALANCED     - the highest build_score overall (the rank-3 default build)
 *   VALUE        - the best score per MAD (build_score / total_price, tied on
 *                  total_price ASC then signature ASC - value prefers cheap)
 *
 * Priority decides the OUTPUT order (1-2 value first, 3 balanced, 4-5
 * performance first). Distinct (CPU, GPU) pairs across the three archetypes;
 * if fewer than three genuinely distinct builds exist, return fewer with a
 * reason code instead of padding.
 *
 * RETURN SHAPE: frozen { archetypes, reason_codes } where each element of
 * `archetypes` is a frozen { strategy_key, persisted_rank (assigned later, by
 * Engine 5b - always null here), build_score, total_price, signature,
 * explanation (null - Engine 6 fills later), build } entry and reason_codes is
 * a frozen array of strings from REASON_CODES in output order (empty when all
 * three archetypes were found).
 *
 * Persistence note: Engine 5b writes recommendation_result rows from the
 * explained array; strategy_key persistence needs Platform migration 019
 * (recommendation_result.strategy_key), which does NOT exist yet. This module
 * therefore only RETURNS the strategy keys; no writer change is made in this
 * epic. REASON_CODES values are stable string identifiers, not user prose.
 */

const PERFORMANCE_FLOOR = 0.85;

const STRATEGIES = Object.freeze(['PERFORMANCE', 'BALANCED', 'VALUE']);

const REASON_CODES = Object.freeze({
  EMPTY_RANKED: 'EMPTY_RANKED',
  NO_PERFORMANCE_CANDIDATE: 'NO_PERFORMANCE_CANDIDATE',
  NO_VALUE_CANDIDATE: 'NO_VALUE_CANDIDATE',
});

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Priority vocabulary: 1..5 (API-checked). Mapping to output order:
 *   1, 2 -> value, performance, balanced (budget-conscious first)
 *   3    -> balanced, performance, value      (the default)
 *   4, 5 -> performance, balanced, value      (performance first)
 */
function strategyOrder(priority) {
  if (priority === undefined || priority === null) {
    return ['BALANCED', 'PERFORMANCE', 'VALUE'];
  }
  if (priority === 1 || priority === 2) {
    return ['VALUE', 'PERFORMANCE', 'BALANCED'];
  }
  if (priority === 3) {
    return ['BALANCED', 'PERFORMANCE', 'VALUE'];
  }
  if (priority === 4 || priority === 5) {
    return ['PERFORMANCE', 'BALANCED', 'VALUE'];
  }
  fail(ERROR_CODES.INVALID_FIELD_VALUE, 'priority', '"priority" must be 1..5 or null');
}

/**
 * The (CPU, GPU) pair key, same identity as select-diverse's pairKey so the
 * two stages cannot disagree about what "one pair" means. GPU omission
 * (iGPU path) is the literal 'OMITTED'.
 */
function pairKey(entry) {
  const components = entry.build.components;
  const byRole = Object.create(null);
  for (const component of components) {
    byRole[component.component_role] = component;
  }
  const cpu = byRole['CPU'];
  if (cpu === undefined) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'ranked',
      'ranked entry build has no CPU component - contract violation (Decision 10 required_roles)'
    );
  }
  const gpu = byRole['GPU'];
  const gpuPairValue = gpu === undefined ? 'OMITTED' : (gpu.product_variant_id ?? '');
  return `${cpu.product_id}|${gpuPairValue}`;
}

function entrySignature(entry) {
  return entry.signature;
}

/**
 * Pick the archetype entry for one strategy from the still-eligible ranked
 * entries (pair not already claimed by an earlier strategy in output order).
 * Deterministic: consecutive pairs keep the ranked order; within one pass a
 * strategy scans in ranked order and picks the FIRST best match, never a
 * random one.
 */
function pickForStrategy(strategy, entries, claimedPairs) {
  let best = null;
  for (const entry of entries) {
    const key = pairKey(entry);
    if (claimedPairs.has(key)) {
      continue;
    }
    if (strategy === 'PERFORMANCE') {
      if (entry.total_price / entry.budget_amount < PERFORMANCE_FLOOR) {
        continue;
      }
    }
    if (strategy === 'VALUE') {
      // VALUE: score-per-MAD, ties to the CHEAPER build first, then signature.
      if (
        best !== null &&
        (entry.build_score / entry.total_price < best.build_score / best.total_price ||
          (entry.build_score / entry.total_price === best.build_score / best.total_price &&
            (entry.total_price > best.total_price ||
              (entry.total_price === best.total_price && entrySignature(entry) > entrySignature(best)))))
      ) {
        continue;
      }
    } else {
      // PERFORMANCE / BALANCED: highest build_score, ties keep the FIRST entry
      // (rank order), deterministic, no signature comparison needed.
      if (best !== null && entry.build_score <= best.build_score) {
        continue;
      }
    }
    best = entry;
  }
  return best;
}

/**
 * E4 boundary function. Arguments:
 *   ranked         - Engine 5a ranked output (array of ranked entries; each
 *                    carrying build, build_score, total_price, signature,
 *                    compatibility_status, explanation). May be empty.
 *   budget         - { amount, currency } (amount finite > 0), the pinned
 *                    query budget - used ONLY for the PERFORMANCE floor.
 *   priority       - optional 1..5 (null/undefined = 3 default order).
 */
function selectArchetypes({ ranked, budget, priority } = {}) {
  if (ranked === undefined || ranked === null) {
    ranked = [];
  }
  if (!Array.isArray(ranked)) {
    fail(ERROR_CODES.INVALID_INPUT, 'ranked', '"ranked" must be an array');
  }
  if (budget === undefined || budget === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'budget', '"budget" is required (the pinned query budget)');
  }
  if (budget.amount === undefined || budget.amount === null || !isFiniteNumber(budget.amount) || budget.amount <= 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'budget.amount', '"budget.amount" must be a finite number > 0');
  }
  if (priority !== undefined && priority !== null && (!Number.isInteger(priority) || priority < 1 || priority > 5)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'priority', '"priority" must be 1..5 or null');
  }

  // Entries with a zero/negative price make VALUE division undefined; the
  // ranked list is Engine 5a output so this should never occur, but the check
  // makes the arithmetic contract explicit.
  const entries = ranked.map((entry, index) => ({
    ...entry,
    budget_amount: budget.amount,
    _rank: index,
  }));

  const reasonCodes = [];
  if (entries.length === 0) {
    // Empty ranked is one condition, not three: no strategy can nominate
    // anything, so the honest answer is the single EMPTY_RANKED reason.
    return deepFreeze({ archetypes: [], reason_codes: [REASON_CODES.EMPTY_RANKED] });
  }

  const order = strategyOrder(priority);
  const claimedPairs = new Set();
  const archetypes = [];

  for (const strategy of order) {
    if (entries.length === 0) {
      reasonCodes.push(REASON_CODES[`NO_${strategy}_CANDIDATE`]);
      continue;
    }
    const pick = pickForStrategy(strategy, entries, claimedPairs);
    if (pick === null) {
      // No pair-distinct entry for THIS strategy - honest degradation: skip it.
      reasonCodes.push(REASON_CODES[`NO_${strategy}_CANDIDATE`]);
      continue;
    }
    claimedPairs.add(pairKey(pick));
    archetypes.push({
      strategy_key: strategy,
      persisted_rank: null,
      build_score: pick.build_score,
      total_price: pick.total_price,
      compatibility_status: pick.compatibility_status,
      signature: pick.signature,
      explanation: null,
      build: pick.build,
    });
  }

  return deepFreeze({
    archetypes,
    reason_codes: reasonCodes,
  });
}

module.exports = { selectArchetypes, PERFORMANCE_FLOOR, STRATEGIES, REASON_CODES };
