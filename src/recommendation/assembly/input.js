/**
 * Engine 3 - Build assembly - COMPATIBILITY SHIM (step 4B PR 3).
 *
 * The implementation moved to
 * packages/recommendation-core/src/assembly/input.js. Re-exported by identity
 * so the ten-field Engine 3 input contract keeps one implementation.
 */
module.exports = require('../../../packages/recommendation-core/src/assembly/input');
