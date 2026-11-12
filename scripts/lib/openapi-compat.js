'use strict';

/**
 * scripts/lib/openapi-compat.js — the direction-aware compatibility classifier.
 *
 * Pure: two already-parsed OpenAPI documents in, a deterministic change list
 * out. No filesystem, no git, no clock, no network. `check-openapi-compatibility.js`
 * supplies the documents (the baseline from an explicit Git ref, the candidate
 * from the working tree) and decides the exit status.
 *
 * WHY DIRECTION MATTERS
 * ---------------------
 * Compatibility is not symmetric. A request schema is a set of ACCEPTED
 * messages, a response schema is a set of GUARANTEED results, and a change can
 * widen one while narrowing the other:
 *
 *   request   the candidate must accept every request the base accepted
 *             (`Accepted(base) ⊆ Accepted(candidate)`). Any narrowing —
 *             a new required property, a removed accepted value, a type that
 *             stops admitting a value — is BREAKING.
 *
 *   response  the candidate must guarantee at least what the base guaranteed,
 *             and stay consumable by a client written against the base. The
 *             guaranteed VALUE DOMAIN is treated as a contract: a response
 *             field that becomes optional or nullable, a response enum or type
 *             that gains OR loses a member, and any change to a response
 *             validation bound are BREAKING, because a client may depend on the
 *             exact values it can receive. Presence guarantees may strengthen
 *             (`required` added, `additionalProperties` closed, a new optional
 *             property on an open object, a new status code or media type):
 *             those are ADDITIVE.
 *
 * Both directions are propagated through every nested comparison: object
 * properties, array items, `allOf`/`anyOf`/`oneOf` branches, enums, types,
 * nullability, `required`, `additionalProperties`, validation constraints and
 * resolved `$ref` targets. `compareSchema()` never guesses: when the caller
 * omits a direction it defaults to `response`, the conservative side.
 *
 * CLASSIFICATION
 * --------------
 *   BREAKING  a client that worked against the base can fail against the
 *             candidate, or lose a guarantee it was entitled to rely on.
 *   ADDITIVE  an existing client keeps working and keeps its guarantees.
 *   NEUTRAL   nothing a client depends on changed (reported, never failed).
 *
 * CONSERVATIVE ASSUMPTIONS (deliberate, not oversights)
 * -----------------------------------------------------
 *  * A schema keyword this module does not model (`not`, `if`/`then`/`else`,
 *    `contains`, `prefixItems`, `discriminator`, `readOnly`, …) is reported as
 *    UNCOMPARABLE when it changes, and the CLI treats UNCOMPARABLE as BREAKING.
 *    An unexamined keyword must never be an implicit pass.
 *  * Removing a request property is BREAKING even when `additionalProperties`
 *    allowed it: the property carried a documented contract that disappears
 *    with it. Removing a response property is BREAKING for the same reason.
 *  * A response type, nullability or validation bound that changes in EITHER
 *    direction is BREAKING: the guaranteed value domain moved, and a client
 *    written against the base may depend on the values it could receive.
 *  * A response enum is CLOSED unless the contract says otherwise
 *    (`x-extensible-enum` array or `x-enum-open: true`). Gaining a member is
 *    BREAKING because a client with exhaustive handling never saw that value;
 *    losing a member is BREAKING because a documented value disappears.
 *  * A response object that opens (`additionalProperties: false → true`) or
 *    gains a property while it was closed is BREAKING: unknown keys start
 *    arriving where the base promised none.
 *  * A response `allOf` conjunct that is removed weakens the guarantee and is
 *    BREAKING; the same removal widens a request and is ADDITIVE.
 *  * A composition keyword that appears or disappears cannot be proven
 *    equivalent and is BREAKING in both directions.
 *  * Path Item parameters are inherited by every operation; an operation-level
 *    parameter with the same name+`in` overrides the inherited one. The
 *    classifier compares the effective request contract for each operation,
 *    so a path-level removal, addition or tightening cannot escape detection.
 *  * Media Type Object `encoding` changes request serialization even when the
 *    schema is unchanged. Adding, removing or reserializing an encoding entry
 *    is BREAKING; an encoding field this module does not model is
 *    UNCOMPARABLE, never an implicit pass.
 *  * Parameter and Header Objects declare their value with EITHER a `schema` OR
 *    a `content`, never both. A document that moves from one representation to
 *    the other describes a different wire shape; the transition is
 *    UNCOMPARABLE and therefore BREAKING, even though neither keyword is
 *    "removed" in a way a schema-only comparison would notice.
 *  * `security`, `servers` and `callbacks` are not modelled value by value.
 *    Their stable representation is compared where they are declared (root,
 *    Path Item and Operation), and a change is UNCOMPARABLE and therefore
 *    BREAKING. An unchanged declaration is not reported.
 *  * Recursive `$ref` cycles are compared once; the repeated visit is assumed
 *    equal because any difference is reported at the first visit.
 */

const BREAKING = 'BREAKING';
const ADDITIVE = 'ADDITIVE';
const NEUTRAL = 'NEUTRAL';

const REQUEST = 'request';
const RESPONSE = 'response';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Schema keywords compared by a dedicated rule below. */
const HANDLED_KEYS = new Set([
  'type', 'enum', 'nullable', 'properties', 'required', 'items',
  'additionalProperties', 'allOf', 'anyOf', 'oneOf',
  'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'multipleOf', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
  'x-extensible-enum', 'x-enum-open',
]);

/**
 * Presentation-only keywords. A client cannot observe these, so changing them
 * is not a compatibility event. `description`/`example`/`default` are the ones
 * that appear in this repository's contract.
 */
const ANNOTATION_KEYS = new Set([
  'description', 'title', 'summary', 'example', 'examples', 'default',
  'deprecated', 'externalDocs', 'xml', '$comment',
]);

/**
 * Validation keywords and what "stricter" means for each.
 *
 *   lower-bound    a HIGHER value accepts less  (minLength, minimum, …)
 *   upper-bound    a LOWER value accepts less   (maxLength, maximum, …)
 *   stricter-true  `true` accepts less          (uniqueItems)
 *   opaque         order is not decidable; any change is "changed"
 */
const CONSTRAINT_RULES = {
  minLength: 'lower-bound',
  minItems: 'lower-bound',
  minProperties: 'lower-bound',
  minimum: 'lower-bound',
  exclusiveMinimum: 'lower-bound',
  maxLength: 'upper-bound',
  maxItems: 'upper-bound',
  maxProperties: 'upper-bound',
  maximum: 'upper-bound',
  exclusiveMaximum: 'upper-bound',
  uniqueItems: 'stricter-true',
  multipleOf: 'opaque',
  pattern: 'opaque',
  format: 'opaque',
};

function change(classification, code, location, detail) {
  return { classification, code, location, detail };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Canonical JSON for one value: object keys sorted, so the signature depends on
 * the shape and not on key insertion order. Used to tell "the branches were
 * reordered" (no client-visible change) from "a branch changed".
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

/** The members of a closed vocabulary, however the generator rendered the union. */
function enumMembers(schema) {
  if (!schema || typeof schema !== 'object') return [];
  if (Array.isArray(schema.enum)) return schema.enum.slice();
  if (Array.isArray(schema['x-extensible-enum'])) return schema['x-extensible-enum'].slice();
  const branches = Array.isArray(schema.anyOf) ? schema.anyOf : (Array.isArray(schema.oneOf) ? schema.oneOf : []);
  const members = [];
  for (const branch of branches) {
    if (branch && Array.isArray(branch.enum)) members.push(...branch.enum);
    else if (branch && Array.isArray(branch['x-extensible-enum'])) members.push(...branch['x-extensible-enum']);
  }
  return members;
}

/**
 * A response enum is closed unless the document opts into extension. A request
 * enum is a list of accepted values and needs no openness marker (adding one
 * only widens what a caller may send).
 */
function isOpenEnum(schema) {
  if (!schema || typeof schema !== 'object') return false;
  if (schema['x-enum-open'] === true) return true;
  if (Array.isArray(schema['x-extensible-enum'])) return true;
  const branches = Array.isArray(schema.anyOf) ? schema.anyOf : (Array.isArray(schema.oneOf) ? schema.oneOf : []);
  return branches.some((branch) => branch && (branch['x-enum-open'] === true || Array.isArray(branch['x-extensible-enum'])));
}

/** The normalized JSON-type set, with null folded in from either rendering. */
function typeSet(schema) {
  const types = new Set();
  if (!schema || typeof schema !== 'object') return types;
  if (typeof schema.type === 'string') types.add(schema.type);
  else if (Array.isArray(schema.type)) {
    for (const type of schema.type) if (typeof type === 'string') types.add(type);
  }
  if (schema.nullable === true) types.add('null');
  return types;
}

function withoutValue(set, value) {
  const copy = new Set(set);
  copy.delete(value);
  return copy;
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

/** `integer` is a subset of `number`; every other type is only itself. */
function isTypeSubset(left, right) {
  for (const type of left) {
    if (right.has(type)) continue;
    if (type === 'integer' && right.has('number')) continue;
    return false;
  }
  return true;
}

function showTypes(set) {
  if (set.size === 0) return '(unconstrained)';
  return [...set].sort().join('|');
}

/* ------------------------------------------------------------------------- *
 * $ref resolution
 * ------------------------------------------------------------------------- */

/** Resolve one local JSON pointer (`#/components/schemas/Foo`). */
function lookupPointer(root, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('#/')) return undefined;
  let node = root;
  for (const token of pointer.slice(2).split('/')) {
    let key;
    try {
      key = decodeURIComponent(token).replace(/~1/g, '/').replace(/~0/g, '~');
    } catch (_error) {
      return undefined;
    }
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, key)) {
      return undefined;
    }
    node = node[key];
  }
  return node;
}

/**
 * Follow `$ref` until a non-reference schema is reached.
 *
 * @returns {{schema: object|null, chain: string[], problem: string|null}}
 */
function dereference(schema, root) {
  let current = schema;
  const chain = [];
  let guard = 0;
  while (current && typeof current === 'object' && typeof current.$ref === 'string') {
    const ref = current.$ref;
    if (guard > 64 || chain.includes(ref)) {
      return { schema: null, chain, problem: 'circular $ref ' + JSON.stringify(ref) };
    }
    guard += 1;
    const target = lookupPointer(root, ref);
    if (!isPlainObject(target)) {
      return { schema: null, chain, problem: 'unresolvable $ref ' + JSON.stringify(ref) };
    }
    const siblings = {};
    for (const [key, value] of Object.entries(current)) if (key !== '$ref') siblings[key] = value;
    current = Object.keys(siblings).length > 0 ? Object.assign({}, target, siblings) : target;
    chain.push(ref);
  }
  return { schema: current, chain, problem: null };
}

/* ------------------------------------------------------------------------- *
 * Schema comparison
 * ------------------------------------------------------------------------- */

function normalizeContext(options) {
  const context = options || {};
  return {
    direction: context.direction === REQUEST ? REQUEST : RESPONSE,
    baseRoot: isPlainObject(context.baseRoot) ? context.baseRoot : {},
    candidateRoot: isPlainObject(context.candidateRoot) ? context.candidateRoot : {},
    visited: Array.isArray(context.visited) ? context.visited : [],
    enumCovered: Boolean(context.enumCovered),
  };
}

/**
 * Types. For a request the candidate may widen but must not narrow. For a
 * response the guaranteed value domain is treated as a contract: BOTH a
 * narrowing (rule A6) and a widening are BREAKING, because a client written
 * against the base may depend on the exact set of values it can receive.
 * Nullability is reported on its own so the diff names the change.
 */
function compareTypes(base, candidate, location, direction) {
  const baseTypes = typeSet(base);
  const candidateTypes = typeSet(candidate);
  if (baseTypes.size === 0 && candidateTypes.size === 0) return [];
  if (sameSet(baseTypes, candidateTypes)) return [];

  const baseWithoutNull = withoutValue(baseTypes, 'null');
  const candidateWithoutNull = withoutValue(candidateTypes, 'null');
  const nullAdded = !baseTypes.has('null') && candidateTypes.has('null');
  const nullRemoved = baseTypes.has('null') && !candidateTypes.has('null');

  if (sameSet(baseWithoutNull, candidateWithoutNull) && (nullAdded || nullRemoved)) {
    if (nullAdded) {
      // A nullable request field is a widening (safe); a nullable response field
      // is a weakened guarantee (a client that never handled null now can).
      return [change(
        direction === REQUEST ? ADDITIVE : BREAKING,
        'NULLABILITY_ADDED',
        location,
        direction === REQUEST
          ? 'the request field became nullable; callers may keep sending the old values'
          : 'the response field became nullable; a client written against the base may not handle null'
      )];
    }
    return [change(
      BREAKING,
      'NULLABILITY_REMOVED',
      location,
      direction === REQUEST
        ? 'the request field stopped being nullable; a previously accepted null is now rejected'
        : 'the response value domain narrowed by removing null; a client that relied on the previous type set is affected'
    )];
  }

  const named = showTypes(baseTypes) + ' -> ' + showTypes(candidateTypes);

  if (baseTypes.size === 0) {
    // Rule A6: a response that starts declaring a type changes the guaranteed
    // value domain just as much as one that drops a type. Both directions are
    // BREAKING; only a request can widen safely.
    return [change(
      BREAKING,
      direction === REQUEST ? 'TYPE_RESTRICTED' : 'TYPE_CHANGED',
      location,
      'the base accepted any type and the candidate declares ' + showTypes(candidateTypes)
        + (direction === REQUEST
          ? '; that narrows what a caller may send'
          : '; the guaranteed response value domain changed')
    )];
  }
  if (candidateTypes.size === 0) {
    return [change(
      direction === REQUEST ? ADDITIVE : BREAKING,
      direction === REQUEST ? 'TYPE_WIDENED' : 'TYPE_CHANGED',
      location,
      'the candidate accepts any type where the base declared ' + showTypes(baseTypes)
    )];
  }

  if (direction === REQUEST) {
    if (isTypeSubset(baseTypes, candidateTypes)) {
      return [change(ADDITIVE, 'TYPE_WIDENED', location, 'the request type widened: ' + named)];
    }
    return [change(BREAKING, 'TYPE_CHANGED', location, 'the request type narrowed or changed incompatibly: ' + named)];
  }

  // A response type is compared for identity: narrowing is rule A6, widening is
  // a wider value set, and neither can be proven safe for an existing client.
  return [change(
    BREAKING,
    'TYPE_CHANGED',
    location,
    'the guaranteed response value domain changed: ' + named
      + (isTypeSubset(candidateTypes, baseTypes) ? ' (narrowed)' : ' (widened or incomparable)')
  )];
}

/**
 * Enums. Request enums are accepted values; response enums are closed
 * guarantees. An enum constraint that appears or disappears is itself a change.
 */
function compareEnums(base, candidate, location, direction) {
  const baseMembers = enumMembers(base);
  const candidateMembers = enumMembers(candidate);
  const changes = [];

  if (baseMembers.length > 0 && candidateMembers.length === 0) {
    changes.push(change(
      direction === REQUEST ? ADDITIVE : BREAKING,
      direction === REQUEST ? 'ENUM_OPENED' : 'ENUM_REMOVED',
      location,
      direction === REQUEST
        ? 'the request enum constraint was dropped; every previously accepted value is still accepted'
        : 'the response enum constraint was dropped; the base promised a closed set of values'
    ));
    return changes;
  }
  if (baseMembers.length === 0 && candidateMembers.length > 0) {
    changes.push(change(
      BREAKING,
      'ENUM_RESTRICTED',
      location,
      direction === REQUEST
        ? 'a request enum constraint was added; a value the base accepted is now rejected'
        : 'a response enum constraint was added; the API can no longer return values the base allowed'
    ));
    return changes;
  }
  if (baseMembers.length === 0 && candidateMembers.length === 0) return changes;

  const baseSet = new Set(baseMembers.map((member) => stableSignature(member)));
  const candidateSet = new Set(candidateMembers.map((member) => stableSignature(member)));
  const open = isOpenEnum(base) && isOpenEnum(candidate);

  for (const member of baseMembers) {
    if (candidateSet.has(stableSignature(member))) continue;
    changes.push(change(
      BREAKING,
      'ENUM_MEMBER_REMOVED',
      location,
      'removed enum member ' + JSON.stringify(member)
        + (direction === REQUEST
          ? '; a caller that sent it is now rejected'
          : '; a value the base guaranteed the API could return is gone')
    ));
  }
  for (const member of candidateMembers) {
    if (baseSet.has(stableSignature(member))) continue;
    if (direction === REQUEST) {
      changes.push(change(
        ADDITIVE,
        'ENUM_MEMBER_ADDED',
        location,
        'added enum member ' + JSON.stringify(member) + '; the request accepts one more value'
      ));
    } else if (open) {
      changes.push(change(
        ADDITIVE,
        'ENUM_MEMBER_ADDED',
        location,
        'added enum member ' + JSON.stringify(member) + '; the response enum is declared extensible'
      ));
    } else {
      changes.push(change(
        BREAKING,
        'ENUM_MEMBER_ADDED',
        location,
        'added enum member ' + JSON.stringify(member)
          + '; the response enum is closed, and a client with exhaustive handling never saw this value'
      ));
    }
  }
  return changes;
}

/**
 * Validation constraints. The candidate's strictness is compared against the
 * base's: stricter is a narrowing, looser is a widening, and an opaque change
 * (a different pattern, a different `format`) is not provable either way.
 */
function compareConstraints(base, candidate, location, direction) {
  const changes = [];
  for (const [keyword, rule] of Object.entries(CONSTRAINT_RULES)) {
    const before = base[keyword];
    const after = candidate[keyword];
    if (before === undefined && after === undefined) continue;
    if (stableSignature(before) === stableSignature(after)) continue;

    let verdict;
    if (before === undefined || after === undefined) {
      // Declaring a constraint where there was none restricts; dropping one relaxes.
      verdict = after === undefined ? 'looser' : 'stricter';
    } else if (rule === 'opaque') {
      verdict = 'changed';
    } else if (rule === 'stricter-true') {
      verdict = (typeof before === 'boolean' && typeof after === 'boolean')
        ? (after ? 'stricter' : 'looser')
        : 'changed';
    } else if (typeof before === 'number' && typeof after === 'number') {
      if (rule === 'lower-bound') verdict = after > before ? 'stricter' : (after < before ? 'looser' : null);
      else verdict = after < before ? 'stricter' : (after > before ? 'looser' : null);
    } else if (typeof before === 'boolean' && typeof after === 'boolean') {
      // OpenAPI 3.0 renders exclusiveMinimum/Maximum as booleans.
      verdict = after === before ? null : (after ? 'stricter' : 'looser');
    } else {
      verdict = 'changed';
    }
    if (verdict === null) continue;

    const named = keyword + ' ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after);
    if (verdict === 'changed') {
      changes.push(change(BREAKING, 'VALIDATION_CHANGED', location, named + '; the two constraints cannot be ordered'));
    } else if (verdict === 'stricter') {
      changes.push(change(
        BREAKING,
        'VALIDATION_RESTRICTED',
        location,
        named + (direction === REQUEST
          ? '; a request the base accepted is now rejected'
          : '; the guaranteed response value domain narrowed')
      ));
    } else {
      changes.push(change(
        direction === REQUEST ? ADDITIVE : BREAKING,
        'VALIDATION_RELAXED',
        location,
        named + (direction === REQUEST
          ? '; the request accepts more than before'
          : '; the response no longer guarantees what the base guaranteed')
      ));
    }
  }
  return changes;
}

/** How permissive the "extra keys" domain is: open > schema > closed. */
const ADDITIONAL_PROPERTIES_RANK = { closed: 0, schema: 1, open: 2 };

function additionalPropertiesKind(value) {
  if (value === false) return 'closed';
  if (isPlainObject(value)) return 'schema';
  return 'open';
}

function compareAdditionalProperties(base, candidate, location, context) {
  const baseKind = additionalPropertiesKind(base.additionalProperties);
  const candidateKind = additionalPropertiesKind(candidate.additionalProperties);

  if (baseKind === 'schema' && candidateKind === 'schema') {
    return compareSchema(
      base.additionalProperties,
      candidate.additionalProperties,
      location + ' additionalProperties',
      descend(context)
    );
  }

  const baseRank = ADDITIONAL_PROPERTIES_RANK[baseKind];
  const candidateRank = ADDITIONAL_PROPERTIES_RANK[candidateKind];
  if (baseRank === candidateRank) return [];

  const detail = 'additionalProperties ' + baseKind + ' -> ' + candidateKind;
  if (context.direction === REQUEST) {
    return [candidateRank < baseRank
      ? change(BREAKING, 'OBJECT_CLOSED', location, detail + '; a key the base accepted is now rejected')
      : change(ADDITIVE, 'OBJECT_OPENED', location, detail + '; the request accepts more keys')];
  }
  return [candidateRank > baseRank
    ? change(BREAKING, 'OBJECT_OPENED', location, detail + '; keys the base promised would never appear may now appear')
    : change(ADDITIVE, 'OBJECT_CLOSED', location, detail + '; the response guarantee only became stronger')];
}

/** `required` and `properties`, with the request/response split. */
function compareObjectProperties(base, candidate, location, context) {
  const direction = context.direction;
  const changes = [];
  const baseRequired = new Set(Array.isArray(base.required) ? base.required : []);
  const candidateRequired = new Set(Array.isArray(candidate.required) ? candidate.required : []);
  const baseProperties = isPlainObject(base.properties) ? base.properties : {};
  const candidateProperties = isPlainObject(candidate.properties) ? candidate.properties : {};
  const baseClosed = base.additionalProperties === false;

  for (const name of baseRequired) {
    if (candidateRequired.has(name)) continue;
    changes.push(direction === REQUEST
      ? change(ADDITIVE, 'PROPERTY_BECAME_OPTIONAL', location, name + ' is no longer required; the request accepts one more shape')
      : change(BREAKING, 'PROPERTY_BECAME_OPTIONAL', location, name + ' is no longer guaranteed; a client written against the base may read it as missing'));
  }
  for (const name of candidateRequired) {
    if (baseRequired.has(name)) continue;
    changes.push(direction === REQUEST
      ? change(BREAKING, 'PROPERTY_BECAME_REQUIRED', location, name + ' became required; a request the base accepted is now rejected')
      : change(ADDITIVE, 'PROPERTY_BECAME_REQUIRED', location, name + ' is now always present; the response guarantee only became stronger'));
  }

  for (const name of Object.keys(baseProperties)) {
    if (!Object.prototype.hasOwnProperty.call(candidateProperties, name)) {
      changes.push(change(
        BREAKING,
        'PROPERTY_REMOVED',
        location,
        'removed property ' + JSON.stringify(name)
          + (direction === REQUEST
            ? '; the key was part of the accepted contract'
            : '; a client written against the base may depend on it')
      ));
      continue;
    }
    changes.push(...compareSchema(
      baseProperties[name],
      candidateProperties[name],
      location + '.' + name,
      descend(context)
    ));
  }

  for (const name of Object.keys(candidateProperties)) {
    if (Object.prototype.hasOwnProperty.call(baseProperties, name)) continue;
    if (direction === REQUEST) {
      changes.push(change(ADDITIVE, 'PROPERTY_ADDED', location, 'added property ' + JSON.stringify(name) + '; the request accepts a new key'));
    } else if (baseClosed) {
      changes.push(change(
        BREAKING,
        'PROPERTY_ADDED',
        location,
        'added property ' + JSON.stringify(name)
          + ' to a response object the base declared closed (additionalProperties: false)'
      ));
    } else {
      changes.push(change(ADDITIVE, 'PROPERTY_ADDED', location, 'added property ' + JSON.stringify(name) + '; an open response object may gain keys'));
    }
  }

  return changes;
}

/**
 * Compare one composition keyword (`allOf`, `anyOf`, `oneOf`) branch by branch.
 *
 * Identical branches are matched by signature first, so a reordering reports
 * nothing and an added or removed branch is not confused with an edited one.
 * The remaining branches are paired in order to recover property-level detail.
 *
 * `allOf` branches are conjuncts: adding one narrows the accepted input and
 * removing one widens it. `anyOf`/`oneOf` branches are alternatives: adding one
 * accepts more for a request but can serve an unknown variant for a response.
 */
function compareComposition(base, candidate, location, context) {
  const direction = context.direction;
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

    const unmatched = candidateBranches.map((branch) => ({ branch, used: false }));
    const unmatchedBase = [];
    for (const branch of baseBranches) {
      const signature = stableSignature(branch);
      const match = unmatched.find((entry) => !entry.used && stableSignature(entry.branch) === signature);
      if (match) match.used = true;
      else unmatchedBase.push(branch);
    }
    const unmatchedCandidate = unmatched.filter((entry) => !entry.used).map((entry) => entry.branch);

    // `enumMembers()` flattens the parent's anyOf first, then oneOf. Suppress a
    // branch-level enum comparison only for the keyword it actually flattened on
    // BOTH sides; a second keyword's branch enums are compared normally.
    const flattenedWith = (schema) => (Array.isArray(schema.anyOf)
      ? 'anyOf'
      : (Array.isArray(schema.oneOf) ? 'oneOf' : null));
    const enumCovered = union && flattenedWith(base) === keyword && flattenedWith(candidate) === keyword;

    const pairs = Math.min(unmatchedBase.length, unmatchedCandidate.length);
    for (let index = 0; index < pairs; index += 1) {
      changes.push(...compareSchema(unmatchedBase[index], unmatchedCandidate[index], at + '[' + index + ']', {
        direction,
        baseRoot: context.baseRoot,
        candidateRoot: context.candidateRoot,
        visited: context.visited,
        enumCovered,
      }));
    }

    const removedCount = unmatchedBase.length - pairs;
    const addedCount = unmatchedCandidate.length - pairs;

    if (removedCount > 0) {
      const breaking = union || direction === RESPONSE;
      changes.push(change(
        breaking ? BREAKING : ADDITIVE,
        union ? 'COMPOSITION_VARIANT_REMOVED' : 'COMPOSITION_CONSTRAINT_REMOVED',
        at,
        'the candidate declares ' + removedCount + ' fewer ' + keyword + ' branch(es)'
          + (union
            ? (direction === REQUEST
              ? '; a request shape the base accepted is no longer described'
              : '; a variant the base could serve is no longer described')
            : (direction === REQUEST
              ? '; the request accepts more shapes'
              : '; a conjunct the base guaranteed is no longer applied'))
      ));
    }
    if (addedCount > 0) {
      const breaking = union ? direction === RESPONSE : direction === REQUEST;
      changes.push(change(
        breaking ? BREAKING : ADDITIVE,
        union ? 'COMPOSITION_VARIANT_ADDED' : 'COMPOSITION_CONSTRAINT_ADDED',
        at,
        'the candidate declares ' + addedCount + ' more ' + keyword + ' branch(es)'
          + (union
            ? (direction === REQUEST
              ? '; the request accepts one more shape'
              : '; a client written against the base may receive a variant it has never seen')
            : (direction === REQUEST
              ? '; a request that the base accepted can now fail the extra conjunct'
              : '; the response guarantee only became stronger'))
      ));
    }
  }

  return changes;
}

/**
 * Any schema keyword this module does not model: a change is UNCOMPARABLE, and
 * the CLI treats UNCOMPARABLE as BREAKING. Silence would be an implicit pass.
 */
function compareUnmodelledKeywords(base, candidate, location) {
  const changes = [];
  const keys = new Set(Object.keys(base).concat(Object.keys(candidate)));
  for (const key of [...keys].sort()) {
    if (key === '$ref' || key.startsWith('x-')) continue;
    if (HANDLED_KEYS.has(key) || ANNOTATION_KEYS.has(key)) continue;
    if (stableSignature(base[key]) === stableSignature(candidate[key])) continue;
    changes.push(change(
      BREAKING,
      'UNCOMPARABLE',
      location,
      'unsupported schema keyword ' + JSON.stringify(key)
        + ' changed; this classifier cannot prove the change compatible'
    ));
  }
  return changes;
}

/** A context for the children of the schema currently being compared. */
function descend(context) {
  return {
    direction: context.direction,
    baseRoot: context.baseRoot,
    candidateRoot: context.candidateRoot,
    visited: context.visited,
    enumCovered: false,
  };
}

/**
 * Compare two schemas. `location` is a human path such as
 * `/v1/recommendations 201.properties.builds`.
 *
 * @param {object} baseInput the base schema (may carry `$ref`)
 * @param {object} candidateInput the candidate schema (may carry `$ref`)
 * @param {string} location the human path reported in a change
 * @param {{direction?: string, baseRoot?: object, candidateRoot?: object,
 *          visited?: string[], enumCovered?: boolean}} options
 *        `direction` is `'request'` or `'response'`; it defaults to
 *        `'response'`, the conservative side.
 * @returns {Array<{classification: string, code: string, location: string, detail: string}>}
 */
function compareSchema(baseInput, candidateInput, location, options) {
  const context = normalizeContext(options);
  const direction = context.direction;

  if (baseInput === undefined && candidateInput === undefined) return [];
  if (baseInput === undefined) {
    return [change(
      direction === REQUEST ? BREAKING : ADDITIVE,
      direction === REQUEST ? 'SCHEMA_RESTRICTED' : 'SCHEMA_ADDED',
      location,
      direction === REQUEST
        ? 'a schema appeared where the base accepted any body; callers may now be rejected'
        : 'a schema appeared where the base guaranteed nothing specific'
    )];
  }
  if (candidateInput === undefined) {
    return [change(
      direction === RESPONSE ? BREAKING : ADDITIVE,
      direction === RESPONSE ? 'SCHEMA_REMOVED' : 'SCHEMA_RELAXED',
      location,
      direction === RESPONSE
        ? 'the base guaranteed a response schema and the candidate declares none'
        : 'the candidate dropped the request schema; every previously accepted body is still accepted'
    )];
  }
  if (!isPlainObject(baseInput) || !isPlainObject(candidateInput)) {
    return stableSignature(baseInput) === stableSignature(candidateInput)
      ? []
      : [change(BREAKING, 'UNCOMPARABLE', location, 'the two schemas are not comparable objects')];
  }

  const baseResolution = dereference(baseInput, context.baseRoot);
  const candidateResolution = dereference(candidateInput, context.candidateRoot);
  if (baseResolution.schema === null || candidateResolution.schema === null) {
    return [change(
      BREAKING,
      'UNCOMPARABLE',
      location,
      'cannot resolve ' + (baseResolution.problem || candidateResolution.problem || 'a schema reference')
    )];
  }

  const pairKey = baseResolution.chain.join('>') + '|' + candidateResolution.chain.join('>');
  const reachedByReference = baseResolution.chain.length > 0 || candidateResolution.chain.length > 0;
  if (reachedByReference && context.visited.includes(pairKey)) {
    // Recursive reference: the change, if any, was reported where the cycle began.
    return [];
  }

  const base = baseResolution.schema;
  const candidate = candidateResolution.schema;
  const childContext = descend(context);
  if (reachedByReference) childContext.visited = context.visited.concat(pairKey);

  const changes = [];
  changes.push(...compareTypes(base, candidate, location, direction));
  if (!context.enumCovered) changes.push(...compareEnums(base, candidate, location, direction));
  changes.push(...compareConstraints(base, candidate, location, direction));
  changes.push(...compareAdditionalProperties(base, candidate, location, childContext));
  changes.push(...compareObjectProperties(base, candidate, location, childContext));

  if (base.items !== undefined || candidate.items !== undefined) {
    if (Array.isArray(base.items) || Array.isArray(candidate.items)) {
      if (stableSignature(base.items) !== stableSignature(candidate.items)) {
        changes.push(change(
          BREAKING,
          'UNCOMPARABLE',
          location + '[]',
          'a tuple-style items array changed; this classifier only models a single item schema'
        ));
      }
    } else {
      changes.push(...compareSchema(base.items, candidate.items, location + '[]', childContext));
    }
  }

  changes.push(...compareComposition(base, candidate, location, childContext));
  changes.push(...compareUnmodelledKeywords(base, candidate, location));

  return changes;
}

/* ------------------------------------------------------------------------- *
 * Operations, parameters, content and responses
 * ------------------------------------------------------------------------- */

/** Encoding fields that change how a request part is serialized. */
const ENCODING_KEYS = new Set(['contentType', 'headers', 'style', 'explode', 'allowReserved']);

const REPRESENTATION_SCHEMA = 'schema';
const REPRESENTATION_CONTENT = 'content';
const REPRESENTATION_NONE = 'none';
const REPRESENTATION_BOTH = 'schema+content';

/**
 * Which representation a Parameter or Header Object uses. OpenAPI 3.0 allows
 * exactly one of `schema` and `content`; both is invalid, but is still made
 * explicit here so the comparison cannot fall through a branch.
 */
function representationKind(node) {
  if (!isPlainObject(node)) return REPRESENTATION_NONE;
  const hasSchema = node.schema !== undefined;
  const hasContent = node.content !== undefined;
  if (hasSchema && hasContent) return REPRESENTATION_BOTH;
  if (hasSchema) return REPRESENTATION_SCHEMA;
  if (hasContent) return REPRESENTATION_CONTENT;
  return REPRESENTATION_NONE;
}

/**
 * Compare the `schema`/`content` representation shared by Parameter and Header
 * Objects.
 *
 * The two are alternative encodings of the same slot, not layered keywords: a
 * client that sent a query parameter according to `schema: string` does not
 * automatically send the `content: application/json` object. Comparing only
 * the branch present on both sides silently drops the representation that
 * disappeared, so ANY transition (schema <-> content, or a side that declares
 * neither) fails closed as UNCOMPARABLE (BREAKING) instead.
 */
function compareRepresentation(baseNode, candidateNode, location, direction, context) {
  const before = isPlainObject(baseNode) ? baseNode : {};
  const after = isPlainObject(candidateNode) ? candidateNode : {};
  const baseKind = representationKind(before);
  const candidateKind = representationKind(after);

  if (baseKind === REPRESENTATION_NONE && candidateKind === REPRESENTATION_NONE) return [];

  if (baseKind === candidateKind) {
    const changes = [];
    if (baseKind !== REPRESENTATION_CONTENT) {
      changes.push(...compareSchema(before.schema, after.schema, location, {
        direction,
        baseRoot: context.baseRoot,
        candidateRoot: context.candidateRoot,
      }));
    }
    if (baseKind !== REPRESENTATION_SCHEMA) {
      changes.push(...compareContent(before.content, after.content, location, direction, context));
    }
    return changes;
  }

  return [change(
    BREAKING,
    'UNCOMPARABLE',
    location,
    'the representation changed from ' + baseKind + ' to ' + candidateKind
      + '; schema and content describe different wire shapes and cannot be compared'
  )];
}

/**
 * Encoding headers are Header Objects, not Parameter Objects. A removed,
 * added or reserialized header changes the representation of the part, so the
 * request rules apply to its schema and any change to presence/serialization
 * is BREAKING.
 */
function compareEncodingHeaders(baseHeaders, candidateHeaders, location, context) {
  const changes = [];
  if (baseHeaders === undefined && candidateHeaders === undefined) return changes;

  const baseIsObject = isPlainObject(baseHeaders);
  const candidateIsObject = isPlainObject(candidateHeaders);
  if ((baseHeaders !== undefined && !baseIsObject) || (candidateHeaders !== undefined && !candidateIsObject)) {
    if (stableSignature(baseHeaders) !== stableSignature(candidateHeaders)) {
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        location,
        'the encoding headers are not comparable; this classifier cannot prove the change compatible'
      ));
    }
    return changes;
  }

  const base = baseIsObject ? baseHeaders : {};
  const candidate = candidateIsObject ? candidateHeaders : {};

  for (const name of Object.keys(base)) {
    if (!Object.prototype.hasOwnProperty.call(candidate, name)) {
      changes.push(change(
        BREAKING,
        'ENCODING_HEADER_REMOVED',
        location,
        'removed encoding header ' + JSON.stringify(name) + '; the request representation changed'
      ));
      continue;
    }
    const baseResolved = resolveNode(base[name], context.baseRoot);
    const candidateResolved = resolveNode(candidate[name], context.candidateRoot);
    if (baseResolved.node === null || candidateResolved.node === null) {
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        location + ' header ' + JSON.stringify(name),
        'cannot resolve ' + (baseResolved.problem || candidateResolved.problem || 'an encoding header reference')
      ));
      continue;
    }
    const before = baseResolved.node;
    const after = candidateResolved.node;
    const at = location + ' header ' + JSON.stringify(name);

    if ((before.required === true) !== (after.required === true)) {
      changes.push(change(
        BREAKING,
        'ENCODING_HEADER_CHANGED',
        at,
        'required ' + JSON.stringify(before.required === true) + ' -> ' + JSON.stringify(after.required === true)
          + '; the request representation changed'
      ));
    }
    changes.push(...compareRepresentation(before, after, at, REQUEST, context));
    for (const field of ['style', 'explode', 'allowReserved']) {
      if (stableSignature(before[field]) === stableSignature(after[field])) continue;
      changes.push(change(
        BREAKING,
        'ENCODING_HEADER_CHANGED',
        at,
        'the serialization of header ' + JSON.stringify(name) + ' changed (' + field + ')'
      ));
    }
  }

  for (const name of Object.keys(candidate)) {
    if (Object.prototype.hasOwnProperty.call(base, name)) continue;
    changes.push(change(
      BREAKING,
      'ENCODING_HEADER_ADDED',
      location,
      'added encoding header ' + JSON.stringify(name) + '; the request representation changed'
    ));
  }
  return changes;
}

/** Compare one Encoding Object's wire-format fields. */
function compareEncodingEntry(baseEntry, candidateEntry, location, context) {
  const changes = [];
  if (!isPlainObject(baseEntry) || !isPlainObject(candidateEntry)) {
    if (stableSignature(baseEntry) !== stableSignature(candidateEntry)) {
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        location,
        'the encoding entry is not a comparable object; this classifier cannot prove the change compatible'
      ));
    }
    return changes;
  }

  for (const field of ['contentType', 'style', 'explode', 'allowReserved']) {
    if (stableSignature(baseEntry[field]) === stableSignature(candidateEntry[field])) continue;
    changes.push(change(
      BREAKING,
      'ENCODING_CHANGED',
      location,
      field + ' ' + JSON.stringify(baseEntry[field]) + ' -> ' + JSON.stringify(candidateEntry[field])
        + '; the request wire format changed'
    ));
  }

  if (baseEntry.headers !== undefined || candidateEntry.headers !== undefined) {
    changes.push(...compareEncodingHeaders(baseEntry.headers, candidateEntry.headers, location, context));
  }

  const keys = new Set(Object.keys(baseEntry).concat(Object.keys(candidateEntry)));
  for (const key of [...keys].sort()) {
    if (key.startsWith('x-') || ENCODING_KEYS.has(key)) continue;
    if (stableSignature(baseEntry[key]) === stableSignature(candidateEntry[key])) continue;
    changes.push(change(
      BREAKING,
      'UNCOMPARABLE',
      location,
      'unsupported encoding field ' + JSON.stringify(key)
        + ' changed; this classifier cannot prove the change compatible'
    ));
  }
  return changes;
}

/**
 * Compare Media Type Object `encoding`. Encoding changes the wire format of a
 * request part even when the schema is unchanged, so adding, removing or
 * reserializing an entry is BREAKING. An encoding field this module does not
 * model is reported as UNCOMPARABLE (which fails the gate), never ignored.
 */
function compareMediaTypeEncoding(baseEncoding, candidateEncoding, location, context) {
  const changes = [];
  if (baseEncoding === undefined && candidateEncoding === undefined) return changes;

  const baseIsObject = isPlainObject(baseEncoding);
  const candidateIsObject = isPlainObject(candidateEncoding);
  if ((baseEncoding !== undefined && !baseIsObject) || (candidateEncoding !== undefined && !candidateIsObject)) {
    if (stableSignature(baseEncoding) !== stableSignature(candidateEncoding)) {
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        location,
        'the encoding object is not comparable; this classifier cannot prove the change compatible'
      ));
    }
    return changes;
  }

  const base = baseIsObject ? baseEncoding : {};
  const candidate = candidateIsObject ? candidateEncoding : {};

  for (const property of Object.keys(base)) {
    if (!Object.prototype.hasOwnProperty.call(candidate, property)) {
      changes.push(change(
        BREAKING,
        'ENCODING_REMOVED',
        location + ' property ' + JSON.stringify(property),
        'removed the encoding for ' + JSON.stringify(property) + '; the request representation changed'
      ));
      continue;
    }
    changes.push(...compareEncodingEntry(
      base[property],
      candidate[property],
      location + ' property ' + JSON.stringify(property),
      context
    ));
  }

  for (const property of Object.keys(candidate)) {
    if (Object.prototype.hasOwnProperty.call(base, property)) continue;
    changes.push(change(
      BREAKING,
      'ENCODING_ADDED',
      location + ' property ' + JSON.stringify(property),
      'added an encoding for ' + JSON.stringify(property) + '; the request representation changed'
    ));
  }
  return changes;
}

/** Compare every media type the operation declares a schema for. */
function compareContent(baseContent, candidateContent, location, direction, context) {
  const changes = [];
  const baseTypes = isPlainObject(baseContent) ? Object.keys(baseContent) : [];
  const candidateTypes = isPlainObject(candidateContent) ? Object.keys(candidateContent) : [];

  for (const mediaType of baseTypes) {
    if (!isPlainObject(candidateContent) || candidateContent[mediaType] === undefined) {
      changes.push(change(BREAKING, 'MEDIA_TYPE_REMOVED', location, 'removed ' + mediaType));
      continue;
    }
    const baseSchema = baseContent[mediaType] && baseContent[mediaType].schema;
    const candidateSchema = candidateContent[mediaType] && candidateContent[mediaType].schema;
    changes.push(...compareSchema(baseSchema, candidateSchema, location + ' ' + mediaType, {
      direction,
      baseRoot: context.baseRoot,
      candidateRoot: context.candidateRoot,
    }));
    changes.push(...compareMediaTypeEncoding(
      baseContent[mediaType] && baseContent[mediaType].encoding,
      candidateContent[mediaType] && candidateContent[mediaType].encoding,
      location + ' ' + mediaType + ' encoding',
      context
    ));
  }
  for (const mediaType of candidateTypes) {
    if (baseTypes.includes(mediaType)) continue;
    changes.push(change(ADDITIVE, 'MEDIA_TYPE_ADDED', location, 'added ' + mediaType));
  }
  return changes;
}

/**
 * OpenAPI parameter identity is the combination of `name` and `in`, even when
 * one side renders the parameter as a `$ref`. Resolving first is what makes an
 * operation-level parameter override the inherited path-level one.
 */
function parameterKey(parameter, root) {
  if (!isPlainObject(parameter)) return '$invalid:' + stableSignature(parameter);
  const resolved = resolveNode(parameter, root);
  if (resolved.node !== null && isPlainObject(resolved.node)) {
    return String(resolved.node.in || 'query') + ':' + String(resolved.node.name || '');
  }
  if (typeof parameter.$ref === 'string') return '$ref:' + parameter.$ref;
  return String(parameter.in || 'query') + ':' + String(parameter.name || '');
}

/**
 * The parameters an operation actually accepts: Path Item parameters are
 * inherited, but an operation-level parameter with the same name+`in` replaces
 * the inherited one. Concatenating both arrays would compare a parameter with
 * itself and miss the override.
 */
function effectiveParameters(pathItem, operation, root) {
  const pathParameters = isPlainObject(pathItem) && Array.isArray(pathItem.parameters)
    ? pathItem.parameters
    : [];
  const operationParameters = isPlainObject(operation) && Array.isArray(operation.parameters)
    ? operation.parameters
    : [];
  const merged = [];
  const positions = new Map();

  for (const parameter of pathParameters.concat(operationParameters)) {
    const key = parameterKey(parameter, root);
    if (positions.has(key)) {
      merged[positions.get(key)] = parameter;
    } else {
      positions.set(key, merged.length);
      merged.push(parameter);
    }
  }
  return merged;
}

/**
 * Resolve a whole operation-level object (a parameter, a request body, a
 * response) that may be a `$ref` to `components`. A reference this module
 * cannot follow is reported, never treated as unchanged.
 */
function resolveNode(node, root) {
  if (!isPlainObject(node) || typeof node.$ref !== 'string') return { node, problem: null };
  const resolution = dereference(node, root);
  return resolution.schema === null
    ? { node: null, problem: resolution.problem }
    : { node: resolution.schema, problem: null };
}

function compareParameters(baseParameters, candidateParameters, location, context) {
  const changes = [];
  const baseList = Array.isArray(baseParameters) ? baseParameters : [];
  const candidateList = Array.isArray(candidateParameters) ? candidateParameters : [];
  const baseByKey = new Map(baseList.map((parameter) => [parameterKey(parameter, context.baseRoot), parameter]));
  const candidateByKey = new Map(candidateList.map((parameter) => [parameterKey(parameter, context.candidateRoot), parameter]));

  for (const [key, parameter] of baseByKey) {
    if (!candidateByKey.has(key)) {
      changes.push(change(BREAKING, 'PARAMETER_REMOVED', location, 'removed parameter ' + key));
      continue;
    }
    const candidate = candidateByKey.get(key);
    const baseResolved = resolveNode(parameter, context.baseRoot);
    const candidateResolved = resolveNode(candidate, context.candidateRoot);
    if (baseResolved.node === null || candidateResolved.node === null) {
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        location + ' parameter ' + key,
        'cannot resolve ' + (baseResolved.problem || candidateResolved.problem || 'a parameter reference')
      ));
      continue;
    }
    const before = baseResolved.node;
    const after = candidateResolved.node;
    if (before.required === true && after.required !== true) {
      changes.push(change(ADDITIVE, 'PARAMETER_BECAME_OPTIONAL', location, key + ' is no longer required'));
    } else if (before.required !== true && after.required === true) {
      changes.push(change(BREAKING, 'PARAMETER_BECAME_REQUIRED', location, key + ' became required'));
    }
    changes.push(...compareRepresentation(before, after, location + ' parameter ' + key, REQUEST, context));
    for (const field of ['style', 'explode', 'allowEmptyValue', 'allowReserved']) {
      if (stableSignature(before[field]) === stableSignature(after[field])) continue;
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        location + ' parameter ' + key,
        'the serialization of ' + key + ' changed (' + field + '); existing clients serialize differently'
      ));
    }
  }
  for (const [key, parameter] of candidateByKey) {
    if (baseByKey.has(key)) continue;
    const resolved = resolveNode(parameter, context.candidateRoot);
    if (resolved.node === null) {
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        location + ' parameter ' + key,
        'cannot resolve ' + (resolved.problem || 'an added parameter reference')
      ));
      continue;
    }
    changes.push(resolved.node.required === true
      ? change(BREAKING, 'REQUIRED_PARAMETER_ADDED', location, 'added required parameter ' + key)
      : change(ADDITIVE, 'PARAMETER_ADDED', location, 'added optional parameter ' + key));
  }
  return changes;
}

/** Response headers: a removed header, or one that stops being guaranteed. */
function compareResponseHeaders(baseHeaders, candidateHeaders, location, context) {
  const base = isPlainObject(baseHeaders) ? baseHeaders : {};
  const candidate = isPlainObject(candidateHeaders) ? candidateHeaders : {};
  const changes = [];

  for (const name of Object.keys(base)) {
    if (!Object.prototype.hasOwnProperty.call(candidate, name)) {
      changes.push(change(BREAKING, 'RESPONSE_HEADER_REMOVED', location, 'removed response header ' + JSON.stringify(name)));
      continue;
    }
    const before = resolveNode(base[name], context.baseRoot).node;
    const after = resolveNode(candidate[name], context.candidateRoot).node;
    if (before === null || after === null) {
      changes.push(change(BREAKING, 'UNCOMPARABLE', location, 'cannot resolve the response header ' + JSON.stringify(name)));
      continue;
    }
    if (before.required === true && after.required !== true) {
      changes.push(change(BREAKING, 'RESPONSE_HEADER_BECAME_OPTIONAL', location, name + ' is no longer guaranteed to be present'));
    } else if (before.required !== true && after.required === true) {
      changes.push(change(ADDITIVE, 'RESPONSE_HEADER_BECAME_REQUIRED', location, name + ' is now always present'));
    }
    changes.push(...compareRepresentation(before, after, location + ' header ' + name, RESPONSE, context));
  }
  for (const name of Object.keys(candidate)) {
    if (Object.prototype.hasOwnProperty.call(base, name)) continue;
    changes.push(change(ADDITIVE, 'RESPONSE_HEADER_ADDED', location, 'added response header ' + JSON.stringify(name)));
  }
  return changes;
}

/**
 * The stable signature of a `security` requirement list. OpenAPI treats the
 * alternatives and the scopes inside one requirement as sets: reordering them
 * is not a client-visible change, but a different scheme, scope or alternative
 * is. Canonicalizing both makes that distinction explicit instead of reporting
 * a harmless reorder as breaking.
 */
function securitySignature(security) {
  if (!Array.isArray(security)) return String(stableSignature(security));
  return security.map((requirement) => {
    if (!isPlainObject(requirement)) return stableSignature(requirement);
    return Object.keys(requirement).sort().map((scheme) => {
      const scopes = Array.isArray(requirement[scheme])
        ? requirement[scheme].slice().sort()
        : requirement[scheme];
      return JSON.stringify(scheme) + ':' + stableSignature(scopes);
    }).join(',');
  }).sort().join('|');
}

/**
 * A construct this classifier does not model semantically (security
 * requirements, servers) is compared by its stable representation. Equal
 * values produce no finding; a real change fails closed as UNCOMPARABLE, which
 * the gate treats as BREAKING. Only changed declarations are reported.
 */
function compareUnmodelledConstruct(baseValue, candidateValue, location, label, signature) {
  if (baseValue === undefined && candidateValue === undefined) return [];
  if (signature(baseValue) === signature(candidateValue)) return [];

  const transition = baseValue === undefined
    ? 'added'
    : (candidateValue === undefined ? 'removed' : 'changed');
  return [change(
    BREAKING,
    'UNCOMPARABLE',
    location,
    label + ' ' + transition + '; this classifier does not model ' + label
      + ' and cannot prove the change compatible'
  )];
}

/**
 * Callbacks make the server call the consumer, so their expressions and
 * payloads are part of the contract. The classifier does not model callback
 * payloads; it walks to the changed callback/expression and fails closed
 * there, which keeps an unchanged callback from becoming a false positive.
 */
function compareCallbacks(baseCallbacks, candidateCallbacks, location, context) {
  if (baseCallbacks === undefined && candidateCallbacks === undefined) return [];
  const baseIsObject = isPlainObject(baseCallbacks);
  const candidateIsObject = isPlainObject(candidateCallbacks);
  if ((baseCallbacks !== undefined && !baseIsObject) || (candidateCallbacks !== undefined && !candidateIsObject)) {
    if (stableSignature(baseCallbacks) === stableSignature(candidateCallbacks)) return [];
    return [change(
      BREAKING,
      'UNCOMPARABLE',
      location + ' callbacks',
      'callbacks are not a comparable map; this classifier cannot prove the change compatible'
    )];
  }

  const base = baseIsObject ? baseCallbacks : {};
  const candidate = candidateIsObject ? candidateCallbacks : {};
  const changes = [];
  for (const name of Object.keys(base)) {
    const at = location + ' callbacks ' + JSON.stringify(name);
    if (!Object.prototype.hasOwnProperty.call(candidate, name)) {
      changes.push(change(BREAKING, 'UNCOMPARABLE', at, 'removed callback ' + JSON.stringify(name)));
      continue;
    }
    const baseResolved = resolveNode(base[name], context.baseRoot);
    const candidateResolved = resolveNode(candidate[name], context.candidateRoot);
    if (baseResolved.node === null || candidateResolved.node === null) {
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        at,
        'cannot resolve ' + (baseResolved.problem || candidateResolved.problem || 'a callback reference')
      ));
      continue;
    }
    if (!isPlainObject(baseResolved.node) || !isPlainObject(candidateResolved.node)) {
      if (stableSignature(baseResolved.node) !== stableSignature(candidateResolved.node)) {
        changes.push(change(
          BREAKING,
          'UNCOMPARABLE',
          at,
          'the callback is not a comparable expression map; this classifier cannot prove the change compatible'
        ));
      }
      continue;
    }

    const baseExpressions = baseResolved.node;
    const candidateExpressions = candidateResolved.node;
    for (const expression of Object.keys(baseExpressions)) {
      const expressionAt = at + ' expression ' + JSON.stringify(expression);
      if (!Object.prototype.hasOwnProperty.call(candidateExpressions, expression)) {
        changes.push(change(BREAKING, 'UNCOMPARABLE', expressionAt, 'removed callback expression ' + JSON.stringify(expression)));
        continue;
      }
      if (stableSignature(baseExpressions[expression]) === stableSignature(candidateExpressions[expression])) continue;
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        expressionAt,
        'the callback configuration changed; this classifier does not model callback payloads'
          + ' and cannot prove the change compatible'
      ));
    }
    for (const expression of Object.keys(candidateExpressions)) {
      if (Object.prototype.hasOwnProperty.call(baseExpressions, expression)) continue;
      changes.push(change(BREAKING, 'UNCOMPARABLE', at + ' expression ' + JSON.stringify(expression), 'added callback expression ' + JSON.stringify(expression)));
    }
  }
  for (const name of Object.keys(candidate)) {
    if (Object.prototype.hasOwnProperty.call(base, name)) continue;
    changes.push(change(BREAKING, 'UNCOMPARABLE', location + ' callbacks ' + JSON.stringify(name), 'added callback ' + JSON.stringify(name)));
  }
  return changes;
}

function compareOperation(baseOperation, candidateOperation, location, context) {
  const changes = [];
  const baseParameters = effectiveParameters(context.basePathItem, baseOperation, context.baseRoot);
  const candidateParameters = effectiveParameters(context.candidatePathItem, candidateOperation, context.candidateRoot);
  changes.push(...compareParameters(baseParameters, candidateParameters, location, context));

  const baseRequest = resolveNode(baseOperation.requestBody, context.baseRoot);
  const candidateRequest = resolveNode(candidateOperation.requestBody, context.candidateRoot);
  if (baseRequest.problem || candidateRequest.problem) {
    changes.push(change(
      BREAKING,
      'UNCOMPARABLE',
      location + ' request',
      'cannot resolve ' + (baseRequest.problem || candidateRequest.problem)
    ));
  }
  const before = baseRequest.node;
  const after = candidateRequest.node;

  if (before || after) {
    if (!after) {
      changes.push(change(BREAKING, 'REQUEST_BODY_REMOVED', location, 'the base accepted a request body'));
    } else if (!before) {
      if (after.required === true) {
        changes.push(change(BREAKING, 'REQUEST_BODY_BECAME_REQUIRED', location, 'a required request body was introduced'));
      } else {
        changes.push(change(ADDITIVE, 'REQUEST_BODY_ADDED', location, 'the operation now accepts a body'));
      }
    } else {
      if (before.required !== true && after.required === true) {
        changes.push(change(BREAKING, 'REQUEST_BODY_BECAME_REQUIRED', location, 'the request body became required'));
      } else if (before.required === true && after.required !== true) {
        changes.push(change(ADDITIVE, 'REQUEST_BODY_BECAME_OPTIONAL', location, 'the request body became optional'));
      }
      changes.push(...compareContent(before.content, after.content, location + ' request', REQUEST, context));
    }
  }

  const baseResponses = isPlainObject(baseOperation.responses) ? baseOperation.responses : {};
  const candidateResponses = isPlainObject(candidateOperation.responses) ? candidateOperation.responses : {};

  for (const status of Object.keys(baseResponses)) {
    if (!Object.prototype.hasOwnProperty.call(candidateResponses, status)) {
      changes.push(change(BREAKING, 'RESPONSE_REMOVED', location, 'removed response ' + status));
      continue;
    }
    const baseResponse = resolveNode(baseResponses[status], context.baseRoot);
    const candidateResponse = resolveNode(candidateResponses[status], context.candidateRoot);
    if (baseResponse.node === null || candidateResponse.node === null) {
      changes.push(change(
        BREAKING,
        'UNCOMPARABLE',
        location + ' ' + status,
        'cannot resolve ' + (baseResponse.problem || candidateResponse.problem || 'a response reference')
      ));
      continue;
    }
    const baseBody = baseResponse.node || {};
    const candidateBody = candidateResponse.node || {};
    changes.push(...compareContent(baseBody.content, candidateBody.content, location + ' ' + status, RESPONSE, context));
    changes.push(...compareResponseHeaders(baseBody.headers, candidateBody.headers, location + ' ' + status, context));
  }
  for (const status of Object.keys(candidateResponses)) {
    if (Object.prototype.hasOwnProperty.call(baseResponses, status)) continue;
    changes.push(change(ADDITIVE, 'RESPONSE_ADDED', location, 'added response ' + status));
  }

  changes.push(...compareUnmodelledConstruct(
    baseOperation.security,
    candidateOperation.security,
    location + ' security',
    'operation security requirements',
    securitySignature
  ));
  changes.push(...compareUnmodelledConstruct(
    baseOperation.servers,
    candidateOperation.servers,
    location + ' servers',
    'operation servers',
    stableSignature
  ));
  changes.push(...compareCallbacks(baseOperation.callbacks, candidateOperation.callbacks, location, context));

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
  if (!isPlainObject(base) || !isPlainObject(candidate)) {
    throw new TypeError('compareContracts requires two parsed OpenAPI documents');
  }

  const changes = [];
  const baseVersion = base.info && base.info.version ? base.info.version : null;
  const candidateVersion = candidate.info && candidate.info.version ? candidate.info.version : null;
  if (baseVersion !== candidateVersion) {
    changes.push(change(
      ADDITIVE,
      'VERSION_CHANGED',
      'info.version',
      JSON.stringify(baseVersion) + ' -> ' + JSON.stringify(candidateVersion)
    ));
  }

  const basePaths = isPlainObject(base.paths) ? base.paths : {};
  const candidatePaths = isPlainObject(candidate.paths) ? candidate.paths : {};

  changes.push(...compareUnmodelledConstruct(base.security, candidate.security, 'security', 'root security requirements', securitySignature));
  changes.push(...compareUnmodelledConstruct(base.servers, candidate.servers, 'servers', 'root servers', stableSignature));

  const baseComponents = isPlainObject(base.components) ? base.components : {};
  const candidateComponents = isPlainObject(candidate.components) ? candidate.components : {};
  changes.push(...compareUnmodelledConstruct(
    baseComponents.securitySchemes,
    candidateComponents.securitySchemes,
    'components.securitySchemes',
    'security scheme definitions',
    stableSignature
  ));

  for (const route of Object.keys(basePaths)) {
    if (!Object.prototype.hasOwnProperty.call(candidatePaths, route)) {
      changes.push(change(BREAKING, 'PATH_REMOVED', route, 'the whole path is gone'));
      continue;
    }
    const baseItem = basePaths[route] || {};
    const candidateItem = candidatePaths[route] || {};
    changes.push(...compareUnmodelledConstruct(
      baseItem.servers,
      candidateItem.servers,
      route + ' servers',
      'path item servers',
      stableSignature
    ));
    for (const method of METHODS) {
      if (!baseItem[method]) continue;
      if (!candidateItem[method]) {
        changes.push(change(BREAKING, 'METHOD_REMOVED', route, method.toUpperCase() + ' was served and is gone'));
        continue;
      }
      changes.push(...compareOperation(baseItem[method], candidateItem[method], method.toUpperCase() + ' ' + route, {
        baseRoot: base,
        candidateRoot: candidate,
        basePathItem: baseItem,
        candidatePathItem: candidateItem,
      }));
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
    (left.location + '|' + left.code + '|' + left.detail)
      .localeCompare(right.location + '|' + right.code + '|' + right.detail)
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
  REQUEST,
  RESPONSE,
  METHODS,
  enumMembers,
  isOpenEnum,
  typeSet,
  compareSchema,
  compareContracts,
};
