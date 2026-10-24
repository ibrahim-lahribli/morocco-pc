'use strict';

/**
 * apps/api/test/unit/openapi-snapshot.test.js - the served OpenAPI document,
 * pinned (Sprint 4 of PLAN_PLATFORM_P0.md: v1.1 pass facts, v1.2 product
 * identity; Platform P1 Sprint 5: v1.3 request dedupe; Platform P1 Sprint 6:
 * v1.4 the presets ribbon; Platform P2 Sprint 3: v1.5 the read-only catalog;
 * v1.6 the price history; v1.7 input effects).
 *
 * A committed snapshot is the only thing that makes a published contract a
 * CLAIM rather than a description: without it, the document can lose a field,
 * change a type or gain a path and every test still passes, because the tests
 * assert against the same code that generates the document. `openapi-v1.6.json`
 * is the served bytes, not a hand-written file - regenerate it, never edit it.
 * There is exactly ONE snapshot on purpose: each superseded file (v1.1 through
 * v1.5) was DELETED when the next landed, because two plausible contracts in the
 * tree is worse than none - a reader cannot tell which one the service serves.
 *
 * How to regenerate (deliberate contract change only):
 *
 *   node -e "const fs=require('fs');const stub=require('./apps/api/test/helpers/stub');\
 *   stub.createTestApp().inject({method:'GET',url:'/v1/docs/json'})\
 *   .then(r=>fs.writeFileSync('apps/api/test/unit/openapi-v1.7.json',r.body+'\n'))"
 *
 * v1.7 (Decision 52) adds TWO fields and no path: `inputs_applied` on
 * GET /v1/meta/options and `input_effects` on both recommendation verbs. Both
 * are ADDITIVE - a 1.6 client keeps working - and the new test at the bottom
 * pins their vocabularies rather than only their presence, because the whole
 * point of the field is that its values are a closed, checkable claim.
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
 *
 * v1.5 adds the read-only catalog (Platform P2 Sprint 3):
 * `/v1/catalog/products` and `/v1/catalog/products/{slug}`. No existing field
 * or path changed, and the earlier minors stay asserted below.
 *
 * v1.6 adds exactly one path: `/v1/catalog/products/{slug}/price-history`
 * (S25's unblock). No existing field or path changed. Its summary fields are
 * declared nullable for the reason the route gives: most products have ONE
 * observation, and a change over one point is UNKNOWN, not zero.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stub = require('../helpers/stub');

const SNAPSHOT_PATH = path.join(__dirname, 'openapi-v1.7.json');

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

test('the served OpenAPI document is byte-identical to the committed v1.7 snapshot', async () => {
  const { raw } = await servedDocument();
  const committed = fs.readFileSync(SNAPSHOT_PATH, 'utf8');

  assert.equal(
    raw,
    committed.replace(/\n$/, ''),
    'the served document differs from openapi-v1.7.json. If the change is deliberate, regenerate the '
      + 'snapshot with the command in this file\'s header and commit it together with the schema change; '
      + 'if it is not, the contract has drifted and this is the gate that noticed.'
  );
});

test('the v1.7 document advertises the persisted pass facts on BOTH verbs', async () => {
  const { document } = await servedDocument();

  assert.equal(document.info.version, '1.7.0', 'the version names the current surface (adds input effects)');

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

test('the v1.7 document declares the dedupe fields on BOTH verbs', async () => {
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

test('the v1.7 document declares components[].slug on BOTH verbs, nullable like its column', async () => {
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

test('the v1.7 document declares both catalog reads, with provenance beside every price', async () => {
  const { document } = await servedDocument();

  const list = document.paths['/v1/catalog/products'];
  const detail = document.paths['/v1/catalog/products/{slug}'];
  assert.ok(list && list.get, 'the catalogue list is documented');
  assert.ok(detail && detail.get, 'the product detail is documented');

  // The list's three parameters, and the one it deliberately does NOT have:
  // `use_case` could only be an inert filter, and an inert query parameter on a
  // public browse surface would tell a client its results were narrowed when
  // they were not (see routes/catalog.js's header).
  assert.deepEqual(
    list.get.parameters.map((parameter) => parameter.name).sort(),
    ['cursor', 'limit', 'role']
  );

  const page = list.get.responses['200'].content['application/json'].schema;
  assert.deepEqual(page.required, ['products', 'next_cursor']);
  assert.deepEqual(
    page.properties.next_cursor,
    { type: 'string', nullable: true },
    'the last page has no cursor, and null says exactly that'
  );

  // A price without its class is the defect this contract exists to prevent, so
  // both fields are required and BOTH are nullable: a product with no eligible
  // offer reports null, never 0 and never "verified".
  const item = page.properties.products.items;
  assert.deepEqual(item.properties.from_price, { type: 'number', nullable: true });
  assert.deepEqual(item.properties.offer_class, { type: 'string', nullable: true });
  assert.deepEqual(item.properties.has_offer, { type: 'boolean' });

  const product = detail.get.responses['200'].content['application/json'].schema;
  assert.deepEqual(
    product.required,
    ['slug', 'display_name', 'category', 'specs', 'offers', 'price_status', 'disclaimer'],
    'the disclaimer is part of the contract, not a decoration a presenter may drop'
  );
  // `specs` is OPEN by design: its keys are spec-table columns, and enumerating
  // them would make every spec migration a breaking API change.
  assert.equal(product.properties.specs.additionalProperties, true);
  assert.equal(product.properties.specs.type, 'object');
  assert.deepEqual(product.properties.offers.items.properties.price, { type: 'number' });

  // The null branch must stay representable: `price_status` over zero offers is
  // null, and a schema that forced 'verified' or 'indicative' would have to be
  // satisfied by a lie.
  const status = JSON.stringify(product.properties.price_status);
  assert.match(status, /indicative/);
  assert.match(status, /verified/);
  assert.match(status, /null/);
});

test('the v1.7 document declares the price history, and says when a trend is unknown', async () => {
  const { document } = await servedDocument();

  const history = document.paths['/v1/catalog/products/{slug}/price-history'];
  assert.ok(history && history.get, 'the price history is documented');
  assert.deepEqual(
    history.get.parameters.map((parameter) => parameter.name),
    ['slug'],
    'the history takes the slug and nothing else: no window or paging, because the route caps it'
  );

  const body = history.get.responses['200'].content['application/json'].schema;
  assert.deepEqual(
    body.required,
    [
      'slug',
      'currency',
      'points',
      'observation_count',
      'latest_price',
      'min_price',
      'max_price',
      'change_amount',
      'change_pct',
      'disclaimer',
    ],
    'the summary is part of the contract: a client must not have to re-derive it'
  );

  // Each point carries the provenance of ITS price, exactly as the list and
  // detail do - a historical price without its class would be the same defect
  // one layer down.
  const point = body.properties.points.items;
  assert.deepEqual(point.required, ['observed_at', 'price', 'offer_class']);
  assert.deepEqual(point.properties.price, { type: 'number' });

  // The change fields are nullable because thin data is the NORMAL case: a
  // single observation is a fact and not a trend, and 0 would assert the price
  // held when the catalog only ever observed it once.
  for (const field of ['latest_price', 'min_price', 'max_price', 'change_amount', 'change_pct']) {
    assert.deepEqual(
      body.properties[field],
      { type: 'number', nullable: true },
      field + ' is declared a nullable number'
    );
  }
  // Countable is not nullable: "no observation" is 0, not unknown.
  assert.deepEqual(body.properties.observation_count, { type: 'integer' });
  assert.ok(
    body.required.includes('observation_count'),
    'observation_count is required: the empty state is a fact the client formats'
  );
});

/**
 * The members of a closed vocabulary, however @fastify/swagger rendered the
 * TypeBox union: a single `enum` array, or one `anyOf` branch per literal (the
 * shape it used for `price_status` in v1.5). Reading both keeps this a
 * vocabulary assertion rather than a formatting assertion.
 */
function enumMembers(schema) {
  const branches = Array.isArray(schema.anyOf) ? schema.anyOf : [schema];
  return branches.flatMap((branch) => (Array.isArray(branch.enum) ? branch.enum : []));
}

test('the v1.7 document declares input effects, with closed vocabularies', async () => {
  const { document } = await servedDocument();

  // The DEPLOYMENT half (Decision 52): which inputs the active model reads at
  // all. Required, and possibly empty - an empty list is a fact ("this model
  // reads none of them"), while an absent field would be silence, and the web
  // wizard treats those two differently by design.
  const meta = document.paths['/v1/meta/options'].get.responses['200']
    .content['application/json'].schema;
  assert.deepEqual(
    meta.properties.inputs_applied,
    { type: 'array', items: { type: 'string' } },
    'inputs_applied is a plain string list, which is what the wizard parser accepts'
  );
  assert.ok(
    meta.required.includes('inputs_applied'),
    'inputs_applied is required: silence and an empty list must not collapse'
  );

  // The PER-PASS half, on BOTH verbs: one schema, so POST and GET cannot
  // advertise different fields (Decision 36 item 4).
  for (const [label, response] of responsesFor(document)) {
    const schema = response.content['application/json'].schema;
    const effects = schema.properties.input_effects;
    assert.ok(effects, label + ' declares input_effects');
    assert.ok(schema.required.includes('input_effects'), label + ' requires input_effects');
    assert.equal(effects.type, 'array');

    const item = effects.items;
    assert.deepEqual(item.required, ['input', 'effect', 'reason']);
    // The two vocabularies a client MAY switch on are closed and pinned.
    assert.deepEqual(
      enumMembers(item.properties.input).sort(),
      ['priority', 'resolution', 'use_case'],
      label + ' pins the input vocabulary'
    );
    assert.deepEqual(
      enumMembers(item.properties.effect).sort(),
      ['APPLIED', 'NO_EFFECT', 'UNKNOWN'],
      label + ' pins the three-valued effect vocabulary'
    );
    // `reason` stays OPEN on purpose: it explains WHY, and a new explanation
    // must not force a contract bump on a client that already switches on
    // `effect`.
    assert.deepEqual(item.properties.reason, { type: 'string' });
  }
});
