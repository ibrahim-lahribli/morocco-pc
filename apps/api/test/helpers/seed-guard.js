'use strict';

/**
 * apps/api/test/helpers/seed-guard.js - the `Seed ` prefix must not reach a client.
 *
 * Migration 020 backfills `product.display_name` (the `Seed `-stripped name) and
 * the API reads `COALESCE(p.display_name, p.name)`, so no component name served
 * to a client should still carry the ingestion prefix. That is a DATA property,
 * not something the presenter enforces - which is exactly why it needs a test:
 * a presenter that went back to serving `name` would pass every other assertion
 * in these suites, since the shape and the types would be unchanged.
 *
 * It walks a REAL response body and reports the offending component WITH its
 * product id, so a failure names the row to look at instead of just "a name was
 * wrong". Two suites assert it - the unit suite against fixture rows, and the DB
 * suite against rows read from the TEST branch - so the guarantee is also
 * checked against persisted data rather than only against a fixture.
 *
 * Scoped honestly: it proves NO served component name still starts with "Seed "
 * for the rows that test read. That is the property migration 020 exists to remove
 * from reach; it is NOT proof that the `COALESCE(p.display_name, p.name)` alias is
 * correct by itself - a presenter that went back to serving `product.name` AFTER the
 * unit fixture was corrected to the post-020 shape would pass this guard. The DB
 * suite is what proves the alias for real rows (it reads the actual served `slug`
 * from the branch and asserts it satisfies the migration CHECK); the guard's own
 * reason to exist is regression, not a by-construction backfill proof. A product
 * inserted after 020 without a `display_name` is nullable by design (see that
 * migration's header) and would legitimately fall back to `name`; such a row is
 * what this guard exists to surface, not to hide.
 */

const PREFIX = 'Seed ';

/**
 * @param {object} body a response body (or any object with `builds[].components[]`)
 * @returns {Array<{product_id: string|null, name: string}>} the offending components
 */
function findSeedNames(body) {
  const builds = body && Array.isArray(body.builds) ? body.builds : [];
  const offenders = [];
  for (const build of builds) {
    const components = build && Array.isArray(build.components) ? build.components : [];
    for (const component of components) {
      const name = component ? component.name : undefined;
      if (typeof name === 'string' && name.startsWith(PREFIX)) {
        offenders.push({
          product_id: component.product_id === undefined ? null : component.product_id,
          name,
        });
      }
    }
  }
  return offenders;
}

/**
 * @param {object} body a response body
 * @throws {Error} naming every offending component and its product id
 */
function assertNoSeedNames(body) {
  const offenders = findSeedNames(body);
  if (offenders.length > 0) {
    throw new Error(
      'a component name still carries the "Seed " ingestion prefix, so migration 020\'s display_name '
        + 'backfill (or the COALESCE that reads it) is not in effect for: '
        + offenders.map((o) => o.name + ' (product_id ' + o.product_id + ')').join(', ')
    );
  }
}

module.exports = { PREFIX, findSeedNames, assertNoSeedNames };
