'use strict';

// packages/recommendation-runtime/test/composite-lifecycle-scanner.js — the pure
// half of the F1 lifecycle gate (owner decision of 2026-11-26).
//
// WHY THIS IS ITS OWN FILE, AND WHY IT TAKES DATA RATHER THAN A TREE.
// The owner approved the three composite barrels as an unpublished, step-6-scoped
// exception with one condition no test executed: step 6 must DELETE them once the
// orchestrator's specifiers are rewritten (docs/MIXED_BARRELS.md §5.4, condition
// 5). A test that only asserts today's directory listing can never enforce that:
// the removal branch would be dead code nobody has ever run, and a half-finished
// migration would look exactly like a passing one.
//
// So the decision logic lives here as a pure function over an OBSERVATION, and
// composite-lifecycle.test.js both (a) feeds it the real tree and (b) feeds it
// synthetic trees in each of the three possible states. The MIGRATED branch is
// therefore executable today, and a reviewer can see it fail.
//
// Three states, no fourth:
//   ACTIVE   - the orchestrator still requires the composites from exactly the
//              four committed modules, and every condition of the exception holds.
//   MIGRATED - no orchestrator module requires a composite any more, and nothing
//              of the exception survives (files, spreaders, shims, consumers).
//   PARTIAL  - anything in between. Deliberately a FAILURE: a tree where some
//              consumers were rewritten and others were not is mid-migration, and
//              treating it as either end state would let the other half rot.
//
// DB-free and dependency-free: no fs, no path, no require of the package. The
// caller supplies the bytes and the observations.

const STAGES = Object.freeze(['candidates', 'filtering', 'scoring']);

// The in-package consumers of the exception, committed on purpose. The owner's
// condition 6 says no future module may use this exception as precedent, so this
// is an EXACT map: a fifth module gaining a composite `require` fails the gate
// rather than quietly joining the set.
const EXPECTED_ACTIVE_DEPENDENCIES = Object.freeze({
  'run.js': Object.freeze(['candidates', 'filtering', 'scoring']),
  'swap-preview.js': Object.freeze(['candidates', 'filtering']),
  'swap-commit.js': Object.freeze(['scoring']),
  'compute.js': Object.freeze(['scoring']),
});

// The suites that must stay discoverable while the exception is active: the
// key-set/identity/order proof, and this gate itself.
const REQUIRED_SUITES = Object.freeze(['composite-lifecycle.test.js', 'namespace-barrels.test.js']);

/**
 * Comments removed, line structure kept.
 *
 * A commented-out `require` is a note, not a dependency, and a gate that treated
 * it as one would either block a legitimate cleanup or pass a stale shim. The
 * `//` rule deliberately skips a `://` URL and a `//` that follows a quote, so a
 * string literal is not chopped mid-token; a `//` inside a string can still be
 * eaten, and that only ever costs a mention, never a real specifier (a specifier
 * cannot contain `//`).
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/**
 * The composite stages one source file requires through the LEGACY BARREL
 * SPECIFIER.
 *
 * Only the exact barrel counts: `require('../candidates')`,
 * `require('../candidates/index')` and `require('../candidates/index.js')`.
 * A subpath require such as `require('../candidates/errors')` is a different
 * thing - it names one module, not the composite - and must not be mistaken for
 * a consumer of the exception. Comments are stripped first for the same reason.
 *
 * @param {string} source
 * @returns {string[]} stages, in STAGES order
 */
function stagesRequiredBy(source) {
  // Built inside the function so the global flag cannot leak between calls.
  const pattern = new RegExp(
    "\\brequire\\(\\s*['\"]\\.\\./(candidates|filtering|scoring)(?:/index(?:\\.js)?)?['\"]\\s*\\)",
    'g'
  );
  const found = new Set();
  for (const match of stripComments(source).matchAll(pattern)) found.add(match[1]);
  return STAGES.filter((stage) => found.has(stage));
}

/** Stages in canonical order, so source order cannot change the verdict. */
function canonical(stages) {
  const set = new Set(stages || []);
  return STAGES.filter((stage) => set.has(stage));
}

function normalizeDependencies(byFile) {
  const normalized = {};
  for (const [file, stages] of Object.entries(byFile || {})) {
    const list = canonical(stages);
    if (list.length > 0) normalized[file] = list;
  }
  return normalized;
}

function describeDependencies(dependencies) {
  const files = Object.keys(dependencies).sort();
  if (files.length === 0) return '(none)';
  return files.map((file) => file + ' -> ' + dependencies[file].join('+')).join('; ');
}

/**
 * The state of the exception, from the per-file require map alone.
 *
 * @param {Record<string, string[]>} byFile orchestrator file name -> stages it requires
 * @returns {{state: 'ACTIVE'|'MIGRATED'|'PARTIAL', dependencies: object, union: string[]}}
 */
function classifyLifecycle(byFile) {
  const dependencies = normalizeDependencies(byFile);
  const files = Object.keys(dependencies).sort();
  const union = STAGES.filter((stage) => files.some((file) => dependencies[file].includes(stage)));

  if (files.length === 0) return { state: 'MIGRATED', dependencies: {}, union };

  const expectedFiles = Object.keys(EXPECTED_ACTIVE_DEPENDENCIES).sort();
  const sameKeys = files.length === expectedFiles.length && files.every((file, i) => file === expectedFiles[i]);
  const sameStages = sameKeys && expectedFiles.every((file) => {
    const observed = dependencies[file];
    const expected = EXPECTED_ACTIVE_DEPENDENCIES[file];
    return observed.length === expected.length && observed.every((stage, i) => stage === expected[i]);
  });

  return { state: sameStages ? 'ACTIVE' : 'PARTIAL', dependencies, union };
}

function sameSet(left, right) {
  const a = (left || []).slice().sort();
  const b = (right || []).slice().sort();
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function mentionsStage(keys, stage) {
  return (keys || []).includes(stage) || (keys || []).includes('./' + stage);
}

/**
 * Judge one observation. Returns the state and every problem it found; an empty
 * `problems` is the only PASS.
 *
 * @param {object} observation
 * @param {Record<string, string[]>} observation.dependencies orchestrator file -> stages required
 * @param {string[]} observation.compositeFiles composite implementation paths that exist
 * @param {string[]} observation.coreSpreaders runtime src index files that spread a core namespace
 * @param {Record<string, boolean>} observation.shimRefsRuntime old-path shim -> re-exports the runtime composite
 * @param {string[]} [observation.exportsKeys] package.json exports keys
 * @param {string[]} [observation.rootKeys] root namespace keys
 * @param {string[]} [observation.snapshotExports] committed export-surface snapshot
 * @param {string[]} [observation.discoveryRequired] assert-discovery REQUIRED list
 * @param {boolean} [observation.compositeSuitePresent]
 * @param {string[]} [observation.references] repo-wide references to a runtime composite
 * @returns {{state: 'ACTIVE'|'MIGRATED'|'PARTIAL', problems: string[], dependencies: object}}
 */
function assess(observation) {
  const obs = observation || {};
  const { state, dependencies } = classifyLifecycle(obs.dependencies);
  const problems = [];
  const compositeFiles = (obs.compositeFiles || []).slice().sort();
  const coreSpreaders = (obs.coreSpreaders || []).slice().sort();
  const shims = obs.shimRefsRuntime || {};
  const published = [
    ['package.json exports', obs.exportsKeys],
    ['the root namespace', obs.rootKeys],
    ['test/export-surface.json', obs.snapshotExports],
  ];

  if (state === 'PARTIAL') {
    problems.push(
      'PARTIAL MIGRATION: the orchestrator requires a composite from a set of files that is neither the four '
        + 'committed consumers nor none. Observed: ' + describeDependencies(dependencies) + '. Either restore '
        + 'the four committed consumers (ACTIVE) or finish the step 6 migration completely (MIGRATED); a '
        + 'half-migrated tree is not a valid state.'
    );
    return { state, problems, dependencies };
  }

  if (state === 'ACTIVE') {
    // Condition 1 + the file set: exactly the three expected composites, no more.
    const expectedComposites = STAGES.map((stage) => 'src/' + stage + '/index.js');
    if (!sameSet(compositeFiles, expectedComposites)) {
      problems.push(
        'the composite file set must be exactly ' + expectedComposites.join(', ') + '; found '
          + (compositeFiles.length === 0 ? '(none)' : compositeFiles.join(', '))
      );
    }
    // A fourth file that spreads a core namespace would be a new use of the
    // exception, which condition 6 forbids without a separate decision.
    if (!sameSet(coreSpreaders, STAGES.map((stage) => 'src/' + stage + '/index.js'))) {
      problems.push(
        'the only runtime files that may spread a core namespace are '
          + STAGES.map((stage) => 'src/' + stage + '/index.js').join(', ') + '; found '
          + (coreSpreaders.length === 0 ? '(none)' : coreSpreaders.join(', '))
      );
    }
    // Condition 1's compatibility half: the old paths must still be identity
    // shims to the composite, or the documented patch seam is detached.
    for (const stage of STAGES) {
      if (shims[stage] !== true) {
        problems.push(
          'src/recommendation/' + stage + '/index.js must exist and re-export the runtime composite '
            + '(the identity shim the patch seam depends on)'
        );
      }
    }
    // Condition 1's publication half: none of the three may be reachable through
    // the package name.
    for (const [label, keys] of published) {
      for (const stage of STAGES) {
        if (mentionsStage(keys, stage)) {
          problems.push(label + ' publishes ' + stage + '; the composites must stay unpublished');
        }
      }
    }
    // "Keep the existing key-set, identity and order tests active" is enforced as
    // a discovery fact: a rename that removes the proof fails here too.
    const required = obs.discoveryRequired || [];
    for (const suite of REQUIRED_SUITES) {
      if (!required.includes(suite)) {
        problems.push('assert-discovery.js REQUIRED no longer names ' + suite + ', so the proof can vanish silently');
      }
    }
    if (obs.compositeSuitePresent === false) {
      problems.push('test/composite-lifecycle.test.js is missing, so the gate is not discoverable');
    }
    return { state, problems, dependencies };
  }

  // MIGRATED: the exception is over, so every trace of it must be gone.
  if (compositeFiles.length > 0) {
    problems.push(
      'step 6 rewrote the consumers but these composite implementation files remain: '
        + compositeFiles.join(', ') + '. Owner condition 5 requires them DELETED, not left behind.'
    );
  }
  if (coreSpreaders.length > 0) {
    problems.push(
      'step 6 rewrote the consumers but these runtime files still spread a core namespace: '
        + coreSpreaders.join(', ') + '. The exception is over; a composite that outlives it is a plain RFC §6.4 violation.'
    );
  }
  for (const stage of STAGES) {
    if (shims[stage] === true) {
      problems.push(
        'the old path src/recommendation/' + stage + '/index.js still re-exports the runtime composite; '
          + 'repoint it to the owning package or delete it'
      );
    }
  }
  if ((obs.references || []).length > 0) {
    problems.push(
      'obsolete compatibility consumers still reference a runtime composite: ' + obs.references.join('; ')
    );
  }
  return { state, problems, dependencies };
}

module.exports = {
  EXPECTED_ACTIVE_DEPENDENCIES,
  REQUIRED_SUITES,
  STAGES,
  assess,
  classifyLifecycle,
  describeDependencies,
  stagesRequiredBy,
  stripComments,
};
