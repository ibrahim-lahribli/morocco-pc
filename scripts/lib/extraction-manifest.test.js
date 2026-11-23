'use strict';

// scripts/lib/extraction-manifest.test.js - the manifest is the single versioned
// source of extraction provenance, so its VALIDATION is a gate of its own: a
// malformed record must fail closed instead of being half-verified, and a later
// batch must be addable without touching PR 2's baseline.
//
// DB-free and dependency-free. The Git half builds throwaway repositories under
// os.tmpdir(); nothing here reads or writes the real database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  MANIFEST_KIND,
  MANIFEST_REL,
  MANIFEST_VERSION,
  REPO_ROOT,
  isAncestor,
  isRepoRelativePath,
  loadManifest,
  manifestFile,
  regularFileAt,
  resolveCommit,
  validateManifest,
} = require('./extraction-manifest');

const FIXTURE_REL = 'packages/recommendation-core/test/fixtures/pr2-characterization.json';

function batch(overrides = {}) {
  return {
    id: 'batch-one',
    baseline_sha: 'a'.repeat(40),
    identity_policy: 'byte-identical',
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
    ...overrides,
  };
}

function document(batches, overrides = {}) {
  return { kind: MANIFEST_KIND, version: MANIFEST_VERSION, batches, ...overrides };
}

function errorsFor(doc) {
  const { errors } = validateManifest(doc);
  assert.ok(errors.length > 0, 'expected the manifest to be rejected');
  return errors;
}

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-manifest-git-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run(['init', '--quiet']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'Extraction Test']);
  run(['config', 'commit.gpgsign', 'false']);
  const write = (relative, text) => {
    const absolute = path.join(dir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, text);
  };
  const commit = (message) => {
    run(['add', '-A']);
    run(['commit', '--quiet', '-m', message]);
    return run(['rev-parse', 'HEAD']);
  };
  return { dir, run, write, commit };
}

test('the committed manifest is valid and pins PR 2 as its first batch', () => {
  const loaded = loadManifest(manifestFile(REPO_ROOT));
  assert.deepEqual(loaded.errors, []);
  // One batch per extraction PR: PR 2 first, later batches appended after it.
  // Step 5 W1 PR 1 appended the eighth batch (step-5-w1-query-scoring).
  assert.equal(loaded.batches.length, 8);

  const pr2 = loaded.batches[0];
  assert.equal(pr2.id, 'step-4b-pr2');
  assert.equal(pr2.identity_policy, 'byte-identical');
  assert.equal(pr2.modules.length, 21);
  assert.match(pr2.baseline_sha, /^[0-9a-f]{40}$/);
  assert.ok(pr2.characterization, 'PR 2 declares its characterization record');
  assert.equal(pr2.characterization.fixture, FIXTURE_REL);
  assert.equal(pr2.characterization.capture_command, 'node scripts/characterize-pr2.js');
  assert.equal(pr2.characterization.expect_touch_commits, 1);
  // 581ee73 added the capture tool beside the fixture, so the record declares it;
  // the verifier proves it was absent at the baseline rather than ignoring it.
  assert.deepEqual(pr2.characterization.capture_paths, ['scripts/characterize-pr2.js']);

  const pr3 = loaded.batches[1];
  assert.equal(pr3.id, 'step-4b-pr3');
  assert.equal(pr3.identity_policy, 'byte-identical');
  assert.equal(pr3.modules.length, 7);
  assert.equal(pr3.baseline_sha, 'de659adaaf4bbde4b2e1673aae08314d07af000e');
  assert.ok(pr3.characterization, 'PR 3 declares its characterization record');
  assert.equal(pr3.characterization.fixture, 'packages/recommendation-core/test/fixtures/pr3-characterization.json');
  assert.equal(pr3.characterization.capture_command, 'node scripts/characterize-pr3.js');
  assert.equal(pr3.characterization.expect_touch_commits, 1);
  assert.deepEqual(pr3.characterization.capture_paths, ['scripts/characterize-pr3.js']);

  const pr4 = loaded.batches[2];
  assert.equal(pr4.id, 'step-4b-pr4');
  assert.equal(pr4.identity_policy, 'byte-identical');
  assert.equal(pr4.modules.length, 4);
  assert.equal(pr4.baseline_sha, '07dfd22be7170ede689da1a1637cfab1645cb209');
  assert.ok(pr4.characterization, 'PR 4 declares its characterization record');
  assert.equal(pr4.characterization.fixture, 'packages/recommendation-core/test/fixtures/pr4-characterization.json');
  assert.equal(pr4.characterization.capture_command, 'node scripts/characterize-pr4.js');
  assert.equal(pr4.characterization.expect_touch_commits, 1);
  assert.deepEqual(pr4.characterization.capture_paths, ['scripts/characterize-pr4.js']);

  const pr5 = loaded.batches[3];
  assert.equal(pr5.id, 'step-4b-pr5');
  assert.equal(pr5.identity_policy, 'byte-identical');
  assert.equal(pr5.modules.length, 5);
  assert.equal(pr5.baseline_sha, '0f439e0400c6814d0a21d4ab527c462aef0f5639');
  assert.ok(pr5.characterization, 'PR 5 declares its characterization record');
  assert.equal(pr5.characterization.fixture, 'packages/recommendation-core/test/fixtures/pr5-characterization.json');
  assert.equal(pr5.characterization.capture_command, 'node scripts/characterize-pr5.js');
  assert.equal(pr5.characterization.expect_touch_commits, 1);
  assert.deepEqual(pr5.characterization.capture_paths, ['scripts/characterize-pr5.js']);

  const pr6 = loaded.batches[4];
  assert.equal(pr6.id, 'step-4b-pr6');
  assert.equal(pr6.identity_policy, 'byte-identical');
  assert.equal(pr6.modules.length, 5);
  assert.equal(pr6.baseline_sha, '1a9d8cfbe2b7f3a3f7a1a17e80919575d52c326e');
  assert.ok(pr6.characterization, 'PR 6 declares its characterization record');
  assert.equal(pr6.characterization.fixture, 'packages/recommendation-core/test/fixtures/pr6-characterization.json');
  assert.equal(pr6.characterization.capture_command, 'node scripts/characterize-pr6.js');
  assert.equal(pr6.characterization.expect_touch_commits, 1);
  assert.deepEqual(pr6.characterization.capture_paths, ['scripts/characterize-pr6.js']);

  const pr7 = loaded.batches[5];
  assert.equal(pr7.id, 'step-4b-pr7');
  assert.equal(pr7.identity_policy, 'byte-identical');
  assert.equal(pr7.modules.length, 5);
  assert.equal(pr7.baseline_sha, '268371300a2c70cc32a819f072b63f0b29d3b83d');
  assert.ok(pr7.characterization, 'PR 7 declares its characterization record');
  assert.equal(pr7.characterization.fixture, 'packages/recommendation-core/test/fixtures/pr7-characterization.json');
  assert.equal(pr7.characterization.capture_command, 'node scripts/characterize-pr7.js');
  assert.equal(pr7.characterization.expect_touch_commits, 1);
  assert.deepEqual(pr7.characterization.capture_paths, ['scripts/characterize-pr7.js']);
});

test('the manifest baseline is the fixture baseline, never the working tree', () => {
  const { batches } = loadManifest(manifestFile(REPO_ROOT));
  const pr2 = batches[0];
  const fixture = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, FIXTURE_REL), 'utf8'));
  assert.equal(fixture.provenance.baseline_sha, pr2.baseline_sha);

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  assert.notEqual(pr2.baseline_sha, head, 'the baseline must not be inferred from the current revision');
});

test('every PR 2 move is declared once, from src/recommendation into the core package', () => {
  const { batches } = loadManifest(manifestFile(REPO_ROOT));
  const modules = batches[0].modules;
  assert.equal(new Set(modules.map((entry) => entry.source)).size, modules.length);
  assert.equal(new Set(modules.map((entry) => entry.destination)).size, modules.length);
  for (const entry of modules) {
    assert.match(entry.source, /^src\/recommendation\/.+\.js$/);
    assert.match(entry.destination, /^packages\/recommendation-core\/src\/.+\.js$/);
  }
});

test('a top-level schema violation is rejected', () => {
  const cases = [
    ['a non-object document', [], /expected a JSON object/],
    ['a missing kind', { version: MANIFEST_VERSION, batches: [batch()] }, /kind must be/],
    ['a wrong kind', document([batch()], { kind: 'migration-ledger' }), /kind must be/],
    ['a wrong version', document([batch()], { version: 2 }), /version must be/],
    ['no batches key', { kind: MANIFEST_KIND, version: MANIFEST_VERSION }, /batches must be/],
    ['empty batches', document([]), /batches must be/],
  ];
  for (const [name, doc, pattern] of cases) {
    const errors = errorsFor(doc);
    assert.ok(errors.some((error) => pattern.test(error)), name + ': ' + errors.join(' | '));
  }
});

test('a malformed batch record is rejected', () => {
  const cases = [
    ['a missing id', document([{ baseline_sha: 'a'.repeat(40), modules: batch().modules }]), /id must be/],
    ['a non-kebab id', document([batch({ id: 'Step_4B' })]), /id must be/],
    ['a duplicate id', document([batch(), batch({ modules: [{ source: 'src/b.js', destination: 'packages/b.js' }] })]), /duplicate batch id/],
    ['a short baseline', document([batch({ baseline_sha: 'afccc67' })]), /40-character/],
    ['an uppercase baseline', document([batch({ baseline_sha: 'A'.repeat(40) })]), /40-character/],
    ['an unsupported batch policy', document([batch({ identity_policy: 'pretty-printed' })]), /only implemented policy/],
    ['a missing modules list', document([{ id: 'batch-one', baseline_sha: 'a'.repeat(40), identity_policy: 'byte-identical' }]), /modules must be/],
    ['an empty modules list', document([batch({ modules: [] })]), /modules must be/],
    ['a non-object batch', document(['not-a-batch']), /expected an object/],
  ];
  for (const [name, doc, pattern] of cases) {
    const errors = errorsFor(doc);
    assert.ok(errors.some((error) => pattern.test(error)), name + ': ' + errors.join(' | '));
  }
});

test('a malformed move record is rejected', () => {
  const cases = [
    ['a missing source', document([batch({ modules: [{ destination: 'packages/a.js' }] })]), /source must be/],
    ['a missing destination', document([batch({ modules: [{ source: 'src/a.js' }] })]), /destination must be/],
    ['an absolute destination', document([batch({ modules: [{ source: 'src/a.js', destination: '/tmp/a.js' }] })]), /destination must be/],
    ['a parent-relative escape', document([batch({ modules: [{ source: 'src/a.js', destination: 'packages/../../a.js' }] })]), /destination must be/],
    ['a backslash path', document([batch({ modules: [{ source: 'src/a.js', destination: 'packages\\a.js' }] })]), /destination must be/],
    ['a drive-letter path', document([batch({ modules: [{ source: 'C:/src/a.js', destination: 'packages/a.js' }] })]), /source must be/],
    ['source equal to destination', document([batch({ modules: [{ source: 'packages/a.js', destination: 'packages/a.js' }] })]), /same path/],
    ['a non-object module', document([batch({ modules: ['src/a.js'] })]), /expected an object/],
  ];
  for (const [name, doc, pattern] of cases) {
    const errors = errorsFor(doc);
    assert.ok(errors.some((error) => pattern.test(error)), name + ': ' + errors.join(' | '));
  }
});

test('a duplicate move or a shared destination is rejected, across batches too', () => {
  const duplicated = validateManifest(document([batch({ modules: [
    { source: 'src/a.js', destination: 'packages/a.js' },
    { source: 'src/a.js', destination: 'packages/a.js' },
  ] })]));
  assert.ok(duplicated.errors.some((error) => /duplicate move/.test(error)), duplicated.errors.join(' | '));

  const sharedDestination = validateManifest(document([
    batch({ modules: [{ source: 'src/a.js', destination: 'packages/a.js' }] }),
    batch({ id: 'batch-two', modules: [{ source: 'src/b.js', destination: 'packages/a.js' }] }),
  ]));
  assert.ok(
    sharedDestination.errors.some((error) => /already a destination in batch batch-one/.test(error)),
    sharedDestination.errors.join(' | ')
  );
});

test('a characterization record is optional, and malformed when wrong', () => {
  const absent = validateManifest(document([batch()]));
  assert.deepEqual(absent.errors, []);
  assert.equal(absent.batches[0].characterization, null);

  const nulled = validateManifest(document([batch({ characterization: null })]));
  assert.deepEqual(nulled.errors, []);

  const cases = [
    ['a non-object record', batch({ characterization: 'pr2-characterization.json' }), /characterization must be an object or null/],
    ['a missing fixture', batch({ characterization: { capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 1 } }), /characterization\.fixture/],
    ['a missing command', batch({ characterization: { fixture: 'f.json', capture_commit_subject: 'capture', expect_touch_commits: 1 } }), /capture_command/],
    ['a missing subject', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', expect_touch_commits: 1 } }), /capture_commit_subject/],
    ['a zero touch count', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 0 } }), /expect_touch_commits must be exactly 1/],
    // The fixture is introduced once and stays immutable: a record may not ask
    // for the weaker "N commits carrying the right subject" rule, which a
    // modify-and-restore cycle would satisfy.
    ['two expected touches', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 2 } }), /expect_touch_commits must be exactly 1 \(found 2\)/],
    ['three expected touches', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 3 } }), /introduced once and must never be/],
    ['a fractional touch count', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 1.5 } }), /expect_touch_commits must be exactly 1/],
    ['a quoted touch count', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: '1' } }), /expect_touch_commits must be exactly 1/],
    ['a non-array capture_paths', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 1, capture_paths: 'scripts/x.js' } }), /capture_paths must be an array/],
    ['an absolute capture path', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 1, capture_paths: ['/etc/passwd'] } }), /capture_paths\[0\] must be a repo-relative/],
    ['a capture path naming the fixture', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 1, capture_paths: ['f.json'] } }), /capture_paths\[0\] names the fixture itself/],
    ['a repeated capture path', batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 1, capture_paths: ['scripts/x.js', 'scripts/x.js'] } }), /repeats scripts\/x\.js/],
  ];
  for (const [name, record, pattern] of cases) {
    const { errors } = validateManifest(document([record]));
    assert.ok(errors.some((error) => pattern.test(error)), name + ': ' + errors.join(' | '));
  }

  // Omitted means "the fixture is the only path the capture commit may add";
  // declared paths are kept so the verifier can prove each one was introduced.
  const omitted = validateManifest(document([batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 1 } })]));
  assert.deepEqual(omitted.errors, []);
  assert.deepEqual(omitted.batches[0].characterization.capture_paths, []);
  const declared = validateManifest(document([batch({ characterization: { fixture: 'f.json', capture_command: 'node x.js', capture_commit_subject: 'capture', expect_touch_commits: 1, capture_paths: ['scripts/x.js'] } })]));
  assert.deepEqual(declared.errors, []);
  assert.deepEqual(declared.batches[0].characterization.capture_paths, ['scripts/x.js']);
});

const EDIT = {
  id: 'edit-one',
  destination: 'packages/a.js',
  edit_commit: '1'.repeat(40),
  previous_commit: '3'.repeat(40),
  previous_blob: '4'.repeat(40),
  new_blob: '5'.repeat(40),
  reason: 'round the score to 6 decimals before comparing',
  approved_by: 'Owner',
  approved_on: '2026-11-20',
  approval_ref: 'docs/RECOMMENDATION_ENGINE_DECISIONS.md#Decision-66',
};

test('edits are optional, and a well-formed chain is normalised', () => {
  const absent = validateManifest(document([batch()]));
  assert.deepEqual(absent.errors, []);
  assert.equal(absent.batches[0].edits, null);

  const present = validateManifest(document([batch({ edits: [EDIT] })]));
  assert.deepEqual(present.errors, []);
  assert.deepEqual(present.batches[0].edits, [EDIT]);
});

test('a malformed edit record is rejected: shape is decided in one place', () => {
  const sameId = { ...EDIT, edit_commit: '6'.repeat(40) };
  const sameCommit = { ...EDIT, id: 'edit-two' };
  const cases = [
    ['a non-array', 'edits', /edits must be an array/],
    ['an empty array', [], /edits must be a non-empty array/],
    // The key is absent or a non-empty array; an explicit null is a
    // half-written record, not "no edits".
    ['an explicit null', null, /edits must be a non-empty array when present, not null/],
    ['a non-object event', ['edit-one'], /expected an object/],
    ['a destination outside the batch', [{ ...EDIT, destination: 'packages/b.js' }], /not a declared move of this batch/],
    ['a non-kebab id', [{ ...EDIT, id: 'Edit_One' }], /id must be a kebab-case identifier/],
    ['a duplicate id across batches', [EDIT, sameId], /duplicate edit id/],
    ['a duplicate edit commit', [EDIT, sameCommit], /already claimed by/],
    ['a short previous_commit', [{ ...EDIT, previous_commit: 'abc' }], /previous_commit must be a full/],
    ['a short blob', [{ ...EDIT, previous_blob: 'abc' }], /previous_blob must be a full/],
    ['identical blobs', [{ ...EDIT, new_blob: EDIT.previous_blob }], /the same blob/],
    ['an empty reason', [{ ...EDIT, reason: '   ' }], /reason must be a non-empty string/],
    ['no approver', [{ ...EDIT, approved_by: '' }], /approved_by must be a non-empty string/],
    ['a non-ISO approval date', [{ ...EDIT, approved_on: '20-11-2026' }], /approved_on must be a real calendar date/],
    ['an impossible approval date', [{ ...EDIT, approved_on: '2026-02-31' }], /approved_on must be a real calendar date/],
    ['no approval reference', [{ ...EDIT, approval_ref: '' }], /approval_ref must be a non-empty string/],
    ['an unknown event key', [{ ...EDIT, notes: 'extra' }], /unknown key "notes"/],
    // The record commit is derived from history; declaring it would be a SHA
    // self-reference no commit can satisfy.
    ['a declared record_commit', [{ ...EDIT, record_commit: '2'.repeat(40) }], /unknown key "record_commit"/],
  ];
  for (const [name, edits, pattern] of cases) {
    const { errors } = validateManifest(document([batch({ edits })]));
    assert.ok(errors.some((error) => pattern.test(error)), name + ': ' + errors.join(' | '));
  }
});

test('approved_on names a real Gregorian day, not merely a date-shaped string', () => {
  const validate = (date) =>
    validateManifest(document([batch({ edits: [{ ...EDIT, approved_on: date }] })]));

  for (const date of ['2026-11-20', '2024-02-29', '2000-02-29', '1900-02-28', '2026-12-31', '0001-01-01']) {
    assert.deepEqual(validate(date).errors, [], date + ' must be accepted');
  }

  for (const date of [
    '2026-02-29', // not a leap year
    '1900-02-29', // century, not a leap year
    '2026-02-31',
    '2026-04-31',
    '2026-13-01',
    '2026-00-00',
    '2026-11-00',
    '0000-01-01', // the Gregorian calendar has no year 0
    '2026-1-1',
    '26-11-20',
    '2026-11-20T00:00:00Z',
    '',
  ]) {
    const { errors } = validate(date);
    assert.ok(
      errors.some((error) => /approved_on must be a real calendar date in YYYY-MM-DD form/.test(error)),
      date + ' must be rejected: ' + errors.join(' | ')
    );
  }
});

test('unknown keys and a non-string description are rejected, not ignored', () => {
  const topLevel = validateManifest(document([batch()], { extra: true }));
  assert.ok(topLevel.errors.some((error) => /manifest: unknown key "extra"/.test(error)), topLevel.errors.join(' | '));

  const batchLevel = validateManifest(document([batch({ extra: true })]));
  assert.ok(batchLevel.errors.some((error) => /unknown key "extra"/.test(error)), batchLevel.errors.join(' | '));

  const moduleLevel = validateManifest(document([batch({
    modules: [{ source: 'src/a.js', destination: 'packages/a.js', mode: '100644' }],
  })]));
  assert.ok(moduleLevel.errors.some((error) => /unknown key "mode"/.test(error)), moduleLevel.errors.join(' | '));

  const recordLevel = validateManifest(document([batch({
    characterization: {
      fixture: 'f.json',
      capture_command: 'node x.js',
      capture_commit_subject: 'capture',
      expect_touch_commits: 1,
      capture_tool: 'x',
    },
  })]));
  assert.ok(recordLevel.errors.some((error) => /unknown key "capture_tool"/.test(error)), recordLevel.errors.join(' | '));
});

test('a later batch can be appended without disturbing batch one', () => {  const { batches, errors } = validateManifest(document([
    batch(),
    {
      id: 'step-4b-pr3',
      baseline_sha: 'b'.repeat(40),
      identity_policy: 'byte-identical',
      characterization: {
        fixture: 'packages/recommendation-core/test/fixtures/pr3-characterization.json',
        capture_command: 'node scripts/characterize-pr3.js',
        capture_commit_subject: 'test(core): freeze the PR 3 surface',
        expect_touch_commits: 1,
      },
      modules: [{ source: 'src/b.js', destination: 'packages/b.js' }],
    },
  ]));
  assert.deepEqual(errors, []);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].baseline_sha, 'a'.repeat(40));
  assert.equal(batches[0].characterization, null);
  assert.equal(batches[1].baseline_sha, 'b'.repeat(40));
  assert.equal(batches[1].characterization.fixture, 'packages/recommendation-core/test/fixtures/pr3-characterization.json');
});

test('isRepoRelativePath accepts repo paths and refuses escapes', () => {
  for (const value of ['src/a.js', 'packages/recommendation-core/src/a.js', 'a']) {
    assert.equal(isRepoRelativePath(value), true, value);
  }
  for (const value of ['', '/src/a.js', 'src/../a.js', './a.js', 'src/a.js/', 'src\\a.js', 'C:/a.js', null, 42]) {
    assert.equal(isRepoRelativePath(value), false, String(value));
  }
});

test('git helpers resolve commits, ancestry and regular-file entries', (t) => {
  const repo = makeRepo(t);
  repo.write('src/a.js', 'same bytes\n');
  const baseline = repo.commit('baseline');

  repo.write('packages/a.js', 'same bytes\n');
  const move = repo.commit('move');

  const head = resolveCommit(repo.dir, 'HEAD');
  assert.equal(head.ok, true);
  assert.equal(head.sha, move);

  assert.equal(resolveCommit(repo.dir, 'afccc67').ok, false, 'a short SHA is not accepted');
  assert.equal(resolveCommit(repo.dir, 'f'.repeat(40)).ok, false, 'an unknown commit is refused');
  assert.equal(resolveCommit(repo.dir, '-n').ok, false, 'an option-shaped reference is refused');
  assert.equal(resolveCommit(repo.dir, '').ok, false);

  assert.equal(isAncestor(repo.dir, baseline), true);
  assert.equal(isAncestor(repo.dir, head.sha), true);

  const before = regularFileAt(repo.dir, baseline, 'src/a.js');
  const after = regularFileAt(repo.dir, 'HEAD', 'packages/a.js');
  assert.deepEqual({ ok: before.ok, mode: before.mode }, { ok: true, mode: '100644' });
  assert.deepEqual({ ok: after.ok, mode: after.mode }, { ok: true, mode: '100644' });
  assert.equal(before.oid, after.oid);
  assert.deepEqual(regularFileAt(repo.dir, baseline, 'src/missing.js'), { ok: false, reason: 'missing' });
  assert.equal(regularFileAt(repo.dir, 'HEAD', 'packages').reason, 'directory', 'a directory is not a file');

  repo.run(['checkout', '--quiet', '-b', 'side']);
  repo.write('src/side.js', 'side\n');
  const side = repo.commit('side work');
  assert.equal(isAncestor(repo.dir, side), true);
  repo.run(['checkout', '--quiet', '-']);
  repo.write('packages/b.js', 'more\n');
  repo.commit('after the side branch');
  assert.equal(isAncestor(repo.dir, side), false, 'a sibling branch is not an ancestor');

  // A symlink and a gitlink are index entries with no working-tree file, so they
  // are staged directly and committed without `git add -A` (which would delete
  // them). Both resolve through `rev:path`, which is exactly why the helper
  // classifies by tree-entry mode and object type instead of object id alone.
  const linkBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: repo.dir,
    encoding: 'utf8',
    input: 'target.js',
  }).trim();
  repo.run(['update-index', '--add', '--cacheinfo', '120000,' + linkBlob + ',packages/link.js']);
  repo.run(['commit', '--quiet', '-m', 'symlink entry']);
  assert.equal(regularFileAt(repo.dir, 'HEAD', 'packages/link.js').reason, 'symlink');

  const parent = repo.run(['rev-parse', 'HEAD']);
  repo.run(['update-index', '--add', '--cacheinfo', '160000,' + parent + ',packages/sub']);
  repo.run(['commit', '--quiet', '-m', 'gitlink entry']);
  assert.equal(regularFileAt(repo.dir, 'HEAD', 'packages/sub').reason, 'gitlink');
});

test('loadManifest reports a missing file and invalid JSON instead of throwing', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-manifest-json-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const missing = loadManifest(path.join(dir, 'absent.json'));
  assert.equal(missing.document, null);
  assert.ok(missing.errors.some((error) => /cannot read/.test(error)), missing.errors.join(' | '));

  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{ "kind": "extraction-manifest", ');
  const invalid = loadManifest(broken);
  assert.equal(invalid.document, null);
  assert.ok(invalid.errors.some((error) => /not valid JSON/.test(error)), invalid.errors.join(' | '));
});

test('the manifest lives at the repository root under a known name', () => {
  assert.equal(MANIFEST_REL, 'extraction-manifest.json');
  assert.equal(manifestFile(REPO_ROOT), path.join(REPO_ROOT, MANIFEST_REL));
  assert.equal(fs.existsSync(manifestFile(REPO_ROOT)), true);
});
