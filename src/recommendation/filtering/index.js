/**
 * Engine 2D - Filtering context loader (foundation).
 *
 * Public surface of the Engine 2D foundation: loadFilteringContext() assembles
 * the frozen Engine 2D filtering context from an Engine 2C candidate-pool
 * result and a validated pg-compatible `db` dependency. The DB-backed
 * population of specs / platform_by_socket / compat is NOT implemented yet
 * (future Engine 2D stage); compatibility verdicts, candidate rejection,
 * budget filtering, scoring, build generation and persistence belong to later
 * stages/engines.
 *
 * Candidate and error contracts are reused from Engine 2 (../candidates);
 * this module defines no parallel contracts.
 */
const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('./context-loader');

module.exports = { loadFilteringContext, CONTEXT_COMPAT_KEYS };
