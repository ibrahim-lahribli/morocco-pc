'use strict';

/**
 * Engine 2D - Filtering stage orchestration entry point (B2-G).
 *
 * Boundary: composes the two already-validated Engine 2D stages into the one
 * filtering step of the recommendation pipeline:
 *
 *   Engine 2C candidate-pool result ({ input, pool })
 *         |  loadFilteringContext(pool, db)  - B2-B: candidate-scoped,
 *         |                                    parameterized loading and
 *         |                                    normalization of the frozen
 *         |                                    filtering context
 *         v
 *   frozen Engine 2D filtering context
 *         |  filterCandidates(context)      - B2-D: pure hard-compatibility
 *         |                                   verdict aggregation
 *         v
 *   Engine 2D filtering result { results: [candidate verdict, ...] }
 *
 * B2-G SCOPE. This module is a thin composition boundary and owns no logic
 * of its own. It deliberately does NOT: access the database or create a
 * connection, normalize component specs, evaluate compatibility, call Engine
 * 1 resolvers, aggregate verdicts beyond what filterCandidates returns,
 * invent relationships, score candidates, apply budget constraints, rank
 * candidates, assemble builds, or persist anything.
 *
 * Statuses: the filter vocabulary (PASS / UNKNOWN / REJECT) is returned
 * untouched - REJECT keeps meaning "the hard-compatibility stage rejected
 * the candidate", and UNKNOWN stays distinguishable from REJECT. No second
 * status vocabulary is introduced here.
 *
 * Errors: candidate-pool validation failures, database access failures and
 * filter failures all propagate to the caller unchanged (the Engine 2
 * CandidateSelectionError from the composed validation, database errors as
 * thrown by the loader). Nothing is swallowed into an empty result, and no
 * error is translated.
 *
 * Dependencies: the caller supplies the Engine 2C candidate-pool result and
 * the database client. This module creates no connection of its own and
 * imports nothing besides the two sibling stages, so it stays unit-testable
 * with a fake db.
 */

const { loadFilteringContext } = require('./context-loader');
const { filterCandidates } = require('./filter');

/**
 * Run the Engine 2D hard-compatibility filtering stage for one Engine 2C
 * candidate-pool result: load the filtering context through the B2-B loader
 * and hand it unchanged to the pure B2-D filter.
 *
 * @param {object} candidatePoolResult  Engine 2C result { input, pool } as
 *        produced by selectCandidatePool
 * @param {object} db  caller-owned database client, the exact dependency the
 *        context loader consumes; never created or closed here
 * @returns {Promise<object>} the frozen filtering result of filterCandidates:
 *        { results: frozen candidate-verdict array } with candidate verdicts
 *        PASS / UNKNOWN / REJECT preserved exactly
 * @throws {CandidateSelectionError} when the candidate-pool result or the db
 *        dependency is invalid (raised by loadFilteringContext validation)
 * @throws any database access error and any filter error, unchanged
 */
async function filterCandidatesForRecommendation(candidatePoolResult, db) {
  const context = await loadFilteringContext(candidatePoolResult, db);
  return filterCandidates(context);
}

module.exports = { filterCandidatesForRecommendation };
