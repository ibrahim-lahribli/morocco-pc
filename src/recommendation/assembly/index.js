/**
 * Engine 3 - Build assembly (public surface).
 *
 * Pure, framework-free build assembly: Engine 2D verdicts + the query
 * contract + GPU-requirement inputs + the price carrier are validated, then
 * expanded into candidate builds. Never reads from or writes to the database.
 *
 * Public surface (direct re-exports only - no wrappers, no logic):
 *
 *   validateEngine3Input()  - Step 1: structural validation and freezing of the
 *     nine-field Engine 3 input contract (see ./input).
 *   priceKey()              - Step 2: canonical price-carrier key
 *     (product_id | product_variant_id | component_role) (see ./prices).
 *   validatePrices()        - Step 2: price-carrier validation (see ./prices).
 *   lookupPrice()           - Step 2: deterministic carrier lookup by key
 *     (see ./prices).
 *   resolveGpuRequirement() - Step 3: REQUIRED | OPTIONAL GPU policy decision
 *     for the active CPU (see ./gpu-policy).
 *   assembleBuilds()        - Step 4: deterministic DFS build assembly over
 *     EXPANSION_ORDER (see ./assemble).
 *   EXPANSION_ORDER         - Step 4: authoritative, frozen traversal order.
 *
 * Price selection (upstream, Engine 2 Stage 1) and GPU-input loading
 * (`gpu_required_use_cases`, iGPU presence) are NOT owned here: they remain
 * future tasks. This module is a boundary only - it introduces no pipeline,
 * no orchestration, no validation, no errors and no contracts of its own.
 */
const { validateEngine3Input } = require('./input');
const { priceKey, validatePrices, lookupPrice } = require('./prices');
const { resolveGpuRequirement } = require('./gpu-policy');
const { assembleBuilds, EXPANSION_ORDER } = require('./assemble');

module.exports = {
  validateEngine3Input,
  priceKey,
  validatePrices,
  lookupPrice,
  resolveGpuRequirement,
  assembleBuilds,
  EXPANSION_ORDER,
};
