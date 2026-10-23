'use strict';

/**
 * scripts/lib/deployed-role.test.js - the pure half of the deployed-role check.
 *
 * The cases that matter are the ones a two-valued gate would get wrong: no app
 * session at all is INCONCLUSIVE (never PASS), a staging tag must not satisfy a
 * production tag, and one foreign connection among many is still a FAIL.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  APPLICATION_NAME_MAX_LENGTH,
  UNKNOWN_USER,
  assertAppTag,
  connectionLabel,
  evaluateDeployedRole,
  formatReport,
  normalizeSessions,
} = require('./deployed-role');

const APP = 'morocco-pc-api';
const ROLE = 'morocco_pc_api';
const AS_OF = new Date('2026-10-23T12:00:00Z');

/** A session row as the SQL returns it. */
function session(usename, applicationName, connections) {
  return { usename, application_name: applicationName, connections };
}

function view(rows) {
  return evaluateDeployedRole(rows, { appTag: APP, roleName: ROLE });
}

function report(rows, extra) {
  return formatReport(view(rows), Object.assign({ targetEnv: 'TARGET_DATABASE_URL', database: 'neondb', asOf: AS_OF }, extra || {}))
    .join('\n');
}

test('an app whose sessions are all the role PASSes', () => {
  const result = view([session(ROLE, APP, 2), session('neondb_owner', 'morocco-pc-smoke-api-role', 1)]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.appTotal, 2);
  assert.deepEqual(result.appUsers, [ROLE]);
  assert.deepEqual(result.foreignSessions, []);
});

test('an app still on the owner FAILs, and other tools do not change that', () => {
  const result = view([
    session('neondb_owner', APP, 2),
    session('neondb_owner', 'psql', 1),
    session(ROLE, 'morocco-pc-smoke-api-role', 1),
  ]);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.foreignTotal, 2);
  assert.deepEqual(result.foreignSessions, [{ usename: 'neondb_owner', connections: 2 }]);
});

test('ONE foreign connection among many is still a FAIL (a half-finished rotation)', () => {
  const result = view([session(ROLE, APP, 4), session('neondb_owner', APP, 1)]);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.appTotal, 5);
  assert.equal(result.foreignTotal, 1);
});

test('no app session at all is INCONCLUSIVE, never PASS', () => {
  const result = view([session('neondb_owner', 'psql', 1), session('neondb_owner', '', 2)]);
  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.equal(result.appTotal, 0);
  const text = report([session('neondb_owner', 'psql', 1)]);
  assert.match(text, /RESULT: INCONCLUSIVE/);
  assert.match(text, /NOT a pass/);
  assert.doesNotMatch(text, /RESULT: PASS/);
});

test('the app tag is matched EXACTLY: a staging tag or trailing space cannot satisfy it', () => {
  for (const tag of [APP + '-staging', APP + ' ', ' ' + APP, APP.toUpperCase(), '']) {
    const result = view([session(ROLE, tag, 1)]);
    assert.equal(result.verdict, 'INCONCLUSIVE', JSON.stringify(tag) + ' must not count as the app');
  }
});

test('a tagged session with no usable usename is foreign, never the role', () => {
  const result = view([session(null, APP, 1)]);
  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.foreignSessions, [{ usename: UNKNOWN_USER, connections: 1 }]);
});

test('connections are summed per user, in code-unit order (never localeCompare)', () => {
  const result = view([
    session('alpha', '', 1),
    session('Zeta', '', 2),
    session('alpha', APP, 1),
    session('Zeta', '', 1),
  ]);
  assert.deepEqual(result.fleet, [
    { usename: 'Zeta', connections: 3 },
    { usename: 'alpha', connections: 2 },
  ], 'uppercase sorts before lowercase by code unit');
  assert.equal(result.totalSessions, 5);
});

test('a row without a connection count counts as one session', () => {
  const rows = normalizeSessions([{ usename: ROLE, application_name: APP }]);
  assert.deepEqual(rows, [{
    usename: ROLE,
    applicationName: APP,
    connections: 1,
    oldestStart: null,
    newestStart: null,
  }]);
});

test('the report carries the session start times, because a pooled connection outlives its client', () => {
  // Measured 2026-10-23: after a pooled client disconnected, its server
  // connection stayed in pg_stat_activity still carrying the app tag. An old
  // start time is how a reader tells that leftover from live traffic.
  const result = evaluateDeployedRole([
    {
      usename: ROLE,
      application_name: APP,
      connections: 1,
      oldest_start: '2026-10-23T21:00:00Z',
      newest_start: '2026-10-23T21:30:00Z',
    },
    {
      usename: 'neondb_owner',
      application_name: APP,
      connections: 1,
      oldest_start: '2026-10-23T20:00:00Z',
      newest_start: '2026-10-23T22:30:00Z',
    },
  ], { appTag: APP, roleName: ROLE });
  assert.equal(result.oldestStart.toISOString(), '2026-10-23T20:00:00.000Z');
  assert.equal(result.newestStart.toISOString(), '2026-10-23T22:30:00.000Z');
  const text = report([
    { usename: ROLE, application_name: APP, connections: 1, oldest_start: '2026-10-23T21:00:00Z', newest_start: '2026-10-23T21:00:00Z' },
  ]);
  assert.match(text, /started between 2026-10-23T21:00:00\.000Z and 2026-10-23T21:00:00\.000Z/);
  assert.match(text, /outlives its client/);
});

test('a row with no usable timestamps still evaluates, with no start line', () => {
  const result = view([{ usename: ROLE, application_name: APP, connections: 1, oldest_start: 'not-a-date' }]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.oldestStart, null);
  assert.doesNotMatch(report([{ usename: ROLE, application_name: APP, connections: 1 }]), /started between/);
});

test('malformed input is a failure, not an empty report', () => {
  assert.throws(() => evaluateDeployedRole(null, { appTag: APP, roleName: ROLE }), /array/);
  assert.throws(() => evaluateDeployedRole([null], { appTag: APP, roleName: ROLE }), /object/);
  assert.throws(() => evaluateDeployedRole([session(ROLE, APP, 0)], { appTag: APP, roleName: ROLE }), /positive integer/);
  assert.throws(() => evaluateDeployedRole([session(ROLE, APP, 1.5)], { appTag: APP, roleName: ROLE }), /positive integer/);
  assert.throws(() => evaluateDeployedRole([], { appTag: APP, roleName: 'Not A Role' }), /plain identifier/);
});

test('the app tag is shape-checked, because PG truncates at 63 characters', () => {
  assert.equal(assertAppTag(APP), APP);
  for (const bad of ['', '   ', ' ' + APP, APP + ' ', 'x'.repeat(APPLICATION_NAME_MAX_LENGTH + 1), null, 42]) {
    assert.throws(() => assertAppTag(bad), /appTag/, JSON.stringify(bad) + ' must be refused');
  }
});

test('the FAIL report names the offending user and the repair', () => {
  const text = report([session('neondb_owner', APP, 2)]);
  assert.match(text, /RESULT: FAIL - 2 of 2 morocco-pc-api session\(s\) are authenticated as another role: neondb_owner \(2 connections\)/);
  assert.match(text, /still using the owner's credentials/);
  assert.match(text, /deploy-eu-colocation\.md section 8\.5/);
});

test('the PASS report names both users and never prints a connection string', () => {
  const text = report([session(ROLE, APP, 1), session('neondb_owner', '', 3)]);
  assert.match(text, /RESULT: PASS - every morocco-pc-api session is authenticated as morocco_pc_api/);
  assert.match(text, /Target: env:TARGET_DATABASE_URL/);
  assert.match(text, /Database: neondb/);
  assert.match(text, /neondb_owner 3 connections/);
  assert.doesNotMatch(text, /:\/\//);
});

test('the singular reads as one connection, not "1 connections"', () => {
  assert.equal(connectionLabel(1), '1 connection');
  assert.equal(connectionLabel(2), '2 connections');
});
