'use strict';

// scripts/lib/api-role.test.js — the DB-free contract of the production role's
// privileges (`scripts/lib/api-role.js`), the ONE owner of that contract.
//
// These tests moved here from `rehearse-api-role-cli.test.js` when the contract
// was extracted, because three scripts now consume it: the branch rehearsal, the
// owner-gated shared apply (`scripts/apply-api-role.js`) and the smoke test
// (`scripts/smoke-api-role.js`). What the rehearsal's OWN CLI does is still
// pinned in `rehearse-api-role-cli.test.js`.
//
// The pins, in order: the fixture is WELL-FORMED and its composition is the one
// docs/API.md documents (20 answers: the six INSERT targets, two row-wide UPDATEs
// false, three column-scoped UPDATEs true) with a golden id set, so dropping one
// is a failure rather than a smaller rehearsal; every `true` answer is
// SATISFIABLE by the statements the grant builder emits; an expectation with no
// answer is a FAILURE, not a skip — and so is an answer with no expectation, a
// wrong one, or an unknown (NULL) one; the self-check is ONE labelled statement;
// role names are validated before they reach DDL; the teardown sweep carries no
// DROP ROLE inside it; and the dry-run/rollback statement builders hold their
// properties.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  API_ROLE_NAME,
  COLUMN_UPDATE_GRANTS,
  PRIVILEGE_EXPECTATIONS,
  WRITE_TARGET_TABLES,
  buildGrantStatements,
  buildGrantStatementsRedacted,
  buildRemovalStatements,
  buildSelfCheckSql,
  buildTeardownStatements,
  comparePrivilegeAnswers,
  privilegeExpression,
  quoteSqlLiteral,
  roleConnectionString,
} = require('./api-role');

/** The 20 ids this contract is defined by, spelled out (golden). */
const GOLDEN_IDS = [
  'build_candidate_insert',
  'build_component_delete',
  'build_component_insert',
  'build_rejection_delete',
  'build_rejection_insert',
  'product_delete',
  'product_insert',
  'product_select',
  'product_update',
  'recommendation_profile_insert',
  'recommendation_query_budget_floor_update',
  'recommendation_query_insert',
  'recommendation_query_update',
  'recommendation_result_engine_version_update',
  'recommendation_result_insert',
  'recommendation_result_strategy_key_update',
  'recommendation_result_update',
  'schema_public_create',
  'store_offer_delete',
  'store_offer_insert',
];

const expectedOf = (id) => PRIVILEGE_EXPECTATIONS.find((entry) => entry.id === id).expected;

/** A complete, correct set of answers — the shape the live self-check returns. */
function correctAnswers() {
  return PRIVILEGE_EXPECTATIONS.map((entry) => ({ id: entry.id, allowed: entry.expected }));
}

test('the fixture is well-formed: 20 uniquely-identified answers, each with a known kind', () => {
  assert.equal(PRIVILEGE_EXPECTATIONS.length, 20, 'the plan and docs/API.md both say 20');
  const ids = PRIVILEGE_EXPECTATIONS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique — an id is the join key to an answer');
  assert.deepEqual(ids.slice().sort(), GOLDEN_IDS, 'the id set is golden: dropping one must fail, not shrink the rehearsal');

  for (const entry of PRIVILEGE_EXPECTATIONS) {
    assert.ok(['SCHEMA', 'TABLE', 'COLUMN'].includes(entry.kind), entry.id + ' has an unknown kind');
    assert.equal(typeof entry.target, 'string', entry.id + ' needs a target');
    assert.equal(typeof entry.privilege, 'string', entry.id + ' needs a privilege');
    assert.equal(typeof entry.expected, 'boolean', entry.id + ' must EXPECT a boolean, never "unknown"');
    if (entry.kind === 'COLUMN') {
      assert.equal(typeof entry.column, 'string', entry.id + ' is column-scoped and needs a column');
    } else {
      assert.equal(entry.column, undefined, entry.id + ' is not column-scoped and must not name a column');
    }
  }
});

test('the composition is the one docs/API.md documents, not merely 20 entries', () => {
  for (const table of WRITE_TARGET_TABLES) {
    assert.equal(expectedOf(table + '_insert'), true, table + ' must be INSERTable by the role');
  }
  assert.deepEqual(
    WRITE_TARGET_TABLES,
    ['recommendation_profile', 'recommendation_query', 'build_candidate', 'build_component', 'recommendation_result', 'build_rejection']
  );

  assert.equal(expectedOf('product_insert'), false);
  assert.equal(expectedOf('product_update'), false);
  assert.equal(expectedOf('product_delete'), false);
  assert.equal(expectedOf('store_offer_insert'), false);
  assert.equal(expectedOf('store_offer_delete'), false);
  assert.equal(expectedOf('product_select'), true);

  const deleteTrue = PRIVILEGE_EXPECTATIONS.filter((e) => e.privilege === 'DELETE' && e.expected === true);
  assert.deepEqual(deleteTrue.map((e) => e.target), ['build_rejection'], 'Decision 31 clears build_rejection and nothing else');

  const tableUpdates = PRIVILEGE_EXPECTATIONS.filter((e) => e.kind === 'TABLE' && e.privilege === 'UPDATE');
  assert.deepEqual(tableUpdates.map((e) => e.target).sort(), ['product', 'recommendation_query', 'recommendation_result']);
  assert.ok(tableUpdates.every((e) => e.expected === false), 'a table-level UPDATE answer must stay false');
  const columnUpdates = PRIVILEGE_EXPECTATIONS.filter((e) => e.kind === 'COLUMN' && e.privilege === 'UPDATE');
  assert.deepEqual(
    columnUpdates.map((e) => e.target + '.' + e.column).sort(),
    ['recommendation_query.budget_floor', 'recommendation_result.engine_version', 'recommendation_result.strategy_key'],
    'the three pass-facts columns, and only those'
  );
  assert.ok(columnUpdates.every((e) => e.expected === true));

  assert.equal(expectedOf('schema_public_create'), false);
});

test('the self-check is ONE statement with one labelled branch per expectation', () => {
  const sql = buildSelfCheckSql(API_ROLE_NAME);
  assert.equal((sql.match(/UNION ALL/g) || []).length, PRIVILEGE_EXPECTATIONS.length - 1);
  for (const entry of PRIVILEGE_EXPECTATIONS) {
    assert.ok(sql.includes("'" + entry.id + "' AS id"), entry.id + ' must be labelled in the SQL');
    assert.ok(sql.includes(privilegeExpression(entry, API_ROLE_NAME)), entry.id + ' must appear as its own expression');
  }
  assert.match(sql, /has_schema_privilege\('morocco_pc_api','public','CREATE'\)/);
  assert.match(sql, /has_table_privilege\('morocco_pc_api','product','SELECT'\)/);
  assert.match(sql, /has_column_privilege\('morocco_pc_api','recommendation_query','budget_floor','UPDATE'\)/);
  assert.match(sql, /ORDER BY 1$/, 'the ORDER BY is what makes the report stable');
  assert.doesNotMatch(sql, /;\s*$/, 'one statement, never a script');
});

test('a role name is validated before it reaches DDL (it is interpolated, never parameterised)', () => {
  assert.equal(quoteSqlLiteral("o'brien"), "'o''brien'");
  assert.throws(() => quoteSqlLiteral(7), /requires a string/);
  assert.throws(() => buildSelfCheckSql('x; DROP ROLE y'), /not a plain identifier/);
  assert.throws(() => buildGrantStatements('Bad-Name', 'pw'), /not a plain identifier/);
  assert.throws(() => roleConnectionString('postgresql://h/db', 'a b', 'pw'), /not a plain identifier/);
});

test('the grant script is the documented one: CREATE ROLE first, then the least privilege that runs the path', () => {
  const statements = buildGrantStatements(API_ROLE_NAME, "pa'ss");
  assert.match(statements[0], /^CREATE ROLE morocco_pc_api LOGIN PASSWORD 'pa''ss'$/, 'the password is quoted, not spliced');
  assert.equal(statements.join(' ').match(/CREATE ROLE/g).length, 1);

  const insert = statements.find((s) => s.startsWith('GRANT INSERT'));
  for (const table of WRITE_TARGET_TABLES) assert.ok(insert.includes(table), table + ' must be INSERTable');
  assert.equal(statements.filter((s) => s.startsWith('GRANT INSERT')).length, 1, 'one INSERT grant, listing the six tables');

  assert.ok(statements.includes('GRANT DELETE ON build_rejection TO morocco_pc_api'));
  assert.equal(statements.filter((s) => s.startsWith('GRANT DELETE')).length, 1, 'DELETE is granted once, on one table');

  assert.ok(statements.includes('GRANT SELECT ON ALL TABLES IN SCHEMA public TO morocco_pc_api'));
  assert.ok(statements.includes('GRANT USAGE ON SCHEMA public TO morocco_pc_api'));
  assert.ok(statements.includes('GRANT UPDATE (budget_floor) ON recommendation_query TO morocco_pc_api'));
  assert.ok(statements.includes('GRANT UPDATE (engine_version, strategy_key) ON recommendation_result TO morocco_pc_api'));
  assert.ok(statements.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO morocco_pc_api'));

  assert.doesNotMatch(statements.join(' '), /GRANT UPDATE ON|GRANT ALL|GRANT CREATE/);
  assert.equal(statements.filter((s) => s.startsWith('GRANT UPDATE')).length, 2, 'exactly the two column-scoped UPDATE grants');

  // Every `true` answer must be SATISFIABLE by a grant this builder emits — an
  // expectation no grant can satisfy is a self-check that can only fail.
  for (const entry of PRIVILEGE_EXPECTATIONS.filter((e) => e.expected === true && e.kind === 'TABLE')) {
    if (entry.privilege === 'INSERT') {
      assert.ok(WRITE_TARGET_TABLES.includes(entry.target), entry.id + ' expects INSERT but the INSERT grant does not name ' + entry.target);
    } else if (entry.privilege === 'DELETE') {
      assert.ok(statements.includes('GRANT DELETE ON ' + entry.target + ' TO ' + API_ROLE_NAME), entry.id + ' expects DELETE with no grant');
    } else if (entry.privilege === 'SELECT') {
      assert.ok(statements.includes('GRANT SELECT ON ALL TABLES IN SCHEMA public TO ' + API_ROLE_NAME), entry.id + ' expects SELECT, which only the ALL TABLES grant provides');
    } else {
      assert.fail(entry.id + ' expects a table privilege no grant provides');
    }
  }
  const grantedColumns = COLUMN_UPDATE_GRANTS.flatMap((grant) => grant.columns.map((column) => grant.table + '.' + column));
  for (const entry of PRIVILEGE_EXPECTATIONS.filter((e) => e.expected === true && e.kind === 'COLUMN')) {
    assert.ok(grantedColumns.includes(entry.target + '.' + entry.column), entry.id + ' expects a column UPDATE with no grant');
  }
});

test('the redacted grant script keeps the plan printable and drops the password', () => {
  const redacted = buildGrantStatementsRedacted(API_ROLE_NAME);
  assert.equal(redacted.length, buildGrantStatements(API_ROLE_NAME, 'x').length, 'same number of statements');
  assert.match(redacted[0], /^CREATE ROLE morocco_pc_api LOGIN PASSWORD '<redacted>'$/);
  assert.doesNotMatch(redacted.join('\n'), /'PASSWORD'/, 'the sentinel used to build it must not survive');
});

test('the teardown is a REVOKE SWEEP and carries no DROP ROLE (the measured 2BP01 fix)', () => {
  const sweep = buildTeardownStatements(API_ROLE_NAME);
  assert.ok(sweep.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM morocco_pc_api'));
  assert.ok(sweep.includes('REVOKE ALL ON SCHEMA public FROM morocco_pc_api'));
  assert.ok(sweep.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM morocco_pc_api'));
  // Measured 2026-10-17: DROP ROLE exits 2BP01 while the grants are held, and
  // DROP OWNED BY is refused 42501 (the owner is not a member of the role). The
  // sweep empties pg_shdepend, and the DROP is issued only after it.
  assert.equal(sweep.filter((s) => s.startsWith('DROP ROLE')).length, 0);

  // The removal sequence a refusal prints, and the order a rollback uses: sweep
  // first, then DROP ROLE.
  const removal = buildRemovalStatements(API_ROLE_NAME);
  assert.deepEqual(removal.slice(0, sweep.length), sweep);
  assert.equal(removal[removal.length - 1], 'DROP ROLE ' + API_ROLE_NAME);
});

test('the role connection swaps the identity and never carries the owner credential', () => {
  const ownerUrl = 'postgresql://neondb_owner:owner-s3cret@ep-example-123.us-east-2.aws.neon.tech/neondb?sslmode=require';
  // The password the scripts actually generate: 24 random bytes as base64url.
  // That charset needs no escaping in a URL's userinfo, so it travels verbatim.
  const password = crypto.randomBytes(24).toString('base64url');
  const asRole = roleConnectionString(ownerUrl, API_ROLE_NAME, password);
  const parsed = new URL(asRole);
  assert.equal(parsed.username, 'morocco_pc_api');
  assert.equal(parsed.password, password, 'the generated credential round-trips unchanged');
  assert.ok(asRole.includes(password), 'and appears verbatim, not escaped');
  assert.equal(parsed.pathname, '/neondb', 'the database is preserved');
  assert.equal(parsed.hostname, 'ep-example-123.us-east-2.aws.neon.tech', 'the endpoint is preserved');
  assert.equal(parsed.search, '?sslmode=require', 'every connection parameter is preserved verbatim');
  assert.ok(!asRole.includes('owner-s3cret'), 'the owner password must not survive into the role URL');
});

test('comparePrivilegeAnswers: all 20 correct is the only PASS', () => {
  const verdict = comparePrivilegeAnswers(correctAnswers(), API_ROLE_NAME);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.checks.length, 20);
  assert.deepEqual(verdict.missing, []);
  assert.deepEqual(verdict.mismatches, []);
  assert.deepEqual(verdict.unexpected, []);
  assert.ok(verdict.checks.every((check) => check.ok && check.answered));
});

test('a MISSING answer is a failure, never a skip', () => {
  const rows = correctAnswers().filter((row) => row.id !== 'recommendation_query_update');
  const verdict = comparePrivilegeAnswers(rows, API_ROLE_NAME);
  assert.equal(verdict.ok, false, '19 of 20 answers must not read as a pass');
  assert.deepEqual(verdict.missing, ['recommendation_query_update']);
  assert.equal(verdict.mismatches.length, 0, 'nothing was WRONG — one expectation was never asked');
  const dropped = verdict.checks.find((check) => check.id === 'recommendation_query_update');
  assert.equal(dropped.answered, false);
  assert.equal(dropped.actual, null);
  assert.equal(dropped.ok, false);
});

test('an UNEXPECTED or wrong answer also fails — and an unknown (NULL) is never a pass', () => {
  const extra = comparePrivilegeAnswers(correctAnswers().concat([{ id: 'surprise_grant', allowed: true }]), API_ROLE_NAME);
  assert.equal(extra.ok, false);
  assert.deepEqual(extra.unexpected, ['surprise_grant']);

  const wrong = correctAnswers().map((row) => (row.id === 'product_insert' ? { id: row.id, allowed: true } : row));
  const wrongVerdict = comparePrivilegeAnswers(wrong, API_ROLE_NAME);
  assert.equal(wrongVerdict.ok, false);
  assert.deepEqual(wrongVerdict.mismatches, ['product_insert'], 'a grant the role must NOT have is a mismatch, not a note');

  const unknown = correctAnswers().map((row) => (row.id === 'build_rejection_delete' ? { id: row.id, allowed: null } : row));
  const unknownVerdict = comparePrivilegeAnswers(unknown, API_ROLE_NAME);
  assert.equal(unknownVerdict.ok, false, 'NULL means UNKNOWN, and UNKNOWN is not PASS');
  assert.deepEqual(unknownVerdict.mismatches, ['build_rejection_delete']);
  assert.deepEqual(unknownVerdict.missing, []);

  assert.throws(() => comparePrivilegeAnswers([{ id: 'product_select', allowed: true }, { id: 'product_select', allowed: false }]), /twice/);
  assert.throws(() => comparePrivilegeAnswers([{ allowed: true }]), /string id/);
  assert.throws(() => comparePrivilegeAnswers({}), /requires an array/);
});
