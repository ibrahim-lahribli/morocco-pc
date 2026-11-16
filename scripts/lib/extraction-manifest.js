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
 * Schema (version 1) - required unless marked optional:
 *   {
 *     "kind": "extraction-manifest",
 *     "version": 1,
 *     "identity_policy": "byte-identical",        // optional default for batches
 *     "batches": [
 *       {
 *         "id": "step-4b-pr2",                    // kebab-case, unique
 *         "description": "...",                   // optional
 *         "baseline_sha": "<40 lowercase hex>",   // the commit the code moved FROM
 *         "identity_policy": "byte-identical",    // optional; inherits the default
 *         "characterization": {                   // optional; absent/null = L3 only
 *           "fixture": "<repo-relative path>",
 *           "capture_command": "<command that produced it>",
 *           "capture_commit_subject": "<subject of the capture commit>",
 *           "expect_touch_commits": 1
 *         },
 *         "modules": [
 *           { "source": "<path at baseline>",
 *             "destination": "<path at HEAD>",
 *             "identity_policy": "byte-identical" }   // optional per-module override
 *         ]
 *       }
 *     ]
 *   }
 *
 * How future batches extend it
 *   Append a batch object with its own id and baseline. A batch that captures a
 *   behaviour fixture names that fixture in `characterization`, so the PR 2
 *   fixture is never treated as a universal baseline: a batch without the block
 *   is held to L3 only, explicitly. `identity_policy` is checked against
 *   SUPPORTED_IDENTITY_POLICIES: a batch may declare a policy the checker does
 *   not implement yet, and that FAILS closed instead of passing unverified.
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
const DEFAULT_IDENTITY_POLICY = 'byte-identical';

/**
 * Only blob equality is implemented. A future policy ("identical after comment
 * normalisation", say) is added here AND in the verifier in the same commit;
 * until then declaring it is a hard failure rather than a silent pass.
 */
const SUPPORTED_IDENTITY_POLICIES = Object.freeze([DEFAULT_IDENTITY_POLICY]);

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
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  if (value.endsWith('/')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * A string that can be handed to `git rev-parse` as a reference. Rejects an
 * empty value, a leading `-` (which Git would read as an option) and anything
 * containing whitespace or a control character.
 */
function isRefValue(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return false;
  if (value.startsWith('-')) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\s\u0000-\u001f]/.test(value);
}

function validateCharacterization(raw, label, errors, { defaultPolicy } = {}) {
  void defaultPolicy;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(label + ': characterization must be an object or null');
    return null;
  }
  let valid = true;
  if (!isRepoRelativePath(raw.fixture)) {
    errors.push(label + ': characterization.fixture must be a repo-relative POSIX path (found ' + JSON.stringify(raw.fixture) + ')');
    valid = false;
  }
  for (const key of ['capture_command', 'capture_commit_subject']) {
    if (typeof raw[key] !== 'string' || raw[key].length === 0) {
      errors.push(label + ': characterization.' + key + ' must be a non-empty string');
      valid = false;
    }
  }
  if (!Number.isInteger(raw.expect_touch_commits) || raw.expect_touch_commits < 1) {
    errors.push(label + ': characterization.expect_touch_commits must be a positive integer');
    valid = false;
  }
  if (!valid) return null;
  return {
    fixture: raw.fixture,
    capture_command: raw.capture_command,
    capture_commit_subject: raw.capture_commit_subject,
    expect_touch_commits: raw.expect_touch_commits,
  };
}

/**
 * Validate a parsed manifest document. Returns the normalised batches (defaults
 * applied) and every error found. A normalised batch always carries
 * `identity_policy`, `characterization` (null when undeclared) and `modules`.
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
  const defaultPolicy = document.identity_policy === undefined ? DEFAULT_IDENTITY_POLICY : document.identity_policy;
  if (!SUPPORTED_IDENTITY_POLICIES.includes(defaultPolicy)) {
    errors.push(
      'manifest: unsupported identity_policy ' + JSON.stringify(defaultPolicy) +
      ' (supported: ' + SUPPORTED_IDENTITY_POLICIES.join(', ') + ')'
    );
  }
  if (!Array.isArray(document.batches) || document.batches.length === 0) {
    errors.push('manifest: batches must be a non-empty array');
    return { batches, errors };
  }

  const seenBatchIds = new Set();
  const seenPairs = new Map();
  const seenDestinations = new Map();

  document.batches.forEach((raw, index) => {
    const label = 'batch[' + index + ']' +
      (raw && typeof raw === 'object' && typeof raw.id === 'string' ? ' (' + raw.id + ')' : '');
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(label + ': expected an object');
      return;
    }

    if (typeof raw.id !== 'string' || !BATCH_ID.test(raw.id)) {
      errors.push(label + ': id must be a kebab-case identifier (found ' + JSON.stringify(raw.id) + ')');
    } else if (seenBatchIds.has(raw.id)) {
      errors.push(label + ': duplicate batch id ' + raw.id);
    } else {
      seenBatchIds.add(raw.id);
    }

    if (typeof raw.baseline_sha !== 'string' || !COMMIT_SHA.test(raw.baseline_sha)) {
      errors.push(
        label + ': baseline_sha must be a full 40-character lowercase commit SHA (found ' +
        JSON.stringify(raw.baseline_sha) + ')'
      );
    }

    const policy = raw.identity_policy === undefined ? defaultPolicy : raw.identity_policy;
    if (!SUPPORTED_IDENTITY_POLICIES.includes(policy)) {
      errors.push(
        label + ': unsupported identity_policy ' + JSON.stringify(policy) +
        ' (supported: ' + SUPPORTED_IDENTITY_POLICIES.join(', ') + ')'
      );
    }

    if (raw.description !== undefined && typeof raw.description !== 'string') {
      errors.push(label + ': description must be a string');
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
        let valid = true;
        if (!isRepoRelativePath(module.source)) {
          errors.push(moduleLabel + ': source must be a repo-relative POSIX path (found ' + JSON.stringify(module.source) + ')');
          valid = false;
        }
        if (!isRepoRelativePath(module.destination)) {
          errors.push(moduleLabel + ': destination must be a repo-relative POSIX path (found ' + JSON.stringify(module.destination) + ')');
          valid = false;
        }
        if (valid && module.source === module.destination) {
          errors.push(moduleLabel + ': source and destination are the same path (' + module.source + '), so there is no move');
          valid = false;
        }
        const modulePolicy = module.identity_policy === undefined ? policy : module.identity_policy;
        if (!SUPPORTED_IDENTITY_POLICIES.includes(modulePolicy)) {
          errors.push(
            moduleLabel + ': unsupported identity_policy ' + JSON.stringify(modulePolicy) +
            ' (supported: ' + SUPPORTED_IDENTITY_POLICIES.join(', ') + ')'
          );
          valid = false;
        }
        if (!valid) return;

        const pairKey = module.source + ' -> ' + module.destination;
        if (seenPairs.has(pairKey)) {
          errors.push(moduleLabel + ': duplicate move ' + pairKey + ' (already declared by batch ' + seenPairs.get(pairKey) + ')');
        } else {
          seenPairs.set(pairKey, typeof raw.id === 'string' ? raw.id : label);
        }
        if (seenDestinations.has(module.destination)) {
          errors.push(
            moduleLabel + ': destination ' + module.destination +
            ' is already a destination in batch ' + seenDestinations.get(module.destination)
          );
        } else {
          seenDestinations.set(module.destination, typeof raw.id === 'string' ? raw.id : label);
        }

        modules.push({
          source: module.source,
          destination: module.destination,
          identity_policy: modulePolicy,
        });
      });
    }

    batches.push({
      id: typeof raw.id === 'string' ? raw.id : null,
      description: raw.description === undefined ? null : raw.description,
      baseline_sha: typeof raw.baseline_sha === 'string' ? raw.baseline_sha : null,
      identity_policy: policy,
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
    return {
      document: null,
      batches: [],
      errors: ['manifest: cannot read ' + file + ' (' + (err.code || err.message) + ')'],
    };
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    return {
      document: null,
      batches: [],
      errors: ['manifest: ' + file + ' is not valid JSON: ' + err.message],
    };
  }
  const { batches, errors } = validateManifest(document);
  return { document, batches, errors };
}

// ---------------------------------------------------------------------------
// Git helpers. Every one of them answers { ok, ... } instead of throwing: a
// missing object is an expected FAIL of the gate, not a crash.
// ---------------------------------------------------------------------------

function tryGit(repo, args) {
  try {
    const out = execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.replace(/\s+$/, ''), error: null };
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr).trim() : '';
    return { ok: false, out: '', error: stderr || (err && err.message) || 'git failed' };
  }
}

function isGitRepository(repo) {
  return tryGit(repo, ['rev-parse', '--git-dir']).ok;
}

/** Resolve a reference to a full commit SHA. */
function resolveCommit(repo, ref) {
  if (!isRefValue(ref)) {
    return { ok: false, sha: null, error: 'refusing to resolve ' + JSON.stringify(ref) + ': a git reference is expected' };
  }
  const result = tryGit(repo, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
  if (!result.ok || !COMMIT_SHA.test(result.out)) {
    return { ok: false, sha: null, error: 'not a commit in this repository: ' + ref };
  }
  return { ok: true, sha: result.out, error: null };
}

/** Is `sha` an ancestor of `descendant` (default HEAD)? */
function isAncestor(repo, sha, descendant = 'HEAD') {
  return tryGit(repo, ['merge-base', '--is-ancestor', sha, descendant]).ok;
}

/** Does `rev:path` exist? */
function fileExistsAt(repo, rev, filePath) {
  return tryGit(repo, ['cat-file', '-e', rev + ':' + filePath]).ok;
}

/** Blob object id of `rev:path`, or { ok: false } when it does not exist. */
function blobAt(repo, rev, filePath) {
  const result = tryGit(repo, ['rev-parse', '--verify', '--quiet', rev + ':' + filePath]);
  if (!result.ok || result.out === '') return { ok: false, oid: null };
  return { ok: true, oid: result.out };
}

module.exports = {
  COMMIT_SHA,
  DEFAULT_IDENTITY_POLICY,
  MANIFEST_KIND,
  MANIFEST_REL,
  MANIFEST_VERSION,
  REPO_ROOT,
  SUPPORTED_IDENTITY_POLICIES,
  blobAt,
  fileExistsAt,
  isAncestor,
  isGitRepository,
  isRefValue,
  isRepoRelativePath,
  loadManifest,
  manifestFile,
  resolveCommit,
  tryGit,
  validateManifest,
};
