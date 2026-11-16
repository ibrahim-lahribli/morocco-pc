/**
 * Compatibility shim (step 4B PR 2): the Engine 1 compatibility tree moved to
 * packages/recommendation-core/src/compatibility/. Re-exported by identity so
 * the old barrel path keeps resolving — filtering/filter.js (now core) and the
 * src-side runtime modules both reach the same functions.
 *
 * The 13 sibling modules were internal to this directory and had no consumer
 * outside it, so only the barrel gets a shim; the implementation is whole in
 * one package rather than split across two.
 */
module.exports = require('../../../packages/recommendation-core/src/compatibility');
