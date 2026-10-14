'use strict';

/**
 * apps/api/test/unit/openapi-snapshot.test.js - the served OpenAPI document,
 * pinned (Sprint 4 of PLAN_PLATFORM_P0.md, contract v1.1).
 *
 * A committed snapshot is the only thing that makes a published contract a
 * CLAIM rather than a description: without it, the document can lose a field,
 * change a type or gain a path and every test still passes, because the tests
 * assert against the same code that generates the document. `openapi-v1.1.json`
 * is the served bytes, not a hand-written file - regenerate it, never edit it.
 *
 * How to regenerate (deliberate contract change only):
 *
 *   node -e "const fs=require('fs');const stub=require('./apps/api/test/helpers/stub');\
 *   stub.createTestApp().inject({method:'GET',url:'/v1/docs/json'})\
 *   .then(r=>fs.writeFileSync('apps/api/test/unit/openapi-v1.1.json',r.body))"
 *
 * The comparison ignores ONE trailing newline so that a committed text file may
 * keep the POSIX convention; every other byte must match exactly, including key
 * order, which is what makes this a snapshot rather than a schema check.
 *
 * Not covered here: `components[].slug` / `display_name`. Those are migration
 * 020 (product identity), which is not in the tree yet, so the v1.1 document
 * deliberately does not declare them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stub = require('../helpers/stub');

const SNAPSHOT_PATH = path.join(__dirname, 'openapi-v1.1.json');

async function servedDocument() {
  const response = await stub.createTestApp().inject({ method: 'GET', url: '/v1/docs/json' });
  assert.equal(response.statusCode, 200, 'the document endpoint must answer');
  return { raw: response.body, document: response.json() };
}

test('the served OpenAPI document is byte-identical to the committed v1.1 snapshot', async () => {
  const { raw } = await servedDocument();
  const committed = fs.readFileSync(SNAPSHOT_PATH, 'utf8');

  assert.equal(
    raw,
    committed.replace(/\n$/, ''),
    'the served document differs from openapi-v1.1.json. If the change is deliberate, regenerate the '
      + 'snapshot with the command in this file\'s header and commit it together with the schema change; '
      + 'if it is not, the contract has drifted and this is the gate that noticed.'
  );
});

test('the v1.1 document advertises the persisted pass facts on BOTH verbs', async () => {
  const { document } = await servedDocument();

  assert.equal(document.info.version, '1.1.0', 'the version names the pass-facts surface');

  // Both verbs serve the same response schema, and that sameness is the
  // contract: a client may read either and see the same fields.
  const responses = [
    ['POST 201', document.paths['/v1/recommendations'].post.responses['201']],
    ['GET 200', document.paths['/v1/recommendations/{id}'].get.responses['200']],
  ];
  for (const [label, response] of responses) {
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
