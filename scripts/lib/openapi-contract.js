'use strict';

/**
 * scripts/lib/openapi-contract.js — the ONE authoritative contract, located and
 * validated (no database, no network, no API).
 *
 * The repository rule is "one contract, one address". A committed copy that
 * nothing compares is worse than none, because a reader cannot tell which file
 * the service serves. This module answers three questions with a problem list
 * instead of a boolean, so a failure says what to fix:
 *
 *   1. is there exactly ONE `openapi-*.json` in the tree (outside node_modules)?
 *   2. is it at `contract/openapi-<major>.<minor>.<patch>.json`?
 *   3. does the filename's version equal `info.version` inside the document?
 *
 * It does NOT compare the file with the served document: `openapi-snapshot.test.js`
 * owns that. It does NOT compare revisions: `openapi-compat.js` owns that.
 */

const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_DIR = 'contract';
/** The versioned convention: `openapi-<major>.<minor>.<patch>.json`. */
const CONTRACT_NAME_RE = /^openapi-(\d+)\.(\d+)\.(\d+)\.json$/;
/**
 * The pre-3b filename (`openapi-v1.10.json`), accepted ONLY when reading a
 * historical Git ref as a compatibility baseline. It is never valid as the
 * working-tree contract: the canonical address carries the full patch triple.
 */
const LEGACY_NAME_RE = /^openapi-v(\d+)\.(\d+)\.json$/;

function isContractName(name) {
  return CONTRACT_NAME_RE.test(name) || LEGACY_NAME_RE.test(name);
}

/** Directories that never hold a published contract. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'test-results', '.lighthouseci', 'coverage']);

/**
 * Every `openapi-*.json` under `rootDir`, as repo-relative POSIX paths.
 * Deliberately recursive: a copy in a frontend, a test directory or a package
 * is exactly the drift this gate exists to find.
 *
 * @param {string} rootDir absolute repository root
 * @returns {string[]} sorted repo-relative paths
 */
function findContractFiles(rootDir) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.startsWith('openapi-') && entry.name.endsWith('.json')) {
        found.push(path.relative(rootDir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(rootDir);
  return found.sort();
}

/**
 * @param {string} rootDir absolute repository root
 * @returns {{ok: boolean, file: string|null, version: string|null, problems: string[]}}
 */
function inspectContract(rootDir) {
  const problems = [];
  const files = findContractFiles(rootDir);

  if (files.length === 0) {
    return {
      ok: false,
      file: null,
      version: null,
      problems: ['no openapi-*.json contract found; the authoritative document belongs at ' + CONTRACT_DIR + '/openapi-<major>.<minor>.<patch>.json'],
    };
  }

  if (files.length > 1) {
    const keep = files.find((file) => file.startsWith(CONTRACT_DIR + '/')) || files[0];
    problems.push(
      'found ' + files.length + ' openapi-*.json files (' + files.join(', ') + '); exactly one is authoritative. '
        + 'Delete the copies and keep ' + keep + ' - a second contract is a file no gate compares.'
    );
  }

  const file = files.find((candidate) => candidate.startsWith(CONTRACT_DIR + '/')) || files[0];
  const base = path.basename(file);
  const match = CONTRACT_NAME_RE.exec(base);
  if (!match) {
    problems.push(
      'the contract is named ' + base + '; the versioned convention is openapi-<major>.<minor>.<patch>.json '
        + '(for example openapi-1.10.0.json)'
    );
  }
  if (path.dirname(file).split(path.sep).join('/') !== CONTRACT_DIR) {
    problems.push(
      'the contract lives at ' + file + ', not in ' + CONTRACT_DIR + '/; the shared, versioned location is the one '
        + 'address both the API and the frontends read'
    );
  }

  let document;
  try {
    document = JSON.parse(fs.readFileSync(path.join(rootDir, file), 'utf8'));
  } catch (error) {
    problems.push('the contract at ' + file + ' is not readable JSON: ' + error.message);
    return { ok: false, file, version: null, problems };
  }

  const version = document && document.info && typeof document.info.version === 'string'
    ? document.info.version
    : null;
  if (version === null) {
    problems.push('the contract at ' + file + ' declares no info.version');
  } else if (match && match.slice(1).join('.') !== version) {
    problems.push(
      'the filename says ' + match.slice(1).join('.') + ' but info.version says ' + version
        + '; rename the file when the contract version changes, so the address and the document agree'
    );
  }

  const paths = document && document.paths;
  if (paths === null || typeof paths !== 'object' || Object.keys(paths).length === 0) {
    problems.push('the contract at ' + file + ' declares no paths');
  }

  return { ok: problems.length === 0, file, version, problems };
}

module.exports = { CONTRACT_DIR, CONTRACT_NAME_RE, LEGACY_NAME_RE, isContractName, findContractFiles, inspectContract };
