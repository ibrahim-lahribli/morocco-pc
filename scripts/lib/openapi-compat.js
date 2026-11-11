'use strict';

/**
 * scripts/lib/openapi-compat.js — the backward-compatibility classifier.
 *
 * Pure: two already-parsed OpenAPI documents in, a deterministic change list
 * out. No filesystem, no git, no clock, no network. `check-openapi-compatibility.js`
 * supplies the documents (the baseline from an explicit Git ref, the candidate
 * from the working tree) and decides the exit status.
 *
 * Classification, per the RFC's §15.5 policy:
 *
 *   BREAKING  a client that worked against the base can fail against the
 *             candidate: a removed path, method, parameter, response or
 *             property; a changed type; a newly required property/parameter;
 *             a removed enum member; nullability or additionalProperties
 *             tightening.
 *   ADDITIVE  an existing client keeps working: a new path, method, response,
 *             optional property/parameter or enum member; a required property
 *             becoming optional.
 *   NEUTRAL   nothing a client depends on changed (reported, never failed).
 *
 * UNKNOWN is not a classification here: anything this module cannot compare is
 * reported as UNCOMPARABLE and treated as BREAKING by the CLI. Silence would
 * turn an unexamined change into an implicit pass.
 *
 * Composition is compared structurally, not only through its flattened enum.
 * `allOf`, `anyOf` and `oneOf` branches are visited recursively, because a
 * property, a type or a required list can change entirely inside a branch.
 * Branches are compared in document order: a pure reordering reports nothing,
 * while an added or removed branch is classified by what it means (a union
 * variant or an `allOf` conjunct, and whether the schema governs a request or
 * a response). A branch enum is reported once, by `enumMembers()` on the
 * composed parent, never twice.
 */

const BREAKING = 'BREAKING';
const ADDITIVE = 'ADDITIVE';
const NEUTRAL = 'NEUTRAL';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** The members of a closed vocabulary, however the generator rendered the union. */
function enumMembers(schema) {
  if (!schema || typeof schema !== 'object') return [];
  const branches = Array.isArray(schema.anyOf) ? schema.anyOf : (Array.isArray(schema.oneOf) ? schema.oneOf : [schema]);
  const members = [];
  for (const branch of branches) {
    if (branch && Array.isArray(branch.enum)) members.push(...branch.enum);
  }
  return members;
}

/**
 * Canonical JSON for one schema branch: object keys sorted, so the signature
 * depends on the shape and not on key insertion order. Used to tell "the
 * branches were reordered" (no client-visible change) from "a branch changed".
 */
function stableSignature(value) {
  if (Array.isArray(value)) return '[' + value.map(stableSignature).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stableSignature(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * Compare one composition keyword (`allOf`, `anyOf`, `oneOf`) branch by branch.
 *
 * `allOf` branches are conjuncts: adding one narrows the accepted input, and
 * removing one widens it. `anyOf`/`oneOf` branches are alternatives: adding one
 * accepts/serves more, removing one takes a variant away. The request/response
 * direction decides which side of each pair is safe.
 */
function compareComposition(base, candidate, location, direction) {
  const changes = [];
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    const baseBranches = Array.isArray(base[keyword]) ? base[keyword] : null;
    const candidateBranches = Array.isArray(candidate[keyword]) ? candidate[keyword] : null;
    if (baseBranches === null && candidateBranches === null) continue;

    const at = location + ' ' + keyword;
    const union = keyword !== 'allOf';

    if (baseBranches === null || candidateBranches === null) {
      changes.push(change(
        BREAKING,
        'COMPOSITION_CHANGED',
        at,
        'the schema is ' + keyword + '-composed in ' + (baseBranches ? 'the base only' : 'the candidate only')
          + '; equivalence cannot be proven'
      ));
      continue;
    }

    const baseSignatures = baseBranches.map(stableSignature);
    const candidateSignatures = candidateBranches.map(stableSignature);
    if (baseSignatures.length === candidateSignatures.length
      && baseSignatures.slice().sort().join('\u0000') === candidateSignatures.slice().sort().join('\u0000')) {
      continue; // reordered branches only
    }

    const delta = candidateBranches.length - baseBranches.length;
    if (delta < 0) {
      const removed = -delta;
      const breaking = union || direction === 'response';
      changes.push(change(
        breaking ? BREAKING : ADDITIVE,
        union ? 'COMPOSITION_VARIANT_REMOVED' : 'COMPOSITION_CONSTRAINT_REMOVED',
        at,
        'the candidate declares ' + removed + ' fewer ' + keyword + ' branch(es)'
      ));
    } else if (delta > 0) {
      const breaking = !union && direction === 'request';
      changes.push(change(
        breaking ? BREAKING : ADDITIVE,
        union ? 'COMPOSITION_VARIANT_ADDED' : 'COMPOSITION_CONSTRAINT_ADDED',
        at,
        'the candidate declares ' + delta + ' more ' + keyword + ' branch(es)'
      ));
    }

    const pairs = Math.min(baseBranches.length, candidateBranches.length);
    // enumMembers() flattens the parent's anyOf first, then oneOf. Suppress a
    // branch-level enum comparison only for the keyword it actually flattened on
    // BOTH sides; a second keyword's branch enums are compared normally.
    const flattenedWith = (schema) => (Array.isArray(schema.anyOf)
      ? 'anyOf'
      : (Array.isArray(schema.oneOf) ? 'oneOf' : null));
    const enumCovered = union && flattenedWith(base) === keyword && flattenedWith(candidate) === keyword;
    for (let index = 0; index < pairs; index += 1) {
      changes.push(...compareSchema(
        baseBranches[index],
        candidateBranches[index],
        at + '[' + index + ']',
        { direction, enumCovered }
      ));
    }
  }
  return changes;
}

function change(classification, code, location, detail) {
  return { classification, code, location, detail };
}

/**
 * Compare two schemas. `location` is a human path such as
 * `/v1/recommendations 201.properties.builds`.
 *
 * `options.direction` is `'request'` or `'response'` and only affects how a
 * composition branch count change is classified. `options.enumCovered` says the
 * caller already compared this schema's own enum through a composed parent.
 *
 * @returns {Array<{classification: string, code: string, location: string, detail: string}>}
 */
function compareSchema(base, candidate, location, options) {
  if (base === undefined && candidate === undefined) return [];
  if (base === undefined) return [change(ADDITIVE, 'SCHEMA_ADDED', location, 'a schema appeared where the base declared none')];
  if (candidate === undefined) {
    return [change(BREAKING, 'SCHEMA_REMOVED', location, 'the base declared a schema here and the candidate declares none')];
  }
  if (base === null || candidate === null || typeof base !== 'object' || typeof candidate !== 'object') {
    return JSON.stringify(base) === JSON.stringify(candidate)
      ? []
      : [change(BREAKING, 'UNCOMPARABLE', location, 'the two schemas are not comparable objects')];
  }

  const direction = options && options.direction === 'request' ? 'request' : 'response';
  const enumCovered = Boolean(options && options.enumCovered);
  const changes = [];

  if (base.type !== candidate.type) {
    // `type: [string, null]` (OpenAPI 3.1) and `nullable: true` (3.0) express the
    // same thing; do not report a rendering difference as a type change.
    const baseTypes = Array.isArray(base.type) ? base.type.join('|') : base.type;
    const candidateTypes = Array.isArray(candidate.type) ? candidate.type.join('|') : candidate.type;
    changes.push(change(
      BREAKING,
      'TYPE_CHANGED',
      location,
      'type ' + JSON.stringify(baseTypes) + ' -> ' + JSON.stringify(candidateTypes)
    ));
  }

  const baseEnum = enumMembers(base);
  const candidateEnum = enumMembers(candidate);
  if (!enumCovered) {
    for (const member of baseEnum) {
      if (!candidateEnum.includes(member)) {
        changes.push(change(BREAKING, 'ENUM_MEMBER_REMOVED', location, 'removed enum member ' + JSON.stringify(member)));
      }
    }
    for (const member of candidateEnum) {
      if (!baseEnum.includes(member)) {
        changes.push(change(ADDITIVE, 'ENUM_MEMBER_ADDED', location, 'added enum member ' + JSON.stringify(member)));
      }
    }
  }

  if (base.nullable === true && candidate.nullable !== true) {
    changes.push(change(BREAKING, 'NULLABILITY_REMOVED', location, 'the field was nullable and is not any more'));
  } else if (base.nullable !== true && candidate.nullable === true) {
    changes.push(change(ADDITIVE, 'NULLABILITY_ADDED', location, 'the field became nullable'));
  }

  if (base.additionalProperties === true && candidate.additionalProperties === false) {
    changes.push(change(BREAKING, 'OBJECT_CLOSED', location, 'additionalProperties true -> false refuses keys the base allowed'));
  } else if (base.additionalProperties === false && candidate.additionalProperties === true) {
    changes.push(change(ADDITIVE, 'OBJECT_OPENED', location, 'additionalProperties false -> true allows new keys'));
  }

  const baseRequired = Array.isArray(base.required) ? base.required : [];
  const candidateRequired = Array.isArray(candidate.required) ? candidate.required : [];
  for (const property of baseRequired) {
    if (!candidateRequired.includes(property)) {
      changes.push(change(ADDITIVE, 'PROPERTY_BECAME_OPTIONAL', location, property + ' is no longer required'));
    }
  }
  const baseProperties = base.properties && typeof base.properties === 'object' ? base.properties : {};
  const candidateProperties = candidate.properties && typeof candidate.properties === 'object' ? candidate.properties : {};

  for (const key of Object.keys(baseProperties)) {
    if (!Object.prototype.hasOwnProperty.call(candidateProperties, key)) {
      changes.push(change(BREAKING, 'PROPERTY_REMOVED', location, 'removed property ' + JSON.stringify(key)));
    }
  }
  for (const key of Object.keys(candidateProperties)) {
    if (!Object.prototype.hasOwnProperty.call(baseProperties, key)) {
      changes.push(change(ADDITIVE, 'PROPERTY_ADDED', location, 'added property ' + JSON.stringify(key)));
    }
  }
  for (const key of Object.keys(candidateProperties)) {
    if (candidateRequired.includes(key) && !baseRequired.includes(key)) {
      changes.push(change(BREAKING, 'PROPERTY_BECAME_REQUIRED', location, key + ' became required'));
    }
  }
  for (const key of Object.keys(baseProperties)) {
    if (!Object.prototype.hasOwnProperty.call(candidateProperties, key)) continue;
    changes.push(...compareSchema(baseProperties[key], candidateProperties[key], location + '.' + key, { direction }));
  }

  if (base.items !== undefined || candidate.items !== undefined) {
    changes.push(...compareSchema(base.items, candidate.items, location + '[]', { direction }));
  }

  changes.push(...compareComposition(base, candidate, location, direction));

  return changes;
}

/** Compare every media type a response declares a schema for. */
function compareContent(baseContent, candidateContent, location, direction) {
  const changes = [];
  const baseTypes = baseContent && typeof baseContent === 'object' ? Object.keys(baseContent) : [];
  const candidateTypes = candidateContent && typeof candidateContent === 'object' ? Object.keys(candidateContent) : [];

  for (const mediaType of baseTypes) {
    const baseSchema = baseContent[mediaType] && baseContent[mediaType].schema;
    const candidateSchema = candidateContent && candidateContent[mediaType]
      ? candidateContent[mediaType].schema
      : undefined;
    if (candidateContent && candidateContent[mediaType] === undefined) {
      changes.push(change(BREAKING, 'MEDIA_TYPE_REMOVED', location, 'removed ' + mediaType));
      continue;
    }
    changes.push(...compareSchema(baseSchema, candidateSchema, location + ' ' + mediaType, { direction }));
  }
  for (const mediaType of candidateTypes) {
    if (!baseTypes.includes(mediaType)) {
      changes.push(change(ADDITIVE, 'MEDIA_TYPE_ADDED', location, 'added ' + mediaType));
    }
  }
  return changes;
}

function parameterKey(parameter) {
  return String(parameter.in || 'query') + ':' + String(parameter.name || '');
}

function compareParameters(baseParameters, candidateParameters, location) {
  const changes = [];
  const baseList = Array.isArray(baseParameters) ? baseParameters : [];
  const candidateList = Array.isArray(candidateParameters) ? candidateParameters : [];
  const baseByKey = new Map(baseList.map((parameter) => [parameterKey(parameter), parameter]));
  const candidateByKey = new Map(candidateList.map((parameter) => [parameterKey(parameter), parameter]));

  for (const [key, parameter] of baseByKey) {
    if (!candidateByKey.has(key)) {
      changes.push(change(BREAKING, 'PARAMETER_REMOVED', location, 'removed parameter ' + key));
      continue;
    }
    const candidate = candidateByKey.get(key);
    if (parameter.required === true && candidate.required !== true) {
      changes.push(change(ADDITIVE, 'PARAMETER_BECAME_OPTIONAL', location, key + ' is no longer required'));
    } else if (parameter.required !== true && candidate.required === true) {
      changes.push(change(BREAKING, 'PARAMETER_BECAME_REQUIRED', location, key + ' became required'));
    }
    changes.push(...compareSchema(parameter.schema, candidate.schema, location + ' parameter ' + key, { direction: 'request' }));
  }
  for (const key of candidateByKey.keys()) {
    if (baseByKey.has(key)) continue;
    const parameter = candidateByKey.get(key);
    if (parameter.required === true) {
      changes.push(change(BREAKING, 'REQUIRED_PARAMETER_ADDED', location, 'added required parameter ' + key));
    } else {
      changes.push(change(ADDITIVE, 'PARAMETER_ADDED', location, 'added optional parameter ' + key));
    }
  }
  return changes;
}

function compareOperation(baseOperation, candidateOperation, location) {
  const changes = [];
  changes.push(...compareParameters(baseOperation.parameters, candidateOperation.parameters, location));

  const baseRequest = baseOperation.requestBody;
  const candidateRequest = candidateOperation.requestBody;
  if (baseRequest || candidateRequest) {
    if (!candidateRequest) {
      changes.push(change(BREAKING, 'REQUEST_BODY_REMOVED', location, 'the base accepted a request body'));
    } else if (!baseRequest) {
      changes.push(change(ADDITIVE, 'REQUEST_BODY_ADDED', location, 'the operation now accepts a body'));
    } else {
      if (baseRequest.required !== true && candidateRequest.required === true) {
        changes.push(change(BREAKING, 'REQUEST_BODY_BECAME_REQUIRED', location, 'the request body became required'));
      }
      changes.push(...compareContent(baseRequest.content, candidateRequest.content, location + ' request', 'request'));
    }
  }

  const baseResponses = baseOperation.responses && typeof baseOperation.responses === 'object'
    ? baseOperation.responses
    : {};
  const candidateResponses = candidateOperation.responses && typeof candidateOperation.responses === 'object'
    ? candidateOperation.responses
    : {};

  for (const status of Object.keys(baseResponses)) {
    if (!Object.prototype.hasOwnProperty.call(candidateResponses, status)) {
      changes.push(change(BREAKING, 'RESPONSE_REMOVED', location, 'removed response ' + status));
      continue;
    }
    changes.push(...compareContent(
      baseResponses[status].content,
      candidateResponses[status].content,
      location + ' ' + status,
      'response'
    ));
  }
  for (const status of Object.keys(candidateResponses)) {
    if (!Object.prototype.hasOwnProperty.call(baseResponses, status)) {
      changes.push(change(ADDITIVE, 'RESPONSE_ADDED', location, 'added response ' + status));
    }
  }

  return changes;
}

/**
 * Compare a baseline document with a candidate.
 *
 * @param {object} base the contract at the baseline Git ref
 * @param {object} candidate the working-tree contract
 * @returns {{changes: Array, breaking: Array, additive: Array, verdict: string}}
 */
function compareContracts(base, candidate) {
  if (base === null || typeof base !== 'object' || candidate === null || typeof candidate !== 'object') {
    throw new TypeError('compareContracts requires two parsed OpenAPI documents');
  }

  const changes = [];
  const baseVersion = base.info && base.info.version ? base.info.version : null;
  const candidateVersion = candidate.info && candidate.info.version ? candidate.info.version : null;
  if (baseVersion !== candidateVersion) {
    changes.push(change(
      baseVersion === candidateVersion ? NEUTRAL : ADDITIVE,
      'VERSION_CHANGED',
      'info.version',
      JSON.stringify(baseVersion) + ' -> ' + JSON.stringify(candidateVersion)
    ));
  }

  const basePaths = base.paths && typeof base.paths === 'object' ? base.paths : {};
  const candidatePaths = candidate.paths && typeof candidate.paths === 'object' ? candidate.paths : {};

  for (const route of Object.keys(basePaths)) {
    if (!Object.prototype.hasOwnProperty.call(candidatePaths, route)) {
      changes.push(change(BREAKING, 'PATH_REMOVED', route, 'the whole path is gone'));
      continue;
    }
    const baseItem = basePaths[route] || {};
    const candidateItem = candidatePaths[route] || {};
    for (const method of METHODS) {
      if (!baseItem[method]) continue;
      if (!candidateItem[method]) {
        changes.push(change(BREAKING, 'METHOD_REMOVED', route, method.toUpperCase() + ' was served and is gone'));
        continue;
      }
      changes.push(...compareOperation(baseItem[method], candidateItem[method], method.toUpperCase() + ' ' + route));
    }
    for (const method of METHODS) {
      if (baseItem[method] || !candidateItem[method]) continue;
      changes.push(change(ADDITIVE, 'METHOD_ADDED', route, method.toUpperCase() + ' is new'));
    }
  }

  for (const route of Object.keys(candidatePaths)) {
    if (!Object.prototype.hasOwnProperty.call(basePaths, route)) {
      changes.push(change(ADDITIVE, 'PATH_ADDED', route, 'new path'));
    }
  }

  // Deterministic output: the same pair always reports the same list.
  changes.sort((left, right) => (
    (left.location + '|' + left.code).localeCompare(right.location + '|' + right.code)
  ));

  const breaking = changes.filter((item) => item.classification !== ADDITIVE && item.classification !== NEUTRAL);
  const additive = changes.filter((item) => item.classification === ADDITIVE);
  const verdict = breaking.length > 0 ? BREAKING : (additive.length > 0 ? ADDITIVE : NEUTRAL);

  return { changes, breaking, additive, verdict };
}

module.exports = {
  BREAKING,
  ADDITIVE,
  NEUTRAL,
  METHODS,
  enumMembers,
  compareSchema,
  compareContracts,
};
