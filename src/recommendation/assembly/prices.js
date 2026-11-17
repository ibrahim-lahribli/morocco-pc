/**
 * Engine 3 - price carrier - COMPATIBILITY SHIM (step 4B PR 3).
 *
 * The implementation moved to
 * packages/recommendation-core/src/assembly/prices.js. Re-exported by identity
 * because retention, offers/as-of and the orchestrator call the same priceKey
 * and validatePrices instances the assembler uses.
 */
module.exports = require('../../../packages/recommendation-core/src/assembly/prices');
