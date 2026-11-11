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

const { compareContracts, BREAKING, ADDITIVE, NEUTRAL } = require('./openapi-compat');

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

test('a new path, a new method, an added enum member and an optional parameter are all ADDITIVE', () => {
  const candidate = baseDocument();
  candidate.paths['/v1/other'] = { get: { responses: { 200: response({ type: 'object' }) } } };
  candidate.paths['/v1/things'].get = { responses: { 200: response({ type: 'object' }) } };
  candidate.paths['/v1/things'].post.responses['201'].content['application/json'].schema
    .properties.status.enum.push('UNKNOWN');
  candidate.paths['/v1/things'].post.parameters.push({
    in: 'query', name: 'cursor', required: false, schema: { type: 'string' },
  });
  const result = compareContracts(baseDocument(), candidate);
  assert.equal(result.verdict, ADDITIVE);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(
    codes(result),
    ['ENUM_MEMBER_ADDED', 'METHOD_ADDED', 'PARAMETER_ADDED', 'PATH_ADDED'].sort()
  );
});

test('a property that stops being required is ADDITIVE, and nullability added too', () => {
  const candidate = baseDocument();
  const schema = candidate.paths['/v1/things'].post.responses['201'].content['application/json'].schema;
  schema.required = schema.required.filter((name) => name !== 'status');
  schema.properties.id.nullable = true;
  const result = compareContracts(baseDocument(), candidate);
  assert.equal(result.verdict, ADDITIVE);
  assert.deepEqual(breakingCodes(result), []);
  assert.ok(codes(result).includes('PROPERTY_BECAME_OPTIONAL'));
  assert.ok(codes(result).includes('NULLABILITY_ADDED'));
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

test('a newly required property is BREAKING', () => {
  const candidate = baseDocument();
  candidate.paths['/v1/things'].post.responses['201'].content['application/json'].schema.required.push('hint');
  candidate.paths['/v1/things'].post.responses['201'].content['application/json'].schema.properties.hint = { type: 'string' };
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

test('nullability removed and a closed object are both BREAKING', () => {
  const nullableRemoved = baseDocument();
  nullableRemoved.paths['/v1/things'].post.responses['201'].content['application/json'].schema
    .properties.note.nullable = false;
  assert.deepEqual(breakingCodes(compareContracts(baseDocument(), nullableRemoved)), ['NULLABILITY_REMOVED']);

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

test('an anyOf variant added is ADDITIVE and a removed variant is BREAKING', () => {
  const base = baseDocument();
  setResponseSchema(base, { anyOf: [{ type: 'string' }, { type: 'number' }] });

  const added = baseDocument();
  setResponseSchema(added, { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] });
  const addedResult = compareContracts(base, added);
  assert.deepEqual(addedResult.breaking, []);
  assert.deepEqual(codes(addedResult), ['COMPOSITION_VARIANT_ADDED']);

  const removed = baseDocument();
  setResponseSchema(removed, { anyOf: [{ type: 'string' }] });
  const removedResult = compareContracts(base, removed);
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
