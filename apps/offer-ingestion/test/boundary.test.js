'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Boundary rule (RFC §12.4 / R4): `apps/offer-ingestion/**` may not require
 * `recommendation-core`, `recommendation-runtime`, or any path under them.
 * Zero inbound engine edges must stay zero.
 */
const ROOT = path.resolve(__dirname, '..');
const FORBIDDEN = [
  'recommendation-core',
  'recommendation-runtime',
];

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

test('offer-ingestion has zero require edges to recommendation-core / recommendation-runtime', () => {
  const files = collectJsFiles(path.join(ROOT, 'src'))
    .concat(collectJsFiles(path.join(ROOT, 'gates')))
    .concat(collectJsFiles(path.join(ROOT, 'bin')));
  assert.ok(files.length > 0, 'expected at least one source file to scan');

  const hits = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    for (const forbidden of FORBIDDEN) {
      if (src.includes(`require('${forbidden}')`) || src.includes(`require("${forbidden}")`) || src.includes(`require('${forbidden}/`) || src.includes(`require("${forbidden}/`)) {
        hits.push(`${rel}: requires ${forbidden}`);
      }
    }
  }
  assert.equal(hits.length, 0, 'forbidden require edges found:\n' + hits.join('\n'));
});
