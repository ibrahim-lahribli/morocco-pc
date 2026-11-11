'use strict';

// scripts/lib/openapi-compat-cli.test.js - the gate's behaviour, end to end.
//
// Each case builds a throwaway Git repository, so the baseline really is read
// from a ref (`git show <ref>:contract/...`) exactly as CI reads origin/master.
// Nothing here touches the real repository, a database or the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'check-openapi-compatibility.js');

function document(version, extraPath) {
  const paths = {
    '/v1/things': {
      post: {
        responses: {
          201: {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  };
  if (extraPath) paths[extraPath] = { get: { responses: { 200: { description: 'ok' } } } };
  return { openapi: '3.0.3', info: { title: 'test', version }, paths };
}

function git(dir, args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, 'git ' + args.join(' ') + ' failed: ' + (result.stderr || ''));
  return result.stdout;
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', message]);
}

/** A repository whose HEAD is the baseline commit. */
function repoWithBaseline(contractPath, documentValue) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  const full = path.join(dir, contractPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(documentValue, null, 2));
  commit(dir, 'baseline');
  return dir;
}

function writeContract(dir, contractPath, documentValue) {
  const full = path.join(dir, contractPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(documentValue, null, 2));
}

function run(dir, args) {
  const result = spawnSync(process.execPath, [SCRIPT].concat(args).concat(['--root=' + dir]), { encoding: 'utf8' });
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

test('an additive change passes against the ref', () => {
  const dir = repoWithBaseline('contract/openapi-1.0.0.json', document('1.0.0'));
  fs.rmSync(path.join(dir, 'contract/openapi-1.0.0.json'));
  const candidate = document('1.1.0', '/v1/extra');
  candidate.paths['/v1/things'].post.responses['201'].content['application/json']
    .schema.properties.hint = { type: 'string' };
  writeContract(dir, 'contract/openapi-1.1.0.json', candidate);

  const result = run(dir, ['--base=HEAD']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /PASS openapi-compatibility/);
  assert.match(result.output, /ADDITIVE/);
  assert.match(result.output, /PROPERTY_ADDED/);
});

test('a breaking change fails and says how to proceed', () => {
  const dir = repoWithBaseline('contract/openapi-1.0.0.json', document('1.0.0'));
  fs.rmSync(path.join(dir, 'contract/openapi-1.0.0.json'));
  const candidate = document('2.0.0');
  candidate.paths['/v1/things'].post.responses['201'].content['application/json']
    .schema.properties.id.type = 'number';
  writeContract(dir, 'contract/openapi-2.0.0.json', candidate);

  const result = run(dir, ['--base=HEAD']);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /FAIL openapi-compatibility/);
  assert.match(result.output, /TYPE_CHANGED/);
  assert.match(result.output, /documented review and owner approval/);
  assert.match(result.output, /--approval-note=/);
});

test('a removed path is caught, not just a changed field', () => {
  const dir = repoWithBaseline('contract/openapi-1.0.0.json', document('1.0.0', '/v1/extra'));
  fs.rmSync(path.join(dir, 'contract/openapi-1.0.0.json'));
  writeContract(dir, 'contract/openapi-2.0.0.json', document('2.0.0'));

  const result = run(dir, ['--base=HEAD']);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /PATH_REMOVED/);
});

test('an approved breaking change passes and prints the approval note', () => {
  const dir = repoWithBaseline('contract/openapi-1.0.0.json', document('1.0.0'));
  fs.rmSync(path.join(dir, 'contract/openapi-1.0.0.json'));
  const candidate = document('2.0.0');
  delete candidate.paths['/v1/things'].post;
  candidate.paths['/v1/things'].get = { responses: { 200: { description: 'ok' } } };
  writeContract(dir, 'contract/openapi-2.0.0.json', candidate);

  const result = run(dir, [
    '--base=HEAD',
    '--allow-breaking',
    '--approval-note=Reviewed in PR 42; owner approved the 2.0.0 surface',
  ]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /ACCEPTED under an explicit waiver/);
  assert.match(result.output, /Reviewed in PR 42/);
});

test('a bare --allow-breaking is a refusal, not a waiver', () => {
  const dir = repoWithBaseline('contract/openapi-1.0.0.json', document('1.0.0'));
  fs.rmSync(path.join(dir, 'contract/openapi-1.0.0.json'));
  const candidate = document('2.0.0');
  delete candidate.paths['/v1/things'].post;
  writeContract(dir, 'contract/openapi-2.0.0.json', candidate);

  assert.equal(run(dir, ['--base=HEAD', '--allow-breaking']).status, 1);
  assert.equal(run(dir, ['--base=HEAD', '--allow-breaking', '--approval-note=short']).status, 1);
});

test('a missing or unreadable --base is a usage error, never a pass', () => {
  const dir = repoWithBaseline('contract/openapi-1.0.0.json', document('1.0.0'));
  assert.equal(run(dir, []).status, 2);
  assert.equal(run(dir, ['--base=does-not-exist']).status, 2);
});

test('a ref that predates the move is read from the legacy test directory, from history only', () => {
  const dir = repoWithBaseline('apps/api/test/unit/openapi-1.0.0.json', document('1.0.0'));
  fs.rmSync(path.join(dir, 'apps/api/test/unit/openapi-1.0.0.json'));
  writeContract(dir, 'contract/openapi-1.1.0.json', document('1.1.0', '/v1/extra'));

  const result = run(dir, ['--base=HEAD']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /apps\/api\/test\/unit\/openapi-1\.0\.0\.json/);
  assert.match(result.output, /pre-3b location, read from history only/);
});

test('the candidate must satisfy the one-contract rule, whatever the baseline says', () => {
  const dir = repoWithBaseline('contract/openapi-1.0.0.json', document('1.0.0'));
  // A second copy in the working tree: drift the location gate would refuse.
  writeContract(dir, 'apps/web/openapi-1.0.0.json', document('1.0.0'));
  const result = run(dir, ['--base=HEAD']);
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /exactly one is authoritative/);
});
