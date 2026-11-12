'use strict';

// scripts/lib/openapi-contract.test.js - "one contract, one address" is a gate.
//
// The repository rule is that the tree holds exactly ONE openapi-*.json, in
// contract/, named after its own info.version. Each test below breaks exactly
// one part of that sentence, because a gate nobody has seen fail is a comment.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inspectContract, findContractFiles } = require('./openapi-contract');

function document(version, paths) {
  return { openapi: '3.0.3', info: { title: 'test', version }, paths: paths || { '/v1/health': { get: { responses: {} } } } };
}

/** Build a throwaway tree: { 'relative/path.json': objectOrString }. */
function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
  for (const [relative, value] of Object.entries(files)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }
  return dir;
}

test('a single versioned contract in contract/ passes', () => {
  const dir = tree({ 'contract/openapi-1.10.0.json': document('1.10.0') });
  const result = inspectContract(dir);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.file, 'contract/openapi-1.10.0.json');
  assert.equal(result.version, '1.10.0');
});

test('a second copy anywhere in the tree fails, and the message says which to keep', () => {
  const dir = tree({
    'contract/openapi-1.10.0.json': document('1.10.0'),
    'apps/web/lib/openapi-1.10.0.json': document('1.10.0'),
  });
  const result = inspectContract(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => /found 2 openapi-\*\.json/.test(problem)), result.problems.join('\n'));
  assert.ok(result.problems.some((problem) => /contract\/openapi-1\.10\.0\.json/.test(problem)));
});

test('the old test-directory location fails even when it is the only file', () => {
  const dir = tree({ 'apps/api/test/unit/openapi-1.10.0.json': document('1.10.0') });
  const result = inspectContract(dir);
  assert.equal(result.ok, false);
  assert.equal(result.file, 'apps/api/test/unit/openapi-1.10.0.json');
  assert.ok(result.problems.some((problem) => /not in contract\//.test(problem)), result.problems.join('\n'));
});

test('a filename without the version triple fails', () => {
  const dir = tree({ 'contract/openapi-latest.json': document('1.10.0') });
  const result = inspectContract(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => /versioned convention/.test(problem)));
});

test('a filename that disagrees with info.version fails', () => {
  const dir = tree({ 'contract/openapi-1.9.0.json': document('1.10.0') });
  const result = inspectContract(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => /filename says 1\.9\.0 but info\.version says 1\.10\.0/.test(problem)));
});

test('a document with no paths fails, and unreadable JSON fails with a reason', () => {
  const empty = tree({ 'contract/openapi-1.0.0.json': document('1.0.0', {}) });
  assert.ok(inspectContract(empty).problems.some((problem) => /declares no paths/.test(problem)));

  const broken = tree({ 'contract/openapi-1.0.0.json': '{ not json' });
  const result = inspectContract(broken);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => /not readable JSON/.test(problem)));
});

test('no contract at all fails with the expected path', () => {
  const dir = tree({ 'README.md': 'nothing here' });
  const result = inspectContract(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].includes('contract/openapi-<major>.<minor>.<patch>.json'));
});

test('node_modules copies are ignored, so an installed package cannot fail the gate', () => {
  const dir = tree({
    'contract/openapi-1.0.0.json': document('1.0.0'),
    'node_modules/some-client/openapi-3.1.0.json': document('3.1.0'),
  });
  assert.deepEqual(findContractFiles(dir), ['contract/openapi-1.0.0.json']);
  assert.equal(inspectContract(dir).ok, true);
});

test('THE REAL TREE holds one contract at the versioned path', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const result = inspectContract(repoRoot);
  assert.deepEqual(result.problems, [], 'the committed tree must satisfy the one-contract rule');
  assert.match(result.file, /^contract\/openapi-\d+\.\d+\.\d+\.json$/);
});
