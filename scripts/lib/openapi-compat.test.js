'use strict';

// scripts/lib/openapi-compat.test.js - the classifier, as pure logic.
//
// Two halves, deliberately kept apart:
//   * THIS file pins what a given pair of documents is classified AS;
//   * scripts/lib/openapi-compat-cli.test.js pins what the gate DOES with the
//     classification (exit status, Git-ref baseline, approval waiver).
// A classifier that calls everything neutral would pass a CLI test that only
// asserts "additive passes"; the explicit BREAKING cases below are the reason
// this file exists.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { compareContracts, BREAKING, ADDITIVE, NEUTRAL } = require('./openapi-compat');
const { inspectContract } = require('./openapi-contract');

/** A response object carrying one JSON schema. */
function response(schema) {
  return { description: 'ok', content: { 'application/json': { schema } } };
}

/** A complete one-route document, so each test can change exactly one thing. */
function baseDocument() {
  return {
    openapi: '3.0.3',
    info: { title: 'test', version: '1.10.0' },
    paths: {
      '/v1/things': {
        post: {
          parameters: [{ in: 'query', name: 'limit', required: false, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['budget'],
                  properties: { budget: { type: 'object', properties: { amount: { type: 'number' } } } },
                },
              },
            },
          },
          responses: {
            201: response({
              type: 'object',
              required: ['id', 'status'],
              properties: {
                id: { type: 'string' },
                status: { type: 'string', enum: ['PASS', 'FAIL'] },
                note: { type: 'string', nullable: true },
              },
            }),
            429: response({ type: 'object', properties: { error: { type: 'string' } } }),
            500: response({ type: 'object', properties: { error: { type: 'string' } } }),
          },
        },
      },
    },
  };
}

function codes(result) {
  return result.changes.map((item) => item.code).sort();
}

function breakingCodes(result) {
  return result.breaking.map((item) => item.code).sort();
}

test('an identical document is NEUTRAL', () => {
  const result = compareContracts(baseDocument(), baseDocument());
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

// --- additive ---------------------------------------------------------------

test('an added optional property is ADDITIVE', () => {
  const candidate = baseDocument();
  candidate.paths['/v1/things'].post.responses['201'].content['application/json'].schema.properties.hint = { type: 'string' };
  const result = compareContracts(baseDocument(), candidate);
  assert.equal(result.verdict, ADDITIVE);
  assert.deepEqual(result.breaking, []);
  assert.ok(codes(result).includes('PROPERTY_ADDED'));
});

test('a new path, a new method, an added request enum member and an optional parameter are all ADDITIVE', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  candidate.paths['/v1/other'] = { get: { responses: { 200: response({ type: 'object' }) } } };
  candidate.paths['/v1/things'].get = { responses: { 200: response({ type: 'object' }) } };
  // A REQUEST enum gains a value: the caller may now send one more thing.
  const requestSchema = (doc) => doc.paths['/v1/things'].post.requestBody.content['application/json'].schema;
  requestSchema(base).properties.budget.properties.amount = { type: 'string', enum: ['MAD'] };
  requestSchema(candidate).properties.budget.properties.amount = { type: 'string', enum: ['MAD', 'EUR'] };
  candidate.paths['/v1/things'].post.parameters.push({
    in: 'query', name: 'cursor', required: false, schema: { type: 'string' },
  });
  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, ADDITIVE);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(
    codes(result),
    ['ENUM_MEMBER_ADDED', 'METHOD_ADDED', 'PARAMETER_ADDED', 'PATH_ADDED'].sort()
  );
});

test('a response that stops guaranteeing a required property or a non-null value is BREAKING', () => {
  // Direction matters: these two are ADDITIVE for a request and BREAKING for a
  // response, because a client written against the base may read a missing or
  // null field where the base promised one.
  const optional = baseDocument();
  const optionalSchema = optional.paths['/v1/things'].post.responses['201'].content['application/json'].schema;
  optionalSchema.required = optionalSchema.required.filter((name) => name !== 'status');
  const optionalResult = compareContracts(baseDocument(), optional);
  assert.deepEqual(breakingCodes(optionalResult), ['PROPERTY_BECAME_OPTIONAL']);

  const nullable = baseDocument();
  nullable.paths['/v1/things'].post.responses['201'].content['application/json'].schema
    .properties.id.nullable = true;
  const nullableResult = compareContracts(baseDocument(), nullable);
  assert.deepEqual(breakingCodes(nullableResult), ['NULLABILITY_ADDED']);
});

// --- breaking ---------------------------------------------------------------

test('a removed path is BREAKING', () => {
  const candidate = baseDocument();
  delete candidate.paths['/v1/things'];
  const result = compareContracts(baseDocument(), candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['PATH_REMOVED']);
});

test('a removed method is BREAKING but leaves the rest of the path alone', () => {
  const candidate = baseDocument();
  delete candidate.paths['/v1/things'].post;
  const result = compareContracts(baseDocument(), candidate);
  assert.deepEqual(breakingCodes(result), ['METHOD_REMOVED']);
});

test('a removed response property is BREAKING', () => {
  const candidate = baseDocument();
  delete candidate.paths['/v1/things'].post.responses['201'].content['application/json'].schema.properties.note;
  const result = compareContracts(baseDocument(), candidate);
  assert.deepEqual(breakingCodes(result), ['PROPERTY_REMOVED']);
  assert.match(result.breaking[0].location, /^POST \/v1\/things 201 /);
});

test('a changed type is BREAKING', () => {
  const candidate = baseDocument();
  candidate.paths['/v1/things'].post.responses['201'].content['application/json'].schema
    .properties.id.type = 'number';
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), candidate)), ['TYPE_CHANGED']);
});

test('a newly required property is BREAKING for a request', () => {
  const candidate = baseDocument();
  const schema = candidate.paths['/v1/things'].post.requestBody.content['application/json'].schema;
  schema.required.push('currency');
  schema.properties.currency = { type: 'string' };
  const result = compareContracts(baseDocument(), candidate);
  assert.deepEqual(breakingCodes(result), ['PROPERTY_BECAME_REQUIRED']);
});

test('a removed enum member is BREAKING', () => {
  const candidate = baseDocument();
  candidate.paths['/v1/things'].post.responses['201'].content['application/json'].schema
    .properties.status.enum = ['PASS'];
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), candidate)), ['ENUM_MEMBER_REMOVED']);
});

test('a removed response code is BREAKING', () => {
  const candidate = baseDocument();
  delete candidate.paths['/v1/things'].post.responses['429'];
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), candidate)), ['RESPONSE_REMOVED']);
});

test('a newly required parameter is BREAKING', () => {
  const candidate = baseDocument();
  candidate.paths['/v1/things'].post.parameters.push({
    in: 'query', name: 'role', required: true, schema: { type: 'string' },
  });
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), candidate)), ['REQUIRED_PARAMETER_ADDED']);
});

test('an optional parameter that becomes required is BREAKING', () => {
  const candidate = baseDocument();
  candidate.paths['/v1/things'].post.parameters[0].required = true;
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), candidate)), ['PARAMETER_BECAME_REQUIRED']);
});

test('a required parameter that becomes optional is ADDITIVE', () => {
  const base = baseDocument();
  base.paths['/v1/things'].post.parameters[0].required = true;
  const candidate = baseDocument();
  candidate.paths['/v1/things'].post.parameters[0].required = false;
  const result = compareContracts(base, candidate);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(codes(result), ['PARAMETER_BECAME_OPTIONAL']);
});

test('a response value domain may not narrow by dropping null, and a closed request object is BREAKING', () => {
  const nullableRemoved = baseDocument();
  nullableRemoved.paths['/v1/things'].post.responses['201'].content['application/json'].schema
    .properties.note.nullable = false;
  const nullableResult = compareContracts(baseDocument(), nullableRemoved);
  // Rule A6: removing null narrows the guaranteed value domain.
  assert.deepEqual(breakingCodes(nullableResult), ['NULLABILITY_REMOVED']);

  // A tightening is only a tightening where the base explicitly ALLOWED extra
  // keys: an object that never said either way stays neutral when it says
  // `false`, and the base below says `true` on purpose.
  const base = baseDocument();
  base.paths['/v1/things'].post.requestBody.content['application/json'].schema
    .properties.budget.additionalProperties = true;
  const closed = baseDocument();
  closed.paths['/v1/things'].post.requestBody.content['application/json'].schema
    .properties.budget.additionalProperties = false;
  assert.deepEqual(breakingCodes(compareContracts(base, closed)), ['OBJECT_CLOSED']);
});

test('a removed request body and a request body that becomes required are BREAKING', () => {
  const removed = baseDocument();
  delete removed.paths['/v1/things'].post.requestBody;
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), removed)), ['REQUEST_BODY_REMOVED']);

  const base = baseDocument();
  base.paths['/v1/things'].post.requestBody.required = false;
  const candidate = baseDocument();
  candidate.paths['/v1/things'].post.requestBody.required = true;
  // The nested schema is identical, so exactly one change is reported.
  assert.deepEqual(breakingCodes(compareContracts(base, candidate)), ['REQUEST_BODY_BECAME_REQUIRED']);
});

test('an optional request body added or a required body made optional is ADDITIVE, and dropping a request schema relaxes it', () => {
  const withoutBody = baseDocument();
  delete withoutBody.paths['/v1/things'].post.requestBody;

  const optionalBody = baseDocument();
  optionalBody.paths['/v1/things'].post.requestBody.required = false;

  const added = compareContracts(withoutBody, optionalBody);
  assert.deepEqual(added.breaking, []);
  assert.deepEqual(codes(added), ['REQUEST_BODY_ADDED']);

  const madeOptional = compareContracts(baseDocument(), optionalBody);
  assert.deepEqual(madeOptional.breaking, []);
  assert.deepEqual(codes(madeOptional), ['REQUEST_BODY_BECAME_OPTIONAL']);

  const withoutSchema = baseDocument();
  delete withoutSchema.paths['/v1/things'].post.requestBody.content['application/json'].schema;

  const relaxed = compareContracts(baseDocument(), withoutSchema);
  assert.deepEqual(relaxed.breaking, []);
  assert.deepEqual(codes(relaxed), ['SCHEMA_RELAXED']);

  // Re-declaring the schema on a request narrows what callers may send.
  assert.deepEqual(breakingCodes(compareContracts(withoutSchema, baseDocument())), ['SCHEMA_RESTRICTED']);
});

test('a required request property added is BREAKING, inside the request schema', () => {
  const candidate = baseDocument();
  const schema = candidate.paths['/v1/things'].post.requestBody.content['application/json'].schema;
  schema.required.push('currency');
  schema.properties.currency = { type: 'string' };
  const result = compareContracts(baseDocument(), candidate);
  assert.deepEqual(breakingCodes(result), ['PROPERTY_BECAME_REQUIRED']);
  assert.match(result.breaking[0].location, /request/);
});

test('a version change is reported but does not by itself fail', () => {
  const candidate = baseDocument();
  candidate.info.version = '1.11.0';
  const result = compareContracts(baseDocument(), candidate);
  assert.deepEqual(codes(result), ['VERSION_CHANGED']);
  assert.deepEqual(result.breaking, []);
});

// --- OpenAPI version and dialect -------------------------------------------
//
// The schema rules in the classifier are OpenAPI 3.0.3 semantics (`nullable`,
// for one). A document written against another dialect must fail closed, not be
// compared as though it were 3.0.3.

test('a candidate whose only change is openapi 3.1.0 fails closed, not NEUTRAL', () => {
  const root = path.resolve(__dirname, '..', '..');
  const contract = inspectContract(root);
  assert.ok(contract.ok, 'the committed contract must be locatable: ' + (contract.problems || []).join('; '));
  const base = JSON.parse(fs.readFileSync(path.join(root, contract.file), 'utf8'));
  const candidate = clone(base);
  candidate.openapi = '3.1.0';

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.ok(result.breaking.length > 0);
  assert.ok(result.breaking.every((item) => item.location === 'openapi'));
  assert.deepEqual([...new Set(breakingCodes(result))], ['UNCOMPARABLE']);
  assert.deepEqual(result.additive, []);
});

test('a missing or unsupported openapi version is UNCOMPARABLE at the root', () => {
  const base = baseDocument();
  for (const version of ['3.1.0', '3.0.2', '2.0', 'not-a-version', undefined]) {
    const candidate = clone(base);
    if (version === undefined) delete candidate.openapi;
    else candidate.openapi = version;

    const result = compareContracts(base, candidate);
    assert.equal(result.verdict, BREAKING, JSON.stringify(version) + ' must fail closed');
    assert.deepEqual([...new Set(breakingCodes(result))], ['UNCOMPARABLE']);
    assert.ok(result.breaking.every((item) => item.location === 'openapi'));
  }
});

test('a declared or changed jsonSchemaDialect fails closed', () => {
  const base = baseDocument();
  const added = clone(base);
  added.jsonSchemaDialect = 'https://json-schema.org/draft/2020-12/schema';

  const addedResult = compareContracts(base, added);
  assert.equal(addedResult.verdict, BREAKING);
  assert.deepEqual(breakingCodes(addedResult), ['UNCOMPARABLE']);
  assert.equal(addedResult.breaking[0].location, 'jsonSchemaDialect');

  const other = clone(added);
  other.jsonSchemaDialect = 'https://json-schema.org/draft/2019-09/schema';
  const changed = compareContracts(added, other);
  assert.equal(changed.verdict, BREAKING);
  assert.deepEqual(breakingCodes(changed), ['UNCOMPARABLE']);

  // Even identical on both sides: no dialect is applied, so it is not a pass.
  const identical = compareContracts(added, clone(added));
  assert.equal(identical.verdict, BREAKING);
  assert.deepEqual(breakingCodes(identical), ['UNCOMPARABLE']);
});

test('a newer root-level construct that changes is UNCOMPARABLE, not ignored', () => {
  const base = baseDocument();
  const candidate = clone(base);
  candidate.webhooks = { newThing: { post: { responses: { 200: response({ type: 'object' }) } } } };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(result.breaking[0].location, 'webhooks');
});

test('the classifier refuses a non-document instead of reporting a clean diff', () => {
  assert.throws(() => compareContracts(null, {}), /two parsed OpenAPI documents/);
});

test('the same pair always yields the same ordered change list', () => {
  const candidate = baseDocument();
  delete candidate.paths['/v1/things'];
  candidate.paths['/v1/extra'] = { get: { responses: { 200: response({ type: 'object' }) } } };
  assert.deepEqual(compareContracts(baseDocument(), candidate), compareContracts(baseDocument(), candidate));
});

// --- composition (allOf / anyOf / oneOf) -----------------------------------
//
// A change inside a composed branch is invisible to a comparison that only
// reads the parent's `type`/`properties`, so these cases pin the recursion and
// the request/response semantics of an added or removed branch.

/** Replace the 201 response schema of the single test route. */
function setResponseSchema(doc, schema) {
  doc.paths['/v1/things'].post.responses['201'].content['application/json'].schema = schema;
}

/** Replace the request body schema of the single test route. */
function setRequestSchema(doc, schema) {
  doc.paths['/v1/things'].post.requestBody.content['application/json'].schema = schema;
}

test('a property removed inside an allOf branch is BREAKING in a response', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  setResponseSchema(base, {
    allOf: [{ type: 'object', properties: { id: { type: 'string' }, note: { type: 'string' } } }],
  });
  setResponseSchema(candidate, {
    allOf: [{ type: 'object', properties: { id: { type: 'string' } } }],
  });
  const result = compareContracts(base, candidate);
  assert.deepEqual(breakingCodes(result), ['PROPERTY_REMOVED']);
  assert.match(result.breaking[0].location, /allOf\[0\]/);
});

test('an added allOf constraint is BREAKING for a request and ADDITIVE for a response', () => {
  const baseBranch = { type: 'object', properties: { budget: { type: 'number' } } };
  const addedBranch = { type: 'object', required: ['currency'], properties: { currency: { type: 'string' } } };

  const requestBase = baseDocument();
  const requestCandidate = baseDocument();
  setRequestSchema(requestBase, { allOf: [baseBranch] });
  setRequestSchema(requestCandidate, { allOf: [baseBranch, addedBranch] });
  const requestResult = compareContracts(requestBase, requestCandidate);
  assert.deepEqual(breakingCodes(requestResult), ['COMPOSITION_CONSTRAINT_ADDED']);

  const responseBase = baseDocument();
  const responseCandidate = baseDocument();
  setResponseSchema(responseBase, { allOf: [baseBranch] });
  setResponseSchema(responseCandidate, { allOf: [baseBranch, addedBranch] });
  const responseResult = compareContracts(responseBase, responseCandidate);
  assert.deepEqual(responseResult.breaking, []);
  assert.equal(responseResult.verdict, ADDITIVE);
});

test('a removed allOf conjunct widens a request but breaks a response', () => {
  const kept = { type: 'object', properties: { budget: { type: 'number' } } };
  const dropped = { type: 'object', required: ['currency'], properties: { currency: { type: 'string' } } };

  const requestBase = baseDocument();
  const requestCandidate = baseDocument();
  setRequestSchema(requestBase, { allOf: [kept, dropped] });
  setRequestSchema(requestCandidate, { allOf: [kept] });
  const requestResult = compareContracts(requestBase, requestCandidate);
  assert.deepEqual(breakingCodes(requestResult), []);
  assert.equal(requestResult.verdict, ADDITIVE);

  const responseBase = baseDocument();
  const responseCandidate = baseDocument();
  setResponseSchema(responseBase, { allOf: [kept, dropped] });
  setResponseSchema(responseCandidate, { allOf: [kept] });
  const responseResult = compareContracts(responseBase, responseCandidate);
  assert.deepEqual(breakingCodes(responseResult), ['COMPOSITION_CONSTRAINT_REMOVED']);
});

test('an anyOf variant added widens a request but breaks a response', () => {
  const requestBase = baseDocument();
  const requestCandidate = baseDocument();
  setRequestSchema(requestBase, { anyOf: [{ type: 'string' }, { type: 'number' }] });
  setRequestSchema(requestCandidate, { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] });
  const requestResult = compareContracts(requestBase, requestCandidate);
  assert.deepEqual(requestResult.breaking, []);
  assert.deepEqual(codes(requestResult), ['COMPOSITION_VARIANT_ADDED']);

  // A response may now serve a variant a client has never seen: BREAKING.
  const responseBase = baseDocument();
  const responseCandidate = baseDocument();
  setResponseSchema(responseBase, { anyOf: [{ type: 'string' }, { type: 'number' }] });
  setResponseSchema(responseCandidate, { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] });
  const responseResult = compareContracts(responseBase, responseCandidate);
  assert.deepEqual(breakingCodes(responseResult), ['COMPOSITION_VARIANT_ADDED']);

  const removed = baseDocument();
  setResponseSchema(removed, { anyOf: [{ type: 'string' }] });
  const removedResult = compareContracts(responseBase, removed);
  assert.deepEqual(breakingCodes(removedResult), ['COMPOSITION_VARIANT_REMOVED']);
});

test('an enum inside an anyOf branch is reported once, not once per branch', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  setResponseSchema(base, { anyOf: [{ type: 'string', enum: ['PASS', 'FAIL'] }, { type: 'null' }] });
  setResponseSchema(candidate, { anyOf: [{ type: 'string', enum: ['PASS'] }, { type: 'null' }] });
  const result = compareContracts(base, candidate);
  assert.deepEqual(breakingCodes(result), ['ENUM_MEMBER_REMOVED']);
  assert.equal(result.changes.length, 1);
});

test('reordering composition branches alone is NEUTRAL', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  setResponseSchema(base, { anyOf: [{ type: 'string' }, { type: 'number' }] });
  setResponseSchema(candidate, { anyOf: [{ type: 'number' }, { type: 'string' }] });
  const result = compareContracts(base, candidate);
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('a composition keyword that appears or disappears is BREAKING', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  setResponseSchema(base, { anyOf: [{ type: 'string' }, { type: 'null' }] });
  setResponseSchema(candidate, { type: 'string' });
  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.ok(breakingCodes(result).includes('COMPOSITION_CHANGED'));
});

test('composition changes are ordered deterministically', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  setResponseSchema(base, { anyOf: [{ type: 'string', enum: ['A', 'B'] }, { type: 'number' }] });
  setResponseSchema(candidate, { anyOf: [{ type: 'string', enum: ['A'] }, { type: 'boolean' }] });
  assert.deepEqual(compareContracts(base, candidate), compareContracts(base, candidate));
});

// --- direction-aware regression suite --------------------------------------
//
// Every case below is a change that used to be classified by its structure
// alone. The expected verdict follows the direction: a request must keep
// accepting what it accepted, a response must keep guaranteeing what it
// guaranteed. `docs/api/CONTRACT.md` documents the policy these tests pin.

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const operation = (doc) => doc.paths['/v1/things'].post;
const requestSchema = (doc) => operation(doc).requestBody.content['application/json'].schema;
const okSchema = (doc) => operation(doc).responses['201'].content['application/json'].schema;

test('a closed response enum that gains a value is BREAKING', () => {
  const candidate = baseDocument();
  okSchema(candidate).properties.status.enum.push('PENDING');
  const result = compareContracts(baseDocument(), candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['ENUM_MEMBER_ADDED']);
});

test('an extensible response enum that gains a value is ADDITIVE', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  const baseStatus = okSchema(base).properties.status;
  const candidateStatus = okSchema(candidate).properties.status;
  baseStatus['x-extensible-enum'] = ['PASS', 'FAIL'];
  candidateStatus['x-extensible-enum'] = ['PASS', 'FAIL', 'PENDING'];
  candidateStatus.enum.push('PENDING');
  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, ADDITIVE);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(codes(result), ['ENUM_MEMBER_ADDED']);
});

test('a response that drops its enum constraint is BREAKING', () => {
  const candidate = baseDocument();
  delete okSchema(candidate).properties.status.enum;
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), candidate)), ['ENUM_REMOVED']);
});

test('a request that drops an accepted enum value is BREAKING, one that gains one is ADDITIVE', () => {
  const narrowed = baseDocument();
  requestSchema(narrowed).properties.budget.properties.currency = { type: 'string', enum: ['MAD'] };
  const base = clone(narrowed);
  requestSchema(base).properties.budget.properties.currency.enum = ['MAD', 'EUR'];
  assert.deepEqual(breakingCodes(compareContracts(base, narrowed)), ['ENUM_MEMBER_REMOVED']);

  const widened = clone(base);
  requestSchema(widened).properties.budget.properties.currency.enum = ['MAD', 'EUR', 'USD'];
  const widenedResult = compareContracts(base, widened);
  assert.deepEqual(widenedResult.breaking, []);
  assert.deepEqual(codes(widenedResult), ['ENUM_MEMBER_ADDED']);
});

test('a request that declares a type where the base accepted any type is BREAKING', () => {
  const base = baseDocument();
  delete requestSchema(base).properties.budget.properties.amount.type;
  const result = compareContracts(base, baseDocument());
  assert.deepEqual(breakingCodes(result), ['TYPE_RESTRICTED']);
});

test('a request type may widen but not narrow; a response type domain is exact', () => {
  const requestBase = baseDocument();
  const requestWide = baseDocument();
  requestSchema(requestBase).properties.budget.properties.amount = { type: 'string' };
  requestSchema(requestWide).properties.budget.properties.amount = { type: ['string', 'number'] };
  const widenedRequest = compareContracts(requestBase, requestWide);
  assert.deepEqual(widenedRequest.breaking, []);
  assert.deepEqual(codes(widenedRequest), ['TYPE_WIDENED']);

  const narrowedRequest = compareContracts(requestWide, requestBase);
  assert.deepEqual(breakingCodes(narrowedRequest), ['TYPE_CHANGED']);

  const responseBase = baseDocument();
  const responseNarrow = baseDocument();
  okSchema(responseBase).properties.id = { type: ['string', 'number'] };
  okSchema(responseNarrow).properties.id = { type: 'string' };
  // Rule A6: a narrowed response type is BREAKING, because a client may rely on
  // receiving the values the base allowed.
  assert.deepEqual(breakingCodes(compareContracts(responseBase, responseNarrow)), ['TYPE_CHANGED']);

  const widenedResponse = compareContracts(responseNarrow, responseBase);
  assert.deepEqual(breakingCodes(widenedResponse), ['TYPE_CHANGED']);
});

test('a response property with no declared type that becomes string is BREAKING', () => {
  const base = baseDocument();
  delete okSchema(base).properties.id.type;
  const candidate = clone(base);
  okSchema(candidate).properties.id = { type: 'string' };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(
    result.changes.map((item) => [item.classification, item.code]),
    [[BREAKING, 'TYPE_CHANGED']]
  );
});

test('a response property with no declared type that becomes integer is BREAKING', () => {
  const base = baseDocument();
  delete okSchema(base).properties.id.type;
  const candidate = clone(base);
  okSchema(candidate).properties.id = { type: 'integer' };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(
    result.changes.map((item) => [item.classification, item.code]),
    [[BREAKING, 'TYPE_CHANGED']]
  );
});

test('a response property that drops its declared type is BREAKING', () => {
  const candidate = baseDocument();
  delete okSchema(candidate).properties.id.type;

  const result = compareContracts(baseDocument(), candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(
    result.changes.map((item) => [item.classification, item.code]),
    [[BREAKING, 'TYPE_CHANGED']]
  );
});

test('a response property that changes to an incompatible declared type is BREAKING', () => {
  const candidate = baseDocument();
  okSchema(candidate).properties.id = { type: 'integer' };

  const result = compareContracts(baseDocument(), candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(
    result.changes.map((item) => [item.classification, item.code]),
    [[BREAKING, 'TYPE_CHANGED']]
  );
});

test('request type classification still widens safely and restricts conservatively', () => {
  const unconstrained = baseDocument();
  delete requestSchema(unconstrained).properties.budget.properties.amount.type;

  const declared = clone(unconstrained);
  requestSchema(declared).properties.budget.properties.amount = { type: 'integer' };
  const restricted = compareContracts(unconstrained, declared);
  assert.equal(restricted.verdict, BREAKING);
  assert.deepEqual(
    restricted.changes.map((item) => [item.classification, item.code]),
    [[BREAKING, 'TYPE_RESTRICTED']]
  );

  const relaxed = compareContracts(declared, unconstrained);
  assert.equal(relaxed.verdict, ADDITIVE);
  assert.deepEqual(
    relaxed.changes.map((item) => [item.classification, item.code]),
    [[ADDITIVE, 'TYPE_WIDENED']]
  );

  const stringRequest = baseDocument();
  requestSchema(stringRequest).properties.budget.properties.amount = { type: 'string' };
  const integerRequest = clone(stringRequest);
  requestSchema(integerRequest).properties.budget.properties.amount = { type: 'integer' };
  const incompatible = compareContracts(stringRequest, integerRequest);
  assert.equal(incompatible.verdict, BREAKING);
  assert.deepEqual(
    incompatible.changes.map((item) => [item.classification, item.code]),
    [[BREAKING, 'TYPE_CHANGED']]
  );
});

test('a response schema replaced by an incompatible one is BREAKING', () => {
  const candidate = baseDocument();
  setResponseSchema(candidate, { type: 'array', items: { type: 'string' } });
  const result = compareContracts(baseDocument(), candidate);
  assert.equal(result.verdict, BREAKING);
  assert.ok(breakingCodes(result).includes('TYPE_CHANGED'));
  // The replaced object's properties are gone too, and every one is reported.
  assert.ok(breakingCodes(result).includes('PROPERTY_REMOVED'));
});

test('a response that gains a schema where it guaranteed none is ADDITIVE, and dropping one is BREAKING', () => {
  const undeclared = baseDocument();
  delete operation(undeclared).responses['201'].content['application/json'].schema;

  const added = compareContracts(undeclared, baseDocument());
  assert.deepEqual(added.breaking, []);
  assert.deepEqual(codes(added), ['SCHEMA_ADDED']);

  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), undeclared)), ['SCHEMA_REMOVED']);
});

test('a removed response media type is BREAKING and an added one is ADDITIVE', () => {
  const removed = baseDocument();
  delete operation(removed).responses['201'].content['application/json'];
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), removed)), ['MEDIA_TYPE_REMOVED']);

  const added = baseDocument();
  operation(added).responses['201'].content['text/plain'] = { schema: { type: 'string' } };
  const addedResult = compareContracts(baseDocument(), added);
  assert.deepEqual(addedResult.breaking, []);
  assert.ok(codes(addedResult).includes('MEDIA_TYPE_ADDED'));
});

// --- Media Type Object encoding --------------------------------------------
//
// `encoding` changes the request wire format without changing the schema, so
// every entry or serialization change is BREAKING. An unsupported field is
// UNCOMPARABLE (which also fails the gate), never silently accepted.

function setMultipartBody(doc, encoding) {
  const mediaType = {
    schema: {
      type: 'object',
      properties: { file: { type: 'string' }, meta: { type: 'object' } },
    },
  };
  if (encoding !== undefined) mediaType.encoding = encoding;
  operation(doc).requestBody.content = { 'multipart/form-data': mediaType };
}

function multipartEncoding(doc) {
  return operation(doc).requestBody.content['multipart/form-data'].encoding;
}

test('adding a media-type encoding entry is BREAKING', () => {
  const base = baseDocument();
  setMultipartBody(base);
  const candidate = clone(base);
  setMultipartBody(candidate, { file: { contentType: 'application/octet-stream' } });

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['ENCODING_ADDED']);
});

test('removing a media-type encoding entry is BREAKING', () => {
  const base = baseDocument();
  setMultipartBody(base, {
    file: { contentType: 'text/plain' },
    meta: { style: 'form' },
  });
  const candidate = clone(base);
  delete multipartEncoding(candidate).meta;

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['ENCODING_REMOVED']);
});

test('changing an encoding contentType is BREAKING', () => {
  const base = baseDocument();
  setMultipartBody(base, { file: { contentType: 'text/plain' } });
  const candidate = clone(base);
  multipartEncoding(candidate).file.contentType = 'application/octet-stream';

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['ENCODING_CHANGED']);
});

test('changing an encoding style or explode flag is BREAKING', () => {
  const base = baseDocument();
  setMultipartBody(base, { meta: { style: 'form', explode: true } });

  const style = clone(base);
  multipartEncoding(style).meta.style = 'spaceDelimited';
  const styleResult = compareContracts(base, style);
  assert.equal(styleResult.breaking.length, 1);
  assert.deepEqual(breakingCodes(styleResult), ['ENCODING_CHANGED']);

  const explode = clone(base);
  multipartEncoding(explode).meta.explode = false;
  const explodeResult = compareContracts(base, explode);
  assert.equal(explodeResult.breaking.length, 1);
  assert.deepEqual(breakingCodes(explodeResult), ['ENCODING_CHANGED']);
});

test('changing an encoding header is BREAKING', () => {
  const base = baseDocument();
  setMultipartBody(base, {
    file: { headers: { 'X-Part': { schema: { type: 'string' } } } },
  });

  const narrowed = clone(base);
  multipartEncoding(narrowed).file.headers['X-Part'].schema.type = 'integer';
  const narrowedResult = compareContracts(base, narrowed);
  assert.deepEqual(breakingCodes(narrowedResult), ['TYPE_CHANGED']);
  assert.match(narrowedResult.breaking[0].location, /encoding.*header "X-Part"/);

  const removed = clone(base);
  delete multipartEncoding(removed).file.headers['X-Part'];
  assert.deepEqual(breakingCodes(compareContracts(base, removed)), ['ENCODING_HEADER_REMOVED']);
});

test('an encoding header that moves between schema and content fails closed', () => {
  const base = baseDocument();
  setMultipartBody(base, {
    file: { headers: { 'X-Part': { schema: { type: 'string' } } } },
  });
  const toContent = clone(base);
  multipartEncoding(toContent).file.headers['X-Part'] = {
    content: { 'application/json': { schema: { type: 'object' } } },
  };

  const toContentResult = compareContracts(base, toContent);
  assert.equal(toContentResult.verdict, BREAKING);
  assert.equal(toContentResult.breaking[0].classification, BREAKING);
  assert.deepEqual(breakingCodes(toContentResult), ['UNCOMPARABLE']);
  assert.match(toContentResult.breaking[0].location, /encoding.*header "X-Part"/);
  assert.match(toContentResult.breaking[0].detail, /schema to content/);

  const toSchemaResult = compareContracts(toContent, base);
  assert.equal(toSchemaResult.verdict, BREAKING);
  assert.equal(toSchemaResult.breaking[0].classification, BREAKING);
  assert.deepEqual(breakingCodes(toSchemaResult), ['UNCOMPARABLE']);
  assert.match(toSchemaResult.breaking[0].detail, /content to schema/);
});

test('unchanged schema-based and content-based encoding headers produce no difference', () => {
  const doc = baseDocument();
  setMultipartBody(doc, {
    file: {
      headers: {
        'X-Schema': { schema: { type: 'string' } },
        'X-Content': { content: { 'application/json': { schema: { type: 'object' } } } },
      },
    },
  });

  const result = compareContracts(doc, clone(doc));
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('an encoding header content media type or schema change is compared, not skipped', () => {
  const base = baseDocument();
  setMultipartBody(base, {
    file: {
      headers: {
        'X-Content': { content: { 'application/json': { schema: { type: 'string' } } } },
      },
    },
  });

  const mediaType = clone(base);
  multipartEncoding(mediaType).file.headers['X-Content'].content = {
    'application/xml': { schema: { type: 'string' } },
  };
  assert.deepEqual(breakingCodes(compareContracts(base, mediaType)), ['MEDIA_TYPE_REMOVED']);

  const schema = clone(base);
  multipartEncoding(schema).file.headers['X-Content'].content['application/json'].schema = { type: 'integer' };
  assert.deepEqual(breakingCodes(compareContracts(base, schema)), ['TYPE_CHANGED']);
});

test('an unchanged encoding object produces no difference', () => {
  const doc = baseDocument();
  setMultipartBody(doc, {
    file: {
      contentType: 'application/octet-stream',
      headers: { 'X-Part': { schema: { type: 'string' } } },
    },
    meta: { style: 'form', explode: true, allowReserved: false },
  });

  const result = compareContracts(doc, clone(doc));
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('an unsupported encoding field change fails closed as UNCOMPARABLE', () => {
  const base = baseDocument();
  setMultipartBody(base, { file: { contentType: 'text/plain' } });
  const candidate = clone(base);
  multipartEncoding(candidate).file.contentEncoding = 'base64';

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.match(result.breaking[0].detail, /"contentEncoding"/);
});

test('a removed response header is BREAKING, an added one is ADDITIVE, and required -> optional is BREAKING', () => {
  const base = baseDocument();
  operation(base).responses['201'].headers = {
    'X-Request-Id': { required: true, schema: { type: 'string' } },
    'X-Trace': { schema: { type: 'string' } },
  };

  const removed = clone(base);
  delete operation(removed).responses['201'].headers['X-Request-Id'];
  assert.deepEqual(breakingCodes(compareContracts(base, removed)), ['RESPONSE_HEADER_REMOVED']);

  const optional = clone(base);
  operation(optional).responses['201'].headers['X-Request-Id'].required = false;
  assert.deepEqual(breakingCodes(compareContracts(base, optional)), ['RESPONSE_HEADER_BECAME_OPTIONAL']);

  const added = clone(base);
  operation(added).responses['201'].headers['X-Rate-Limit'] = { schema: { type: 'integer' } };
  const addedResult = compareContracts(base, added);
  assert.deepEqual(addedResult.breaking, []);
  assert.deepEqual(codes(addedResult), ['RESPONSE_HEADER_ADDED']);
});

test('a response header that becomes guaranteed present is ADDITIVE', () => {
  const base = baseDocument();
  operation(base).responses['201'].headers = { 'X-Request-Id': { schema: { type: 'string' } } };

  const candidate = clone(base);
  operation(candidate).responses['201'].headers['X-Request-Id'].required = true;

  const result = compareContracts(base, candidate);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(codes(result), ['RESPONSE_HEADER_BECAME_REQUIRED']);
});

test('a response header content change is compared, not skipped', () => {
  const base = baseDocument();
  operation(base).responses['201'].headers = {
    'X-Detail': { content: { 'application/json': { schema: { type: 'string' } } } },
  };

  const schemaChanged = clone(base);
  operation(schemaChanged).responses['201'].headers['X-Detail']
    .content['application/json'].schema = { type: 'integer' };
  assert.deepEqual(breakingCodes(compareContracts(base, schemaChanged)), ['TYPE_CHANGED']);

  const mediaTypeChanged = clone(base);
  operation(mediaTypeChanged).responses['201'].headers['X-Detail'].content = {
    'application/xml': { schema: { type: 'string' } },
  };
  assert.deepEqual(breakingCodes(compareContracts(base, mediaTypeChanged)), ['MEDIA_TYPE_REMOVED']);

  const representationChanged = clone(base);
  operation(representationChanged).responses['201'].headers['X-Detail'] = { schema: { type: 'string' } };
  const result = compareContracts(base, representationChanged);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
});

test('a response object that was closed rejects a new property and opening it is BREAKING', () => {
  const closedBase = baseDocument();
  okSchema(closedBase).additionalProperties = false;

  const addedProperty = clone(closedBase);
  okSchema(addedProperty).properties.hint = { type: 'string' };
  assert.deepEqual(breakingCodes(compareContracts(closedBase, addedProperty)), ['PROPERTY_ADDED']);

  const opened = clone(closedBase);
  okSchema(opened).additionalProperties = true;
  assert.deepEqual(breakingCodes(compareContracts(closedBase, opened)), ['OBJECT_OPENED']);

  // The reverse direction only strengthens the guarantee.
  const closed = compareContracts(opened, closedBase);
  assert.deepEqual(closed.breaking, []);
  assert.ok(codes(closed).includes('OBJECT_CLOSED'));
});

test('a new response status code is ADDITIVE', () => {
  const candidate = baseDocument();
  operation(candidate).responses['202'] = response({ type: 'object' });
  const result = compareContracts(baseDocument(), candidate);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(codes(result), ['RESPONSE_ADDED']);
});

test('request validation that becomes stricter is BREAKING, looser is ADDITIVE', () => {
  const base = baseDocument();
  requestSchema(base).properties.budget.properties.currency = { type: 'string', minLength: 2 };

  const stricter = clone(base);
  requestSchema(stricter).properties.budget.properties.currency.minLength = 5;
  assert.deepEqual(breakingCodes(compareContracts(base, stricter)), ['VALIDATION_RESTRICTED']);

  const looser = clone(base);
  requestSchema(looser).properties.budget.properties.currency.minLength = 1;
  const looserResult = compareContracts(base, looser);
  assert.deepEqual(looserResult.breaking, []);
  assert.deepEqual(codes(looserResult), ['VALIDATION_RELAXED']);

  const patterned = clone(base);
  requestSchema(patterned).properties.budget.properties.currency.pattern = '^[A-Z]{3}$';
  assert.deepEqual(breakingCodes(compareContracts(base, patterned)), ['VALIDATION_RESTRICTED']);
});

test('any response validation change is BREAKING: the guaranteed value domain changed', () => {
  const base = baseDocument();
  okSchema(base).properties.id = { type: 'string', minLength: 3 };

  const looser = clone(base);
  delete okSchema(looser).properties.id.minLength;
  assert.deepEqual(breakingCodes(compareContracts(base, looser)), ['VALIDATION_RELAXED']);

  const stricter = clone(base);
  okSchema(stricter).properties.id.minLength = 8;
  assert.deepEqual(breakingCodes(compareContracts(base, stricter)), ['VALIDATION_RESTRICTED']);
});

test('a constraint that changes without a comparable ordering is BREAKING', () => {
  const base = baseDocument();
  okSchema(base).properties.id.format = 'uuid';

  const candidate = clone(base);
  okSchema(candidate).properties.id.format = 'email';

  assert.deepEqual(breakingCodes(compareContracts(base, candidate)), ['VALIDATION_CHANGED']);
});

test('a request enum constraint added is BREAKING and dropped is ADDITIVE', () => {
  const plain = baseDocument();
  requestSchema(plain).properties.budget.properties.currency = { type: 'string' };
  const restricted = clone(plain);
  requestSchema(restricted).properties.budget.properties.currency.enum = ['MAD', 'EUR'];
  assert.deepEqual(breakingCodes(compareContracts(plain, restricted)), ['ENUM_RESTRICTED']);

  const opened = compareContracts(restricted, plain);
  assert.deepEqual(opened.breaking, []);
  assert.deepEqual(codes(opened), ['ENUM_OPENED']);
});

test('a response enum constraint added is BREAKING: values the base allowed disappear', () => {
  const plain = baseDocument();
  okSchema(plain).properties.status = { type: 'string' };
  const restricted = clone(plain);
  okSchema(restricted).properties.status = { type: 'string', enum: ['PASS', 'FAIL'] };
  assert.deepEqual(breakingCodes(compareContracts(plain, restricted)), ['ENUM_RESTRICTED']);
});

test('a request property removed is BREAKING even when extra properties were allowed', () => {
  const base = baseDocument();
  requestSchema(base).properties.budget.properties.currency = { type: 'string' };
  const candidate = clone(base);
  delete requestSchema(candidate).properties.budget.properties.currency;
  assert.deepEqual(breakingCodes(compareContracts(base, candidate)), ['PROPERTY_REMOVED']);
});

test('an optional request property becoming required is BREAKING', () => {
  const base = baseDocument();
  requestSchema(base).properties.budget.properties.currency = { type: 'string' };
  const candidate = clone(base);
  requestSchema(candidate).required.push('currency');
  assert.deepEqual(breakingCodes(compareContracts(base, candidate)), ['PROPERTY_BECAME_REQUIRED']);
});

test('an added optional request property is ADDITIVE', () => {
  const candidate = baseDocument();
  requestSchema(candidate).properties.budget.properties.currency = { type: 'string' };
  const result = compareContracts(baseDocument(), candidate);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(codes(result), ['PROPERTY_ADDED']);
});

test('a nullable request property that becomes non-nullable rejects a previously accepted null', () => {
  const base = baseDocument();
  requestSchema(base).properties.budget.properties.currency = { type: 'string', nullable: true };
  const candidate = clone(base);
  requestSchema(candidate).properties.budget.properties.currency.nullable = false;
  assert.deepEqual(breakingCodes(compareContracts(base, candidate)), ['NULLABILITY_REMOVED']);
});

test('a request object that closes additionalProperties is BREAKING, opening it is ADDITIVE', () => {
  const open = baseDocument();
  requestSchema(open).additionalProperties = true;
  const closed = clone(open);
  requestSchema(closed).additionalProperties = false;
  assert.deepEqual(breakingCodes(compareContracts(open, closed)), ['OBJECT_CLOSED']);

  const opened = compareContracts(closed, open);
  assert.deepEqual(opened.breaking, []);
  assert.deepEqual(codes(opened), ['OBJECT_OPENED']);
});

test('a removed request parameter is BREAKING', () => {
  const candidate = baseDocument();
  operation(candidate).parameters = [];
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), candidate)), ['PARAMETER_REMOVED']);
});

// --- Path Item parameters --------------------------------------------------
//
// Path-level parameters are inherited by every operation. These cases pin the
// inheritance, the operation-level override, and the fact that a path-level
// change is judged by the request rules for every operation that inherits it.

function setPathParameters(doc, parameters) {
  doc.paths['/v1/things'].parameters = parameters;
}

function tenant(schema, required = false) {
  return { in: 'query', name: 'tenant', required, schema };
}

test('removing a required path-level parameter is BREAKING', () => {
  const base = baseDocument();
  setPathParameters(base, [tenant({ type: 'string' }, true)]);
  const candidate = clone(base);
  delete candidate.paths['/v1/things'].parameters;

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['PARAMETER_REMOVED']);
});

test('a path-level parameter that becomes required is BREAKING', () => {
  const base = baseDocument();
  setPathParameters(base, [tenant({ type: 'string' }, false)]);
  const candidate = clone(base);
  candidate.paths['/v1/things'].parameters[0].required = true;

  assert.deepEqual(breakingCodes(compareContracts(base, candidate)), ['PARAMETER_BECAME_REQUIRED']);
});

test('narrowing a path-level parameter schema is BREAKING', () => {
  const base = baseDocument();
  setPathParameters(base, [tenant({ type: 'string', enum: ['A', 'B'] }, false)]);
  const candidate = clone(base);
  candidate.paths['/v1/things'].parameters[0].schema.enum = ['A'];

  assert.deepEqual(breakingCodes(compareContracts(base, candidate)), ['ENUM_MEMBER_REMOVED']);
});

test('adding an optional path-level parameter is ADDITIVE and a required one is BREAKING', () => {
  const optional = baseDocument();
  setPathParameters(optional, [tenant({ type: 'string' }, false)]);
  const optionalResult = compareContracts(baseDocument(), optional);
  assert.deepEqual(optionalResult.breaking, []);
  assert.deepEqual(codes(optionalResult), ['PARAMETER_ADDED']);

  const required = baseDocument();
  setPathParameters(required, [tenant({ type: 'string' }, true)]);
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), required)), ['REQUIRED_PARAMETER_ADDED']);
});

test('an operation-level parameter overrides the inherited path-level parameter', () => {
  const base = baseDocument();
  setPathParameters(base, [tenant({ type: 'string' }, false)]);
  // The operation restates the same name+in, so it owns the effective contract.
  operation(base).parameters.push(tenant({ type: 'string' }, false));

  const candidate = clone(base);
  // Tightening the inherited declaration must not leak through the override.
  candidate.paths['/v1/things'].parameters[0].required = true;
  candidate.paths['/v1/things'].parameters[0].schema = { type: 'integer' };

  const result = compareContracts(base, candidate);
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('an unchanged inherited path-level parameter is not a false positive', () => {
  const base = baseDocument();
  setPathParameters(base, [tenant({ type: 'string' }, true)]);

  const result = compareContracts(base, clone(base));
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('a path-level parameter change is detected for every operation that inherits it', () => {
  const base = baseDocument();
  base.paths['/v1/things'].get = { responses: { 200: response({ type: 'object' }) } };
  setPathParameters(base, [tenant({ type: 'string' }, true)]);

  const candidate = clone(base);
  candidate.paths['/v1/things'].parameters[0].schema = { type: 'integer' };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.equal(result.breaking.length, 2);
  assert.deepEqual(breakingCodes(result), ['TYPE_CHANGED', 'TYPE_CHANGED']);
  assert.ok(result.breaking.some((item) => item.location.startsWith('GET ')));
  assert.ok(result.breaking.some((item) => item.location.startsWith('POST ')));
});

// --- Parameter representations ---------------------------------------------
//
// OpenAPI allows a Parameter Object to declare its value with EITHER `schema`
// OR `content`, never both. Comparing only the branch both sides happen to
// share made a schema -> content move look additive: the old schema "went
// away" and the new content was never inspected. These cases pin the
// fail-closed transition.

function setQueryParameters(doc, parameters) {
  operation(doc).parameters = parameters;
}

function schemaParameter(schema) {
  return { in: 'query', name: 'filter', schema };
}

function contentParameter(mediaType, schema) {
  return { in: 'query', name: 'filter', content: { [mediaType]: { schema } } };
}

test('a parameter that moves between schema and content is UNCOMPARABLE, not additive', () => {
  const base = baseDocument();
  setQueryParameters(base, [schemaParameter({ type: 'string' })]);
  const toContent = clone(base);
  setQueryParameters(toContent, [contentParameter('application/json', { type: 'object' })]);

  const toContentResult = compareContracts(base, toContent);
  assert.equal(toContentResult.verdict, BREAKING);
  assert.equal(toContentResult.breaking[0].classification, BREAKING);
  assert.deepEqual(breakingCodes(toContentResult), ['UNCOMPARABLE']);
  assert.match(toContentResult.breaking[0].detail, /schema to content/);
  assert.match(toContentResult.breaking[0].location, /parameter query:filter/);

  const toSchemaResult = compareContracts(toContent, base);
  assert.equal(toSchemaResult.verdict, BREAKING);
  assert.equal(toSchemaResult.breaking[0].classification, BREAKING);
  assert.deepEqual(breakingCodes(toSchemaResult), ['UNCOMPARABLE']);
  assert.match(toSchemaResult.breaking[0].detail, /content to schema/);
  assert.match(toSchemaResult.breaking[0].location, /parameter query:filter/);
});

test('unchanged schema-based and content-based parameters produce no finding', () => {
  const doc = baseDocument();
  setQueryParameters(doc, [
    schemaParameter({ type: 'string' }),
    contentParameter('application/json', { type: 'object' }),
  ]);

  const result = compareContracts(doc, clone(doc));
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('a parameter content media type or schema change is compared, not skipped', () => {
  const base = baseDocument();
  setQueryParameters(base, [contentParameter('application/json', { type: 'string' })]);

  const mediaType = clone(base);
  setQueryParameters(mediaType, [contentParameter('application/xml', { type: 'string' })]);
  assert.deepEqual(breakingCodes(compareContracts(base, mediaType)), ['MEDIA_TYPE_REMOVED']);

  const schema = clone(base);
  setQueryParameters(schema, [contentParameter('application/json', { type: 'integer' })]);
  assert.deepEqual(breakingCodes(compareContracts(base, schema)), ['TYPE_CHANGED']);
});

test('a parameter that drops its representation fails closed instead of reading as additive', () => {
  const base = baseDocument();
  setQueryParameters(base, [schemaParameter({ type: 'string' })]);
  const candidate = clone(base);
  setQueryParameters(candidate, [{ in: 'query', name: 'filter' }]);

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.match(result.breaking[0].detail, /schema to none/);
});

test('an unresolvable parameter $ref is UNCOMPARABLE, never an implicit pass', () => {
  const base = baseDocument();
  setQueryParameters(base, [{
    in: 'query',
    name: 'filter',
    $ref: '#/components/parameters/Missing',
  }]);

  const result = compareContracts(base, clone(base));
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
});

test('nested object properties keep their direction', () => {
  const base = baseDocument();
  const nested = { type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } } };
  okSchema(base).properties.meta = clone(nested);
  requestSchema(base).properties.meta = clone(nested);

  const responseOptional = clone(base);
  okSchema(responseOptional).properties.meta.required = [];
  assert.deepEqual(breakingCodes(compareContracts(base, responseOptional)), ['PROPERTY_BECAME_OPTIONAL']);

  const requestOptional = clone(base);
  requestSchema(requestOptional).properties.meta.required = [];
  const requestResult = compareContracts(base, requestOptional);
  assert.deepEqual(requestResult.breaking, []);
  assert.deepEqual(codes(requestResult), ['PROPERTY_BECAME_OPTIONAL']);

  const responseNullable = clone(base);
  okSchema(responseNullable).properties.meta.properties.a.nullable = true;
  assert.deepEqual(breakingCodes(compareContracts(base, responseNullable)), ['NULLABILITY_ADDED']);
});

test('array item schemas are compared, not skipped', () => {
  const base = baseDocument();
  const items = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } };
  okSchema(base).properties.builds = { type: 'array', items: clone(items) };

  const response = clone(base);
  okSchema(response).properties.builds.items.properties.id.type = 'number';
  assert.deepEqual(breakingCodes(compareContracts(base, response)), ['TYPE_CHANGED']);

  const optional = clone(base);
  okSchema(optional).properties.builds.items.required = [];
  assert.deepEqual(breakingCodes(compareContracts(base, optional)), ['PROPERTY_BECAME_OPTIONAL']);

  const nestedRequest = baseDocument();
  requestSchema(nestedRequest).properties.builds = { type: 'array', items: clone(items) };
  const tightened = clone(nestedRequest);
  requestSchema(tightened).properties.builds.items.required.push('name');
  requestSchema(tightened).properties.builds.items.properties.name = { type: 'string' };
  assert.deepEqual(breakingCodes(compareContracts(nestedRequest, tightened)), ['PROPERTY_BECAME_REQUIRED']);
});

test('oneOf follows the same direction rules as anyOf', () => {
  const base = baseDocument();
  const added = baseDocument();
  setRequestSchema(base, { oneOf: [{ type: 'string' }, { type: 'number' }] });
  setRequestSchema(added, { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] });
  const requestResult = compareContracts(base, added);
  assert.deepEqual(requestResult.breaking, []);
  assert.deepEqual(codes(requestResult), ['COMPOSITION_VARIANT_ADDED']);

  const responseBase = baseDocument();
  const responseAdded = baseDocument();
  setResponseSchema(responseBase, { oneOf: [{ type: 'string' }, { type: 'number' }] });
  setResponseSchema(responseAdded, { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] });
  assert.deepEqual(breakingCodes(compareContracts(responseBase, responseAdded)), ['COMPOSITION_VARIANT_ADDED']);
});

// --- $ref resolution -------------------------------------------------------

function refDocument() {
  const doc = baseDocument();
  doc.components = {
    schemas: {
      Thing: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  };
  setResponseSchema(doc, { $ref: '#/components/schemas/Thing' });
  setRequestSchema(doc, { $ref: '#/components/schemas/Thing' });
  return doc;
}

test('a $ref is resolved, so an unchanged reference is NEUTRAL', () => {
  const result = compareContracts(refDocument(), refDocument());
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('a change inside a referenced component is detected in both directions', () => {
  const base = refDocument();
  const candidate = clone(base);
  candidate.components.schemas.Thing.properties.id.type = 'number';
  const result = compareContracts(base, candidate);
  assert.equal(result.breaking.length, 2); // the request and the response both see it
  assert.ok(result.breaking.every((item) => item.code === 'TYPE_CHANGED'));
});

test('an inline schema equivalent to a $ref target is NEUTRAL, not a diff', () => {
  const inlined = baseDocument();
  setResponseSchema(inlined, { type: 'object', required: ['id'], properties: { id: { type: 'string' } } });
  const refCandidate = baseDocument();
  const components = { schemas: { Thing: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } };
  refCandidate.components = components;
  setResponseSchema(refCandidate, { $ref: '#/components/schemas/Thing' });
  const result = compareContracts(inlined, refCandidate);
  assert.deepEqual(result.changes, []);
});

test('a recursive $ref terminates instead of looping', () => {
  const doc = baseDocument();
  doc.components = {
    schemas: {
      Node: {
        type: 'object',
        properties: { value: { type: 'string' }, next: { $ref: '#/components/schemas/Node' } },
      },
    },
  };
  setResponseSchema(doc, { $ref: '#/components/schemas/Node' });
  const result = compareContracts(doc, clone(doc));
  assert.deepEqual(result.changes, []);
});

test('an unresolvable $ref is UNCOMPARABLE, never ADDITIVE', () => {
  const candidate = baseDocument();
  candidate.components = { schemas: {} };
  setResponseSchema(candidate, { $ref: '#/components/schemas/Missing' });
  const result = compareContracts(baseDocument(), candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
});

// --- generic Reference Object semantics ------------------------------------
//
// OpenAPI 3.0.3 §4.7.2: only `$ref` has meaning in a Reference Object and every
// sibling is IGNORED. Merging siblings into the target let a sibling override a
// changed target, so a real change could compare equal. These cases pin the
// target as the whole description at every generic Reference Object position.

function requestRefDocument(schema) {
  const doc = baseDocument();
  doc.components = { schemas: { Payload: schema } };
  setRequestSchema(doc, { $ref: '#/components/schemas/Payload' });
  return doc;
}

function referencedResponseDocument(schema) {
  const doc = baseDocument();
  doc.components = { responses: { Ok: response(schema) } };
  operation(doc).responses['201'] = { $ref: '#/components/responses/Ok' };
  return doc;
}

function referencedRequestBodyDocument(schema) {
  const doc = baseDocument();
  doc.components = {
    requestBodies: { Payload: { required: true, content: { 'application/json': { schema } } } },
  };
  operation(doc).requestBody = { $ref: '#/components/requestBodies/Payload' };
  return doc;
}

function referencedParameterDocument(schema) {
  const doc = baseDocument();
  doc.components = { parameters: { Filter: { in: 'query', name: 'filter', schema } } };
  setQueryParameters(doc, [{ $ref: '#/components/parameters/Filter' }]);
  return doc;
}

test('a sibling on a request schema reference cannot mask a changed target', () => {
  const base = requestRefDocument({ type: 'string' });
  const candidate = clone(base);
  candidate.components.schemas.Payload = { type: 'integer' };
  setRequestSchema(candidate, { $ref: '#/components/schemas/Payload', type: 'string' });

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['TYPE_CHANGED']);
  assert.equal(result.breaking[0].location, 'POST /v1/things request application/json');
});

test('a sibling on a response reference cannot mask a changed target', () => {
  const base = referencedResponseDocument({ type: 'string' });
  const candidate = clone(base);
  candidate.components.responses.Ok.content['application/json'].schema = { type: 'integer' };
  operation(candidate).responses['201'] = {
    $ref: '#/components/responses/Ok',
    content: { 'application/json': { schema: { type: 'string' } } },
  };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['TYPE_CHANGED']);
  assert.equal(result.breaking[0].location, 'POST /v1/things 201 application/json');
});

test('a sibling on a request body reference cannot mask a changed target', () => {
  const base = referencedRequestBodyDocument({ type: 'string' });
  const candidate = clone(base);
  candidate.components.requestBodies.Payload.content['application/json'].schema = { type: 'integer' };
  operation(candidate).requestBody = {
    $ref: '#/components/requestBodies/Payload',
    required: false,
    content: { 'application/json': { schema: { type: 'string' } } },
  };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['TYPE_CHANGED']);
  assert.equal(result.breaking[0].location, 'POST /v1/things request application/json');
});

test('a sibling on a parameter reference cannot mask a changed target', () => {
  const base = referencedParameterDocument({ type: 'string' });
  const candidate = clone(base);
  candidate.components.parameters.Filter.schema = { type: 'integer' };
  setQueryParameters(candidate, [{
    $ref: '#/components/parameters/Filter',
    schema: { type: 'string' },
  }]);

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['TYPE_CHANGED']);
  assert.equal(result.breaking[0].location, 'POST /v1/things parameter query:filter');
});

test('a sibling alone is ignored, exactly as the Reference Object says', () => {
  const base = requestRefDocument({ type: 'string' });
  const candidate = clone(base);
  setRequestSchema(candidate, {
    $ref: '#/components/schemas/Payload',
    type: 'integer',
    description: 'an ignored sibling',
  });

  const result = compareContracts(base, candidate);
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

// --- unsupported constructs -------------------------------------------------

test('an unmodelled schema keyword that changes is UNCOMPARABLE and BREAKING', () => {
  const candidate = baseDocument();
  okSchema(candidate).properties.id.not = { type: 'number' };
  const result = compareContracts(baseDocument(), candidate);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.match(result.breaking[0].detail, /"not"/);
});

test('a tuple-style items change is reported conservatively, not ignored', () => {
  const base = baseDocument();
  okSchema(base).properties.pair = { type: 'array', items: [{ type: 'string' }, { type: 'number' }] };
  const candidate = clone(base);
  okSchema(candidate).properties.pair.items = [{ type: 'string' }, { type: 'string' }];
  assert.deepEqual(breakingCodes(compareContracts(base, candidate)), ['UNCOMPARABLE']);
});

test('a readOnly change is UNCOMPARABLE rather than silently additive', () => {
  const candidate = baseDocument();
  okSchema(candidate).properties.id.readOnly = true;
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), candidate)), ['UNCOMPARABLE']);
});

// --- security, servers and callbacks ---------------------------------------
//
// These constructs change authentication, routing and server-initiated
// traffic, but the classifier does not model them value by value. Their stable
// representation is compared where they are declared: unchanged values stay
// NEUTRAL, and a real change fails closed as UNCOMPARABLE (BREAKING).

const securityRequirement = (scheme = 'bearerAuth', scopes = []) => [{ [scheme]: scopes }];

function callbackPathItem() {
  return {
    post: {
      responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } },
    },
  };
}

function operationCallbacks(expression = '$request.body#/callbackUrl', pathItem = callbackPathItem()) {
  return { onEvent: { [expression]: pathItem } };
}

test('a root security requirement added or removed is UNCOMPARABLE and BREAKING', () => {
  const base = baseDocument();
  const withSecurity = clone(base);
  withSecurity.security = securityRequirement();

  const added = compareContracts(base, withSecurity);
  assert.equal(added.verdict, BREAKING);
  assert.deepEqual(breakingCodes(added), ['UNCOMPARABLE']);
  assert.equal(added.breaking[0].location, 'security');

  const removed = compareContracts(withSecurity, base);
  assert.equal(removed.verdict, BREAKING);
  assert.deepEqual(breakingCodes(removed), ['UNCOMPARABLE']);
  assert.equal(removed.breaking[0].location, 'security');
});

test('an operation security requirement added, removed or overridden is UNCOMPARABLE', () => {
  const base = baseDocument();
  const withSecurity = clone(base);
  operation(withSecurity).security = securityRequirement();

  const added = compareContracts(base, withSecurity);
  assert.deepEqual(breakingCodes(added), ['UNCOMPARABLE']);
  assert.equal(added.breaking[0].location, 'POST /v1/things security');

  const removed = compareContracts(withSecurity, base);
  assert.equal(removed.verdict, BREAKING);
  assert.deepEqual(breakingCodes(removed), ['UNCOMPARABLE']);

  const overridden = clone(withSecurity);
  operation(overridden).security = securityRequirement('apiKeyAuth');
  const changed = compareContracts(withSecurity, overridden);
  assert.deepEqual(breakingCodes(changed), ['UNCOMPARABLE']);
  assert.equal(changed.breaking[0].location, 'POST /v1/things security');

  const scoped = clone(base);
  operation(scoped).security = [{ oauth: ['read'] }];
  const rescoped = clone(scoped);
  operation(rescoped).security = [{ oauth: ['write'] }];
  assert.deepEqual(breakingCodes(compareContracts(scoped, rescoped)), ['UNCOMPARABLE']);
});

test('an unchanged security requirement produces no finding', () => {
  const doc = baseDocument();
  doc.security = securityRequirement('oauth', ['read']);
  operation(doc).security = securityRequirement('oauth', ['read']);
  doc.components = {
    securitySchemes: { oauth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: 'https://auth.example.test/token', scopes: { read: 'read' } } } } },
  };

  const result = compareContracts(doc, clone(doc));
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('a changed security scheme definition is UNCOMPARABLE', () => {
  const base = baseDocument();
  base.components = { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } };
  const candidate = clone(base);
  candidate.components.securitySchemes.bearerAuth.scheme = 'basic';

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(result.breaking[0].location, 'components.securitySchemes');
});

test('reordering security alternatives or scopes is not a client-visible change', () => {
  const base = baseDocument();
  base.security = [{ oauth: ['read', 'write'] }, { apiKeyAuth: [] }];
  const candidate = clone(base);
  candidate.security = [{ apiKeyAuth: [] }, { oauth: ['write', 'read'] }];

  assert.deepEqual(compareContracts(base, candidate).changes, []);
});

test('a root server URL change, addition or removal is UNCOMPARABLE and BREAKING', () => {
  const base = baseDocument();
  base.servers = [{ url: 'https://api.example.test' }];

  const changed = clone(base);
  changed.servers = [{ url: 'https://api-v2.example.test' }];
  const changedResult = compareContracts(base, changed);
  assert.equal(changedResult.verdict, BREAKING);
  assert.deepEqual(breakingCodes(changedResult), ['UNCOMPARABLE']);
  assert.equal(changedResult.breaking[0].location, 'servers');

  const removed = clone(base);
  delete removed.servers;
  assert.deepEqual(breakingCodes(compareContracts(base, removed)), ['UNCOMPARABLE']);

  const added = compareContracts(baseDocument(), base);
  assert.deepEqual(breakingCodes(added), ['UNCOMPARABLE']);
  assert.equal(added.breaking[0].location, 'servers');
});

test('an operation server change is UNCOMPARABLE', () => {
  const base = baseDocument();
  operation(base).servers = [{ url: 'https://api.example.test' }];
  const candidate = clone(base);
  operation(candidate).servers = [{ url: 'https://other.example.test' }];

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(result.breaking[0].location, 'POST /v1/things servers');
});

test('a path item server change is UNCOMPARABLE', () => {
  const base = baseDocument();
  base.paths['/v1/things'].servers = [{ url: 'https://api.example.test' }];
  const candidate = clone(base);
  candidate.paths['/v1/things'].servers = [{ url: 'https://other.example.test' }];

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(result.breaking[0].location, '/v1/things servers');
});

test('an unchanged server configuration produces no finding', () => {
  const doc = baseDocument();
  doc.servers = [{ url: 'https://api.example.test', variables: { region: { default: 'eu' } } }];
  doc.paths['/v1/things'].servers = [{ url: 'https://{region}.example.test' }];
  operation(doc).servers = [{ url: 'https://api.example.test' }];

  const result = compareContracts(doc, clone(doc));
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('a callback added to or removed from an operation is UNCOMPARABLE', () => {
  const base = baseDocument();
  const withCallback = clone(base);
  operation(withCallback).callbacks = operationCallbacks();

  const added = compareContracts(base, withCallback);
  assert.equal(added.verdict, BREAKING);
  assert.deepEqual(breakingCodes(added), ['UNCOMPARABLE']);
  assert.equal(added.breaking[0].location, 'POST /v1/things callbacks "onEvent"');

  const removed = compareContracts(withCallback, base);
  assert.equal(removed.verdict, BREAKING);
  assert.deepEqual(breakingCodes(removed), ['UNCOMPARABLE']);
  assert.equal(removed.breaking[0].location, 'POST /v1/things callbacks "onEvent"');
});

test('a changed callback expression is UNCOMPARABLE at the expression', () => {
  const base = baseDocument();
  operation(base).callbacks = operationCallbacks('$request.body#/first');
  const candidate = clone(base);
  operation(candidate).callbacks = operationCallbacks('$request.body#/second');

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE', 'UNCOMPARABLE']);
  const locations = result.breaking.map((item) => item.location).sort();
  assert.match(locations[0], /callbacks "onEvent" expression "\$request\.body#\/first"$/);
  assert.match(locations[1], /callbacks "onEvent" expression "\$request\.body#\/second"$/);
});

test('a changed callback configuration is UNCOMPARABLE', () => {
  const base = baseDocument();
  operation(base).callbacks = operationCallbacks();
  const candidate = clone(base);
  operation(candidate).callbacks.onEvent['$request.body#/callbackUrl'].post.responses['201'] = {
    description: 'changed',
  };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(
    result.breaking[0].location,
    'POST /v1/things callbacks "onEvent" expression "$request.body#/callbackUrl"'
  );
});

test('an unchanged callback produces no finding', () => {
  const doc = baseDocument();
  operation(doc).callbacks = operationCallbacks();

  const result = compareContracts(doc, clone(doc));
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('an unresolvable callback $ref is UNCOMPARABLE, never an implicit pass', () => {
  const doc = baseDocument();
  operation(doc).callbacks = { onEvent: { $ref: '#/components/callbacks/Missing' } };

  const result = compareContracts(doc, clone(doc));
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
});

test('a changed callback reached through $ref is detected at the operation', () => {
  const base = baseDocument();
  base.components = {
    callbacks: { Event: { '$request.body#/callbackUrl': callbackPathItem() } },
  };
  operation(base).callbacks = { onEvent: { $ref: '#/components/callbacks/Event' } };

  const candidate = clone(base);
  candidate.components.callbacks.Event['$request.body#/callbackUrl']
    .post.responses['200'].description = 'changed';

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.match(result.breaking[0].location, /callbacks "onEvent" expression/);
});

// --- Path Item $ref resolution ----------------------------------------------
//
// §4.7.9: a Path Item Object may carry `$ref`, and then it is STILL a Path Item
// — its other fields are declarations, not the ignored siblings of a Reference
// Object. These cases pin that the REFERENCED content is compared wherever
// OpenAPI 3.0.3 allows a Path Item, and that nothing unsafe is guessed.
//
// The shared Path Items live under a root extension key on purpose: a Path Item
// under `paths` would be compared as a route of its own and blur the locations
// these tests assert. OpenAPI 3.0.3 has no `components.pathItems`.

function referencedPathItem(overrides) {
  return Object.assign({
    parameters: [{ in: 'header', name: 'X-Locale', required: false, schema: { type: 'string' } }],
    servers: [{ url: 'https://api.example.test' }],
    get: {
      requestBody: {
        required: false,
        content: {
          'application/json': { schema: { type: 'object', properties: { filter: { type: 'string' } } } },
        },
      },
      responses: {
        200: response({ type: 'object', required: ['id'], properties: { id: { type: 'string' } } }),
      },
    },
  }, overrides || {});
}

/** A document whose `/v1/things` Path Item is a `$ref` to `#/x-path-items/Things`. */
function pathItemRefDocument(pathItem) {
  const doc = baseDocument();
  doc['x-path-items'] = { Things: clone(pathItem) };
  doc.paths['/v1/things'] = { $ref: '#/x-path-items/Things' };
  return doc;
}

/** The same effective Path Item, written inline. */
function inlinePathItemDocument(pathItem) {
  const doc = baseDocument();
  doc.paths['/v1/things'] = clone(pathItem);
  return doc;
}

test('an inline Path Item and a $ref to equivalent contents are NEUTRAL', () => {
  const result = compareContracts(
    inlinePathItemDocument(referencedPathItem()),
    pathItemRefDocument(referencedPathItem())
  );
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('an unchanged referenced Path Item produces no finding', () => {
  const doc = pathItemRefDocument(referencedPathItem());
  const result = compareContracts(doc, clone(doc));
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('a request schema change inside a referenced operation is detected', () => {
  const base = pathItemRefDocument(referencedPathItem());
  const candidate = clone(base);
  candidate['x-path-items'].Things.get.requestBody.content['application/json']
    .schema.properties.filter.type = 'number';

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['TYPE_CHANGED']);
  assert.equal(result.breaking[0].location, 'GET /v1/things request application/json.filter');
});

test('a response schema change inside a referenced operation is detected', () => {
  const base = pathItemRefDocument(referencedPathItem());
  const candidate = clone(base);
  candidate['x-path-items'].Things.get.responses['200'].content['application/json']
    .schema.properties.id.type = 'number';

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['TYPE_CHANGED']);
  assert.equal(result.breaking[0].location, 'GET /v1/things 200 application/json.id');
});

test('an operation added to or removed from a referenced Path Item is detected', () => {
  const base = pathItemRefDocument(referencedPathItem());

  const added = clone(base);
  added['x-path-items'].Things.patch = { responses: { 204: { description: 'ok' } } };
  const addedResult = compareContracts(base, added);
  assert.equal(addedResult.verdict, ADDITIVE);
  assert.deepEqual(codes(addedResult), ['METHOD_ADDED']);
  assert.equal(addedResult.additive[0].location, '/v1/things');

  const removed = clone(base);
  delete removed['x-path-items'].Things.get;
  const removedResult = compareContracts(base, removed);
  assert.equal(removedResult.verdict, BREAKING);
  assert.deepEqual(breakingCodes(removedResult), ['METHOD_REMOVED']);
  assert.equal(removedResult.breaking[0].location, '/v1/things');
});

test('a path-level parameter change inside a referenced Path Item is detected', () => {
  const base = pathItemRefDocument(referencedPathItem());
  const candidate = clone(base);
  candidate['x-path-items'].Things.parameters[0].required = true;

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['PARAMETER_BECAME_REQUIRED']);
  assert.equal(result.breaking[0].location, 'GET /v1/things');
});

test('a server change inside a referenced Path Item is detected', () => {
  const base = pathItemRefDocument(referencedPathItem());
  const candidate = clone(base);
  candidate['x-path-items'].Things.servers = [{ url: 'https://other.example.test' }];

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(result.breaking[0].location, '/v1/things servers');
  assert.match(result.breaking[0].detail, /path item servers/);
});

test('an unchanged $ref string with a changed target is detected', () => {
  const base = pathItemRefDocument(referencedPathItem());
  const candidate = clone(base);
  candidate['x-path-items'].Things.get.responses['200'].content['application/json']
    .schema.properties.id.type = 'number';
  assert.equal(candidate.paths['/v1/things'].$ref, base.paths['/v1/things'].$ref);

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['TYPE_CHANGED']);
  assert.equal(result.breaking[0].location, 'GET /v1/things 200 application/json.id');
});

test('repointing a $ref at equivalent content produces no finding', () => {
  const base = pathItemRefDocument(referencedPathItem());
  base['x-path-items'].Copy = clone(base['x-path-items'].Things);
  const candidate = clone(base);
  candidate.paths['/v1/things'] = { $ref: '#/x-path-items/Copy' };
  assert.notEqual(candidate.paths['/v1/things'].$ref, base.paths['/v1/things'].$ref);

  const result = compareContracts(base, candidate);
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('a chain of Path Item references is followed to its target', () => {
  const base = pathItemRefDocument(referencedPathItem());
  base['x-path-items'].Bridge = { $ref: '#/x-path-items/Things' };
  base.paths['/v1/things'] = { $ref: '#/x-path-items/Bridge' };

  const result = compareContracts(base, clone(base));
  assert.deepEqual(result.changes, []);

  const candidate = clone(base);
  candidate['x-path-items'].Things.get.responses['200'].content['application/json']
    .schema.properties.id.type = 'number';
  const changed = compareContracts(base, candidate);
  assert.equal(changed.verdict, BREAKING);
  assert.deepEqual(breakingCodes(changed), ['TYPE_CHANGED']);
  assert.equal(changed.breaking[0].location, 'GET /v1/things 200 application/json.id');
});

test('the same target reached from two paths is compared at both', () => {
  const base = pathItemRefDocument(referencedPathItem());
  base.paths['/v1/other'] = { $ref: '#/x-path-items/Things' };
  const candidate = clone(base);
  candidate['x-path-items'].Things.get.responses['200'].content['application/json']
    .schema.properties.id.type = 'number';

  const result = compareContracts(base, candidate);
  const locations = result.breaking.map((item) => item.location).sort();
  assert.deepEqual(breakingCodes(result), ['TYPE_CHANGED', 'TYPE_CHANGED']);
  assert.deepEqual(locations, [
    'GET /v1/other 200 application/json.id',
    'GET /v1/things 200 application/json.id',
  ]);
});

test('an unresolved Path Item $ref fails closed', () => {
  const base = pathItemRefDocument(referencedPathItem());
  const candidate = clone(base);
  candidate.paths['/v1/things'] = { $ref: '#/x-path-items/Missing' };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(result.breaking[0].location, '/v1/things');
  assert.match(result.breaking[0].detail, /unresolvable Path Item \$ref/);
});

test('an external Path Item $ref fails closed instead of being fetched', () => {
  const base = pathItemRefDocument(referencedPathItem());
  const candidate = clone(base);
  candidate.paths['/v1/things'] = { $ref: './shared-path-items.yaml#/Things' };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(result.breaking[0].location, '/v1/things');
  assert.match(result.breaking[0].detail, /non-internal Path Item \$ref/);
});

test('a $ref to something that is not a Path Item Object fails closed', () => {
  const base = pathItemRefDocument(referencedPathItem());
  base.components = { schemas: { Thing: { type: 'object', properties: { id: { type: 'string' } } } } };
  const candidate = clone(base);
  candidate.paths['/v1/things'] = { $ref: '#/components/schemas/Thing' };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(result.breaking[0].location, '/v1/things');
  assert.match(result.breaking[0].detail, /does not point at a Path Item Object/);
});

test('a direct or indirect Path Item $ref cycle fails closed', () => {
  const direct = pathItemRefDocument(referencedPathItem());
  direct['x-path-items'].Loop = { $ref: '#/x-path-items/Loop' };
  direct.paths['/v1/things'] = { $ref: '#/x-path-items/Loop' };
  const directResult = compareContracts(direct, clone(direct));
  assert.equal(directResult.verdict, BREAKING);
  assert.deepEqual(breakingCodes(directResult), ['UNCOMPARABLE']);
  assert.equal(directResult.breaking[0].location, '/v1/things');
  assert.match(directResult.breaking[0].detail, /circular Path Item \$ref/);

  const indirect = pathItemRefDocument(referencedPathItem());
  indirect['x-path-items'].A = { $ref: '#/x-path-items/B' };
  indirect['x-path-items'].B = { $ref: '#/x-path-items/A' };
  indirect.paths['/v1/things'] = { $ref: '#/x-path-items/A' };
  const indirectResult = compareContracts(indirect, clone(indirect));
  assert.equal(indirectResult.verdict, BREAKING);
  assert.deepEqual(breakingCodes(indirectResult), ['UNCOMPARABLE']);
  assert.match(indirectResult.breaking[0].detail, /circular Path Item \$ref/);
});

test('a field declared by both the referring Path Item and its target fails closed', () => {
  const base = pathItemRefDocument(referencedPathItem());
  base.paths['/v1/things'] = {
    $ref: '#/x-path-items/Things',
    get: clone(referencedPathItem().get),
  };

  // Even byte-identical documents: §4.7.9 leaves the overlap undefined, so the
  // classifier may not claim equivalence by picking a side.
  const result = compareContracts(base, clone(base));
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(result.breaking[0].location, '/v1/things');
  assert.match(result.breaking[0].detail, /OpenAPI 3.0.3 leaves this undefined/);
});

test('non-overlapping sibling fields are combined, never discarded', () => {
  const pathItem = referencedPathItem();
  const post = baseDocument().paths['/v1/things'].post;

  const base = baseDocument();
  base.paths['/v1/things'] = clone(pathItem);
  base.paths['/v1/things'].post = clone(post);

  const candidate = baseDocument();
  candidate['x-path-items'] = { Things: clone(pathItem) };
  candidate.paths['/v1/things'] = { $ref: '#/x-path-items/Things', post: clone(post) };

  const result = compareContracts(base, candidate);
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);

  // The sibling operation is compared, not silently dropped with the $ref.
  const withoutSibling = clone(candidate);
  delete withoutSibling.paths['/v1/things'].post;
  const dropped = compareContracts(candidate, withoutSibling);
  assert.equal(dropped.verdict, BREAKING);
  assert.ok(breakingCodes(dropped).includes('METHOD_REMOVED'));
  assert.ok(dropped.breaking.some((item) => item.location === '/v1/things'));
});

test('a callback expression holding a referenced Path Item detects a target change', () => {
  function callbackRefDocument(pathItem) {
    const doc = baseDocument();
    doc['x-path-items'] = { Event: clone(pathItem) };
    operation(doc).callbacks = {
      onEvent: { '$request.body#/callbackUrl': { $ref: '#/x-path-items/Event' } },
    };
    return doc;
  }

  const base = callbackRefDocument(callbackPathItem());
  const unchanged = compareContracts(base, clone(base));
  assert.deepEqual(unchanged.changes, []);
  assert.equal(unchanged.verdict, NEUTRAL);

  const candidate = clone(base);
  candidate['x-path-items'].Event.post.responses['200'].content['application/json']
    .schema.properties = { id: { type: 'string' } };
  assert.equal(
    candidate.paths['/v1/things'].post.callbacks.onEvent['$request.body#/callbackUrl'].$ref,
    base.paths['/v1/things'].post.callbacks.onEvent['$request.body#/callbackUrl'].$ref
  );

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, BREAKING);
  assert.deepEqual(breakingCodes(result), ['UNCOMPARABLE']);
  assert.equal(
    result.breaking[0].location,
    'POST /v1/things callbacks "onEvent" expression "$request.body#/callbackUrl"'
  );
  assert.match(result.breaking[0].detail, /callback configuration changed/);
});

// --- Path Item $ref on a newly added path -----------------------------------
//
// A path that exists only in the candidate is ADDITIVE, but only once its Path
// Item has been resolved. A new path carrying a bad `$ref` must not be reported
// as PATH_ADDED: it is exactly the reference class handled above.

/** The single breaking finding of a candidate-only path, asserted field by field. */
function assertNewPathRefused(result, route) {
  assert.equal(result.verdict, BREAKING);
  assert.equal(result.breaking.length, 1);
  const finding = result.breaking[0];
  assert.equal(finding.classification, 'BREAKING');
  assert.equal(finding.code, 'UNCOMPARABLE');
  assert.equal(finding.location, route);
  assert.ok(!codes(result).includes('PATH_ADDED'), 'an invalid new path is never PATH_ADDED');
  return finding;
}

test('a new path that is a valid referenced Path Item is ADDITIVE', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  candidate['x-path-items'] = { Shared: referencedPathItem() };
  candidate.paths['/v1/new'] = { $ref: '#/x-path-items/Shared' };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, ADDITIVE);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(codes(result), ['PATH_ADDED']);
  assert.deepEqual(result.additive, [{
    classification: 'ADDITIVE',
    code: 'PATH_ADDED',
    location: '/v1/new',
    detail: 'new path',
  }]);
});

test('a new inline path is still ADDITIVE', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  candidate.paths['/v1/inline'] = { get: { responses: { 200: response({ type: 'object' }) } } };

  const result = compareContracts(base, candidate);
  assert.equal(result.verdict, ADDITIVE);
  assert.deepEqual(codes(result), ['PATH_ADDED']);
  assert.equal(result.additive[0].location, '/v1/inline');
});

test('a new path with an unresolved Path Item $ref fails closed', () => {
  const candidate = baseDocument();
  candidate.paths['/v1/new'] = { $ref: '#/x-path-items/Missing' };

  const finding = assertNewPathRefused(compareContracts(baseDocument(), candidate), '/v1/new');
  assert.match(finding.detail, /unresolvable Path Item \$ref/);
  assert.match(finding.detail, /new path/);
});

test('a new path with an external Path Item $ref fails closed', () => {
  const candidate = baseDocument();
  candidate.paths['/v1/new'] = { $ref: 'https://example.test/path-items.yaml#/Thing' };

  const finding = assertNewPathRefused(compareContracts(baseDocument(), candidate), '/v1/new');
  assert.match(finding.detail, /non-internal Path Item \$ref/);
});

test('a new path whose $ref is not a Path Item Object fails closed', () => {
  const candidate = baseDocument();
  candidate.components = { schemas: { Thing: { type: 'object', properties: { id: { type: 'string' } } } } };
  candidate.paths['/v1/new'] = { $ref: '#/components/schemas/Thing' };

  const finding = assertNewPathRefused(compareContracts(baseDocument(), candidate), '/v1/new');
  assert.match(finding.detail, /does not point at a Path Item Object/);
});

test('a new path with a cyclic Path Item $ref fails closed', () => {
  const direct = baseDocument();
  direct['x-path-items'] = { Loop: { $ref: '#/x-path-items/Loop' } };
  direct.paths['/v1/new'] = { $ref: '#/x-path-items/Loop' };
  const directFinding = assertNewPathRefused(compareContracts(baseDocument(), direct), '/v1/new');
  assert.match(directFinding.detail, /circular Path Item \$ref/);

  const indirect = baseDocument();
  indirect['x-path-items'] = {
    A: { $ref: '#/x-path-items/B' },
    B: { $ref: '#/x-path-items/A' },
  };
  indirect.paths['/v1/new'] = { $ref: '#/x-path-items/A' };
  const indirectFinding = assertNewPathRefused(compareContracts(baseDocument(), indirect), '/v1/new');
  assert.match(indirectFinding.detail, /circular Path Item \$ref/);
});

// --- rendering equivalence --------------------------------------------------

test('nullable and a type array are the same guarantee, not a type change', () => {
  const nullable = baseDocument();
  const typeArray = baseDocument();
  okSchema(nullable).properties.id = { type: 'string', nullable: true };
  okSchema(typeArray).properties.id = { type: ['string', 'null'] };
  const result = compareContracts(nullable, typeArray);
  assert.deepEqual(result.changes, []);
  assert.equal(result.verdict, NEUTRAL);
});

test('an identical type array is not reported as a type change', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  okSchema(base).properties.id.type = ['string', 'null'];
  okSchema(candidate).properties.id.type = ['string', 'null'];
  assert.deepEqual(compareContracts(base, candidate).changes, []);
});

test('the direction-aware classifier is deterministic across repeated runs', () => {
  const base = baseDocument();
  const candidate = baseDocument();
  okSchema(candidate).properties.status.enum.push('PENDING');
  okSchema(candidate).properties.id.nullable = true;
  candidate.paths['/v1/extra'] = { get: { responses: { 200: response({ type: 'object' }) } } };
  assert.deepEqual(compareContracts(base, candidate), compareContracts(base, candidate));
});
