'use strict';

/**
 * apps/api/test/unit/openapi-snapshot.test.js - the served OpenAPI document,
 * pinned (Sprint 4 of PLAN_PLATFORM_P0.md: v1.1 pass facts, v1.2 product
 * identity; Platform P1 Sprint 5: v1.3 request dedupe; Platform P1 Sprint 6:
 * v1.4 the presets ribbon; Platform P2 Sprint 3: v1.5 the read-only catalog;
 * v1.6 the price history; v1.7 input effects; v1.8 the swap preview; v1.9
 * product variants on the catalog list; v1.10 the committed swap).
 *
 * A committed snapshot is the only thing that makes a published contract a
 * CLAIM rather than a description: without it, the document can lose a field,
 * change a type or gain a path and every test still passes, because the tests
 * assert against the same code that generates the document. `openapi-v1.10.json`
 * is the served bytes, not a hand-written file - regenerate it, never edit it.
 * There is exactly ONE snapshot on purpose: each superseded file (v1.1 through
 * v1.7) was DELETED when the next landed, because two plausible contracts in the
 * tree is worse than none - a reader cannot tell which one the service serves.
 *
 * How to regenerate (deliberate contract change only):
 *
 *   node -e "const fs=require('fs');const stub=require('./apps/api/test/helpers/stub');\
 *   stub.createTestApp().inject({method:'GET',url:'/v1/docs/json'})\
 *   .then(r=>fs.writeFileSync('apps/api/test/unit/openapi-v1.10.json',r.body+'\n'))"
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

const SNAPSHOT_PATH = path.join(__dirname, 'openapi-v1.10.json');

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

test('the served OpenAPI document is byte-identical to the committed v1.10 snapshot', async () => {
  const { raw } = await servedDocument();
  const committed = fs.readFileSync(SNAPSHOT_PATH, 'utf8');

  assert.equal(
    raw,
    committed.replace(/\n$/, ''),
    'the served document differs from openapi-v1.10.json. If the change is deliberate, regenerate the '
      + 'snapshot with the command in this file\'s header and commit it together with the schema change; '
      + 'if it is not, the contract has drifted and this is the gate that noticed.'
  );
});

test('the served document advertises the persisted pass facts on BOTH verbs', async () => {
  const { document } = await servedDocument();

  assert.equal(
    document.info.version,
    '1.10.0',
    'the version names the current surface (adds the committed swap)'
  );

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

test('the served document declares the dedupe fields on BOTH verbs', async () => {
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

test('the served document declares components[].slug on BOTH verbs, nullable like its column', async () => {
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

test('the served document declares both catalog reads, with provenance beside every price', async () => {
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
  // Contract v1.9 adds the product's identity beside its slug: the swap preview
  // takes a product id, so a catalogue that served only slugs could not ask it
  // about the thing it had just shown.
  assert.deepEqual(item.properties.id, { type: 'string' });
  assert.deepEqual(item.properties.from_price, { type: 'number', nullable: true });
  assert.deepEqual(item.properties.offer_class, { type: 'string', nullable: true });
  assert.deepEqual(item.properties.has_offer, { type: 'boolean' });

  // Contract v1.9: a product publishes its SKUs - the identity a variant-keyed
  // GPU candidate is addressed by - ordered by id, and `[]` for a product with
  // none. Neither field is nullable: `sku` is NOT NULL in migration 003, and an
  // entry with no `id` could not be addressed at all.
  assert.deepEqual(item.properties.variants, {
    type: 'array',
    items: {
      additionalProperties: false,
      type: 'object',
      required: ['id', 'sku'],
      properties: { id: { type: 'string' }, sku: { type: 'string' } },
      title: 'CatalogVariant',
    },
  });

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

test('the served document declares the price history, and says when a trend is unknown', async () => {
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

test('the served document declares input effects, with closed vocabularies', async () => {
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

test('the served document declares the swap preview as READ-ONLY, with every branch representable', async () => {
  const { document } = await servedDocument();

  const operation = document.paths['/v1/recommendations/{id}/builds/{rank}/swap-preview'];
  assert.ok(operation && operation.get, 'the preview is a GET: a pure function of (build, live catalog)');
  assert.equal(operation.post, undefined, 'nothing about a preview is created, so there is no POST');

  // 200 is the RESULT door - a FAIL verdict is one of its answers, not an error
  // - and the four error doors Decision 55 item 8 names are all declared.
  assert.deepEqual(Object.keys(operation.get.responses).sort(), ['200', '404', '422', '429', '500']);
  for (const code of ['404', '422', '429', '500']) {
    assert.ok(
      operation.get.responses[code].content['application/json'].schema,
      code + ' declares the shared error envelope'
    );
  }

  // `role` and `product_id` are required; the VARIANT is optional at the schema
  // level because only GPU accepts one - the route is what refuses it elsewhere.
  const query = operation.get.parameters.filter((parameter) => parameter.in === 'query');
  assert.deepEqual(query.map((parameter) => parameter.name).sort(), ['product_id', 'product_variant_id', 'role']);
  assert.deepEqual(
    query.filter((parameter) => parameter.required === true).map((parameter) => parameter.name).sort(),
    ['product_id', 'role']
  );

  const body = operation.get.responses['200'].content['application/json'].schema;
  assert.deepEqual(body.required, ['compatibility', 'price', 'budget', 'catalog_version', 'engine_version']);

  // THE VERDICT: three closed values on the preview AND on every pair, because a
  // client switches on them and must render UNKNOWN as its own state.
  assert.deepEqual(enumMembers(body.properties.compatibility.properties.status).sort(), ['FAIL', 'PASS', 'UNKNOWN']);
  const pair = body.properties.compatibility.properties.pairs.items;
  assert.deepEqual(
    pair.required,
    ['check', 'role', 'partner_role', 'status', 'reason', 'evidence'],
    'a pair is exactly Decision 55 item 1\'s shape'
  );
  assert.deepEqual(enumMembers(pair.properties.status).sort(), ['FAIL', 'PASS', 'UNKNOWN']);

  // A null `partner_role` is the synthetic `eligibility` pair (an ineligible
  // candidate has no partner) and a null `reason` is a PASS pair; both must stay
  // representable or a real answer would be unserializable.
  assert.deepEqual(pair.properties.partner_role, { type: 'string', nullable: true });
  assert.deepEqual(pair.properties.reason, { type: 'string', nullable: true });

  // `check` is NOT an enum: PAIRWISE_CHECKS keys plus the non-pairwise
  // `eligibility` value, and a new relation must not force an API bump.
  assert.deepEqual(pair.properties.check, { type: 'string' });

  // `evidence` is OPEN, exactly like the catalog's `specs`, so a future rule's
  // fields are an addition rather than a breaking change.
  assert.equal(pair.properties.evidence.items.additionalProperties, true);
  assert.equal(pair.properties.evidence.items.type, 'object');

  // THE MONEY: every arithmetic field is nullable, and none of them may ever be
  // forced to 0 - an unknown operand is UNKNOWN.
  for (const field of ['previous', 'next', 'delta']) {
    assert.deepEqual(
      body.properties.price.properties[field],
      { type: 'number', nullable: true },
      field + ' is declared a nullable number'
    );
  }
  for (const field of ['total', 'delta']) {
    assert.deepEqual(
      body.properties.budget.properties[field],
      { type: 'number', nullable: true },
      'budget.' + field + ' is declared a nullable number'
    );
  }
  assert.deepEqual(
    body.properties.budget.properties.within_budget,
    { type: 'boolean', nullable: true },
    'an unknown total is never "within budget", and never "over" either'
  );

  // `price_status` keeps the catalog's and the build's vocabulary, and adds the
  // null branch an ineligible candidate needs.
  const priceStatus = JSON.stringify(body.properties.price.properties.price_status);
  assert.match(priceStatus, /indicative/);
  assert.match(priceStatus, /verified/);
  assert.match(priceStatus, /null/);

  // The live catalog digest, nullable like the column the POST serves it from,
  // and the ANSWERING deploy - the same pair a recommendation response carries.
  assert.deepEqual(body.properties.catalog_version, { type: 'string', nullable: true });
  assert.deepEqual(body.properties.engine_version, { type: 'string' });
});

test('the v1.10 document declares the COMMIT as a POST, with every refusal representable', async () => {
  const { document } = await servedDocument();

  const path = document.paths['/v1/recommendations/{id}/builds/{rank}/swap'];
  assert.ok(path && path.post, 'the commit is a POST: it APPENDS a derived build (Decision 56)');
  assert.equal(path.get, undefined, 'reading a commit is the recommendation GET, not this path');

  // Six doors: 201 is the CREATION, and each refusal has its own status because
  // the reader's next action differs for each (another part, another build,
  // another rank).
  assert.deepEqual(Object.keys(path.post.responses).sort(), ['201', '404', '409', '422', '429', '500']);
  for (const code of ['404', '409', '422', '429', '500']) {
    assert.ok(
      path.post.responses[code].content['application/json'].schema,
      code + ' declares the shared error envelope'
    );
  }

  const body = path.post.responses['201'].content['application/json'].schema;
  assert.deepEqual(
    body.required,
    ['compatibility', 'price', 'budget', 'swapped', 'catalog_version', 'engine_version'],
    'a 201 carries the three preview facts PLUS the persisted link'
  );

  // The verdict is the WHOLE build's - the value that was persisted as
  // build_candidate.compatibility_status - on a closed vocabulary.
  assert.deepEqual(
    enumMembers(body.properties.compatibility.properties.status).sort(),
    ['FAIL', 'PASS', 'UNKNOWN']
  );

  // Every arithmetic field stays nullable: a commit cannot invent a price.
  for (const field of ['previous', 'next', 'delta']) {
    assert.deepEqual(body.properties.price.properties[field], { type: 'number', nullable: true });
  }
  for (const field of ['total', 'delta']) {
    assert.deepEqual(body.properties.budget.properties[field], { type: 'number', nullable: true });
  }

  // `swapped` is REQUIRED and NOT nullable here - the one place it differs from
  // the build object the GET serves, where most builds have none.
  const swapped = body.properties.swapped;
  assert.deepEqual(swapped.required, ['role', 'committed_at', 'engine_version']);
  assert.equal(swapped.nullable, undefined, 'a 201 that named no commit would be a preview');

  // ...and on the GET's build object it IS nullable, because an untouched pass
  // has no swap and no row would answer it.
  const build = document.paths['/v1/recommendations'].post.responses['201']
    .content['application/json'].schema.properties.builds.items;
  assert.ok(build.required.includes('swapped'), 'every build reports the question, even with a null answer');
  assert.equal(build.properties.swapped.nullable, true);
  // Decision 56 item 7 made explanation nullable: a swapped build genuinely has
  // none, and the stored text describes parts it no longer carries.
  assert.deepEqual(build.properties.explanation, { type: 'string', nullable: true });
});
