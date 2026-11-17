'use strict';

/**
 * scripts/lib/extraction-manifest.js - reading and validating the committed
 * extraction manifest (extraction-manifest.json).
 *
 * Why a manifest
 *   The step 4B PR 2 evidence (L2 fixture origin, L3 byte-identical moves) used
 *   to be an array literal inside scripts/verify-pr2-provenance.js. That made the
 *   evidence true for exactly one PR, unreachable for the next one, and
 *   impossible for a reviewer to compare with the tree. The manifest is the
 *   versioned record instead: one BATCH per extraction PR, each with its own
 *   immutable baseline commit, its source -> destination pairs and the identity
 *   policy those pairs must satisfy. Adding a batch is appending an object;
 *   PR 2's baseline is never re-derived from the working tree and never
 *   rewritten by a later PR.
 *
 * Schema (version 1):
 *   {
 *     "kind": "extraction-manifest",
 *     "version": 1,
 *     "batches": [
 *       {
 *         "id": "step-4b-pr2",                    // kebab-case, unique
 *         "description": "...",                   // optional
 *         "baseline_sha": "<40 lowercase hex>",   // the commit the code moved FROM
 *         "identity_policy": "byte-identical",    // the only implemented policy
 *         "characterization": {                   // optional; absent/null = L3 only
 *           "fixture": "<repo-relative path>",
 *           "capture_command": "<command that produced it>",
 *           "capture_commit_subject": "<subject of the capture commit>",
 *           "expect_touch_commits": 1,             // exactly 1; see below
 *           "capture_paths": ["<path>"]           // optional; files the capture commit may ADD
 *         },
 *         "modules": [{ "source": "<path at baseline>", "destination": "<path at HEAD>" }]
 *       }
 *     ]
 *   }
 *
 * How future batches extend it
 *   Append a batch with its own id, baseline and identity policy. A batch that
 *   captures a behaviour fixture names that fixture in `characterization`, so the
 *   PR 2 fixture is never treated as a universal baseline: a batch without the
 *   block is held to L3 only, explicitly. Declaring a policy other than
 *   IDENTITY_POLICY fails closed instead of passing unverified.
 *
 * `expect_touch_commits` is held to EXACTLY 1, and that is the invariant rather
 * than a tunable: the fixture is captured once and must stay immutable
 * afterwards. A larger value used to be accepted, and it allowed a real hole -
 * a fixture modified and then restored in two later commits produces three
 * "touches" with the capture's subject, and a restored blob makes the
 * "unchanged since capture" diff clean. Counting commits cannot distinguish
 * that from an honest capture, so the record may not ask for the weaker rule.
 * The field stays in the schema because it states the expectation explicitly;
 * any value other than 1 fails closed.
 *
 * `capture_paths` exists because a capture commit sometimes introduces its own
 * tool: PR 2's `581ee73` added `scripts/characterize-pr2.js` beside the fixture.
 * A fixture-only rule would reject that real evidence, and relaxing the rule
 * without saying so would hide a capture commit that edits implementation code.
 * The field is the explicit alternative: any extra path the capture commit may
 * add is declared, and the verifier proves each one was ABSENT at the baseline
 * (so it has no baseline identity to alter) and is a regular file at the capture
 * commit. Omitted means "the fixture is the only changed path".
 *
 * What is deliberately NOT here
 *   No schema framework, no per-module policy override and no inherited default:
 *   a normalised batch always carries its own policy and every normalised module
 *   already has both paths, so callers read those facts instead of re-checking
 *   them. Validation is the only place a shape is decided.
 *
 * Fail-closed
 *   Every violation is collected and returned, never thrown: a caller needs the
 *   complete list to fix the record in one pass, and a caller that receives any
 *   error must abort rather than verify a partial manifest.
 *
 * DB-free, dependency-free, read-only.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_REL = 'extraction-manifest.json';
const MANIFEST_KIND = 'extraction-manifest';
const MANIFEST_VERSION = 1;

/**
 * The only identity policy implemented: the destination blob equals the source
 * blob at the baseline. A batch declaring anything else is rejected here rather
 * than silently verified as something it is not.
 */
const IDENTITY_POLICY = 'byte-identical';

const BATCH_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

/** Absolute path of the manifest inside a repository checkout. */
function manifestFile(repo = REPO_ROOT) {
  return path.join(repo, MANIFEST_REL);
}

/**
 * A path a Git object can be named by: relative, POSIX separators, no drive
 * letter, no empty/dot/dot-dot segment and no trailing slash. Absolute paths and
 * `..` escapes are refused because they would make `rev:path` name something
 * outside the repository.
 */
function isRepoRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('\\') || value.startsWith('/') || value.endsWith('/')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function validateCharacterization(raw, label, errors) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(label + ': characterization must be an object or null');
    return null;
  }
  const errorsBefore = errors.length;
  if (!isRepoRelativePath(raw.fixture)) {
    errors.push(label + ': characterization.fixture must be a repo-relative POSIX path (found ' + JSON.stringify(raw.fixture) + ')');
  }
  for (const key of ['capture_command', 'capture_commit_subject']) {
    if (typeof raw[key] !== 'string' || raw[key].length === 0) {
      errors.push(label + ': characterization.' + key + ' must be a non-empty string');
    }
  }
  if (raw.expect_touch_commits !== 1) {
    errors.push(
      label + ': characterization.expect_touch_commits must be exactly 1 (found ' +
      JSON.stringify(raw.expect_touch_commits) + '); the fixture is introduced once and must never be ' +
      'modified, renamed, deleted or replaced afterwards'
    );
  }
  const capturePaths = raw.capture_paths === undefined ? [] : raw.capture_paths;
  if (!Array.isArray(capturePaths)) {
    errors.push(label + ': characterization.capture_paths must be an array of repo-relative paths');
  } else {
    capturePaths.forEach((capturePath, index) => {
      if (!isRepoRelativePath(capturePath)) {
        errors.push(label + ': characterization.capture_paths[' + index + '] must be a repo-relative POSIX path (found ' + JSON.stringify(capturePath) + ')');
      } else if (capturePath === raw.fixture) {
        errors.push(label + ': characterization.capture_paths[' + index + '] names the fixture itself');
      } else if (capturePaths.indexOf(capturePath) !== index) {
        errors.push(label + ': characterization.capture_paths[' + index + '] repeats ' + capturePath);
      }
    });
  }
  if (errors.length > errorsBefore) return null;
  return {
    fixture: raw.fixture,
    capture_command: raw.capture_command,
    capture_commit_subject: raw.capture_commit_subject,
    expect_touch_commits: raw.expect_touch_commits,
    capture_paths: Array.isArray(capturePaths) ? capturePaths : [],
  };
}

/**
 * Validate a parsed manifest document. Returns the normalised batches and every
 * error found; a normalised module is { source, destination } and a normalised
 * batch always carries `identity_policy`, `characterization` (null when
 * undeclared) and `modules`.
 */
function validateManifest(document) {
  const errors = [];
  const batches = [];

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return { batches, errors: ['manifest: expected a JSON object'] };
  }
  if (document.kind !== MANIFEST_KIND) {
    errors.push('manifest: kind must be ' + JSON.stringify(MANIFEST_KIND) + ' (found ' + JSON.stringify(document.kind) + ')');
  }
  if (document.version !== MANIFEST_VERSION) {
    errors.push('manifest: version must be ' + MANIFEST_VERSION + ' (found ' + JSON.stringify(document.version) + ')');
  }
  if (!Array.isArray(document.batches) || document.batches.length === 0) {
    errors.push('manifest: batches must be a non-empty array');
    return { batches, errors };
  }

  const batchIds = new Set();
  const pairs = new Map();
  const destinations = new Map();

  document.batches.forEach((raw, index) => {
    const label = 'batch[' + index + ']' +
      (raw && typeof raw === 'object' && typeof raw.id === 'string' ? ' (' + raw.id + ')' : '');
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(label + ': expected an object');
      return;
    }
    const batchRef = typeof raw.id === 'string' ? raw.id : label;

    if (typeof raw.id !== 'string' || !BATCH_ID.test(raw.id)) {
      errors.push(label + ': id must be a kebab-case identifier (found ' + JSON.stringify(raw.id) + ')');
    } else if (batchIds.has(raw.id)) {
      errors.push(label + ': duplicate batch id ' + raw.id);
    } else {
      batchIds.add(raw.id);
    }

    if (typeof raw.baseline_sha !== 'string' || !COMMIT_SHA.test(raw.baseline_sha)) {
      errors.push(
        label + ': baseline_sha must be a full 40-character lowercase commit SHA (found ' +
        JSON.stringify(raw.baseline_sha) + ')'
      );
    }
    if (raw.identity_policy !== IDENTITY_POLICY) {
      errors.push(
        label + ': identity_policy must be ' + JSON.stringify(IDENTITY_POLICY) +
        ', the only implemented policy (found ' + JSON.stringify(raw.identity_policy) + ')'
      );
    }

    const characterization = validateCharacterization(raw.characterization, label, errors);
    const modules = [];

    if (!Array.isArray(raw.modules) || raw.modules.length === 0) {
      errors.push(label + ': modules must be a non-empty array');
    } else {
      raw.modules.forEach((module, moduleIndex) => {
        const moduleLabel = label + '.modules[' + moduleIndex + ']';
        if (module === null || typeof module !== 'object' || Array.isArray(module)) {
          errors.push(moduleLabel + ': expected an object');
          return;
        }
        if (!isRepoRelativePath(module.source)) {
          errors.push(moduleLabel + ': source must be a repo-relative POSIX path (found ' + JSON.stringify(module.source) + ')');
          return;
        }
        if (!isRepoRelativePath(module.destination)) {
          errors.push(moduleLabel + ': destination must be a repo-relative POSIX path (found ' + JSON.stringify(module.destination) + ')');
          return;
        }
        if (module.source === module.destination) {
          errors.push(moduleLabel + ': source and destination are the same path (' + module.source + '), so there is no move');
          return;
        }

        const pairKey = module.source + ' -> ' + module.destination;
        if (pairs.has(pairKey)) {
          errors.push(moduleLabel + ': duplicate move ' + pairKey + ' (already declared by ' + pairs.get(pairKey) + ')');
        } else {
          pairs.set(pairKey, batchRef);
        }
        if (destinations.has(module.destination)) {
          errors.push(moduleLabel + ': destination ' + module.destination + ' is already a destination in batch ' + destinations.get(module.destination));
        } else {
          destinations.set(module.destination, batchRef);
        }

        modules.push({ source: module.source, destination: module.destination });
      });
    }

    batches.push({
      id: typeof raw.id === 'string' ? raw.id : null,
      description: raw.description === undefined ? null : raw.description,
      baseline_sha: typeof raw.baseline_sha === 'string' ? raw.baseline_sha : null,
      identity_policy: raw.identity_policy,
      characterization,
      modules,
    });
  });

  return { batches, errors };
}

/**
 * Read and validate a manifest. A read error or invalid JSON is returned as a
 * single error (document null), never thrown, so a CLI can print a FAIL instead
 * of a stack trace.
 */
function loadManifest(file = manifestFile()) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { document: null, batches: [], errors: ['manifest: cannot read ' + file + ' (' + (err.code || err.message) + ')'] };
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    return { document: null, batches: [], errors: ['manifest: ' + file + ' is not valid JSON: ' + err.message] };
  }
  const { batches, errors } = validateManifest(document);
  return { document, batches, errors };
}

// ---------------------------------------------------------------------------
// Git helpers. A missing object is an expected FAIL of the gate, so every helper
// answers { ok: false } instead of throwing.
// ---------------------------------------------------------------------------

function tryGit(repo, args) {
  try {
    const out = execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.replace(/\s+$/, '') };
  } catch (_err) {
    return { ok: false, out: '' };
  }
}

function isGitRepository(repo) {
  return tryGit(repo, ['rev-parse', '--git-dir']).ok;
}

/** Resolve a reference to a full commit SHA. */
function resolveCommit(repo, ref) {
  // A leading '-' would be parsed by Git as an option, not a revision.
  if (typeof ref !== 'string' || ref.length === 0 || ref.startsWith('-')) {
    return { ok: false, sha: null };
  }
  const result = tryGit(repo, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
  if (!result.ok || !COMMIT_SHA.test(result.out)) return { ok: false, sha: null };
  return { ok: true, sha: result.out };
}

/** Is `sha` an ancestor of HEAD? */
function isAncestor(repo, sha) {
  return tryGit(repo, ['merge-base', '--is-ancestor', sha, 'HEAD']).ok;
}

/**
 * Classify a manifest path at a revision.
 *
 * `rev:path` resolves to ANY object, so object-id equality alone would accept a
 * directory (tree), a gitlink (commit) or a symlink (blob, mode 120000) as a
 * "byte-identical file move": two trees compare equal, and a symlink shares its
 * blob with any regular file whose bytes happen to be the link target. The tree
 * ENTRY is the only place that difference is visible, so the entry - mode, type
 * and oid - is what this reads.
 *
 * One `ls-tree -z` call per path, for three reasons: it reports the mode that
 * distinguishes a link from a file, `-z` emits the path unquoted (so an exact
 * comparison is meaningful), and a NUL-terminated record set needs no line
 * parsing. When the pathspec names a directory, some Git versions print the tree
 * entry and others its children; both are detected below and neither is accepted.
 * No link is ever followed: the object is read from the tree, not the filesystem.
 *
 * Accepted: regular files 100644 and 100755. Everything else is { ok: false }
 * with a reason the caller turns into a message naming the side and revision.
 */
function regularFileAt(repo, rev, filePath) {
  const listing = tryGit(repo, ['ls-tree', '-z', rev, '--', filePath]);
  if (!listing.ok) return { ok: false, reason: 'unreadable' };

  const entries = [];
  for (const record of listing.out.split('\u0000')) {
    if (record === '') continue;
    const parsed = /^(\d{6}) (\w+) ([0-9a-f]{40})\t([\s\S]*)$/.exec(record);
    if (!parsed) return { ok: false, reason: 'unreadable' };
    entries.push({ mode: parsed[1], type: parsed[2], oid: parsed[3], path: parsed[4] });
  }
  if (entries.length === 0) return { ok: false, reason: 'missing' };

  const entry = entries.find((candidate) => candidate.path === filePath);
  if (!entry) {
    const isDirectory = entries.some((candidate) => candidate.path.startsWith(filePath + '/'));
    return { ok: false, reason: isDirectory ? 'directory' : 'missing' };
  }
  if (entry.type === 'tree') return { ok: false, reason: 'directory', oid: entry.oid, type: entry.type };
  if (entry.type === 'commit') return { ok: false, reason: 'gitlink', oid: entry.oid, type: entry.type };
  if (entry.mode === '120000') {
    return { ok: false, reason: 'symlink', oid: entry.oid, mode: entry.mode, type: entry.type };
  }
  if (entry.mode === '100644' || entry.mode === '100755') return { ok: true, oid: entry.oid, mode: entry.mode };
  return { ok: false, reason: 'mode', oid: entry.oid, mode: entry.mode, type: entry.type };
}

module.exports = {
  IDENTITY_POLICY,
  MANIFEST_KIND,
  MANIFEST_REL,
  MANIFEST_VERSION,
  REPO_ROOT,
  isAncestor,
  isGitRepository,
  isRepoRelativePath,
  loadManifest,
  manifestFile,
  regularFileAt,
  resolveCommit,
  tryGit,
  validateManifest,
};
