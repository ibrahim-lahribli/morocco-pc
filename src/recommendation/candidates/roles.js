/**
 * Engine 2 - Candidate component selector: role / category vocabulary.
 *
 * The values mirror the canonical database enums exactly:
 *   COMPONENT_ROLES    -> `component_role` enum (migration 011, never altered)
 *   PRODUCT_CATEGORIES -> `product_category` enum (migration 002)
 *
 * These constants are part of the engine contract. They must not be renamed
 * casually and must always match the database enums.
 */

const COMPONENT_ROLES = Object.freeze([
  'CPU',
  'GPU',
  'MOTHERBOARD',
  'RAM',
  'SSD_BOOT',
  'SSD_SECONDARY',
  'PSU',
  'CASE',
  'CPU_COOLER',
]);

/**
 * Deterministic role ordering: the `component_role` enum declaration order.
 * Used as the first ordering key when candidates are otherwise equivalent.
 */
const ROLE_ORDER = Object.freeze(
  Object.fromEntries(COMPONENT_ROLES.map((role, index) => [role, index]))
);

/**
 * Singular roles: at most one per build (migration 011 unique partial index
 * `uq_build_component_role_singular`). GPU / RAM / SSD_SECONDARY may be
 * multiple. Exported for documentation of the contract; enforced later by the
 * build assembler, not by candidate selection.
 */
const SINGULAR_ROLES = Object.freeze([
  'CPU',
  'MOTHERBOARD',
  'PSU',
  'CASE',
  'CPU_COOLER',
  'SSD_BOOT',
]);

/** `product_category` enum (migration 002). */
const PRODUCT_CATEGORIES = Object.freeze([
  'CPU',
  'MOTHERBOARD',
  'MEMORY',
  'GPU',
  'STORAGE',
  'PSU',
  'CASE',
  'COOLER',
]);

/**
 * Which `product_category` each component role must come from (Layer 1
 * identity: `product.category`). A build_component role maps onto exactly one
 * product category.
 */
const ROLE_CATEGORIES = Object.freeze({
  CPU: 'CPU',
  GPU: 'GPU',
  MOTHERBOARD: 'MOTHERBOARD',
  RAM: 'MEMORY',
  SSD_BOOT: 'STORAGE',
  SSD_SECONDARY: 'STORAGE',
  PSU: 'PSU',
  CASE: 'CASE',
  CPU_COOLER: 'COOLER',
});

function isValidComponentRole(role) {
  return (
    typeof role === 'string' &&
    Object.prototype.hasOwnProperty.call(ROLE_CATEGORIES, role)
  );
}

function isValidProductCategory(category) {
  return PRODUCT_CATEGORIES.includes(category);
}

/** The only product_category a given role may come from, or null. */
function expectedCategoryForRole(role) {
  if (!isValidComponentRole(role)) return null;
  return ROLE_CATEGORIES[role];
}

module.exports = {
  COMPONENT_ROLES,
  ROLE_ORDER,
  SINGULAR_ROLES,
  PRODUCT_CATEGORIES,
  ROLE_CATEGORIES,
  isValidComponentRole,
  isValidProductCategory,
  expectedCategoryForRole,
};
