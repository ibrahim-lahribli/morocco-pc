'use strict';

/**
 * scripts/lib/deployed-role.js - the PURE half of
 * `scripts/check-deployed-role.js`.
 *
 * WHY THIS EXISTS. `morocco_pc_api` is provisioned on the EU database and proved
 * able to run a whole pass from THIS MACHINE (`smoke-api-role.js`, 2026-10-23:
 * health `db:"ok"`, POST 201 with 1 build, no `42501`). None of that says the
 * DEPLOYED app uses it: the smoke test connects as the role itself, and the
 * app's own `DATABASE_URL` secret is never readable (`fly secrets list` prints a
 * digest, not a value). The one fact that settles it is visible from the
 * database: which user the app's live connections authenticated as.
 *
 * THE CHANNEL. `apps/api/src/db.js` tags every pooled connection with
 * `application_name = 'morocco-pc-api'`, so the app is identifiable in
 * `pg_stat_activity` without any new endpoint, column or credential. The
 * credential is the `usename` of those sessions. Measured 2026-10-23: Neon's
 * pooler preserves a client's `application_name` on the server connection it
 * opens (a pooled session shows it once a query has run; `connect()` alone opens
 * nothing), and `usename`/`application_name` are readable by any user for every
 * session in the database - only `query`/`state`/wait events need
 * `pg_read_all_stats`.
 *
 * A POOLED SERVER CONNECTION OUTLIVES ITS CLIENT and keeps the last client's
 * tag. Measured the same day: after a pooled client disconnected, its server
 * connection stayed in `pg_stat_activity` still labelled `morocco-pc-api`, so an
 * old tag can be a leftover rather than live traffic. That is why the report
 * carries each session's `backend_start`: the credential is the LAST one the
 * pool presented, and the start time is how a reader tells a running app from a
 * stale connection.
 *
 * WHAT IT CAN AND CANNOT PROVE. It reports what the running pool DID, which is
 * the honest evidence for "the app now connects as the role". A client may
 * choose any `application_name`, so a session carrying this tag is not
 * tamper-proof; a party that can already connect could label itself. It is not
 * meant to withstand that - it is meant to stop a rotation being RECORDED
 * without the app ever having used the role.
 *
 * VERDICTS (three, like the other evidence gates):
 *   PASS          every session tagged with the app's name authenticated as the
 *                 expected role.
 *   FAIL          at least one tagged session authenticated as something else -
 *                 the app is still on the owner's credentials (or two machines
 *                 disagree, which is the same repair).
 *   INCONCLUSIVE  no tagged session was observed at all. NEVER a pass: nothing
 *                 was proved, and the app may simply be stopped or idle.
 *
 * PURITY. No `pg`, no clock read (`asOf` is passed in), no I/O, no mutation.
 * `scripts/check-deployed-role.js` owns the SELECT and the exit code.
 */

const { assertRoleName } = require('./api-role');

/** The longest `application_name` PostgreSQL stores (`NAMEDATALEN - 1`). */
const APPLICATION_NAME_MAX_LENGTH = 63;

/** One label for a session row whose `usename` is missing or unusable. */
const UNKNOWN_USER = '(unknown)';

/**
 * A non-empty trimmed string, or null.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function textOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A Date from a pg timestamp (Date | ISO string), or null when absent or
 * unparseable. `node-postgres` returns `timestamptz` as a Date already.
 *
 * @param {unknown} value
 * @returns {Date|null}
 */
function dateOrNull(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Validate the app tag. It is compared EXACTLY, so a typo (or a suffix such as
 * `morocco-pc-api-staging`) must fail here rather than quietly match nothing and
 * turn a real FAIL into an INCONCLUSIVE.
 *
 * @param {string} appTag
 * @returns {string}
 */
function assertAppTag(appTag) {
  const tag = textOrNull(appTag);
  if (tag === null) {
    throw new Error('appTag must be a non-empty string (it is compared exactly against application_name)');
  }
  if (tag.length > APPLICATION_NAME_MAX_LENGTH) {
    throw new Error('appTag is longer than ' + APPLICATION_NAME_MAX_LENGTH
      + ' characters, which PostgreSQL truncates - it could never match in pg_stat_activity');
  }
  if (tag !== appTag) {
    throw new Error('appTag must not carry leading or trailing whitespace (application_name is compared exactly)');
  }
  return tag;
}

/**
 * Normalize the SQL rows into `{usename, applicationName, connections}` records.
 *
 * `connections` defaults to 1 because the caller may pass one row per SESSION;
 * a non-integer or non-positive value is a programming error, not a zero.
 *
 * @param {Array<{usename?: string|null, application_name?: string|null, connections?: number,
 *   oldest_start?: Date|string|null, newest_start?: Date|string|null}>} rows
 * @returns {Array<{usename: string, applicationName: string, connections: number,
 *   oldestStart: Date|null, newestStart: Date|null}>}
 */
function normalizeSessions(rows) {
  if (!Array.isArray(rows)) throw new Error('sessions must be an array of pg_stat_activity rows');
  return rows.map((row) => {
    if (row === null || typeof row !== 'object') throw new Error('every session row must be an object');
    const usename = textOrNull(row.usename) === null ? UNKNOWN_USER : row.usename;
    let connections = 1;
    if (row.connections !== undefined && row.connections !== null) {
      if (!Number.isInteger(row.connections) || row.connections <= 0) {
        throw new Error('a session row\'s connections must be a positive integer, received '
          + JSON.stringify(row.connections));
      }
      connections = row.connections;
    }
    return {
      usename,
      // An absent application_name is '' in pg_stat_activity; keep it as text so
      // the exact comparison is total.
      applicationName: typeof row.application_name === 'string' ? row.application_name : '',
      connections,
      oldestStart: dateOrNull(row.oldest_start),
      newestStart: dateOrNull(row.newest_start),
    };
  });
}

/**
 * Code-unit ordering, never `localeCompare` (the engine's determinism rule, and
 * the reason two runs of a report never reorder themselves).
 */
function compareByName(left, right) {
  if (left.usename < right.usename) return -1;
  if (left.usename > right.usename) return 1;
  return 0;
}

/**
 * Fold per-session rows into one entry per user, so a report says "owner: 3
 * connections" rather than repeating the owner three times.
 *
 * @param {Array<{usename: string, connections: number}>} sessions
 * @returns {Array<{usename: string, connections: number}>}
 */
function foldByUser(sessions) {
  const byUser = new Map();
  for (const session of sessions) {
    byUser.set(session.usename, (byUser.get(session.usename) || 0) + session.connections);
  }
  return Array.from(byUser.entries())
    .map(([usename, connections]) => ({ usename, connections }))
    .sort(compareByName);
}

/**
 * Evaluate a `pg_stat_activity` snapshot.
 *
 * @param {Array<object>} rows as the CLI reads them
 * @param {{appTag: string, roleName: string}} options
 * @returns {object} the report view
 */
function evaluateDeployedRole(rows, options) {
  const settings = options || {};
  const appTag = assertAppTag(settings.appTag);
  const roleName = assertRoleName(settings.roleName);

  const sessions = normalizeSessions(rows);
  const appSessions = sessions.filter((session) => session.applicationName === appTag);
  // A tagged session is attributed to the role only on an EXACT match; anything
  // else - including the unknown-user label - is a foreign credential.
  const foreign = appSessions.filter((session) => session.usename !== roleName);

  let verdict;
  if (appSessions.length === 0) verdict = 'INCONCLUSIVE';
  else if (foreign.length > 0) verdict = 'FAIL';
  else verdict = 'PASS';

  const fleet = foldByUser(sessions);

  // The oldest/newest START among the app's sessions: a pooled connection can
  // outlive its client, so this is how a reader tells live traffic from a tag a
  // disconnected client left behind.
  const starts = appSessions
    .flatMap((session) => [session.oldestStart, session.newestStart])
    .filter((date) => date !== null);
  const oldestStart = starts.length === 0 ? null : new Date(Math.min(...starts.map((date) => date.getTime())));
  const newestStart = starts.length === 0 ? null : new Date(Math.max(...starts.map((date) => date.getTime())));

  return {
    verdict,
    appTag,
    roleName,
    totalSessions: sessions.reduce((total, session) => total + session.connections, 0),
    appSessions: foldByUser(appSessions),
    appTotal: appSessions.reduce((total, session) => total + session.connections, 0),
    foreignSessions: foldByUser(foreign),
    foreignTotal: foreign.reduce((total, session) => total + session.connections, 0),
    appUsers: Array.from(new Set(appSessions.map((session) => session.usename))).sort(),
    oldestStart,
    newestStart,
    fleet,
  };
}

/** `3 connection(s)` - a plural that never reads as a typo. */
function connectionLabel(count) {
  return count === 1 ? '1 connection' : count + ' connections';
}

/**
 * Render the report as lines (no I/O, so a test can pin the wording).
 *
 * @param {object} view evaluateDeployedRole() result
 * @param {{targetEnv: string, database?: string|null, asOf?: Date}} context
 * @returns {string[]}
 */
function formatReport(view, context) {
  const settings = context || {};
  const lines = [];
  lines.push('Deployed-role check (read-only: which credential the running app connects with)');
  if (settings.asOf instanceof Date) lines.push('As of: ' + settings.asOf.toISOString());
  lines.push('Target: env:' + settings.targetEnv + ' (a variable NAME; the connection string is never printed)');
  if (settings.database) lines.push('Database: ' + settings.database);
  lines.push('App tag: ' + view.appTag + ' (the API\'s own application_name, apps/api/src/db.js)');
  lines.push('Expected role: ' + view.roleName);
  lines.push('Sessions observed: ' + view.totalSessions + ' (this check\'s own session excluded)');
  for (const entry of view.fleet) {
    lines.push('  ' + entry.usename + ' ' + connectionLabel(entry.connections));
  }

  if (view.appTotal > 0) {
    lines.push('');
    lines.push('Sessions tagged ' + view.appTag + ': ' + view.appTotal);
    for (const entry of view.appSessions) {
      lines.push('  ' + entry.usename + ' ' + connectionLabel(entry.connections));
    }
    if (view.newestStart !== null) {
      lines.push('  started between ' + (view.oldestStart === null ? '?' : view.oldestStart.toISOString())
        + ' and ' + view.newestStart.toISOString());
      lines.push('  (a pooled server connection outlives its client, so an OLD start time can be a');
      lines.push('   leftover tag: run this while the app is serving traffic)');
    }
  }

  lines.push('');
  if (view.verdict === 'PASS') {
    lines.push('RESULT: PASS - every ' + view.appTag + ' session is authenticated as ' + view.roleName);
  } else if (view.verdict === 'FAIL') {
    const offenders = view.foreignSessions
      .map((entry) => entry.usename + ' (' + connectionLabel(entry.connections) + ')')
      .join(', ');
    lines.push('RESULT: FAIL - ' + view.foreignTotal + ' of ' + view.appTotal + ' ' + view.appTag
      + ' session(s) are authenticated as another role: ' + offenders + '.');
    lines.push('        The app is still using the owner\'s credentials (or two machines disagree).');
    lines.push('        Rotate its DATABASE_URL onto ' + view.roleName
      + ' (docs/RECIPES/deploy-eu-colocation.md section 8.5) and re-run this check.');
  } else {
    lines.push('RESULT: INCONCLUSIVE - no session tagged ' + view.appTag
      + ' was observed, so the app\'s credential could not be checked.');
    lines.push('        This is NOT a pass: the app may be stopped, not deployed, or holding no server connection.');
    lines.push('        A running app keeps one pooled connection (its 15 s health check issues SELECT 1);');
    lines.push('        send traffic, wait a few seconds, and re-run before recording anything.');
  }
  return lines;
}

module.exports = {
  APPLICATION_NAME_MAX_LENGTH,
  UNKNOWN_USER,
  assertAppTag,
  connectionLabel,
  dateOrNull,
  evaluateDeployedRole,
  formatReport,
  normalizeSessions,
};
