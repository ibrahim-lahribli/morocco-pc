'use strict';

// scripts/lib/replay-harness.test.js — tests for the pure, DB-free helpers of
// scripts/verify-migrations-replay.js.
//
// Every helper under test takes an injected client and never connects, so
// these run offline. They pin the failure modes that cost the most time on
// 2026-10-05: pointing the harness at the shared database, leaving a scratch
// database behind, and manufacturing drift that does not exist.
//
// NOT part of `npm run test:unit` (that glob is `src/**/*.test.js`); run with:
//   npm run test:scripts

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SCRATCH_DB,
  SNAPSHOT_QUERIES,
  listMigrations,
  scratchDatabaseUrl,
  dropScratchDatabase,
  withScratchDatabase,
  resolveReplayTarget,
  parseReference,
} = require('../verify-migrations-replay');

function fakeClient() {
  const calls = [];
  return { calls, query: async (sql) => { calls.push(sql); return { rows: [] }; } };
}

describe('verify-migrations-replay helpers', () => {
  // Review Focus #1: the scratch database must be a name this script invents,
  // never anything derived from the shared DATABASE_URL.
  it('scratch database name is invented, never the shared database', () => {
    assert.equal(SCRATCH_DB, 'migrations_replay_tmp');
    const base = 'postgres://u:p@host.example/neondb?sslmode=require';
    const derived = scratchDatabaseUrl(base, SCRATCH_DB);
    assert.match(derived, /\/migrations_replay_tmp\?/);
    assert.notEqual(new URL(derived).pathname, new URL(base).pathname);
  });

  it('scratchDatabaseUrl preserves credentials and query string', () => {
    const base = 'postgres://u:p@host.example/neondb?sslmode=require';
    const derived = new URL(scratchDatabaseUrl(base, SCRATCH_DB));
    assert.equal(derived.username, 'u');
    assert.equal(derived.hostname, 'host.example');
    assert.equal(derived.searchParams.get('sslmode'), 'require');
  });

  // Review Focus #2 (half): schema_migrations is created by run-migrations.js,
  // not by a numbered migration, so a fresh replay legitimately lacks it.
  // Including it in any snapshot manufactures drift that does not exist.
  it('every snapshot query excludes schema_migrations', () => {
    const names = Object.keys(SNAPSHOT_QUERIES);
    assert.ok(names.length > 0, 'SNAPSHOT_QUERIES must not be empty');
    for (const name of names) {
      assert.match(
        SNAPSHOT_QUERIES[name],
        /schema_migrations/,
        `query for class "${name}" must reference schema_migrations to exclude it`,
      );
    }
  });

  it('snapshot classes cover columns, checks, fks and indexes', () => {
    assert.deepEqual(Object.keys(SNAPSHOT_QUERIES).sort(), ['checks', 'columns', 'fks', 'indexes']);
  });

  // A definition-level comparison is the whole point of this gate (C-30), so
  // the constraints and indexes classes must not degrade back to name-only.
  it('constraint and index queries select definitions, not just names', () => {
    assert.match(SNAPSHOT_QUERIES.checks, /pg_get_constraintdef/);
    assert.match(SNAPSHOT_QUERIES.fks, /pg_get_constraintdef/);
    assert.match(SNAPSHOT_QUERIES.indexes, /indexdef/);
    assert.match(SNAPSHOT_QUERIES.columns, /udt_name/);
  });

  it('listMigrations returns the migration files in numeric order', () => {
    const files = listMigrations('database/migrations');
    assert.ok(files.length >= 15, `expected at least 15 migrations, found ${files.length}`);
    assert.equal(files[0], '001_extensions.sql');
    assert.deepEqual(files, files.slice().sort(), 'migrations must be applied in filename order');
  });

  // Review Focus #2: the harness must never be able to target the shared DB.
  it('refuses to resolve a replay target without TEST_DATABASE_URL', () => {
    assert.throws(
      () => resolveReplayTarget({ DATABASE_URL: 'postgres://u:p@shared.example/neondb' }),
      /TEST_DATABASE_URL/,
    );
  });

  it('refuses a TEST_DATABASE_URL that points at the shared database', () => {
    assert.throws(
      () => resolveReplayTarget({
        DATABASE_URL: 'postgres://u:p@shared.example/neondb',
        TEST_DATABASE_URL: 'postgres://u:p@shared.example/neondb',
      }),
      /shared/,
    );
  });

  describe('parseReference', () => {
    it('defaults to the shared database', () => {
      assert.deepStrictEqual(parseReference(['--test-db']), { reference: 'shared' });
    });

    it('accepts --reference=test', () => {
      assert.deepStrictEqual(parseReference(['--test-db', '--reference=test']), { reference: 'test' });
    });

    it('accepts an explicit --reference=shared', () => {
      assert.deepStrictEqual(parseReference(['--test-db', '--reference=shared']), { reference: 'shared' });
    });

    it('rejects anything else', () => {
      assert.match(parseReference(['--test-db', '--reference=bogus']).error, /test or shared/);
    });
  });


  // Review Focus #3: cleanup must terminate other backends before dropping.
  it('dropScratchDatabase terminates backends then drops the database', async () => {
    const client = fakeClient();
    await dropScratchDatabase(client, SCRATCH_DB);
    const joined = client.calls.join('\n');
    assert.match(joined, /pg_terminate_backend/);
    assert.match(joined, new RegExp(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`));
    assert.ok(
      client.calls.findIndex((c) => /pg_terminate_backend/.test(c))
        < client.calls.findIndex((c) => /DROP DATABASE/.test(c)),
      'backends must be terminated before the DROP, or the DROP fails',
    );
  });

  // Review Focus #3 again, on the failure path.
  it('withScratchDatabase drops the scratch database even when the body throws', async () => {
    const client = fakeClient();
    await assert.rejects(
      withScratchDatabase(client, SCRATCH_DB, async () => { throw new Error('boom'); }),
      /boom/,
    );
    assert.match(client.calls.join('\n'), new RegExp(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`));
  });

  it('withScratchDatabase drops on the success path too', async () => {
    const client = fakeClient();
    await withScratchDatabase(client, SCRATCH_DB, async () => 'done');
    assert.match(client.calls.join('\n'), new RegExp(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`));
  });

  it('withScratchDatabase keeps the database when asked to', async () => {
    const client = fakeClient();
    await withScratchDatabase(client, SCRATCH_DB, async () => 'done', { keepDb: true });
    assert.doesNotMatch(client.calls.join('\n'), /DROP DATABASE/);
  });

  // `if (opts.keepDb) return;` inside a finally block OVERRIDES the pending
  // return, so the caller received undefined and read `.failed` off it. That made
  // the documented --keep-db flag crash on every invocation while the test above
  // still passed, because it discarded the return value. The value must survive.
  it('withScratchDatabase still returns the body result when keeping the database', async () => {
    const client = fakeClient();
    const result = await withScratchDatabase(client, SCRATCH_DB, async () => ({ failed: null }), {
      keepDb: true,
    });
    assert.deepEqual(result, { failed: null });
  });

  it('withScratchDatabase returns the body result on the drop path too', async () => {
    const client = fakeClient();
    const result = await withScratchDatabase(client, SCRATCH_DB, async () => ({ failed: null }));
    assert.deepEqual(result, { failed: null });
  });

  // Throwing from a finally block replaces the in-flight exception, so a failed
  // DROP buries the migration error that actually caused the run to stop.
  it('a failing cleanup does not mask the original error', async () => {
    const client = {
      calls: [],
      query: async (sql) => {
        client.calls.push(sql);
        if (/DROP DATABASE/.test(sql)) throw new Error('DROP refused: being accessed');
        return { rows: [] };
      },
    };
    await assert.rejects(
      withScratchDatabase(client, SCRATCH_DB, async () => {
        throw new Error('REAL BUG: migration 003 failed');
      }),
      /REAL BUG/,
      'the body error must win over the cleanup error',
    );
  });

  it('attaches the cleanup error to the original error for diagnosis', async () => {
    const client = {
      calls: [],
      query: async (sql) => {
        if (/DROP DATABASE/.test(sql)) throw new Error('DROP refused: being accessed');
        return { rows: [] };
      },
    };
    await withScratchDatabase(client, SCRATCH_DB, async () => {
      throw new Error('REAL BUG: migration 003 failed');
    }).catch((err) => {
      assert.match(err.cleanupError, /DROP refused/);
    });
  });

  it('a failing cleanup IS reported when the body succeeded', async () => {
    const client = {
      calls: [],
      query: async (sql) => {
        if (/DROP DATABASE/.test(sql)) throw new Error('DROP refused: being accessed');
        return { rows: [] };
      },
    };
    await assert.rejects(
      withScratchDatabase(client, SCRATCH_DB, async () => 'done'),
      /DROP refused/,
    );
  });
});
