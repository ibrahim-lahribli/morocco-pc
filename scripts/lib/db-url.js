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

// --- target descriptor + direct host (E0e / Step-2 C) -----------------------
// Pure host inspection, shared by the harness startup line and the seed apply.
// `describeTarget` names the endpoint id and whether the host is pooled;
// `toDirectUrl` returns the SAME connection string pointed at the direct
// (non-pooler) host. Migrations and session-level SET want the direct host:
// Neon pools through PgBouncer in transaction mode, where a session SET does
// not survive past its own transaction.
function splitHost(urlString) {
  const parsed = new URL(urlString);
  const labels = parsed.hostname.toLowerCase().split('.');
  const pooled = labels.length > 0 && labels[0].endsWith('-pooler');
  const endpointId = pooled ? labels[0].slice(0, labels[0].length - '-pooler'.length) : labels[0];
  const database = parsed.pathname.replace(/^\//, '') || null;
  return { parsed, labels, pooled, endpointId, database };
}

function describeTarget(urlString) {
  const { endpointId, pooled, database } = splitHost(urlString);
  return { endpointId, pooled, database };
}

/**
 * The IDENTITY of the database a connection string points at, and nothing
 * else: the normalized host plus the database name.
 *
 * Deliberately does NOT hand out the parsed URL (nor splitHost, which returns
 * it): a parsed URL still carries the password in `.href`/`.password`, and the
 * one consumer here - the audit-log target digest - must be structurally
 * unable to persist a credential into a tracked file.
 *
 * Parses the string twice, on purpose: it reuses the two CANONICAL
 * derivations (normalizeHost strips a `-pooler` label; splitHost owns reading
 * the database out of the path) instead of copying either one. That strip is
 * already written in three places and must not become four.
 *
 * @param {string} urlString a PostgreSQL connection string
 * @returns {{host: string, database: string}} credential-free identity
 * @throws {TypeError} when the URL cannot be parsed
 */
function normalizeTarget(urlString) {
  const { database } = splitHost(urlString);
  return { host: normalizeHost(urlString), database };
}

/** Swap the pooled host for the direct one, preserving credentials verbatim. */
function toDirectUrl(urlString) {
  const { parsed, labels, pooled } = splitHost(urlString);
  if (!pooled) return urlString;
  labels[0] = labels[0].slice(0, labels[0].length - '-pooler'.length);
  const directHost = labels.join('.');
  const at = urlString.toLowerCase().indexOf(parsed.hostname);
  if (at === -1) return urlString;
  return urlString.slice(0, at) + directHost + urlString.slice(at + parsed.hostname.length);
}

module.exports = {
  CONNECTION_TIMEOUT_MILLIS,
  normalizeHost,
  resolveTestDbUrl,
  getWriteTestDbUrl,
  describeTarget,
  toDirectUrl,
  normalizeTarget,
};
