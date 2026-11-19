'use strict';

// scripts/lib/extraction-edits-cli.test.js - authorized post-extraction edits,
// exercised end to end through the CLI against throwaway Git repositories.
//
// The shape of an edit record is the manifest validator's contract
// (extraction-manifest.test.js). This file pins the HISTORY half: the derived
// destination anchor, the "nothing changed without a record" rule, every
// per-event proof, and the chain that joins events. Each case builds its own
// repository under os.tmpdir(), so no case reads or writes the checkout this
// suite runs in. DB-free, dependency-free.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { REPO_ROOT } = require('./extraction-manifest');
const { verifyFixtureMerges } = require('../verify-pr2-provenance');

const SCRIPT = path.resolve(__dirname, '..', 'verify-pr2-provenance.js');
const MANIFEST_REL = 'extraction-manifest.json';
const SOURCE = 'src/a.js';
const DESTINATION = 'packages/a.js';
const SOURCE_TEXT = 'module.exports = 1;\n';
const FIXTURE = 'test/fixtures/batch-one.json';
const CAPTURE_COMMAND = 'node scripts/characterize-batch-one.js';
const CAPTURE_SUBJECT = 'test(core): freeze the batch-one surface before anything moves';

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-edits-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const git = (args, input) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(input === undefined ? {} : { input }),
    }).trim();

  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Extraction Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'false']);

  const repo = {
    dir,
    git,
    mainBranch: git(['symbolic-ref', '--short', 'HEAD']),
    head() {
      return git(['rev-parse', 'HEAD']);
    },
    blobOf(rev, relative) {
      return git(['rev-parse', rev + ':' + relative]);
    },
    hashBlob(text) {
      return git(['hash-object', '-w', '--stdin'], text);
    },
    write(relative, text) {
      const absolute = path.join(dir, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, text);
    },
    remove(relative) {
      fs.rmSync(path.join(dir, relative), { force: true });
    },
    commit(message) {
      git(['add', '-A']);
      git(['commit', '--quiet', '-m', message]);
      return repo.head();
    },
    commitStaged(message) {
      git(['commit', '--quiet', '-m', message]);
      return repo.head();
    },
    move(source, destination) {
      const bytes = fs.readFileSync(path.join(dir, source));
      repo.write(destination, bytes);
      repo.remove(source);
    },
    /**
     * Write a manifest for batch-one. `edits === undefined` omits the key (no
     * edits); an array - including [] - writes it as given.
     */
    writeManifest(baseline, edits, options = {}) {
      const batch = {
        id: 'batch-one',
        baseline_sha: baseline,
        identity_policy: 'byte-identical',
        modules: [{ source: SOURCE, destination: DESTINATION }],
      };
      if (options.description !== undefined) batch.description = options.description;
      if (edits !== undefined) batch.edits = edits;
      if (options.characterization !== undefined) batch.characterization = options.characterization;
      repo.write(
        MANIFEST_REL,
        JSON.stringify({ kind: 'extraction-manifest', version: 1, batches: [batch] }, null, 2) + '\n'
      );
    },
    /**
     * Overwrite the root tree of `commit` so any path-limited history walk has
     * to fail when it compares that commit's trees, while commit-only commands
     * (ancestry, rev-parse) still work.
     */
    corruptTree(commit) {
      const tree = git(['rev-parse', commit + '^{tree}']);
      const objectPath = path.join(dir, '.git', 'objects', tree.slice(0, 2), tree.slice(2));
      fs.chmodSync(objectPath, 0o644);
      fs.writeFileSync(objectPath, 'corrupt\n');
    },
    verify() {
      return spawnSync(
        process.execPath,
        [SCRIPT, '--repo=' + dir, '--manifest=' + path.join(dir, MANIFEST_REL)],
        { cwd: REPO_ROOT, encoding: 'utf8' }
      );
    },
  };
  return repo;
}

/** baseline -> move -> manifest batch, with no edits recorded yet. */
function extracted(t) {
  const repo = makeRepo(t);
  repo.write(SOURCE, SOURCE_TEXT);
  const baseline = repo.commit('baseline');
  repo.move(SOURCE, DESTINATION);
  repo.commit('move the module into the core package');
  repo.writeManifest(baseline);
  repo.commit('append the batch to the extraction manifest');
  return { repo, baseline };
}

function fixtureText(baseline) {
  return JSON.stringify({ provenance: { baseline_sha: baseline, command: CAPTURE_COMMAND }, result: 1 }, null, 2) + '\n';
}

const CHARACTERIZATION = {
  fixture: FIXTURE,
  capture_command: CAPTURE_COMMAND,
  capture_commit_subject: CAPTURE_SUBJECT,
  expect_touch_commits: 1,
};

/**
 * baseline -> capture -> move -> manifest batch declaring the characterization
 * record. The capture commit's parent is the baseline and it adds only the
 * fixture, so the fixture origin starts out proven.
 */
function characterized(t) {
  const repo = makeRepo(t);
  repo.write(SOURCE, SOURCE_TEXT);
  const baseline = repo.commit('baseline');
  repo.write(FIXTURE, fixtureText(baseline));
  const capture = repo.commit(CAPTURE_SUBJECT);
  repo.move(SOURCE, DESTINATION);
  repo.commit('move the module into the core package');
  repo.writeManifest(baseline, undefined, { characterization: CHARACTERIZATION });
  repo.commit('append the batch to the extraction manifest');
  return { repo, baseline, capture };
}

/** Change the destination and return the facts an event must carry. */
function edit(repo, text) {
  const previous_commit = repo.head();
  const previous_blob = repo.blobOf(previous_commit, DESTINATION);
  repo.write(DESTINATION, text);
  const edit_commit = repo.commit('change the moved module');
  const new_blob = repo.blobOf(edit_commit, DESTINATION);
  return { previous_commit, previous_blob, new_blob, edit_commit };
}

function eventFrom(change, id = 'edit-one', overrides = {}) {
  return {
    id,
    destination: DESTINATION,
    edit_commit: change.edit_commit,
    previous_commit: change.previous_commit,
    previous_blob: change.previous_blob,
    new_blob: change.new_blob,
    reason: 'keep the moved module maintainable',
    approved_by: 'Owner',
    approved_on: '2026-11-20',
    approval_ref: 'docs/RECOGNITION_ENGINE_DECISIONS.md#Decision-66',
    ...overrides,
  };
}

/** Write the manifest with `events` and commit it: the derived record commit. */
function recordEvents(repo, baseline, events) {
  repo.writeManifest(baseline, events);
  return repo.commit('record the edit in the extraction manifest');
}

// ---------------------------------------------------------------------------
// Positive cases
// ---------------------------------------------------------------------------

test('an untouched extraction passes and says the history was proven', (t) => {
  const { repo } = extracted(t);
  const result = repo.verify();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /destination history since baseline: each destination introduced exactly once/);
  assert.match(result.stdout, /destination history: proven for every destination/);
  assert.match(result.stdout, /blob-identical in 'batch-one': 1 \/ 1/);
  assert.doesNotMatch(result.stdout, /recorded edit /);
});

test('a legitimate edit and its record pass', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  const record = recordEvents(repo, baseline, [eventFrom(change)]);

  const result = repo.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /recorded edit edit-one: packages\/a\.js/);
  assert.match(result.stdout, new RegExp('recorded in ' + record.slice(0, 10)));
  assert.match(result.stdout, /blob-identical in 'batch-one': 0 \/ 1 \(\+ 1 recorded edit\(s\)\)/);
  assert.match(result.stdout, /recorded edits verified: 1/);
  assert.match(result.stdout, /verify-pr2-provenance: PASS/);
});

test('two chained edits pass with an unrelated commit between record one and edit two', (t) => {
  const { repo, baseline } = extracted(t);
  const first = edit(repo, 'module.exports = 2;\n');
  recordEvents(repo, baseline, [eventFrom(first)]);

  repo.write('docs/notes.md', 'notes\n');
  repo.commit('unrelated work between the record and the next edit');

  const second = edit(repo, 'module.exports = 3;\n');
  recordEvents(repo, baseline, [eventFrom(first), eventFrom(second, 'edit-two')]);

  const result = repo.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /recorded edit edit-one:/);
  assert.match(result.stdout, /recorded edit edit-two:/);
  assert.match(result.stdout, /recorded edits verified: 2/);
});

test('a second edit whose sole parent is the first record commit passes', (t) => {
  const { repo, baseline } = extracted(t);
  const first = edit(repo, 'module.exports = 2;\n');
  const recordOne = recordEvents(repo, baseline, [eventFrom(first)]);

  const second = edit(repo, 'module.exports = 3;\n');
  assert.equal(second.previous_commit, recordOne, 'the second edit must sit directly on the record');
  recordEvents(repo, baseline, [eventFrom(first), eventFrom(second, 'edit-two')]);

  const result = repo.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /recorded edit edit-one:/);
  assert.match(result.stdout, /recorded edit edit-two:/);
  assert.match(result.stdout, /recorded edits verified: 2/);
});

test('an unrelated commit after the record does not invalidate the chain', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  recordEvents(repo, baseline, [eventFrom(change)]);

  repo.write('README.md', 'readme\n');
  repo.commit('unrelated documentation after the record');

  const result = repo.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /recorded edits verified: 1/);
});

// ---------------------------------------------------------------------------
// Missing and misplaced records
// ---------------------------------------------------------------------------

test('an edit with no record commit fails', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  // The working manifest names the event, but nothing committed it.
  repo.writeManifest(baseline, [eventFrom(change)]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no commit after the edit introduces it into extraction-manifest\.json, so the edit is unrecorded/);
});

test('an event recorded only after the next edit already happened fails: the record must come first', (t) => {
  const { repo, baseline } = extracted(t);
  const first = edit(repo, 'module.exports = 2;\n');
  const second = edit(repo, 'module.exports = 3;\n');
  assert.equal(second.previous_commit, first.edit_commit);
  // Both events are recorded only now, after the second edit exists.
  recordEvents(repo, baseline, [eventFrom(first), eventFrom(second, 'edit-two')]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /the previous edit was recorded in [0-9a-f]{10}, which is not an ancestor of this edit's previous_commit/
  );
});

test('an event whose previous_commit is not the edit parent fails', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  recordEvents(repo, baseline, [eventFrom(change, 'edit-one', { previous_commit: baseline })]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /previous_commit [0-9a-f]{40} is not the edit commit's sole parent/);
  assert.match(result.stderr, /is missing at previous_commit/);
});

test('a wrong previous_blob - including the first event not starting from the source blob - fails', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  const wrongBlob = repo.hashBlob('bytes that were never in the destination\n');
  recordEvents(repo, baseline, [eventFrom(change, 'edit-one', { previous_blob: wrongBlob })]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp('previous_blob ' + wrongBlob + ' is not the destination blob at previous_commit'));
  assert.match(result.stderr, new RegExp('previous_blob ' + wrongBlob + ' is not the baseline source blob'));
});

test('a wrong new_blob fails', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  const wrongBlob = repo.hashBlob('not the edited bytes\n');
  recordEvents(repo, baseline, [eventFrom(change, 'edit-one', { new_blob: wrongBlob })]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp('new_blob ' + wrongBlob + ' is not the destination blob at the edit commit'));
});

// ---------------------------------------------------------------------------
// The edit commit's shape
// ---------------------------------------------------------------------------

test('an edit that changes the destination plus a second file fails', (t) => {
  const { repo, baseline } = extracted(t);
  const previous_commit = repo.head();
  const previous_blob = repo.blobOf(previous_commit, DESTINATION);
  repo.write(DESTINATION, 'module.exports = 2;\n');
  repo.write('docs/extra.md', 'extra\n');
  const edit_commit = repo.commit('change the module and a document');
  const new_blob = repo.blobOf(edit_commit, DESTINATION);

  recordEvents(repo, baseline, [eventFrom({ previous_commit, previous_blob, edit_commit, new_blob })]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /an edit must change exactly packages\/a\.js \(one M record, nothing else\); it changed/);
  assert.match(result.stderr, /docs\/extra\.md/);
});

test('an edit commit that is a merge fails: a merge is never an authorized edit', (t) => {
  const { repo, baseline } = extracted(t);
  const previous_commit = repo.head();
  const previous_blob = repo.blobOf(previous_commit, DESTINATION);

  repo.git(['checkout', '--quiet', '-b', 'side-edit']);
  const edit_commit = edit(repo, 'module.exports = 2;\n').edit_commit;
  repo.git(['checkout', '--quiet', repo.mainBranch]);
  repo.write('docs/base.md', 'base\n');
  repo.commit('unrelated main work so the merge cannot fast-forward');
  repo.git(['merge', '--no-ff', '-m', 'merge the side edit', 'side-edit']);
  const merge = repo.head();
  const new_blob = repo.blobOf(merge, DESTINATION);

  recordEvents(repo, baseline, [
    eventFrom({ previous_commit, previous_blob, edit_commit: merge, new_blob }),
  ]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the edit commit has 2 parents; an edit must be a single-parent commit/);
});

// ---------------------------------------------------------------------------
// The record commit's shape
// ---------------------------------------------------------------------------

test('a record commit that touches the manifest and another file fails', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');

  repo.writeManifest(baseline, [eventFrom(change)]);
  repo.write('docs/extra.md', 'extra\n');
  repo.commit('record the edit and a document');

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /the record commit must change exactly extraction-manifest\.json \(one M record, nothing else\); it changed/
  );
  assert.match(result.stderr, /docs\/extra\.md/);
});

test('a merge commit that invents the event fails: a record must be single-parent', (t) => {
  const { repo, baseline } = extracted(t);
  const baseHead = repo.head();
  const change = edit(repo, 'module.exports = 2;\n');

  // Neither branch records the event; the merge's conflict resolution does.
  repo.git(['checkout', '--quiet', '-b', 'branch-a']);
  repo.writeManifest(baseline, undefined, { description: 'branch a' });
  repo.commit('branch a edits the manifest');
  repo.git(['checkout', '--quiet', '-b', 'branch-b', baseHead]);
  repo.writeManifest(baseline, undefined, { description: 'branch b' });
  repo.commit('branch b edits the manifest');
  repo.git(['checkout', '--quiet', 'branch-b']);
  try {
    repo.git(['merge', '--no-ff', '--no-commit', 'branch-a']);
  } catch (_err) {
    // The manifest conflict is the point: resolve it with the event.
  }
  repo.writeManifest(baseline, [eventFrom(change)]);
  repo.git(['add', MANIFEST_REL]);
  repo.commitStaged('merge branch a and resolve the manifest');

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the record commit has 2 parents; it must be a single-parent commit/);
});

test('a side-branch edit discarded by -s ours fails: full history sees what the merge threw away', (t) => {
  const { repo, baseline } = extracted(t);
  const main = repo.mainBranch;

  repo.git(['checkout', '--quiet', '-b', 'side-edit']);
  edit(repo, 'module.exports = 2;\n');
  repo.git(['checkout', '--quiet', main]);
  repo.write('docs/main.md', 'main\n');
  repo.commit('unrelated main work so the merge cannot fast-forward');
  repo.git(['merge', '-s', 'ours', '--no-ff', '-m', 'merge side, keeping the main destination bytes', 'side-edit']);

  // HEAD still holds the extraction bytes; only the history remembers the edit.
  assert.equal(repo.git(['show', 'HEAD:packages/a.js']), 'module.exports = 1;');

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /batch batch-one: packages\/a\.js: changed by 1 commit\(s\) without a recorded edit: [0-9a-f]{10}/
  );
});

test('a merge that leaves the destination alone is not treated as an edit', (t) => {
  const { repo } = extracted(t);
  const main = repo.mainBranch;

  repo.git(['checkout', '--quiet', '-b', 'docs-only']);
  repo.write('docs/side.md', 'side\n');
  repo.commit('side documentation');
  repo.git(['checkout', '--quiet', main]);
  repo.write('docs/main.md', 'main\n');
  repo.commit('main documentation');
  repo.git(['merge', '--no-ff', '-m', 'merge the documentation branch', 'docs-only']);

  const result = repo.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /destination history: proven for every destination/);
});

// ---------------------------------------------------------------------------
// Characterization fixture history
// ---------------------------------------------------------------------------

test('an untouched characterized batch proves the fixture origin', (t) => {
  const { repo } = characterized(t);

  const result = repo.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /characterization fixture: test\/fixtures\/batch-one\.json \(read from HEAD\)/);
  assert.match(result.stdout, /commits touching the fixture since baseline: 1 \(must be exactly 1\)/);
  assert.match(result.stdout, /fixture captured before the move: yes/);
  assert.match(result.stdout, /fixture unchanged since its capture commit: yes/);
});

test('a fixture regenerated on a side branch and discarded by -s ours fails: full history sees what the merge threw away', (t) => {
  const { repo, capture } = characterized(t);
  const main = repo.mainBranch;

  repo.git(['checkout', '--quiet', '-b', 'side-fixture']);
  repo.write(FIXTURE, JSON.stringify({ provenance: { baseline_sha: 'f'.repeat(40), command: CAPTURE_COMMAND } }) + '\n');
  repo.commit('regenerate the fixture from the moved code');
  repo.git(['checkout', '--quiet', main]);
  repo.write('docs/main.md', 'main\n');
  repo.commit('unrelated main work so the merge cannot fast-forward');
  repo.git(['merge', '-s', 'ours', '--no-ff', '-m', 'merge the side branch, keeping the captured fixture', 'side-fixture']);

  // HEAD still holds the captured fixture bytes; only the history remembers the touch.
  assert.equal(repo.blobOf('HEAD', FIXTURE), repo.blobOf(capture, FIXTURE));

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the fixture was touched by 2 commits since the baseline/);
  assert.match(result.stderr, /a commit touching the fixture is not the pre-move capture/);
});

test('a docs-only merge leaves the fixture origin proven: full history does not invent touches', (t) => {
  const { repo } = characterized(t);
  const main = repo.mainBranch;

  repo.git(['checkout', '--quiet', '-b', 'side-docs']);
  repo.write('docs/side.md', 'side\n');
  repo.commit('side documentation');
  repo.git(['checkout', '--quiet', main]);
  repo.write('docs/main.md', 'main\n');
  repo.commit('main documentation');
  repo.git(['merge', '--no-ff', '-m', 'merge the documentation branch', 'side-docs']);

  const result = repo.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /commits touching the fixture since baseline: 1 \(must be exactly 1\)/);
  assert.match(result.stdout, /verify-pr2-provenance: PASS/);
});

test('a capture that lands through a merge is still one introduction', (t) => {
  const repo = makeRepo(t);
  repo.write(SOURCE, SOURCE_TEXT);
  const baseline = repo.commit('baseline');
  const main = repo.mainBranch;

  // The capture, the move and the manifest commit are all on one branch, merged
  // into main. The merge is TREESAME to that branch for the fixture, so it must
  // not be counted as a second touch.
  repo.git(['checkout', '--quiet', '-b', 'capture-branch']);
  repo.write(FIXTURE, fixtureText(baseline));
  repo.commit(CAPTURE_SUBJECT);
  repo.move(SOURCE, DESTINATION);
  repo.commit('move the module into the core package');
  repo.writeManifest(baseline, undefined, { characterization: CHARACTERIZATION });
  repo.commit('append the batch to the extraction manifest');

  repo.git(['checkout', '--quiet', main]);
  repo.write('docs/main.md', 'main\n');
  repo.commit('unrelated main work so the merge cannot fast-forward');
  repo.git(['merge', '--no-ff', '-m', 'merge the capture branch into main', 'capture-branch']);

  const result = repo.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /commits touching the fixture since baseline: 1 \(must be exactly 1\)/);
  assert.match(result.stdout, /fixture captured before the move: yes/);
});

test('a merge that invents a fixture state and a later merge that restores it fails: merge history is judged in full', (t) => {
  const { repo, baseline, capture } = characterized(t);
  const main = repo.mainBranch;
  const capturedBlob = repo.blobOf(capture, FIXTURE);

  // A docs-only side branch, so the first merge has a second parent.
  repo.git(['checkout', '--quiet', '-b', 'side-docs']);
  repo.write('docs/side.md', 'side\n');
  repo.commit('side documentation');
  repo.git(['checkout', '--quiet', main]);

  // An evil merge: both parents still hold the captured bytes, but the merge
  // result is written with third bytes. No non-merge commit touches the fixture.
  repo.git(['merge', '--no-ff', '--no-commit', 'side-docs']);
  repo.write(FIXTURE, JSON.stringify({
    provenance: { baseline_sha: 'f'.repeat(40), command: CAPTURE_COMMAND },
    result: 2,
  }, null, 2) + '\n');
  repo.git(['add', '-A']);
  repo.commitStaged('merge the side branch and invent fixture bytes');
  const evil = repo.head();
  assert.notEqual(repo.blobOf(evil, FIXTURE), repo.blobOf(evil + '^1', FIXTURE));
  assert.notEqual(repo.blobOf(evil, FIXTURE), repo.blobOf(evil + '^2', FIXTURE));

  // A later merge puts the captured bytes back, matching one of its parents.
  repo.git(['checkout', '--quiet', '-b', 'restore', capture]);
  repo.write('docs/restore.md', 'restore\n');
  repo.commit('restore branch work');
  repo.git(['checkout', '--quiet', main]);
  repo.git(['merge', '--no-ff', '--no-commit', 'restore']);
  repo.write(FIXTURE, fixtureText(baseline));
  repo.git(['add', '-A']);
  repo.commitStaged('merge the restore branch and put the captured fixture back');

  // The capture-to-HEAD comparison is clean and only the capture is a non-merge
  // touch, so only the per-merge inspection can reject this history.
  assert.equal(repo.blobOf('HEAD', FIXTURE), capturedBlob);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /commits touching the fixture since baseline: 1 \(must be exactly 1\)/);
  assert.match(result.stderr, /merge commit [0-9a-f]{10} introduced a fixture state that matches neither parent/);
  assert.doesNotMatch(result.stdout, /verify-pr2-provenance: PASS/);
});

test('a fixture merge scan that cannot be enumerated fails closed instead of returning no merges', (t) => {
  const { repo, baseline } = characterized(t);
  const main = repo.mainBranch;

  repo.git(['checkout', '--quiet', '-b', 'side-docs']);
  repo.write('docs/side.md', 'side\n');
  const side = repo.commit('side documentation');
  repo.git(['checkout', '--quiet', main]);
  repo.write('docs/main.md', 'main\n');
  repo.commit('main documentation');
  repo.git(['merge', '--no-ff', '-m', 'merge the documentation branch', 'side-docs']);

  // The CLI's fixture-touch scan fails on this corruption before the merge scan
  // runs, so the merge scan is exercised directly: it must report a failure,
  // never an empty merge list that would pass.
  repo.corruptTree(side);

  const failures = [];
  const proven = verifyFixtureMerges(repo.dir, 'batch-one', FIXTURE, baseline, failures);
  assert.equal(proven, false);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /the merge commits touching it since the baseline could not be listed/);
});

test('an unreadable history is a failure, not an empty history', (t) => {
  const { repo } = characterized(t);
  const main = repo.mainBranch;

  repo.git(['checkout', '--quiet', '-b', 'side-docs']);
  repo.write('docs/side.md', 'side\n');
  const side = repo.commit('side documentation');
  repo.git(['checkout', '--quiet', main]);
  repo.write('docs/main.md', 'main\n');
  repo.commit('main documentation');
  repo.git(['merge', '--no-ff', '-m', 'merge the documentation branch', 'side-docs']);

  // Make every path-limited history walk fail while HEAD and the ancestry stay intact.
  repo.corruptTree(side);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the history of the fixture since the baseline could not be read, so its origin is unproven/);
  assert.match(result.stderr, /its history since the baseline could not be read/);
  assert.doesNotMatch(result.stdout, /verify-pr2-provenance: PASS/);
});

test('an event whose record was deleted afterwards fails, even if the working manifest still declares it', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  const event = eventFrom(change);
  recordEvents(repo, baseline, [event]);
  repo.writeManifest(baseline);
  repo.commit('drop the event from the manifest');
  // The working copy still declares the event; only the history says otherwise.
  repo.writeManifest(baseline, [event]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /edit edit-one is absent from the manifest at [0-9a-f]{10}, which touched the manifest later/);
  assert.match(result.stderr, /edit edit-one is absent from the committed manifest at HEAD/);
});

test('an edit_commit that does not exist in the repository fails', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  const missing = 'a'.repeat(40);
  recordEvents(repo, baseline, [eventFrom(change, 'edit-one', { edit_commit: missing })]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /edit_commit a{40} does not exist in this repository/);
  assert.match(result.stderr, /the record names commit\(s\) that did not touch it/);
});

// ---------------------------------------------------------------------------
// Unrecorded changes around the chain
// ---------------------------------------------------------------------------

test('an unrecorded edit before the first recorded event fails', (t) => {
  const { repo, baseline } = extracted(t);
  edit(repo, 'module.exports = 2;\n');
  const recorded = edit(repo, 'module.exports = 3;\n');
  recordEvents(repo, baseline, [eventFrom(recorded)]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /changed by 1 commit\(s\) without a recorded edit/);
});

test('an unrecorded edit after the last recorded event fails', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  recordEvents(repo, baseline, [eventFrom(change)]);
  edit(repo, 'module.exports = 3;\n');

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /changed by 1 commit\(s\) without a recorded edit/);
  assert.match(result.stderr, /the last recorded edit's new_blob .* is not the destination blob at HEAD/);
});

test('events on parallel histories are a fork, not a chain', (t) => {
  const { repo, baseline } = extracted(t);
  const base = repo.head();
  const first = edit(repo, 'module.exports = 2;\n');

  repo.git(['checkout', '--quiet', '-b', 'side-edit', base]);
  const second = edit(repo, 'module.exports = 3;\n');
  repo.git(['checkout', '--quiet', repo.mainBranch]);

  recordEvents(repo, baseline, [eventFrom(first), eventFrom(second, 'edit-two')]);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the recorded edits are not a single ancestry chain/);
});

test('an event modified and then restored after its record still fails', (t) => {
  const { repo, baseline } = extracted(t);
  const change = edit(repo, 'module.exports = 2;\n');
  recordEvents(repo, baseline, [eventFrom(change)]);

  const event = eventFrom(change);
  repo.writeManifest(baseline, [{ ...event, reason: 'tampered' }]);
  repo.commit('tamper with the recorded reason');
  repo.writeManifest(baseline, [event]);
  repo.commit('restore the recorded reason');

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /edit edit-one was modified at [0-9a-f]{10} after its record commit/);
});

test('an empty edits array is a malformed record, not "no edits"', (t) => {
  const { repo, baseline } = extracted(t);
  repo.writeManifest(baseline, []);

  const result = repo.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /edits must be a non-empty array when present/);
  assert.doesNotMatch(result.stdout, /blob-identical:/);
});
