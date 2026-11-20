'use strict';

// scripts/lib/ci-workflow.test.js - workflow wiring that must not drift.
//
// Part 1: the nightly assessment-age step CANNOT fail the job, and can never
// run on push/PR.
//
// Part 2: the api-image gate derives the core namespace list from the package
// entry. A hardcoded list drifted once (scoring was missing while core already
// published it), and a static list forces every extraction batch to edit this
// shared workflow. Derivation is pinned here so a future edit cannot quietly
// restore a literal list.
//
// Why this test exists: `check-assessment-age.js` reports a data property
// (assessment staleness) that nobody agreed to gate. Wiring it into CI without
// these assertions would be one `continue-on-error:` edit away from turning an
// ageing catalogue into a red nightly, and one copy/paste away from running it
// on every push.
//
// Two halves are deliberately kept apart:
//   * THIS file pins the WORKFLOW WIRING (job placement, continue-on-error,
//     the `set +e` + `::warning` guard, and that `--strict` is never passed);
//   * scripts/lib/assessment-age-cli.test.js pins the SCRIPT's own contract
//     (exit 0 without --strict, exit 1 with it, argument refusals).
// Neither alone is enough: a warning-only script still fails a job if a step
// propagates its status, and a warning-only step still fails a job if the script
// asserts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = path.resolve(__dirname, '../../.github/workflows/ci.yml');
const IMAGE_WORKFLOW = path.resolve(__dirname, '../../.github/workflows/api-image.yml');
const CORE_SNAPSHOT = path.resolve(
  __dirname,
  '../../packages/recommendation-core/test/export-surface.json'
);

function readWorkflow() {
  return fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
}

function readImageWorkflow() {
  return fs.readFileSync(IMAGE_WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
}

// Split the workflow into job bodies so a step's JOB is asserted, not guessed
// from line order alone. Job keys sit at exactly two spaces of indentation.
function jobs(text) {
  const lines = text.split('\n');
  const jobsStart = lines.findIndex((line) => line === 'jobs:');
  assert.ok(jobsStart >= 0, 'ci.yml has a top-level jobs: key');
  const out = {};
  let current = null;
  for (let i = jobsStart + 1; i < lines.length; i++) {
    const jobKey = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (jobKey) {
      current = jobKey[1];
      out[current] = [];
      continue;
    }
    if (current) out[current].push(lines[i]);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
}

function stepBlock(jobText) {
  const lines = jobText.split('\n');
  const start = lines.findIndex((line) => line.includes('- name: Assessment age'));
  if (start < 0) return null;
  // A step ends at the next `      - ` (six-space list item) at the same depth.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}- /.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

test('the assessment-age step runs in the nightly job only, never on push or PR', () => {
  const all = jobs(readWorkflow());
  assert.deepEqual(Object.keys(all).sort(), ['recurring-gates', 'unit-and-docs']);

  const nightly = stepBlock(all['recurring-gates']);
  assert.ok(nightly, 'recurring-gates carries the Assessment age step');

  // The push/PR job must not carry it at all - not the step, not the script.
  assert.equal(stepBlock(all['unit-and-docs']), null,
    'unit-and-docs (push/PR) must not run the assessment-age step');
  assert.equal(all['unit-and-docs'].includes('check-assessment-age.js'), false,
    'unit-and-docs (push/PR) must not invoke check-assessment-age.js');

  // The nightly job's own trigger is what keeps it off push/PR.
  assert.match(all['recurring-gates'], /if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
});

test('the assessment-age step cannot fail the job', () => {
  const nightly = stepBlock(jobs(readWorkflow())['recurring-gates']);
  assert.ok(nightly);

  // Leg 1: GitHub ignores the step's exit status entirely.
  assert.match(nightly, /^\s+continue-on-error: true\s*$/m,
    'the step must carry continue-on-error: true');

  // Leg 2: the shell cannot propagate a non-zero exit, and a failure becomes an
  // annotation instead of a red step.
  assert.match(nightly, /^\s+set \+e\s*$/m, 'the run block must disable errexit');
  assert.match(nightly, /\|\|\s*echo "::warning /,
    'a non-zero exit must be converted into a ::warning annotation');

  // Leg 3: the escalation flag is never passed - `--strict` is the only way the
  // script itself exits 1 on stale evidence.
  assert.equal(/--strict/.test(nightly), false,
    'the nightly step must never pass --strict');

  // It is still gated on `npm ci` like its neighbours, so a failed install does
  // not produce a second, misleading failure.
  assert.match(nightly, /if: always\(\) && steps\.deps\.outcome == 'success'/);

  // And it targets the read-only shared catalogue through a variable NAME, never
  // an inline connection string.
  assert.match(nightly, /--target=env:DATABASE_URL/);
  assert.match(nightly, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
});

test('the api-image gate validates the shipped exports map, not barrels', () => {
  const text = readImageWorkflow();
  const snapshot = JSON.parse(fs.readFileSync(CORE_SNAPSHOT, 'utf8'));

  // The interface is the declared exports map. The in-container check reads
  // package.json and validates every subpath target against it; there is no
  // per-namespace barrel assumption (`./offers` is src/offers/as-of.js).
  assert.ok(text.includes("const ROOT = '/app/packages/recommendation-core';"),
    'the in-container check must resolve the package root');
  assert.ok(text.includes('const map = manifest.exports;'),
    'the in-container check must read the declared exports map');
  assert.ok(text.includes('package must declare an exports map'),
    'a package with no exports map must fail the container check');
  assert.ok(text.includes("if (map['.'] !== './' + manifest.main)"),
    'the root subpath must be checked against main');
  assert.ok(text.includes('must resolve under src/'),
    'a target outside src/ (including ./package.json) must fail');
  assert.ok(text.includes('target is missing from the image'),
    'a declared target that was not copied into the image must fail');
  assert.ok(text.includes('core surface is empty'),
    'an empty core surface must fail the container check');
  assert.ok(text.includes('has no declared subpath'),
    'a published namespace without a declared subpath must fail');
  assert.ok(text.includes('exports nothing'),
    'an empty namespace must fail the container check');
  assert.ok(text.includes('is not the module its subpath declares'),
    'a subpath must load the same object the entry publishes');

  // The rest of the gate is intact: the core manifest, the engine graph, and
  // the fact that apps/web is not shipped.
  assert.ok(text.includes('test -f /app/packages/recommendation-core/package.json'));
  assert.ok(text.includes("require('/app/apps/api/src/engine.js');"));
  assert.ok(text.includes('test ! -e /app/apps/web'));

  // No barrel-per-namespace assumption and no literal namespace list. Either
  // one is exactly the drift this test exists to prevent. Comments may explain
  // the removed assumption; executable lines may not contain it.
  const code = text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.equal(code.includes('/index.js'), false,
    'api-image.yml must not assume src/<namespace>/index.js');
  assert.equal(code.includes('for ns in $NAMESPACES'), false,
    'the namespace loop was replaced by the declared exports map');
  assert.equal(/const required = \[/.test(text), false,
    'the in-container namespace list must not be a literal array');
  for (const name of snapshot.exports) {
    for (const quote of ["'", '"']) {
      assert.equal(text.includes(quote + name + quote), false,
        'api-image.yml must not hardcode the namespace ' + quote + name + quote);
    }
  }
});
