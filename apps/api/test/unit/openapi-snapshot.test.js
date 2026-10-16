'use strict';

/**
 * apps/api/test/unit/openapi-snapshot.test.js - the served OpenAPI document,
 * pinned (Sprint 4 of PLAN_PLATFORM_P0.md: v1.1 pass facts, v1.2 product
 * identity; Platform P1 Sprint 5: v1.3 request dedupe; Platform P1 Sprint 6:
 * v1.4 the presets ribbon).
 *
 * A committed snapshot is the only thing that makes a published contract a
 * CLAIM rather than a description: without it, the document can lose a field,
 * change a type or gain a path and every test still passes, because the tests
 * assert against the same code that generates the document. `openapi-v1.4.json`
 * is the served bytes, not a hand-written file - regenerate it, never edit it.
 * There is exactly ONE snapshot on purpose: v1.3 was DELETED when v1.4 landed,
 * because two plausible contracts in the tree is worse than none - a reader
 * cannot tell which one the service serves.
 *
 * How to regenerate (deliberate contract change only):
 *
 *   node -e "const fs=require('fs');const stub=require('./apps/api/test/helpers/stub');\
 *   stub.createTestApp().inject({method:'GET',url:'/v1/docs/json'})\
 *   .then(r=>fs.writeFileSync('apps/api/test/unit/openapi-v1.4.json',r.body+'\n'))"
 *
 * The comparison ignores ONE trailing newline so that a committed text file may
 * keep the POSIX convention; every other byte must match exactly, including key
 * order, which is what makes this a snapshot rather than a schema check.
 *
 * v1.3 adds the two dedupe-era fields: `catalog_version` (Decision 47 / migration
 * 021 - the catalog state the pass ran against, nullable like its column) and
 * `reused` (the request fact that says whether THIS POST answered from an
 * equivalent committed pass). `served_by` is deliberately UNCHANGED: it already
 * answers which deploy replied, and the dedupe did not change that question.
 *
 * v1.2 covered `components[].slug` and the `display_name`-precedence name, both
 * migration 020 (product identity); those assertions are kept below, because a
 * new minor must not silently drop the one before it.
 *
 * v1.4 adds exactly one path: `/v1/presets` (Platform P1 Sprint 6 / Decision
 * 48), the generated landing-page ribbon. No existing field changed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stub = require('../helpers/stub');

const SNAPSHOT_PATH = path.join(__dirname, 'openapi-v1.4.json');

async function servedDocument() {
  const response = await stub.createTestApp().inject({ method: 'GET', url: '/v1/docs/json' });
  assert.equal(response.statusCode, 200, 'the document endpoint must answer');
  return { raw: response.body, document: response.json() };
}

/** Both verbs serve the same response schema; that sameness IS the contract. */
function responsesFor(document) {
  return [
    ['POST 201', document.paths['/v1/recommendations'].post.responses['201']],
    ['GET 200', document.paths['/v1/recommendations/{id}'].get.responses['200']],
  ];
}

test('the served OpenAPI document is byte-identical to the committed v1.4 snapshot', async () => {
  const { raw } = await servedDocument();
  const committed = fs.readFileSync(SNAPSHOT_PATH, 'utf8');

  assert.equal(
    raw,
    committed.replace(/\n$/, ''),
    'the served document differs from openapi-v1.4.json. If the change is deliberate, regenerate the '
      + 'snapshot with the command in this file\'s header and commit it together with the schema change; '
      + 'if it is not, the contract has drifted and this is the gate that noticed.'
  );
});

test('the v1.4 document advertises the persisted pass facts on BOTH verbs', async () => {
  const { document } = await servedDocument();

  assert.equal(document.info.version, '1.4.0', 'the version names the current surface (the presets ribbon)');

  // Both verbs serve the same response schema, and that sameness is the
  // contract: a client may read either and see the same fields.
  for (const [label, response] of responsesFor(document)) {
    const schema = response.content['application/json'].schema;
    assert.ok(
      Object.prototype.hasOwnProperty.call(schema.properties, 'budget_floor'),
      label + ' declares budget_floor'
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(schema.properties, 'engine_version'),
      label + ' declares engine_version'
    );
  }

  const build = document.paths['/v1/recommendations'].post.responses['201']
    .content['application/json'].schema.properties.builds.items.properties;
  assert.ok(Object.prototype.hasOwnProperty.call(build, 'engine_version'), 'a build declares engine_version');
  assert.ok(Object.prototype.hasOwnProperty.call(build, 'strategy_key'), 'a build declares strategy_key');

  // The three pass facts are nullable in the document because their COLUMNS
  // are: NULL means "not recorded", and a schema that demanded a value would
  // both serialize-fail on a pre-019 row and assert a fact the schema calls
  // unknowable.
  //
  // `@fastify/swagger` renders TypeBox's `Union([Type.String(), Type.Null()])`
  // as OpenAPI 3.0 `nullable: true` (its "type: [string, null]" form is 3.1),
  // so the assertion pins THAT shape - which is also why a client generator
  // reading this document treats the field as optional-able rather than as a
  // union it may not understand.
  for (const key of ['engine_version', 'strategy_key']) {
    assert.deepEqual(
      build[key],
      { type: 'string', nullable: true },
      key + ' is declared a nullable string'
    );
  }
  assert.equal(
    document.paths['/v1/recommendations'].post.responses['201']
      .content['application/json'].schema.properties.budget_floor.type,
    'object',
    'budget_floor is declared as the nested object it is, not a JSON string'
  );
});

test('the v1.4 document declares the dedupe fields on BOTH verbs', async () => {
  const { document } = await servedDocument();

  for (const [label, response] of responsesFor(document)) {
    const schema = response.content['application/json'].schema;

    // Nullable because the COLUMN is (021 stores NULL for a pass whose digest
    // was unavailable, and Decision 47 item 10 makes an unknown version
    // unmatchable rather than comparable). A schema that demanded a string
    // would serialize-fail on exactly the rows the migration chose to allow.
    assert.deepEqual(
      schema.properties.catalog_version,
      { type: 'string', nullable: true },
      label + ' declares catalog_version as a nullable string'
    );

    // NOT nullable, and that is the point: `reused` is a request fact that is
    // always answerable (false on every GET and on every POST that ran its own
    // pass), so a null would mean "unknown" about something the API knows.
    assert.deepEqual(
      schema.properties.reused,
      { type: 'boolean' },
      label + ' declares reused as a required boolean'
    );
    assert.ok(
      schema.required.includes('reused') && schema.required.includes('catalog_version'),
      label + ' requires both dedupe fields'
    );
  }

  // `served_by` is unchanged by the dedupe: it still names the deploy that
  // ANSWERED the request, which is a different question from the deploy that RAN
  // the pass (billed per build as `engine_version`).
  const servedBy = document.paths['/v1/recommendations'].post.responses['201']
    .content['application/json'].schema.properties.served_by;
  assert.deepEqual(servedBy.required, ['engine_version'], 'served_by still carries exactly its one field');
});

test('the v1.4 document declares components[].slug on BOTH verbs, nullable like its column', async () => {
  const { document } = await servedDocument();

  // `slug` is served from the persisted column (migration 020), so it belongs in
  // the published contract. It is declared NULLABLE because the COLUMN is: 020
  // deliberately did not add NOT NULL, since that would break every product
  // writer that does not supply one (see that migration's header). Asserting the
  // rendered shape, not just presence, is what makes this a contract pin rather
  // than a field check - a schema that quietly demanded a string would fail
  // against a real row created after 020's backfill.
  for (const [label, response] of responsesFor(document)) {
    const component = response.content['application/json'].schema.properties.builds.items.properties.components.items;
    assert.ok(component, label + ' declares a component schema');
    assert.deepEqual(
      component.properties.slug,
      { type: 'string', nullable: true },
      label + ' declares components[].slug as a nullable string'
    );
  }

  // `display_name` is a SOURCE, not a field: it reaches clients only as `name`.
  const component = document.paths['/v1/recommendations'].post.responses['201']
    .content['application/json'].schema.properties.builds.items.properties.components.items.properties;
  assert.ok(
    !Object.prototype.hasOwnProperty.call(component, 'display_name'),
    'display_name is not advertised: it is the source of `name`, never a field'
  );
});
