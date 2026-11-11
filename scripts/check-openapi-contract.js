#!/usr/bin/env node
'use strict';

/**
 * scripts/check-openapi-contract.js - contract-copy drift detection.
 *
 *   node scripts/check-openapi-contract.js
 *
 * Fails when the tree holds anything other than ONE versioned contract at
 * `contract/openapi-<major>.<minor>.<patch>.json` whose filename agrees with
 * `info.version`. It does not compare the document with the served API:
 * `apps/api/test/unit/openapi-snapshot.test.js` owns that, deliberately, so
 * "one authoritative file" and "the file is what we serve" stay separate
 * failures with separate fixes.
 */

const path = require('node:path');

const { inspectContract } = require('./lib/openapi-contract');

const ROOT = path.resolve(__dirname, '..');

const result = inspectContract(ROOT);

if (!result.ok) {
  console.error('FAIL contract-location');
  for (const problem of result.problems) console.error('  - ' + problem);
  process.exit(1);
}

console.log('PASS contract-location -- ' + result.file + ' (contract ' + result.version + ', the only openapi-*.json in the tree)');
