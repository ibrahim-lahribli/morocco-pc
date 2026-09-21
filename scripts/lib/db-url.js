'use strict';

// scripts/lib/db-url.js — isolated write-test DB guard (config only, no I/O).
//
// Purpose: Engine 5 will be the first code that writes to Layer 4. The shared
// Neon database is not disposable, so write-capable tests must target an
// isolated Neon branch via TEST_DATABASE_URL — never the shared DATABASE_URL.
//
// Convention: callers pass their env object in (pure function, no dotenv here).
// dotenv loading happens only in the thin getWriteTestDbUrl() wrapper below.
// CONNECTION_TIMEOUT_MILLIS (15000) matches the existing scripts convention
// (scripts/test-layer3.js, scripts/test-layer4.js).
//
// Guards (fixed messages only — never echo URLs, credentials, or hosts):
//   - TEST_DATABASE_URL unset / empty / unparseable -> throw
//   - DATABASE_URL unset -> throw (needed as the comparison baseline)
//   - normalized hosts equal -> throw (see normalizeHost)
// Normalization: parse with `new URL`, lowercase the host, strip a "-pooler"
// suffix from the first host label (pooled-vs-direct same endpoint counts as
// the same endpoint). Only the hostname is compared; ports, users, and paths
// are ignored.

const CONNECTION_TIMEOUT_MILLIS = 15000;

function normalizeHost(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  const labels = host.split('.');
  if (labels.length > 0 && labels[0].endsWith('-pooler')) {
    labels[0] = labels[0].slice(0, labels[0].length - '-pooler'.length);
  }
  return labels.join('.');
}

function resolveTestDbUrl(env) {
  const source = env || {};
  const testUrl = source.TEST_DATABASE_URL;
  if (typeof testUrl !== 'string' || testUrl.trim() === '') {
    throw new Error('TEST_DATABASE_URL is not set');
  }
  const sharedUrl = source.DATABASE_URL;
  if (typeof sharedUrl !== 'string' || sharedUrl.trim() === '') {
    throw new Error('DATABASE_URL is not set');
  }
  let testHost;
  try {
    testHost = normalizeHost(testUrl);
  } catch (_err) {
    throw new Error('TEST_DATABASE_URL is not a valid URL');
  }
  let sharedHost;
  try {
    sharedHost = normalizeHost(sharedUrl);
  } catch (_err) {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (testHost === sharedHost) {
    throw new Error('TEST_DATABASE_URL must not target the shared database');
  }
  return {
    connectionString: testUrl,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
  };
}

function getWriteTestDbUrl() {
  require('dotenv').config();
  return resolveTestDbUrl(process.env);
}

module.exports = {
  CONNECTION_TIMEOUT_MILLIS,
  normalizeHost,
  resolveTestDbUrl,
  getWriteTestDbUrl,
};
