'use strict';

// compute.purity.test.js — the extracted seam must stay pure.
//
// compute.js is the half of a recommendation pass that is supposed to be
// replayable from a text fixture (see compute.golden.test.js). That only holds
// while it reads no clock, no environment, no randomness and no database, and
// requires nothing but the pure barrels. This scans its SOURCE, so a violation
// fails here even when the offending path is never exercised by a test.
//
// The scanner is exercised against synthetic sources too, so proving the gate
// works never means writing impurity into the real module.
//
// DB-free, dependency-free: node:test + node:assert only.
//   npm run test:unit

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_FILE = path.join(__dirname, 'compute.js');

/** Drop // and /* *\/ comments so a comment about a rule is not a violation. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every forbidden form, with the reason it is forbidden. */
const FORBIDDEN = [
  { pattern: /require\(\s*['"]pg['"]\s*\)/, rule: 'a database client' },
  { pattern: /process\.env/, rule: 'an environment read' },
  { pattern: /Date\.now/, rule: 'a JS clock read' },
  { pattern: /new Date\(\s*\)/, rule: 'a JS clock read (bare new Date())' },
  { pattern: /Math\.random/, rule: 'randomness' },
  { pattern: /randomUUID/, rule: 'randomness' },
  { pattern: /\.query\(/, rule: 'a database statement' },
  { pattern: /require\(\s*['"]fs['"]\s*\)/, rule: 'filesystem access' },
  { pattern: /require\(\s*['"]https?['"]\s*\)/, rule: 'network access' },
];

/** The only relative modules the seam may require. */
const ALLOWED_REQUIRES = [
  '../scoring',
  '../retention',
  '../assembly',
  '../candidates/errors',
];

function violations(source) {
  return FORBIDDEN.filter((entry) => entry.pattern.test(source)).map((entry) => entry.rule);
}

describe('compute.js is pure', () => {
  const source = stripComments(fs.readFileSync(SOURCE_FILE, 'utf8'));

  it('reads no clock, environment, randomness or database', () => {
    assert.deepEqual(violations(source), []);
  });

  it('requires only the pure barrels, never a loader', () => {
    const required = [...source.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]);
    assert.deepEqual(required.slice().sort(), ALLOWED_REQUIRES.slice().sort(),
      'compute.js must not reach outside the pure barrels');
  });

  it('exports the seam and the four derivations the golden test pins', () => {
    const compute = require('./compute');
    for (const name of [
      'computeFromLoaded',
      'resolveGpuPolicy',
      'resolveRoleTargets',
      'resolveArchetypeObjectives',
      'resolveVramFloorGb',
    ]) {
      assert.equal(typeof compute[name], 'function', name + ' must be exported');
    }
  });
});

describe('the purity scanner reports real violations', () => {
  it('flags each forbidden form', () => {
    const cases = [
      ["const { Client } = require('pg');", 'a database client'],
      ['const port = process.env.PORT;', 'an environment read'],
      ['const at = Date.now();', 'a JS clock read'],
      ['const at = new Date();', 'a JS clock read (bare new Date())'],
      ['const pick = Math.random();', 'randomness'],
      ['const id = randomUUID();', 'randomness'],
      ['await db.query(SQL);', 'a database statement'],
      ["const fs = require('fs');", 'filesystem access'],
      ["const https = require('https');", 'network access'],
    ];
    for (const [code, rule] of cases) {
      assert.ok(violations(stripComments(code)).includes(rule), 'the scanner must flag ' + rule);
    }
  });

  it('permits the documented, harmless forms', () => {
    assert.deepEqual(violations(stripComments("const at = new Date(value);")), []);
    assert.deepEqual(violations(stripComments('// Date.now() is forbidden here.')), []);
    assert.deepEqual(violations(stripComments('/* process.env is forbidden */')), []);
  });
});
