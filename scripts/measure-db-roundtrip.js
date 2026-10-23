'use strict';

// scripts/measure-db-roundtrip.js - V1's latency input, measured where it can be.
//
// WHAT THIS ANSWERS. V1's promise is that a recommendation POST completes in under
// 3 s, and there is no deployed origin to measure it on. What CAN be measured is
// the floor every origin pays: the round trip to the database, multiplied by the
// statements one pass issues. This script times N sequential `SELECT 1`s and
// prints that band (scripts/lib/db-roundtrip.js owns the arithmetic and the
// report text; this file owns the connection and nothing else).
//
// WHY A CI RUNNER. On 2026-10-23 the dev box measured a MEDIAN 120.7 ms per
// round trip to the TEST branch, which made one 49-statement pass spend ~8.9 s of
// its 10.2 s waiting - a property of that machine's distance from Neon, not of the
// product. A runner is not the deployed origin either, but it is repeatable, it
// sits where the smoke tests run, and it is the only place a number can be
// compared week to week until an origin exists.
//
// READ ONLY, ALWAYS. The only statement this script issues is `SELECT 1`. It takes
// no lock, writes nothing, and mutates no engine state, so it is safe against the
// shared database as well as the TEST branch. It never prints the connection
// string - only the NAME of the variable it read.
//
// Usage: node scripts/measure-db-roundtrip.js [--samples=N] [--statements=N] [--target=env:NAME]
//         --help    print the usage text and exit 1
//
// Equals form is mandatory (`--samples=5`); the space form is rejected, exactly
// like check-offer-freshness.js' `--fail-days=N` and measure-api-pass-phases.js.
//
// Exit codes: 0 measured (the figure itself is INFORMATIONAL - it does not fail
// the job), 1 the variable is unset, the connection failed, or a query failed.

const path = require('path');

require('dotenv').config();

const { Client } = require('pg');

const {
  parseArgs,
  renderReport,
  summarize,
} = require(path.join(__dirname, 'lib', 'db-roundtrip'));

async function main(argv) {
  const options = parseArgs(argv);
  const connectionString = process.env[options.targetEnv];
  if (!connectionString) {
    throw new Error(options.targetEnv + ' is not set');
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15000,
  });

  await client.connect();
  try {
    // One warm-up round trip, deliberately NOT sampled: a cold connection pays
    // TCP + TLS + auth, which is a property of the connection and would make the
    // first sample describe something no steady-state statement pays.
    await client.query('SELECT 1');

    const samples = [];
    for (let i = 0; i < options.samples; i += 1) {
      const startedAt = process.hrtime.bigint();
      await client.query('SELECT 1');
      samples.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
    }

    const stats = summarize(samples);
    console.log(
      renderReport({
        label: options.targetEnv,
        stats,
        statements: options.statements,
      })
    );
  } finally {
    await client.end();
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error('db-roundtrip: ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
