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
const PACKAGE_JSON = path.resolve(__dirname, '../../package.json');
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
  assert.deepEqual(Object.keys(all).sort(), ['ephemeral-eval', 'recurring-gates', 'unit-and-docs']);

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

  // The interface is the declared exports map, and the gate is the SAME module
  // the host suite runs: the container mounts scripts/lib read-only and calls
  // runContainerGate. No map logic is inlined here, so the two checks cannot
  // drift. (scripts/ is excluded from the image; the mount is why.)
  assert.ok(text.includes('-v "$GITHUB_WORKSPACE/scripts/lib:/core-check:ro"'),
    'the container gate must mount the shared contract read-only');
  assert.ok(text.includes("require('/core-check/core-approved-interface.js')"),
    'the container gate must require the shared contract');
  assert.ok(text.includes("runContainerGate('/app/packages/recommendation-core')"),
    'the container gate must run the shared container gate');
  assert.ok(text.includes('exports-map negatives OK ('),
    'the container log must report the negative self-checks');
  assert.ok(text.includes("result.negatives + '/6"),
    'the gate must report six rejected tampered maps');
  assert.equal(text.split('"scripts/lib/core-approved-interface.js"').length - 1, 2,
    'a change to the shared contract must trigger the image workflow on push and PR');

  // The rest of the gate is intact: the core manifest, the engine graph, and
  // the fact that apps/web is not shipped.
  assert.ok(text.includes('test -f /app/packages/recommendation-core/package.json'));
  assert.ok(text.includes("require('/app/apps/api/src/engine.js');"));
  assert.ok(text.includes('test ! -e /app/apps/web'));

  // No barrel-per-namespace assumption and no literal namespace list. Either
  // one is exactly the drift this test exists to prevent. Comments may explain
  // the removed assumption; executable lines may not contain it. The ONE
  // legitimate entry-point reference is the runtime package's own
  // `src/index.js`, which is a package entry, not a per-namespace barrel.
  const code = text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  const indexRefs = code.split('\n').filter((line) => line.includes('/index.js')).map((l) => l.trim());
  assert.deepEqual(indexRefs, ['test -f /app/packages/recommendation-runtime/src/index.js'],
    'the only explicit entry-point path is the runtime package entry, never a namespace barrel');
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

test('the api-image gate ships the runtime package and proves it loads (C7)', () => {
  const workflow = readImageWorkflow();
  const dockerfile = fs
    .readFileSync(path.resolve(__dirname, '../../apps/api/Dockerfile'), 'utf8')
    .replace(/\r\n/g, '\n');
  const ignore = fs
    .readFileSync(path.resolve(__dirname, '../../.dockerignore'), 'utf8')
    .replace(/\r\n/g, '\n');

  // The exact COPY pair, in this spelling: package.json (cheap layer) then src.
  // Anything broader would ship test/ and docs/, anything narrower would not
  // make `/app/packages/recommendation-runtime` loadable.
  assert.ok(dockerfile.includes(
    'COPY packages/recommendation-runtime/package.json ./packages/recommendation-runtime/package.json'
  ), 'the Dockerfile must copy the runtime manifest');
  assert.ok(dockerfile.includes(
    'COPY packages/recommendation-runtime/src ./packages/recommendation-runtime/src'
  ), 'the Dockerfile must copy the runtime src tree');
  assert.equal(dockerfile.includes('COPY packages/recommendation-runtime/test'), false,
    'the runtime tests must not be copied into the image');
  assert.equal(dockerfile.includes('COPY packages/recommendation-runtime/docs'), false,
    'the runtime docs must not be copied into the image');

  // Placement: after the dependency install (packages are source, not install
  // inputs) and after the core copy it sits beside. `npm ci` must not be asked
  // to resolve the package: the root manifest declares no workspace and no
  // local dependency, so the install is unchanged by this COPY pair.
  const installAt = dockerfile.indexOf('RUN npm ci --omit=dev');
  const runtimeAt = dockerfile.indexOf('COPY packages/recommendation-runtime/package.json');
  assert.ok(installAt >= 0, 'the Dockerfile installs dependencies');
  assert.ok(runtimeAt > installAt, 'the runtime copy must follow npm ci, not precede it');

  // .dockerignore must keep `src` in and `test`/`docs` out. It already lists
  // `test` and `docs`; pinning them here makes the "compatible by accident"
  // state intentional, so a later edit cannot silently ship the harness.
  for (const excluded of ['test', 'docs']) {
    assert.ok(
      ignore.split('\n').map((l) => l.trim()).includes(excluded),
      '.dockerignore must keep excluding ' + excluded
    );
  }

  // A runtime change must rebuild the image: both the push and pull_request
  // path filters need the package, and the workflow file itself stays a trigger.
  assert.equal(workflow.split('"packages/recommendation-runtime/**"').length - 1, 2,
    'a runtime change must trigger api-image on push and PR');

  // The presence gate fails closed on absence, and the load gate actually
  // requires the package. Both are needed: a successful build proves only that
  // COPY did not error, not that the path is there or loadable.
  assert.ok(workflow.includes('test -f /app/packages/recommendation-runtime/package.json'));
  assert.ok(workflow.includes('test -f /app/packages/recommendation-runtime/src/index.js'));
  assert.ok(workflow.includes('test ! -e /app/packages/recommendation-runtime/test'));
  assert.ok(workflow.includes("require('/app/packages/recommendation-runtime')"));
  assert.ok(workflow.includes("require('/app/packages/recommendation-runtime/package.json')"));

  // It must NOT pin the runtime surface at W0. The package entry is empty and
  // the surface is a W1 contract; asserting keys now would fail the moment W1
  // publishes one, or worse, enshrine emptiness as the interface.
  assert.equal(/Object\.keys\(runtime\)\s*\.\s*(sort|deepEqual)/.test(workflow), false,
    'the W0 gate must not assert the runtime export keys');
  assert.equal(/assert\.deepEqual\(runtime/.test(workflow), false,
    'the W0 gate must not assert the runtime surface');
});

test('the runtime harness runs in unit-and-docs, with discovery before the runner', () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const script = pkg.scripts['test:runtime'];

  // One command, quoted glob expanded by Node (the same mechanism test:core
  // already proves on Node 22). assert-discovery.js exits 1 when a required
  // suite is absent, so a glob that matches nothing cannot pass vacuously.
  assert.equal(
    script,
    'node packages/recommendation-runtime/test/assert-discovery.js && node --test "packages/recommendation-runtime/test/*.test.js"'
  );

  const all = jobs(readWorkflow());
  assert.deepEqual(Object.keys(all).sort(), ['ephemeral-eval', 'recurring-gates', 'unit-and-docs'],
    'the three-job architecture must not change');
  assert.ok(all['unit-and-docs'].includes('npm run test:runtime'),
    'unit-and-docs must run the runtime harness');
  assert.equal(all['recurring-gates'].includes('test:runtime'), false,
    'the nightly job must not duplicate the runtime harness');

  // The package's own script keeps the same order: discovery guard, then runner.
  assert.ok(script.indexOf('assert-discovery.js') < script.indexOf('node --test'));
});

test('the boundary lint runs in unit-and-docs, backed by a committed baseline', () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const script = pkg.scripts['lint:boundaries'];
  assert.ok(script, 'package.json declares lint:boundaries');
  assert.ok(script.includes('depcruise'), 'the script runs dependency-cruiser');
  assert.ok(script.includes('--ignore-known'), 'the script applies the known-violations baseline');

  // Removing the CI step (or moving it to the nightly job) must fail here, not
  // silently drop the boundary ratchet from every push and PR.
  const all = jobs(readWorkflow());
  assert.ok(all['unit-and-docs'].includes('npm run lint:boundaries'),
    'unit-and-docs must run the boundary lint');
  assert.equal(all['recurring-gates'].includes('lint:boundaries'), false,
    'the nightly job must not duplicate the boundary lint');

  // The baseline is what lets CI pass today; without it every known violation
  // would fail, and an empty file would silently disable the ratchet.
  const baseline = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../.dependency-cruiser-known-violations.json'), 'utf8')
  );
  assert.ok(Array.isArray(baseline) && baseline.length > 0,
    'the known-violations baseline must be committed and non-empty');
});

test('the ephemeral-eval job runs the golden harness on a throwaway postgres', () => {
  const all = jobs(readWorkflow());
  const job = all['ephemeral-eval'];
  assert.ok(job, 'ci.yml carries the ephemeral-eval job');

  // The service container is pinned: major version (Neon runs PostgreSQL 18)
  // and a readiness gate, so migrations never race a booting database.
  assert.match(job, /image: postgres:18/);
  assert.match(job, /pg_isready/);

  // Provisioning order: migrations through the test-db path (which never
  // appends to the tracked database/migration-applies.jsonl audit log), then
  // the full seed tail, then the harness under an explicit pin - after seed
  // 029 the default seed-minimal-v1@1.0.0 pin is INACTIVE and fails closed.
  const migrate = job.indexOf('node scripts/run-migrations.js --test-db');
  const seed = job.indexOf('node scripts/run-seeds.js');
  const evalRun = job.indexOf(
    'npm run eval:scenarios -- --model=launch-v2@2.5.0 --no-baseline --no-volatile');
  assert.ok(migrate > -1, 'the job applies migrations 001-023 via --test-db');
  assert.ok(seed > migrate, 'the seeds follow the migrations');
  assert.ok(evalRun > seed, 'the harness follows the seeds');

  // One container, two host spellings: database-guard's getWriteTestDbUrl()
  // requires TEST_DATABASE_URL and DATABASE_URL to name DIFFERENT hosts, and
  // the ephemeral job must point at the service container, never at a secret -
  // that absence is what lets fork PRs run the harness.
  assert.match(job,
    /TEST_DATABASE_URL: postgres:\/\/postgres:ephemeral@localhost:5432\/morocco_eval/);
  assert.match(job,
    /DATABASE_URL: postgres:\/\/postgres:ephemeral@127\.0\.0\.1:5432\/morocco_eval/);
  assert.equal(job.includes('secrets.DATABASE_URL'), false,
    'the ephemeral job must not read the shared DATABASE_URL secret');
  assert.equal(job.includes('secrets.TEST_DATABASE_URL'), false,
    'the ephemeral job must not read the TEST_DATABASE_URL secret');

  // Push/PR only - the nightly job keeps its own TEST-branch gates.
  assert.match(job, /if: github\.event_name != 'schedule'/);

  // No other job duplicates the harness.
  assert.equal(all['unit-and-docs'].includes('eval:scenarios'), false,
    'unit-and-docs must not run the golden harness');
  assert.equal(all['recurring-gates'].includes('eval:scenarios'), false,
    'the nightly job must not run the golden harness');
});

test('the ephemeral-eval job runs the guarded DB suite after the golden harness', () => {
  const all = jobs(readWorkflow());
  assert.deepEqual(Object.keys(all).sort(), ['ephemeral-eval', 'recurring-gates', 'unit-and-docs'],
    'the three-job architecture must not change');
  const job = all['ephemeral-eval'];
  assert.ok(job, 'ci.yml carries the ephemeral-eval job');

  // The guarded launcher, not a raw glob: run-db-tests.js is what fails fast on
  // a missing/shared target and refuses a zero-test run.
  const dbRun = job.indexOf('npm run test:api:db');
  assert.ok(dbRun > -1, 'ephemeral-eval must run the DB-backed API suite');

  // Order is load-bearing: eval-scenarios.js preflight FAILS while any unmarked
  // recommendation_query row exists, and the DB suite creates such rows.
  const evalRun = job.indexOf('npm run eval:scenarios');
  assert.ok(evalRun > -1 && dbRun > evalRun,
    'the DB suite must follow the golden harness, never precede it');

  // The job targets the service container through the pinned env pair only.
  // Comments may explain the absence; executable lines may not reintroduce it.
  const code = job.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.equal(code.includes('API_ALLOW_SHARED'), false,
    'the ephemeral job must never opt into the shared database');
  assert.equal(code.includes('secrets.'), false,
    'the ephemeral job must not read any DB secret');

  // Locale parity with Neon: the stock image clusters en_US.utf8, whose
  // collation ignores punctuation at the primary level and orders
  // 'g-skill-...' AFTER 'gigabyte-...'. The catalogue keyset walk asserts
  // code-unit slug order (and Neon serves it), so a fresh ephemeral DB
  // provisioned with the image default fails catalog.db.test.js. Measured
  // 2026-11-22: 16 passed / 1 failed on en_US.utf8, 17/0 on C.UTF-8.
  assert.match(job, /POSTGRES_INITDB_ARGS: "--locale=C\.UTF-8"/,
    'the ephemeral cluster must init with C.UTF-8 collation to match Neon');

  // Placement: the DB-free job never runs it; the nightly TEST-branch run stays.
  assert.equal(all['unit-and-docs'].includes('test:api:db'), false,
    'unit-and-docs is DB-free and must not run the DB suite');
  assert.ok(all['recurring-gates'].includes('npm run test:api:db'),
    'the nightly TEST-branch DB suite must remain wired');
});
