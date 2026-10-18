'use strict';

/**
 * scripts/lib/origin-readiness.js - the PURE half of the deployed-origin
 * preflight (`scripts/check-origin-readiness.js`, EU runbook §8.4, P2 Sprint 2
 * Step 4).
 *
 * The runbook pins TRUST_PROXY from evidence read off a live origin, so the
 * evidence is checked BEFORE anything is pinned: the app must own at least one
 * public address, and its health route must answer 2xx with `status: "ok"` AND
 * `db: "ok"`. Nothing here touches the network, flyctl, the clock or a file, so
 * every boundary below is unit-tested (origin-readiness.test.js).
 *
 * WHY `net.isIP` AND NOT A REGEX: an "IPv6-ish" pattern also matches the
 * `09:00:00` inside `fly ips list`'s CREATED AT column, and a bogus token
 * pasted into TRUST_PROXY changes which addresses are trusted. Column 1 is the
 * address column; that column is the only thing read, and only a token the
 * runtime accepts as an IP survives.
 */

const net = require('node:net');

/** Addresses from `fly ips list`, column 1, unique, in output order. */
function parseFlyIps(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError('parseFlyIps expects the stdout string from `fly ips list`');
  }
  const addresses = [];
  const seen = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const column = line.trim().split(/\s+/)[0];
    if (column === undefined || column === '') {
      continue;
    }
    // The header ("IP ADDRESS ..."), a note line, and any malformed row all
    // fail here for the same reason: they are not an IP address.
    if (net.isIP(column) === 0) {
      continue;
    }
    if (seen.has(column)) {
      continue;
    }
    seen.add(column);
    addresses.push(column);
  }
  return addresses;
}

/**
 * The verdict for one health response.
 *
 * A 2xx alone is not enough. The runbook is about to measure per-IP limits on
 * this deploy, so a reachable process in front of an unreachable database would
 * produce bucket counts that mean nothing. `status` and `db` must both be the
 * exact string "ok": a missing field (UNKNOWN) is never read as healthy, and a
 * non-object JSON body cannot answer either question.
 *
 * @param {number} statusCode HTTP status of the health response
 * @param {string} bodyText response body
 * @returns {{ok: boolean, code: string, detail: string}}
 */
function checkHealth(statusCode, bodyText) {
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode > 299) {
    return { ok: false, code: 'HTTP_STATUS', detail: 'HTTP ' + String(statusCode) };
  }
  let body;
  try {
    body = JSON.parse(typeof bodyText === 'string' ? bodyText : '');
  } catch (_error) {
    return { ok: false, code: 'NOT_JSON', detail: 'health body is not JSON' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'NOT_OBJECT', detail: 'health body is not a JSON object' };
  }
  if (body.status !== 'ok' || body.db !== 'ok') {
    return {
      ok: false,
      code: 'NOT_OK',
      detail: 'status=' + String(body.status) + ' db=' + String(body.db),
    };
  }
  return { ok: true, code: 'OK', detail: 'status=ok db=ok' };
}

/**
 * The health URL for an origin. A trailing slash is removed first so an origin
 * pasted with one does not produce `//v1/health`; the `?probe=preflight` marker
 * is what makes this request's line findable in `fly logs` next to Fly's own
 * health checks.
 */
function healthUrl(origin) {
  if (typeof origin !== 'string' || origin.trim() === '') {
    throw new TypeError('healthUrl expects a non-blank origin');
  }
  return origin.trim().replace(/\/+$/, '') + '/v1/health?probe=preflight';
}

module.exports = {
  parseFlyIps,
  checkHealth,
  healthUrl,
};
