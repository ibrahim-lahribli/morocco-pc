/**
 * Engine 2D - Filtering context loader (B2-B).
 *
 * Public surface: loadFilteringContext() assembles the frozen Engine 2D
 * filtering context from an Engine 2C candidate-pool result and a validated
 * pg-compatible `db` dependency. B2-B populates specs / platform_by_socket /
 * compat from candidate-scoped, parameterized PostgreSQL queries (see
 * ./context-loader). Compatibility verdicts, candidate rejection, budget
 * filtering, scoring, build generation and persistence belong to later
 * stages/engines.
 *
 * Candidate and error contracts are reused from Engine 2 (../candidates);
 * this module defines no parallel contracts.
 */
const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('./context-loader');

module.exports = { loadFilteringContext, CONTEXT_COMPAT_KEYS };
