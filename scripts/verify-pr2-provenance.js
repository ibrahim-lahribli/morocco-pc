'use strict';

/**
 * scripts/verify-pr2-provenance.js - manifest-driven extraction provenance gate
 * (protection L2 + L3). Step 4B PR 2 is batch 1 of the manifest.
 *
 * Two claims are made about an extraction and both must be checkable by a
 * reviewer without trusting the prose:
 *
 *   L2  the characterization fixture was captured from the code BEFORE anything
 *       moved, and has not been regenerated from the extracted code since;
 *   L3  every moved implementation module is byte-identical to its baseline
 *       blob - a move, not a rewrite. This is stronger than Git's rename
 *       percentage, which cannot reach 100% here because a shim now occupies
 *       each old path.
 *
 * Where the claims come from
 *   Not from this file. Every declared move, baseline and identity policy is
 *   read from extraction-manifest.json (version 1) through
 *   scripts/lib/extraction-manifest.js. PR 2's baseline is the commit recorded in
 *   the manifest and in the frozen fixture; it is never re-derived from the
 *   working tree, and a batch whose record does not validate is never partially
 *   verified.
 *
 * What is verified, per batch
 *   * the baseline is a real commit and an ancestor of HEAD;
 *   * every source and destination is a REGULAR FILE (mode 100644 or 100755) at
 *     its own revision - not a directory tree, a gitlink or a symlink, and a
 *     missing path is named as missing rather than as a mode problem;
 *   * the source blob at the baseline equals the destination blob at HEAD
 *     (IDENTITY_POLICY is the only policy, so there is nothing to branch on);
 *   * a batch that declares a characterization record must also show that its
 *     committed copy at HEAD (never the working tree) is a regular file that
 *     parses and names the same baseline, was ADDED by a commit whose parent is
 *     that baseline (captured before the move), is the only commit that touched
 *     it since, and has not changed since the capture commit;
 *   * that capture commit changed nothing except the fixture and the batch's
 *     declared `capture_paths` - no added, modified, renamed or deleted path
 *     outside them - and each declared capture path was absent at the baseline
 *     and is a regular file at the capture commit.
 *   * those fixture scans also run with `--full-history`, so a fixture modified
 *     on a side branch and later discarded by a merge is still counted as a
 *     touch instead of vanishing with the merge; merge commits are excluded
 *     from the touch count (as for destinations), so a capture that lands
 *     through a merge is still one introduction;
 *   * every merge commit in the fixture's full history since the baseline is
 *     then inspected directly, and the rule is relative to the capture commit,
 *     established by ancestry: a merge before the capture may have no fixture,
 *     while a merge that has the capture in its ancestry must resolve the
 *     fixture entry (mode and object id, never decoded text) to the captured
 *     entry. An ordinary treesame merge, or one that carries the capture,
 *     therefore passes; a merge that resolves the fixture to a third state, or
 *     deletes it by selecting an absent parent, fails, and a later merge that
 *     restores the captured bytes cannot erase that earlier unauthorized merge
 *     state;
 *
 * Recorded edits (the only sanctioned way to change a moved file afterwards)
 *   A batch's optional `edits` array names changes that are allowed to break
 *   byte identity. Shape is validated by the manifest library; here the HISTORY
 *   is proven, per destination:
 *   * the destination was ADDED by exactly one non-merge commit since the
 *     baseline, and that commit carries the baseline source blob - every
 *     manifest baseline predates its destinations, so this derived anchor, not
 *     the baseline, is where a chain starts;
 *   * every history scan runs with `--full-history`, so a change made on a side
 *     branch and later discarded by a merge is still seen: the destination's
 *     history is judged, not only the first-parent line;
 *   * a history scan that cannot be enumerated is a FAILURE, never an empty
 *     history: `commitList` returns null on a Git error and the caller reports
 *     it instead of continuing as if nothing happened;
 *   * the non-merge commits that touched the destination since the baseline are
 *     exactly the anchor plus the declared edit commits: any change before,
 *     between or after the recorded events is unrecorded and fails;
 *   * a merge commit that resolves the destination to bytes matching neither
 *     parent (an evil merge) fails; a merge that keeps a parent's bytes is not a
 *     change, even when full history lists it;
 *   * each edit is a single-parent commit whose sole parent is its
 *     `previous_commit`, whose old and new blobs are the blobs actually there,
 *     and which changed exactly that one destination - no rename, no second file;
 *   * each record commit - DERIVED as the single commit after the edit that
 *     introduces the event id - is a single-parent commit that changed exactly
 *     this manifest; the manifest immediately before it does not already
 *     contain the event; the event is deeply equal in the record commit, in
 *     every later commit that touched the manifest, and in the committed
 *     manifest at HEAD (a modify-then-restore cycle fails). A record commit is
 *     derived rather than declared because a commit cannot contain its own SHA;
 *   * events for one destination form a single ancestry chain whose first
 *     previous_blob is the baseline source blob and whose last new_blob is the
 *     destination blob at HEAD, and each record commit is an ancestor of - or
 *     the direct parent of - the next event's previous_commit. Forks, duplicate
 *     ids and duplicate edit commits fail.
 *   Merge, squash, rebase-after-record, force-push and cherry-pick therefore
 *   cannot launder an edit: the event names commits, and the chain re-derives
 *   their relationships from the object graph on every run.
 *
 * DB-free, dependency-free, read-only. Run from the repository root:
 *   node scripts/verify-pr2-provenance.js
 *   node scripts/verify-pr2-provenance.js --manifest=<path> --repo=<path>
 *
 * Exit codes: 0 PASS, 1 FAIL, 2 argument error.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  MANIFEST_REL,
  REPO_ROOT,
  isAncestor,
  isAncestorOf,
  isGitRepository,
  loadManifest,
  manifestFile,
  regularFileAt,
  resolveCommit,
  tryGit,
  validateManifest,
} = require('./lib/extraction-manifest');

const USAGE = 'usage: node scripts/verify-pr2-provenance.js [--manifest=<path>] [--repo=<path>]';

function parseArgs(argv) {
  const options = { repo: REPO_ROOT, manifest: null, errors: [] };
  for (const arg of argv) {
    if (arg.startsWith('--repo=') || arg.startsWith('--manifest=')) {
      const value = arg.slice(arg.indexOf('=') + 1);
      if (value.length === 0) {
        options.errors.push(arg.slice(0, arg.indexOf('=') + 1) + ' needs a path');
      } else if (arg.startsWith('--repo=')) {
        options.repo = path.resolve(process.cwd(), value);
      } else {
        options.manifest = path.resolve(process.cwd(), value);
      }
    } else {
      options.errors.push('unknown argument ' + JSON.stringify(arg));
    }
  }
  return options;
}

function displayPath(absolute) {
  const relative = path.relative(REPO_ROOT, absolute);
  return (relative.length === 0 ? absolute : relative).split(path.sep).join('/');
}

/** One failure message, naming the side, the path and the revision that failed. */
function rejection(batchId, side, filePath, where, entry) {
  const prefix = 'batch ' + batchId + ': ' + side + ' ' + filePath;
  switch (entry.reason) {
    case 'missing':
      return prefix + ' does not exist at ' + where;
    case 'directory':
      return prefix + ' is a directory (tree) at ' + where + ', not a regular file';
    case 'gitlink':
      return prefix + ' is a gitlink (mode 160000, a submodule commit) at ' + where + ', not a regular file';
    case 'symlink':
      return prefix + ' is a symlink (mode 120000) at ' + where + ', not a regular file';
    case 'mode':
    case 'object':
      return prefix + ' is not a regular file at ' + where +
        ' (mode ' + (entry.mode || '?') + ', type ' + (entry.type || '?') + ')';
    default:
      return prefix + ' could not be read as a Git object at ' + where;
  }
}

/** A table cell: the accepted file's mode and blob prefix, or why it was refused. */
function renderEntry(entry) {
  if (entry.ok) return entry.mode + ' ' + entry.oid.slice(0, 10);
  if (entry.reason === 'missing') return 'missing';
  return entry.mode ? entry.reason + ' ' + entry.mode : entry.reason;
}

/** Why a path is not a usable regular file at `where`. */
function describeEntryAt(where, entry) {
  if (entry.reason === 'missing') return 'is missing at ' + where;
  if (entry.reason === 'directory') return 'is a directory (tree) at ' + where + ', not a regular file';
  if (entry.reason === 'gitlink') return 'is a gitlink (mode 160000, a submodule commit) at ' + where + ', not a regular file';
  if (entry.reason === 'symlink') return 'is a symlink (mode 120000) at ' + where + ', not a regular file';
  if (entry.reason === 'mode' || entry.reason === 'object') {
    return 'is not a regular file at ' + where + ' (mode ' + (entry.mode || '?') + ', type ' + (entry.type || '?') + ')';
  }
  return 'could not be read as a Git object at ' + where;
}

/**
 * Raw `git diff-tree --no-commit-id -r -M -z <commit>` output, untrimmed.
 *
 * `diff-tree` reads the commit's own trees, so the working tree cannot
 * contribute to the answer. The raw record format is used (not
 * `--name-status`) because it carries the tree modes beside the status, and
 * `-z` emits paths unquoted so an exact comparison with a manifest path is
 * meaningful. Output is NOT trimmed: a trailing-space path is still a path.
 */
function runGitRaw(repo, args) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (_err) {
    return null;
  }
}

/**
 * Every path a commit changed, with its status and destination mode.
 *
 * A record is `:<old mode> <new mode> <old sha> <new sha> <status>\0<path>\0`,
 * and a rename or copy carries TWO paths (`R100\0old\0new\0`), so a rename
 * INTO an allowed name is still visible as a rename and still fails.
 */
function commitChanges(repo, commit) {
  const output = runGitRaw(repo, ['diff-tree', '--no-commit-id', '-r', '-M', '-z', commit]);
  if (output === null) return null;
  const tokens = output.split('\u0000');
  const changes = [];
  for (let i = 0; i < tokens.length; ) {
    const header = tokens[i];
    if (header === '') break;
    const parsed = /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])(\d{1,3})?$/.exec(header);
    if (!parsed) return null;
    const status = parsed[5] + (parsed[6] || '');
    const paired = parsed[5] === 'R' || parsed[5] === 'C';
    const paths = paired ? [tokens[i + 1], tokens[i + 2]] : [tokens[i + 1]];
    if (paths.some((changed) => typeof changed !== 'string' || changed.length === 0)) return null;
    changes.push({
      status,
      paths,
      mode: parsed[2],
      description: status + ' ' + paths.join(' -> '),
    });
    i += paired ? 3 : 2;
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Recorded edits. The manifest validator checks the record's shape; everything
// below is derived from the object graph, so a record cannot describe a history
// different from the one that exists.
// ---------------------------------------------------------------------------

/** Full SHA list from `git log --format=%H`, or null when the range is unreadable. */
function commitList(repo, args) {
  const out = tryGit(repo, ['log', '--format=%H', ...args]);
  if (!out.ok) return null;
  return out.out.split('\n').filter(Boolean);
}

/** The parents of `sha`, or null when it does not resolve. */
function commitParents(repo, sha) {
  const out = tryGit(repo, ['rev-list', '--parents', '-n', '1', sha]);
  if (!out.ok) return null;
  const [head, ...parents] = out.out.split(/\s+/).filter(Boolean);
  return head === sha ? parents : null;
}

/**
 * Is `ancestor` in the history of `descendant`? 'ancestor', 'not-ancestor', or
 * null when Git could not answer.
 *
 * `git merge-base --is-ancestor` exits 1 for "no" and 128 (or another non-zero
 * status) for an error. `isAncestorOf` from the manifest library collapses both
 * to `false`, which would turn an unreadable history into a legitimate
 * pre-capture merge; the exit status is the only honest signal, so it is read
 * here directly.
 */
function commitAncestry(repo, ancestor, descendant) {
  if (!/^[0-9a-f]{40}$/.test(ancestor) || !/^[0-9a-f]{40}$/.test(descendant)) return null;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 'ancestor';
  } catch (err) {
    return err && err.status === 1 ? 'not-ancestor' : null;
  }
}

/** Order-independent comparison of two parsed JSON values. */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * The committed manifest at a revision, validated the same way the loaded one
 * is. A mid-flight manifest that does not validate is a failure to report, not
 * a value to compare.
 */
function readManifestAt(repo, rev) {
  const raw = tryGit(repo, ['show', rev + ':' + MANIFEST_REL]);
  if (!raw.ok) return { ok: false, reason: 'it could not be read' };
  let document;
  try {
    document = JSON.parse(raw.out);
  } catch (err) {
    return { ok: false, reason: 'it is not valid JSON (' + err.message + ')' };
  }
  const validated = validateManifest(document);
  if (validated.errors.length > 0) {
    return { ok: false, reason: 'it does not validate (' + validated.errors[0] + ')' };
  }
  return { ok: true, batches: validated.batches };
}

/** The event with `id` in any batch, or null. */
function findEvent(batches, id) {
  for (const batch of batches) {
    if (!batch.edits) continue;
    const event = batch.edits.find((candidate) => candidate.id === id);
    if (event) return event;
  }
  return null;
}

/**
 * Order one destination's events by edit ancestry. Two events on unrelated
 * histories (a fork, or a record copied across a rebase) have no order, and the
 * chain is rejected rather than guessed from array order.
 */
function orderEvents(repo, events, label, failures) {
  const remaining = events.slice();
  const ordered = [];
  while (remaining.length > 0) {
    const rootIndex = remaining.findIndex((candidate) =>
      remaining.every((other) =>
        other === candidate || isAncestorOf(repo, candidate.edit_commit, other.edit_commit)
      )
    );
    if (rootIndex < 0) {
      failures.push(label + ': the recorded edits are not a single ancestry chain (a fork or unrelated histories)');
      return null;
    }
    ordered.push(remaining.splice(rootIndex, 1)[0]);
  }
  return ordered;
}

/**
 * The single commit after the edit that introduced this event into the
 * manifest, or null.
 *
 * Derived, not declared: a commit cannot contain its own SHA, so an
 * author-supplied `record_commit` inside the event recorded by that commit is a
 * fixed point no Git object can satisfy. "Introduced" means present at the
 * commit and absent at every parent, so a clean merge that carries an
 * already-recorded event is not an introduction and an evil merge that invents
 * one is.
 */
function findRecordCommit(repo, event, edit, label, failures) {
  const candidates = commitList(repo, ['--full-history', edit + '..HEAD', '--', MANIFEST_REL]);
  if (candidates === null) {
    failures.push(label + ': the manifest history after the edit could not be listed');
    return null;
  }
  const introducing = [];
  for (const commit of candidates) {
    const atCommit = readManifestAt(repo, commit);
    if (!atCommit.ok) continue;
    if (findEvent(atCommit.batches, event.id) === null) continue;
    const parents = commitParents(repo, commit) || [];
    const presentBefore = parents.some((parent) => {
      const atParent = readManifestAt(repo, parent);
      return atParent.ok && findEvent(atParent.batches, event.id) !== null;
    });
    if (!presentBefore) introducing.push(commit);
  }
  if (introducing.length === 0) {
    failures.push(label + ': no commit after the edit introduces it into ' + MANIFEST_REL + ', so the edit is unrecorded');
    return null;
  }
  if (introducing.length > 1) {
    failures.push(
      label + ': the event is introduced by ' + introducing.length + ' commits after the edit (' +
      introducing.map((commit) => commit.slice(0, 10)).join(', ') + '); it must be recorded exactly once'
    );
    return null;
  }
  return introducing[0];
}

/**
 * History for one destination: anchor, unrecorded changes, evil merges, then
 * each recorded event and the chain that joins them.
 *
 * Returns the number of events verified, or -1 when the destination's history
 * itself is unprovable (the failure list already names why).
 */
function verifyDestinationHistory(repo, batch, module, events, sourceOid, lines, failures) {
  const label = 'batch ' + batch.id + ': ' + module.destination;
  const range = batch.baseline_sha + '..HEAD';

  const adds = commitList(repo, ['--full-history', '--no-merges', '--diff-filter=A', range, '--', module.destination]);
  if (adds === null) {
    failures.push(label + ': its history since the baseline could not be read');
    return -1;
  }
  if (adds.length !== 1) {
    failures.push(
      label + ': it must be ADDED by exactly one non-merge commit since the baseline ' + batch.baseline_sha +
      ', found ' + adds.length + '; a file added more than once has no single anchor an edit chain can start from'
    );
    return -1;
  }
  const anchor = adds[0];
  const anchorEntry = regularFileAt(repo, anchor, module.destination);
  if (!anchorEntry.ok || anchorEntry.oid !== sourceOid) {
    failures.push(
      label + ': the commit that introduced it (' + anchor.slice(0, 10) + ') does not carry the baseline source blob ' +
      sourceOid + ' (' + (anchorEntry.ok ? anchorEntry.oid : describeEntryAt('the introducing commit', anchorEntry)) + ')'
    );
  }

  const touches = commitList(repo, ['--full-history', '--no-merges', range, '--', module.destination]);
  if (touches === null) {
    failures.push(label + ': the commits that touched it since the baseline could not be listed');
    return -1;
  }
  const allowed = new Set([anchor, ...events.map((event) => event.edit_commit)]);
  const unrecorded = touches.filter((commit) => !allowed.has(commit));
  if (unrecorded.length > 0) {
    failures.push(
      label + ': changed by ' + unrecorded.length + ' commit(s) without a recorded edit: ' +
      unrecorded.map((commit) => commit.slice(0, 10)).join(', ')
    );
  }
  const notTouching = [...allowed].filter((commit) => !touches.includes(commit));
  if (notTouching.length > 0) {
    failures.push(
      label + ': the record names commit(s) that did not touch it: ' +
      notTouching.map((commit) => commit.slice(0, 10)).join(', ')
    );
  }

  // A clean merge keeps bytes a parent already had; a merge that resolves the
  // path to bytes matching no parent changed it itself, and no record can
  // authorize that (an edit must be a single-parent commit).
  const merges = commitList(repo, ['--full-history', '--merges', range, '--', module.destination]);
  if (merges === null) {
    failures.push(label + ': the merge commits that touched it could not be listed');
  } else {
    for (const merge of merges) {
      const parents = commitParents(repo, merge) || [];
      const atMerge = regularFileAt(repo, merge, module.destination);
      const matchesParent = parents.some((parent) => {
        const entry = regularFileAt(repo, parent, module.destination);
        return entry.ok && atMerge.ok && entry.oid === atMerge.oid;
      });
      if (!matchesParent) {
        failures.push(
          label + ': merge commit ' + merge.slice(0, 10) +
          ' resolved it to bytes that match neither parent; a merge can never be an authorized edit'
        );
      }
    }
  }

  if (events.length === 0) {
    if (anchorEntry.ok && anchorEntry.oid !== sourceOid) return -1; // already named above
    return 0;
  }

  const duplicates = new Set();
  for (const event of events) {
    if (duplicates.has(event.edit_commit)) {
      failures.push(label + ': edit_commit ' + event.edit_commit + ' is declared twice');
    }
    duplicates.add(event.edit_commit);
  }

  const ordered = orderEvents(repo, events, label, failures);
  if (ordered === null) return -1;

  let previousBlob = sourceOid;
  let previousRecord = null;
  let verified = 0;

  for (let index = 0; index < ordered.length; index++) {
    const event = ordered[index];
    const tag = label + ' edit ' + (event.id || '(unnamed)');

    const editResolved = resolveCommit(repo, String(event.edit_commit));
    if (!editResolved.ok) {
      failures.push(tag + ': edit_commit ' + event.edit_commit + ' does not exist in this repository');
      continue;
    }
    const edit = editResolved.sha;
    if (!isAncestor(repo, edit)) {
      failures.push(tag + ': the edit commit is not an ancestor of HEAD');
      continue;
    }
    const parents = commitParents(repo, edit);
    if (parents === null) {
      failures.push(tag + ': the edit commit\'s parents could not be read');
      continue;
    }
    if (parents.length !== 1) {
      failures.push(
        tag + ': the edit commit has ' + parents.length +
        ' parents; an edit must be a single-parent commit, so a merge can never be authorized as one'
      );
      continue;
    }
    if (parents[0] !== event.previous_commit) {
      failures.push(
        tag + ': previous_commit ' + event.previous_commit + ' is not the edit commit\'s sole parent (' + parents[0] + ')'
      );
    }

    const before = regularFileAt(repo, event.previous_commit, module.destination);
    const after = regularFileAt(repo, edit, module.destination);
    if (!before.ok) {
      failures.push(tag + ': destination ' + module.destination + ' ' + describeEntryAt('previous_commit ' + event.previous_commit, before));
    } else if (before.oid !== event.previous_blob) {
      failures.push(tag + ': previous_blob ' + event.previous_blob + ' is not the destination blob at previous_commit (' + before.oid + ')');
    }
    if (!after.ok) {
      failures.push(tag + ': destination ' + module.destination + ' ' + describeEntryAt('the edit commit ' + edit, after));
    } else if (after.oid !== event.new_blob) {
      failures.push(tag + ': new_blob ' + event.new_blob + ' is not the destination blob at the edit commit (' + after.oid + ')');
    }

    const changes = commitChanges(repo, edit);
    if (changes === null) {
      failures.push(tag + ': the edit commit\'s changed paths could not be read');
    } else if (changes.length !== 1 || changes[0].status !== 'M' ||
               changes[0].paths.length !== 1 || changes[0].paths[0] !== module.destination) {
      failures.push(
        tag + ': an edit must change exactly ' + module.destination + ' (one M record, nothing else); it changed ' +
        (changes.length === 0 ? 'nothing' : changes.map((change) => change.description).join(', '))
      );
    }

    if (event.previous_blob !== previousBlob) {
      failures.push(
        tag + ': previous_blob ' + event.previous_blob + ' is not ' +
        (previousRecord ? 'the previous edit\'s new_blob' : 'the baseline source blob') + ' (' + previousBlob + ')'
      );
    }
    // The record must be no later than the next edit's parent: equality is the
    // ordinary direct-parent chain (edit -> record -> next edit).
    if (previousRecord !== null && !isAncestorOf(repo, previousRecord, event.previous_commit)) {
      failures.push(
        tag + ': the previous edit was recorded in ' + previousRecord.slice(0, 10) +
        ', which is not an ancestor of this edit\'s previous_commit; the record must precede the next edit'
      );
    }
    if (index === 0 && !isAncestorOf(repo, anchor, event.previous_commit)) {
      failures.push(
        tag + ': previous_commit is not a descendant of the commit that introduced the destination (' + anchor.slice(0, 10) + ')'
      );
    }

    const record = findRecordCommit(repo, event, edit, tag, failures);
    if (record === null) continue;

    const recordParents = commitParents(repo, record);
    if (recordParents === null) {
      failures.push(tag + ': the record commit\'s parents could not be read');
      continue;
    }
    if (recordParents.length !== 1) {
      failures.push(tag + ': the record commit has ' + recordParents.length + ' parents; it must be a single-parent commit');
      continue;
    }
    const recordChanges = commitChanges(repo, record);
    if (recordChanges === null) {
      failures.push(tag + ': the record commit\'s changed paths could not be read');
      continue;
    }
    if (recordChanges.length !== 1 || recordChanges[0].status !== 'M' ||
        recordChanges[0].paths.length !== 1 || recordChanges[0].paths[0] !== MANIFEST_REL) {
      failures.push(
        tag + ': the record commit must change exactly ' + MANIFEST_REL + ' (one M record, nothing else); it changed ' +
        (recordChanges.length === 0 ? 'nothing' : recordChanges.map((change) => change.description).join(', '))
      );
      continue;
    }

    const beforeRecord = readManifestAt(repo, recordParents[0]);
    if (!beforeRecord.ok) {
      failures.push(tag + ': the manifest immediately before the record commit ' + beforeRecord.reason);
    } else if (findEvent(beforeRecord.batches, event.id) !== null) {
      failures.push(tag + ': the manifest already contained edit ' + event.id + ' before its record commit');
    }

    const recorded = readManifestAt(repo, record);
    if (!recorded.ok) {
      failures.push(tag + ': the manifest at the record commit ' + recorded.reason);
    } else {
      const atRecord = findEvent(recorded.batches, event.id);
      if (atRecord === null) {
        failures.push(tag + ': the record commit does not contain edit ' + event.id);
      } else if (canonicalJson(atRecord) !== canonicalJson(event)) {
        failures.push(tag + ': the event recorded at ' + record.slice(0, 10) + ' differs from the event being verified');
      }
    }

    const laterTouches = commitList(repo, ['--full-history', record + '..HEAD', '--', MANIFEST_REL]);
    if (laterTouches === null) {
      failures.push(
        tag + ': the manifest history after its record commit could not be listed, ' +
        'so a later modification or deletion of the event cannot be ruled out'
      );
      continue;
    }
    for (const later of laterTouches) {
      const state = readManifestAt(repo, later);
      if (!state.ok) {
        failures.push(tag + ': the manifest at ' + later.slice(0, 10) + ' ' + state.reason);
        continue;
      }
      const laterEvent = findEvent(state.batches, event.id);
      if (laterEvent === null) {
        failures.push(tag + ': edit ' + event.id + ' is absent from the manifest at ' + later.slice(0, 10) + ', which touched the manifest later');
      } else if (canonicalJson(laterEvent) !== canonicalJson(event)) {
        failures.push(tag + ': edit ' + event.id + ' was modified at ' + later.slice(0, 10) + ' after its record commit');
      }
    }

    const atHead = readManifestAt(repo, 'HEAD');
    if (!atHead.ok) {
      failures.push(tag + ': the committed manifest at HEAD ' + atHead.reason);
    } else {
      const headEvent = findEvent(atHead.batches, event.id);
      if (headEvent === null) {
        failures.push(tag + ': edit ' + event.id + ' is absent from the committed manifest at HEAD');
      } else if (canonicalJson(headEvent) !== canonicalJson(event)) {
        failures.push(tag + ': edit ' + event.id + ' in the committed manifest at HEAD differs from the event being verified');
      }
    }

    lines.push(
      'recorded edit ' + event.id + ': ' + module.destination + ' ' +
      String(event.previous_blob).slice(0, 10) + ' -> ' + String(event.new_blob).slice(0, 10) +
      ' (edit ' + edit.slice(0, 10) + ', recorded in ' + record.slice(0, 10) + ')'
    );
    previousBlob = event.new_blob;
    previousRecord = record;
    verified += 1;
  }

  const last = ordered[ordered.length - 1];
  const headEntry = regularFileAt(repo, 'HEAD', module.destination);
  if (headEntry.ok && headEntry.oid !== last.new_blob) {
    failures.push(
      label + ': the last recorded edit\'s new_blob ' + last.new_blob +
      ' is not the destination blob at HEAD (' + headEntry.oid + ')'
    );
  }
  return verified;
}

/**
 * A comparable identity for the fixture's tree entry at one revision.
 *
 * The entry is compared, not decoded text: a regular file is (mode, object id),
 * so a mode change is a change; an absent path is its own identity, so it never
 * compares equal to an empty file; and any other entry (symlink, tree, gitlink)
 * is named by kind, mode and object id. An entry that could not be read at all
 * is `readable: false`, which the caller turns into a failure - never a
 * comparison and never "absent".
 */
function entryState(entry) {
  if (entry.ok) return { readable: true, identity: 'file ' + entry.mode + ' ' + entry.oid };
  if (entry.reason === 'missing') return { readable: true, identity: 'absent' };
  if (entry.reason === 'unreadable') return { readable: false, identity: null };
  return {
    readable: true,
    identity: entry.reason +
      (entry.mode ? ' ' + entry.mode : '') +
      (entry.oid ? ' ' + entry.oid : ''),
  };
}

/**
 * Every merge in the fixture's history must preserve the capture, once it
 * exists.
 *
 * The non-merge scans count introductions and are blind to merges on purpose,
 * so an ordinary PR merge carrying a valid capture stays one introduction. That
 * blindness is also a hole, and not only for a third state: a merge can resolve
 * the fixture to ABSENT - the state of a parent branched from the pre-capture
 * baseline - deleting the captured fixture, and a later merge can put the
 * captured bytes back, leaving the touch count at one and the capture-to-HEAD
 * diff clean. Comparing a merge result against "whichever parent it matches"
 * cannot see that, because the absent parent is a legitimate comparable state.
 *
 * Every merge in the fixture's full history since the baseline is therefore
 * inspected directly, and the rule is relative to the CAPTURE, established by
 * commit ancestry (never subject text, timestamps or log order):
 *   * a merge that does not have the capture in its ancestry predates the
 *     capture; the fixture cannot exist without it (the capture is the only
 *     add in the range), so it may keep a parent's state - which is absent;
 *   * a merge that HAS the capture in its ancestry must resolve the fixture to
 *     the captured entry (mode and object id). It may keep the capture or carry
 *     it into another branch, but it may never delete it or change it to any
 *     other identity - even when one parent lacks it.
 * Each merge is judged on its own, so a later restoration cannot erase an
 * earlier unauthorized result.
 *
 * Fail-closed: an enumeration error, an unreadable parent, an unreadable entry,
 * an ancestry that cannot be established, or a commit listed as a merge with
 * fewer than two parents is a failure, never an empty merge list or a silent
 * comparison.
 */
function verifyFixtureMerges(repo, batchId, fixturePath, baseline, capture, failures) {
  const label = 'batch ' + batchId + ': characterization fixture ' + fixturePath;
  const merges = commitList(repo, ['--full-history', '--merges', baseline + '..HEAD', '--', fixturePath]);
  if (merges === null) {
    failures.push(
      label + ': the merge commits touching it since the baseline could not be listed, ' +
      'so an unauthorized merge fixture state cannot be ruled out'
    );
    return false;
  }

  const capturedEntry = regularFileAt(repo, capture, fixturePath);
  const capturedIdentity = capturedEntry.ok ? entryState(capturedEntry).identity : null;
  if (capturedIdentity === null) {
    failures.push(
      label + ': the characterization fixture ' + describeEntryAt('its capture commit ' + capture, capturedEntry) +
      ', so no captured entry can be required of the merges after it'
    );
    return false;
  }

  let proven = true;
  for (const merge of merges) {
    const parents = commitParents(repo, merge);
    if (parents === null) {
      failures.push(label + ': the parents of merge commit ' + merge.slice(0, 10) + ' could not be read');
      proven = false;
      continue;
    }
    if (parents.length < 2) {
      failures.push(
        label + ': commit ' + merge.slice(0, 10) + ' is listed as a merge but has ' +
        parents.length + ' parent(s), so its fixture state cannot be judged'
      );
      proven = false;
      continue;
    }

    const resultState = entryState(regularFileAt(repo, merge, fixturePath));
    if (!resultState.readable) {
      failures.push(label + ': its entry at merge commit ' + merge.slice(0, 10) + ' could not be read');
      proven = false;
      continue;
    }

    const ancestry = commitAncestry(repo, capture, merge);
    if (ancestry === null) {
      failures.push(
        label + ': whether the capture commit ' + capture.slice(0, 10) + ' is in the history of merge commit ' +
        merge.slice(0, 10) + ' could not be established'
      );
      proven = false;
      continue;
    }

    if (ancestry === 'ancestor') {
      if (resultState.identity !== capturedIdentity) {
        failures.push(
          label + ': merge commit ' + merge.slice(0, 10) + ' ' +
          (resultState.identity === 'absent'
            ? 'deleted the characterization fixture after its capture commit ' + capture.slice(0, 10) +
              ' (it is absent at the merge result although the captured entry is in its ancestry)'
            : 'resolved the characterization fixture to ' + resultState.identity + ' after its capture commit ' +
              capture.slice(0, 10) + ' (the captured entry is ' + capturedIdentity + ')') +
          '; a merge may keep or carry the captured entry but never delete or change it, and a later merge ' +
          'that restores the captured bytes does not undo this'
        );
        proven = false;
      }
      continue;
    }

    let matched = false;
    let unreadableParent = null;
    for (const parent of parents) {
      const parentState = entryState(regularFileAt(repo, parent, fixturePath));
      if (!parentState.readable) {
        unreadableParent = parent;
        break;
      }
      if (parentState.identity === resultState.identity) matched = true;
    }
    if (unreadableParent !== null) {
      failures.push(
        label + ': its entry at parent ' + unreadableParent.slice(0, 10) +
        ' of merge commit ' + merge.slice(0, 10) + ' could not be read'
      );
      proven = false;
      continue;
    }
    if (!matched) {
      failures.push(
        label + ': merge commit ' + merge.slice(0, 10) +
        ' introduced a fixture state that matches neither parent (' + resultState.identity + '); ' +
        'a merge may keep one parent\'s fixture state but never modify it, and a later merge that ' +
        'restores the captured bytes does not undo this'
      );
      proven = false;
    }
  }
  return proven;
}

/**
 * L2, for one batch: the fixture predates the move and was not regenerated.
 *
 * The fixture cannot prove its own honesty, so the proof is in Git history, and
 * the fixture is read from HEAD rather than the working tree - a dirty or
 * edited file must not stand in for the committed evidence:
 *   * the committed fixture is a regular file at HEAD and parses;
 *   * it names the manifest baseline and the declared capture command;
 *   * EXACTLY ONE commit touched it since the baseline - its capture - carrying
 *     the declared subject. The manifest's `expect_touch_commits` is held to 1
 *     as well: counting commits alone is not the invariant, because a fixture
 *     modified and then restored in two later commits still ends up identical
 *     to its capture and would satisfy "N touches, one add, unchanged at HEAD";
 *   * the commit that ADDED it is the only one, and its parent is the baseline,
 *     so the capture was committed before anything moved;
 *   * that commit changes NOTHING except the fixture and any declared
 *     `capture_paths`; each declared path must have been absent at the baseline
 *     (nothing to alter) and be a regular file at the capture commit;
 *   * every merge commit in its full history since the baseline either has no
 *     fixture before the capture, or resolves the fixture to the captured entry
 *     (see verifyFixtureMerges), so a merge cannot delete or modify the fixture
 *     after the capture - by selecting an absent parent or inventing a state
 *     matching neither parent - even when a later merge restores the captured
 *     bytes;
 *   * the fixture has not changed since.
 */
function verifyCharacterization(repo, batch, lines, failures) {
  const record = batch.characterization;
  const label = batch.id;
  const fixtureLabel = 'characterization fixture ' + record.fixture;
  const capturePaths = record.capture_paths || [];

  const atHead = regularFileAt(repo, 'HEAD', record.fixture);
  if (!atHead.ok) {
    failures.push('batch ' + label + ': ' + fixtureLabel + ' ' + describeEntryAt('HEAD', atHead));
    return;
  }
  const committed = tryGit(repo, ['show', 'HEAD:' + record.fixture]);
  if (!committed.ok) {
    failures.push('batch ' + label + ': ' + fixtureLabel + ' could not be read at HEAD');
    return;
  }
  let fixture;
  try {
    fixture = JSON.parse(committed.out);
  } catch (err) {
    failures.push('batch ' + label + ': ' + fixtureLabel + ' is not valid JSON at HEAD: ' + err.message);
    return;
  }

  lines.push('characterization fixture: ' + record.fixture + ' (read from HEAD)');

  const provenance = fixture && typeof fixture === 'object' ? fixture.provenance : null;
  if (provenance === null || typeof provenance !== 'object') {
    failures.push('batch ' + label + ': the fixture has no provenance block to compare with the manifest');
    return;
  }
  if (provenance.baseline_sha !== batch.baseline_sha) {
    failures.push(
      'batch ' + label + ': the fixture names baseline ' + String(provenance.baseline_sha) +
      ' but the manifest baseline is ' + batch.baseline_sha
    );
  }
  if (provenance.command !== record.capture_command) {
    failures.push(
      'batch ' + label + ': the fixture was produced by ' + JSON.stringify(provenance.command) +
      ', not the declared ' + JSON.stringify(record.capture_command)
    );
  }

  // Introduction-once-then-immutable. Held here as well as in the manifest
  // validator, so a caller that builds a batch object directly cannot ask for
  // the weaker "N touches" rule either.
  if (record.expect_touch_commits !== 1) {
    failures.push(
      'batch ' + label + ': characterization.expect_touch_commits declares ' +
      String(record.expect_touch_commits) + '; the fixture is introduced once and must stay immutable, ' +
      'so exactly 1 is the only supported value'
    );
  }

  const touching = tryGit(repo, ['log', '--full-history', '--no-merges', '--format=%H\t%s', batch.baseline_sha + '..HEAD', '--', record.fixture]);
  if (!touching.ok) {
    failures.push(
      'batch ' + label + ': the history of the fixture since the baseline could not be read, ' +
      'so its origin is unproven'
    );
    return;
  }
  const touches = touching.out.split('\n').filter(Boolean);
  lines.push('commits touching the fixture since baseline: ' + touches.length + ' (must be exactly 1)');
  for (const line of touches) lines.push('  ' + line.replace('\t', ' '));
  if (touches.length !== 1) {
    failures.push(
      'batch ' + label + ': the fixture was touched by ' + touches.length + ' commits since the baseline ' +
      batch.baseline_sha + '; it must be introduced ONCE and never modified, renamed, deleted or replaced ' +
      'afterwards, so a later commit is a failure even when it restores the captured bytes'
    );
  }
  for (const line of touches) {
    const subject = line.split('\t').slice(1).join(' ');
    if (subject !== record.capture_commit_subject) {
      failures.push(
        'batch ' + label + ': a commit touching the fixture is not the pre-move capture (' +
        JSON.stringify(subject) + ' != ' + JSON.stringify(record.capture_commit_subject) + ')'
      );
    }
  }

  const added = tryGit(repo, ['log', '--full-history', '--no-merges', '--diff-filter=A', '--format=%H', batch.baseline_sha + '..HEAD', '--', record.fixture]);
  if (!added.ok) {
    failures.push(
      'batch ' + label + ': the commit that ADDED the fixture could not be resolved, so its origin is unproven'
    );
    return;
  }
  const captures = added.out.split('\n').filter(Boolean);
  if (captures.length !== 1) {
    failures.push('batch ' + label + ': the fixture must be ADDED by exactly one commit after the baseline, found ' + captures.length);
    return;
  }
  const capture = captures[0];

  // The single touch must BE that add. Two different commits here would mean the
  // fixture's history is not one introduction, and the origin would be ambiguous.
  if (touches.length === 1 && touches[0].split('\t')[0] !== capture) {
    failures.push(
      'batch ' + label + ': the only commit touching the fixture is ' + touches[0].split('\t')[0].slice(0, 10) +
      ' but the commit that added it is ' + capture.slice(0, 10) + ', so the origin is ambiguous'
    );
  }

  const changes = commitChanges(repo, capture);
  if (changes === null) {
    failures.push('batch ' + label + ': the changed paths of the capture commit ' + capture + ' could not be read');
  } else {
    const allowed = new Set([record.fixture, ...capturePaths]);
    const unexpected = changes.filter((change) => change.status !== 'A' || !allowed.has(change.paths[0]));
    if (changes.length === 0) {
      failures.push('batch ' + label + ': the capture commit ' + capture + ' changes no path, so it cannot be the fixture capture');
    } else if (unexpected.length > 0) {
      failures.push(
        'batch ' + label + ': the capture commit ' + capture +
        ' changes paths other than the fixture and its declared capture paths: ' +
        unexpected.map((change) => change.description).join(', ')
      );
    } else {
      lines.push('capture commit changes only declared paths: ' + changes.map((change) => change.description).join(', '));
    }

    for (const capturePath of capturePaths) {
      if (regularFileAt(repo, batch.baseline_sha, capturePath).reason !== 'missing') {
        failures.push(
          'batch ' + label + ': capture path ' + capturePath + ' already exists at the baseline ' +
          batch.baseline_sha + ', so it cannot have been introduced by the capture commit'
        );
      }
      const atCapture = regularFileAt(repo, capture, capturePath);
      if (!atCapture.ok) {
        failures.push(
          'batch ' + label + ': capture path ' + capturePath + ' ' +
          describeEntryAt('the capture commit ' + capture, atCapture)
        );
      }
    }
  }

  const parent = tryGit(repo, ['rev-parse', capture + '^']);
  const capturedBeforeTheMove = parent.ok && parent.out === batch.baseline_sha;
  if (!capturedBeforeTheMove) {
    failures.push(
      'batch ' + label + ': the fixture capture commit ' + capture.slice(0, 10) +
      ' is not a child of the baseline ' + batch.baseline_sha +
      ', so it was not captured before the move'
    );
  }

  // Merges are excluded from the touch count so an ordinary PR merge carrying
  // the capture is still one introduction. They are judged separately instead,
  // against the capture: once the capture is in a merge's ancestry, the merge
  // result must be the captured entry. That rejects both a merge-introduced
  // third state and a merge that selects an absent parent to delete the
  // fixture, even when a later merge restores the captured bytes.
  const mergesProven = verifyFixtureMerges(repo, label, record.fixture, batch.baseline_sha, capture, failures);
  lines.push(
    'fixture merge history: ' +
    (mergesProven ? 'every merge kept or carried the captured fixture entry' : '**NOT PROVEN** (see the failure list)')
  );

  const unchanged = tryGit(repo, ['diff', '--quiet', capture, 'HEAD', '--', record.fixture]);
  if (!unchanged.ok) {
    failures.push('batch ' + label + ': the fixture changed after its capture commit ' + capture.slice(0, 10) + ' - it was regenerated');
  }

  lines.push('fixture captured before the move: ' + (capturedBeforeTheMove ? 'yes' : '**NO**'));
  lines.push('fixture unchanged since its capture commit: ' + (unchanged.ok ? 'yes' : '**NO**'));
}

/** Verify one batch's baseline, fixture origin and every declared move. */
function verifyBatch(repo, batch, failures) {
  const lines = [''];
  lines.push('## batch ' + batch.id);
  if (batch.description) lines.push(batch.description);
  lines.push('baseline: ' + batch.baseline_sha);

  if (!resolveCommit(repo, batch.baseline_sha).ok) {
    failures.push('batch ' + batch.id + ': the baseline ' + batch.baseline_sha + ' does not exist in this repository');
    return { lines, identical: 0 };
  }
  if (!isAncestor(repo, batch.baseline_sha)) {
    failures.push('batch ' + batch.id + ': the baseline ' + batch.baseline_sha + ' is not an ancestor of HEAD');
    return { lines, identical: 0 };
  }

  const date = tryGit(repo, ['log', '-1', '--format=%cI', batch.baseline_sha]);
  lines.push('baseline is an ancestor of HEAD: yes' + (date.ok ? ' (' + date.out + ')' : ''));
  lines.push('identity policy: ' + batch.identity_policy);

  if (batch.characterization) {
    verifyCharacterization(repo, batch, lines, failures);
  } else {
    lines.push('characterization: none declared for this batch (L3 blob identity only)');
  }

  lines.push('');
  lines.push('| Declared move | baseline entry | HEAD entry | identical |');
  lines.push('|---|---|---|---|');

  const editsByDestination = new Map();
  for (const event of batch.edits || []) {
    const list = editsByDestination.get(event.destination) || [];
    list.push(event);
    editsByDestination.set(event.destination, list);
  }

  const historyLines = [];
  let identical = 0;
  let recordedEdits = 0;
  let historyProven = true;

  for (const module of batch.modules) {
    const events = editsByDestination.get(module.destination) || [];
    const isRecorded = events.length > 0;
    const before = regularFileAt(repo, batch.baseline_sha, module.source);
    const after = regularFileAt(repo, 'HEAD', module.destination);
    if (!before.ok) failures.push(rejection(batch.id, 'source', module.source, 'baseline ' + batch.baseline_sha, before));
    if (!after.ok) failures.push(rejection(batch.id, 'destination', module.destination, 'HEAD', after));

    const same = before.ok && after.ok && before.oid === after.oid;
    if (before.ok && after.ok && !same && !isRecorded) {
      failures.push(
        'batch ' + batch.id + ': blob differs for ' + module.destination +
        ' - the file was rewritten, not moved, and no edit is recorded for it'
      );
    }
    if (same) identical += 1;

    lines.push(
      '| `' + module.source + '` -> `' + module.destination + '` | ' +
      renderEntry(before) + ' | ' + renderEntry(after) + ' | ' +
      (same ? 'yes' : isRecorded ? 'edited (recorded)' : '**NO**') + ' |'
    );

    if (before.ok) {
      const verified = verifyDestinationHistory(repo, batch, module, events, before.oid, historyLines, failures);
      if (verified < 0) historyProven = false;
      else recordedEdits += verified;
    } else {
      historyProven = false;
    }
  }

  lines.push('');
  for (const historyLine of historyLines) lines.push(historyLine);
  lines.push(
    'destination history since baseline: ' +
    (historyProven
      ? 'each destination introduced exactly once' + (recordedEdits > 0 ? ', ' + recordedEdits + ' recorded edit(s)' : '')
      : '**FAILED** (see the failure list)')
  );

  lines.push('');
  lines.push(
    "blob-identical in '" + batch.id + "': " + identical + ' / ' + batch.modules.length +
    (recordedEdits > 0 ? ' (+ ' + recordedEdits + ' recorded edit(s))' : '')
  );

  return { lines, identical, recordedEdits, historyProven };
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.errors.length > 0) {
    process.stderr.write('verify-pr2-provenance: ' + options.errors.join('\n  ') + '\n' + USAGE + '\n');
    return 2;
  }

  if (!isGitRepository(options.repo)) {
    process.stderr.write('verify-pr2-provenance: FAIL\n  - ' + options.repo + ' is not a git repository\n');
    return 1;
  }

  const file = options.manifest || manifestFile(options.repo);
  const loaded = loadManifest(file);
  process.stdout.write('manifest: ' + displayPath(file) + '\n');

  if (loaded.errors.length > 0) {
    process.stderr.write('verify-pr2-provenance: FAIL\n');
    for (const error of loaded.errors) process.stderr.write('  - ' + error + '\n');
    return 1;
  }

  const failures = [];
  const characterized = [];
  let declared = 0;
  let identical = 0;
  let edits = 0;
  let historyProven = true;

  // Validation already rejects duplicate moves and shared destinations, so a
  // normalised manifest gives each move exactly one visit here.
  for (const batch of loaded.batches) {
    const result = verifyBatch(options.repo, batch, failures);
    for (const line of result.lines) process.stdout.write(line + '\n');
    declared += batch.modules.length;
    identical += result.identical;
    edits += result.recordedEdits;
    if (!result.historyProven) historyProven = false;
    if (batch.characterization) characterized.push(batch.id);
  }

  process.stdout.write(
    '\nmoves checked: ' + declared + ' declared in ' + loaded.batches.length + ' batch(es), each exactly once\n' +
    'blob-identical: ' + identical + ' / ' + declared + '\n' +
    (edits > 0 ? 'recorded edits verified: ' + edits + '\n' : '') +
    'destination history: ' + (historyProven ? 'proven for every destination' : '**NOT PROVEN** (see failures)') + '\n' +
    'characterization verified for: ' + (characterized.length > 0 ? characterized.join(', ') : 'no batch') + '\n'
  );

  if (failures.length > 0) {
    process.stderr.write('\nverify-pr2-provenance: FAIL\n');
    for (const failure of failures) process.stderr.write('  - ' + failure + '\n');
    return 1;
  }

  process.stdout.write(
    'verify-pr2-provenance: PASS - ' + declared + ' declared move(s) across ' + loaded.batches.length +
    ' batch(es); ' + identical + ' blob-identical; ' +
    (edits > 0 ? edits + ' recorded edit(s) verified; ' : '') +
    (characterized.length > 0 ? characterized.length + ' fixture origin(s) verified' : 'no fixture origin declared') + '\n'
  );
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

// Exported for inspection and for the regression suite: requiring this file must
// not run the gate.
module.exports = {
  canonicalJson,
  parseArgs,
  rejection,
  renderEntry,
  verifyBatch,
  verifyCharacterization,
  verifyDestinationHistory,
  verifyFixtureMerges,
};
