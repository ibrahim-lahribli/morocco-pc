'use strict';

/**
 * apps/api/test/unit/import-boundary.test.js - the API talks to the engine
 * through barrels, and to PostgreSQL through db.js, and through nothing else.
 *
 * A public barrel is `src/recommendation/<stage>/index.js`, with exactly one
 * documented exception: `persistence/` has NO barrel (it is imported directly
 * as `persistence/persist-ranked` by the orchestrator), so an API module needing
 * it must use that exact path. Everything else inside `src/recommendation/` is
 * an internal: importing it would let the HTTP layer depend on a module whose
 * public surface the engine never promised.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API_SRC = path.resolve(__dirname, '..', '..', 'src');
const ENGINE_ROOT = path.resolve(API_SRC, '..', '..', '..', 'src', 'recommendation');

/** The one documented non-barrel engine import. */
const ALLOWED_ENGINE_INTERNAL = 'persistence/persist-ranked';

const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function requiresIn(file) {
  const source = fs.readFileSync(file, 'utf8');
  const requests = [];
  let match = REQUIRE_RE.exec(source);
  while (match !== null) {
    requests.push(match[1]);
    match = REQUIRE_RE.exec(source);
  }
  REQUIRE_RE.lastIndex = 0;
  return requests;
}

function relativeToApiSrc(file) {
  return path.relative(API_SRC, file).split(path.sep).join('/');
}

test('no API module imports an engine internal - barrels only', () => {
  const files = walk(API_SRC, []);
  assert.ok(files.length > 0, 'the API source tree must not be empty');

  const violations = [];
  for (const file of files) {
    for (const request of requiresIn(file)) {
      if (!request.startsWith('.')) {
        continue;
      }
      const resolved = path.resolve(path.dirname(file), request);
      if (resolved !== ENGINE_ROOT && !resolved.startsWith(ENGINE_ROOT + path.sep)) {
        continue;
      }
      const relative = path.relative(ENGINE_ROOT, resolved).split(path.sep).join('/');
      if (relative === ALLOWED_ENGINE_INTERNAL) {
        continue;
      }
      const isBarrel = resolved.endsWith('index.js') || fs.existsSync(path.join(resolved, 'index.js'));
      if (!isBarrel) {
        violations.push(relativeToApiSrc(file) + ' -> ' + request + ' (' + relative + ')');
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('the engine is reachable from exactly one module: engine.js', () => {
  const files = walk(API_SRC, []);
  const importers = files
    .filter((file) => requiresIn(file).some((request) => {
      if (!request.startsWith('.')) {
        return false;
      }
      const resolved = path.resolve(path.dirname(file), request);
      return resolved === ENGINE_ROOT || resolved.startsWith(ENGINE_ROOT + path.sep);
    }))
    .map(relativeToApiSrc);

  assert.deepEqual(importers, ['engine.js']);
});

test('engine.js requires exactly the two public barrels it needs', () => {
  const requests = requiresIn(path.join(API_SRC, 'engine.js'))
    .filter((request) => request.startsWith('.'))
    .map((request) => request.replace(/\\/g, '/'))
    .sort();

  assert.deepEqual(requests, [
    '../../../src/recommendation/candidates',
    '../../../src/recommendation/orchestrator',
  ]);
});

test('pg is required only by db.js - all other SQL goes through the repository seam', () => {
  const files = walk(API_SRC, []);
  const requirers = files
    .filter((file) => fs.readFileSync(file, 'utf8').includes("require('pg')"))
    .map(relativeToApiSrc);

  assert.deepEqual(requirers, ['db.js']);
});

test('the HTTP layer (app.js and routes) never imports the engine or the repository directly', () => {
  const guarded = [path.join(API_SRC, 'app.js')].concat(walk(path.join(API_SRC, 'routes'), []));
  assert.ok(guarded.length >= 4);

  for (const file of guarded) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes('src/recommendation'), relativeToApiSrc(file) + ' must not import the engine');
    assert.ok(!/require\(\s*['"]\.\.?\/engine['"]\s*\)/.test(source), relativeToApiSrc(file) + ' must not import engine.js');
    assert.ok(!/require\(\s*['"]\.\.?\/repository['"]\s*\)/.test(source), relativeToApiSrc(file) + ' must not import repository.js');
  }
});
