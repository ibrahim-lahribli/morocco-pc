'use strict';

/**
 * scripts/generate-presets.js - the preset ribbon generator (Platform P1
 * Sprint 6 / Decision 48).
 *
 * WHAT IT DOES. For each (use case x budget in the ribbon) it makes sure a
 * preset exists AT THE CURRENT CATALOG VERSION: if the key already has one, it
 * skips it; otherwise it runs ONE ordinary engine pass through the API's own
 * write path (`createRecommendationQuery` + `runFullRun`) and records the
 * resulting pass id in `recommendation_preset`. The endpoint then serves the
 * ribbon as landing pages, which is why the id it hands a client is a real
 * recommendation id that GET /v1/recommendations/{id} answers.
 *
 * WHY IT REUSES THE API'S WRITER INSTEAD OF ITS OWN SQL. One writer for
 * `recommendation_query` is what keeps a generated pass indistinguishable from a
 * POSTed one - same profile/query pair, same commit path, same pass facts. The
 * script therefore imports `apps/api/src/repository.js` (which owns every
 * statement against these tables) and `apps/api/src/engine.js` (the API's only
 * engine boundary), exactly as `measure-api-pass-phases.js` does.
 *
 * IDEMPOTENCY IS TWO-LAYERED, deliberately. `findPresetQueryId` is the SKIP: a
 * key that already has a preset at this catalog version runs no pass at all, so
 * a second `--commit` writes nothing. Underneath that, the table's primary key
 * plus `upsertPreset`'s ON CONFLICT make a duplicate row unrepresentable even if
 * a caller bypassed the skip. Re-running is therefore safe and cheap: the second
 * run reports every key as kept.
 *
 * RETENTION (Decision 48). A family - one (use case, currency, budget) - holds
 * ONE catalog version at a time. When a price update moves the catalog version, a
 * commit run inserts the new rows and PRUNES the family's superseded ones,
 * deleting their passes in FK order. The alternative (keep every version
 * forever) would grow the table with each price update and leave rows no request
 * can reach, because the endpoint only ever serves the current version.
 *
 * OPERATIONAL NOTE, and the reason `--cleanup` exists: a generated pass is a
 * `recommendation_query` row like any other, and the golden harness
 * (`npm run eval:scenarios`) REFUSES to run while any query row lacks its own
 * profile marker - it never deletes rows it does not own. So after a `--commit`
 * that harness stays blocked until the generated passes are removed:
 *
 *     node scripts/generate-presets.js --cleanup        # every preset + its pass
 *     node scripts/generate-presets.js --cleanup=<sha>  # just one catalog version
 *
 * The script prints that reminder itself at the end of a commit run, so the
 * consequence is stated where it happens rather than only in a document.
 *
 * Usage: node scripts/generate-presets.js [--budget-from=N] [--budget-to=N]
 *          [--step=N] [--use-case=U]... [--currency=CCC]
 *          [--model=<name@version>] [--dry-run|--commit|--cleanup[=<version>]]
 *          [--help]
 *
 * `--dry-run` is the DEFAULT: the ribbon is printed and nothing is written. The
 * `=<value>` form is mandatory for a valued flag (the parser matches prefixes),
 * and `--help` is a preflight that prints the usage text and exits 2 before any
 * flag is read or the database is touched. Exit codes: 2 for a usage problem
 * (including `--help`, an unknown flag and an out-of-vocabulary value), 1 when
 * the run itself fails - the same split `run-migrations.js` uses. `--dry-run`
 * and `--commit` are mutually exclusive rather than last-wins, so a command
 * line carrying both can never be read as a committed ribbon.
 *
 * Every write goes through `getWriteTestDbUrl()` (scripts/lib/db-url.js), which
 * refuses to run against the shared database - the branch is the only target a
 * pass may be written to. The scoring model is a PIN (`--model=` /
 * `SCORING_MODEL_PIN`), never "whichever is active": a pin selects among active
 * models and can never activate one, and a comparison harness that silently
 * measured a different model than it recorded would be worse than no harness.
 */

require('dotenv').config();

const { Client } = require('pg');

const { getWriteTestDbUrl } = require('./lib/db-url');
const modelPin = require('./lib/model-pin');

const repository = require('../apps/api/src/repository');
const engine = require('../apps/api/src/engine');
const meta = require('../apps/api/src/meta');

/** The ribbon the plan specifies: 6k-40k in 2k steps, over the model's use cases. */
const DEFAULT_BUDGET_FROM = 6000;
const DEFAULT_BUDGET_TO = 40000;
const DEFAULT_STEP = 2000;
const DEFAULT_CURRENCY = 'MAD';

/**
 * The deploy identity recorded on each generated result row (Decision 46).
 *
 * A caller-supplied string, never an engine constant: whoever knows which
 * artifact produced the rows should say so, and a production run passes
 * `ENGINE_VERSION`. The default names the generator, so a row it wrote is
 * attributable even when nobody set the variable.
 */
const ENGINE_VERSION = process.env.ENGINE_VERSION || 'generate-presets';

const USAGE = [
  'usage: node scripts/generate-presets.js [--budget-from=N] [--budget-to=N] [--step=N]',
  '         [--use-case=U]... [--currency=CCC] [--model=<name@version>]',
  '         [--dry-run|--commit|--cleanup[=<catalog-version>]] [--help]',
  'Environment: SCORING_MODEL_PIN (overridden by --model=<name@version>; else the default seed-minimal-v1@1.0.0).',
  'Default is --dry-run: nothing is written. Writes go to TEST_DATABASE_URL only.',
].join('\n');

/**
 * A bad COMMAND LINE, as opposed to a failed run.
 *
 * The distinction earns its own class because the exit code is part of the
 * interface: this repo's CLIs treat a usage problem as exit 2
 * (`run-migrations.js`, `check-offer-freshness.js`), and a caller scripting the
 * generator has to be able to tell "you asked for something impossible" from
 * "the run failed" - the first is fixed by editing the invocation, the second
 * by looking at the database. `--help` is a usage outcome too: it prints the
 * usage text and exits before anything is read.
 */
class UsageError extends Error {}

function fail(message) {
  throw new UsageError(message);
}

/**
 * Parse the command line. `env` is injected (the db-url.js / model-pin.js
 * convention) so the pin precedence is testable without the real environment.
 *
 * @param {string[]} argv
 * @param {object} [env]
 * @returns {{mode: string, cleanupVersion: string|null, budgetFrom: number,
 *   budgetTo: number, step: number, useCases: string[], currency: string,
 *   modelPin: string}}
 * @throws {Error} on `--help` (usage text, no database), an unknown or malformed
 *   flag, an inverted or zero-step ribbon, or a malformed pin
 */
function parseArgs(argv, env = process.env) {
  if (argv.includes('--help')) {
    fail(USAGE);
  }

  const args = {
    mode: 'dry-run',
    cleanupVersion: null,
    budgetFrom: DEFAULT_BUDGET_FROM,
    budgetTo: DEFAULT_BUDGET_TO,
    step: DEFAULT_STEP,
    useCases: [],
    currency: DEFAULT_CURRENCY,
  };

  // Modes are mutually exclusive rather than last-wins: a command line carrying
  // two of them is a mistake, and silently honouring the later one could turn an
  // intended --dry-run into a committed ribbon.
  const setMode = (mode) => {
    if (args.modeSet && args.mode !== mode) {
      fail('--dry-run, --commit and --cleanup are mutually exclusive');
    }
    args.mode = mode;
    args.modeSet = true;
  };

  const number = (name, raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      fail('--' + name + ' must be a positive finite number');
    }
    return value;
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      setMode('dry-run');
    } else if (arg === '--commit') {
      setMode('commit');
    } else if (arg === '--cleanup') {
      setMode('cleanup');
    } else if (arg.startsWith('--cleanup=')) {
      const value = arg.slice('--cleanup='.length);
      if (value.length === 0) {
        fail('--cleanup= needs a catalog version (use --cleanup for every version)');
      }
      setMode('cleanup');
      args.cleanupVersion = value;
    } else if (arg.startsWith('--budget-from=')) {
      args.budgetFrom = number('budget-from', arg.slice('--budget-from='.length));
    } else if (arg.startsWith('--budget-to=')) {
      args.budgetTo = number('budget-to', arg.slice('--budget-to='.length));
    } else if (arg.startsWith('--step=')) {
      args.step = number('step', arg.slice('--step='.length));
    } else if (arg.startsWith('--use-case=')) {
      const value = arg.slice('--use-case='.length);
      if (value.length === 0) {
        fail('--use-case= needs a use case');
      }
      args.useCases.push(value);
    } else if (arg.startsWith('--currency=')) {
      args.currency = arg.slice('--currency='.length);
    } else if (arg.startsWith(modelPin.MODEL_FLAG)) {
      // Read by modelPinValue below; matched here so the flag is not "unknown".
      // `--model=` with an empty value is a mistake the pin reader refuses.
      continue;
    } else {
      fail('unknown argument: ' + arg);
    }
  }

  if (args.budgetTo < args.budgetFrom) {
    fail('--budget-to must be at or above --budget-from');
  }
  if (args.mode === 'cleanup') {
    // cleanup takes no ribbon - it is a maintenance mode, not a generation run -
    // so the use cases collected above are dropped rather than silently scoping
    // a delete that its own scope flag (`--cleanup=<version>`) already defines.
    args.useCases = [];
  }

  // Flag beats environment beats the legacy default; a blank flag does NOT shadow
  // the next level down (model-pin.js modelPinValue).
  args.modelPin = modelPin.modelPinValue(modelPin.readModelPinFlag(argv), env);
  // Malformed pins fail BEFORE the connection is opened, and they are the USER'S
  // mistake rather than the database's - so the shared reader's error (a plain
  // Error, since it is also a library) is re-raised as a usage error here. That
  // keeps the exit-code rule true end to end: 2 means fix the invocation.
  try {
    modelPin.parseModelPin(args.modelPin);
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
  }
  return args;
}

/** The ribbon's budgets, inclusive of both ends, as a deterministic ascending list. */
function budgetRibbon(from, to, step) {
  const budgets = [];
  // Integer cents-free arithmetic is not needed: the API's budgets are whole MAD
  // amounts, and the loop is bounded by the plan's own ribbon.
  for (let budget = from; budget <= to; budget += step) {
    budgets.push(budget);
  }
  return budgets;
}

/**
 * Delete the passes a set of preset rows pointed at, in FK order.
 *
 * Order is not stylistic: `build_component` references `build_candidate`,
 * `recommendation_result` references both the query and the candidate, and all
 * of them are ON DELETE NO ACTION, so a wrong order raises a constraint
 * violation and leaves the rows behind. `build_rejection` and
 * `recommendation_preset` rows cascade from the query and need no statement of
 * their own (the preset rows are already gone by the time this runs).
 *
 * The profile is captured BEFORE the queries are deleted (its id lives on the
 * query row) and removed only when nothing else references it, so this can never
 * take a profile that another pass still points at.
 *
 * @param {object} client a single dedicated connection
 * @param {string[]} queryIds the passes to remove
 * @returns {Promise<{queries: number, profiles: number, results: number, components: number}>}
 */
async function deletePasses(client, queryIds) {
  if (queryIds.length === 0) {
    return { queries: 0, profiles: 0, results: 0, components: 0 };
  }
  await client.query('BEGIN');
  try {
    await client.query(
      'DELETE FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])',
      [queryIds]
    );
    const results = await client.query(
      'DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])',
      [queryIds]
    );
    const components = await client.query(
      'DELETE FROM build_component WHERE build_candidate_id IN ('
      + ' SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))',
      [queryIds]
    );
    await client.query(
      'DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])',
      [queryIds]
    );
    const profileIds = (await client.query(
      'SELECT DISTINCT recommendation_profile_id AS id FROM recommendation_query'
      + ' WHERE id = ANY($1::uuid[]) AND recommendation_profile_id IS NOT NULL',
      [queryIds]
    )).rows.map((row) => row.id);
    const queries = await client.query(
      'DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])',
      [queryIds]
    );
    let profiles = { rowCount: 0 };
    if (profileIds.length > 0) {
      profiles = await client.query(
        'DELETE FROM recommendation_profile WHERE id = ANY($1::uuid[])'
        + ' AND NOT EXISTS (SELECT 1 FROM recommendation_query q'
        + '                  WHERE q.recommendation_profile_id = recommendation_profile.id)',
        [profileIds]
      );
    }
    await client.query('COMMIT');
    return {
      queries: queries.rowCount,
      profiles: profiles.rowCount || 0,
      results: results.rowCount,
      components: components.rowCount,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

/** One key's state: the pass it already has, or null. */
async function inspectKey(db, key) {
  return repository.findPresetQueryId(db, key);
}

/**
 * Make sure the ribbon HAS this key at this catalog version.
 *
 * The SKIP lives here, and it is the reason a second `--commit` writes nothing:
 * a key that already has a preset at the current version runs NO pass at all.
 * It is a separate function from the write so the branch suite can drive the
 * SAME decision the CLI does - a test that re-implemented the skip could agree
 * with itself while the script behaved differently.
 *
 * The two layers of idempotency are deliberately visible from here:
 * `findPresetQueryId` decides whether to run a pass at all, and behind it the
 * table's primary key + `upsertPreset`'s ON CONFLICT make a duplicate ROW
 * unrepresentable even if this check were bypassed.
 *
 * @param {object} client a single dedicated connection
 * @param {object} key { scoringModelId, useCase, currency, catalogVersion, budgetAmount }
 * @returns {Promise<{status: 'kept'|'created'|'empty-pool', queryId: string|null}>}
 */
async function ensureKey(client, key) {
  const existing = await inspectKey(client, key);
  if (existing !== null) {
    return { status: 'kept', queryId: existing };
  }
  return generateOne(client, key);
}

/**
 * Run one pass for a key and record the preset.
 *
 * `EMPTY_CANDIDATE_POOL` is handled as the pass's own outcome rather than as a
 * failure: such a pass throws inside the read stage, BEFORE its write
 * transaction, so its query row has no pass facts and is not an answer. The row
 * this function created is removed again (leaving no residue and no preset) and
 * the key is reported as `empty-pool`, which is what it is - the catalog cannot
 * build anything at that budget, so there is no landing page to serve.
 *
 * @returns {Promise<{status: 'created'|'empty-pool', queryId: string|null}>}
 */
async function generateOne(client, key) {
  const created = await repository.createRecommendationQuery(client, {
    scoringModelId: key.scoringModelId,
    budgetAmount: key.budgetAmount,
    currency: key.currency,
    useCase: key.useCase,
    catalogVersion: key.catalogVersion,
  });
  try {
    await engine.runFullRun(client, created.queryId, ENGINE_VERSION);
  } catch (error) {
    if (error && error.code === 'EMPTY_CANDIDATE_POOL') {
      await deletePasses(client, [created.queryId]);
      return { status: 'empty-pool', queryId: null };
    }
    throw error;
  }
  await repository.upsertPreset(client, {
    useCase: key.useCase,
    currency: key.currency,
    catalogVersion: key.catalogVersion,
    budgetAmount: key.budgetAmount,
    queryId: created.queryId,
  });
  return { status: 'created', queryId: created.queryId };
}

/**
 * Resolve the run's fixed inputs: the pinned model, the catalog version of THIS
 * moment, and the use cases to generate for.
 *
 * The use-case list is the ACTIVE model's vocabulary unless flags narrow it
 * (Decision 37), and an explicit use case outside that vocabulary is refused
 * rather than skipped: a ribbon that silently generated fewer pages than asked
 * for would look like a successful run.
 */
async function resolveRun(db, args) {
  const model = await modelPin.resolvePinnedModel(db, args.modelPin);
  const vocabulary = engine.useCaseVocabulary(model.configuration);
  if (vocabulary === null) {
    fail('the pinned model declares no use-case vocabulary - nothing to generate');
  }
  const useCases = args.useCases.length > 0 ? args.useCases : meta.useCaseValues(vocabulary);
  for (const useCase of useCases) {
    if (!meta.isAllowedUseCase(useCase, vocabulary)) {
      fail('--use-case=' + useCase + ' is not one of: ' + meta.useCaseValues(vocabulary).join(', '));
    }
  }
  if (!meta.isAllowedCurrency(args.currency)) {
    fail('--currency=' + args.currency + ' is not one of: '
      + meta.CURRENCIES.map((entry) => entry.value).join(', '));
  }
  // The catalog version is a hard precondition for BOTH modes: it keys every row
  // this run writes and every row a subsequent run compares against. A digest
  // that cannot be computed is a refusal here, never a run under an unknown
  // version.
  const catalogVersion = await engine.catalogVersion(db);
  return { model, useCases, catalogVersion };
}

async function main() {
  const args = parseArgs(process.argv);
  const client = new Client({ ...getWriteTestDbUrl(), connectionTimeoutMillis: 15000 });
  await client.connect();
  try {
    if (args.mode === 'cleanup') {
      const scope = args.cleanupVersion === null ? {} : { catalogVersion: args.cleanupVersion };
      const queryIds = await repository.deletePresets(client, scope);
      const removed = await deletePasses(client, queryIds);
      console.log('CLEANUP: removed ' + queryIds.length + ' preset row(s) and '
        + removed.queries + ' pass(es), ' + removed.results + ' result row(s), '
        + removed.components + ' component row(s), ' + removed.profiles + ' profile(s)'
        + (args.cleanupVersion === null ? '' : ' for catalog version ' + args.cleanupVersion));
      return;
    }

    const run = await resolveRun(client, args);
    const budgets = budgetRibbon(args.budgetFrom, args.budgetTo, args.step);
    console.log('model: ' + run.model.name + ' ' + run.model.version + ' [pin ' + args.modelPin + ']');
    console.log('catalog version: ' + run.catalogVersion);
    console.log('ribbon: ' + budgets.length + ' budgets x ' + run.useCases.length
      + ' use case(s) in ' + args.currency + ' = ' + (budgets.length * run.useCases.length) + ' keys');

    let created = 0;
    let kept = 0;
    let emptyPool = 0;
    let pruned = 0;
    let prunedPasses = 0;

    for (const useCase of run.useCases) {
      for (const budgetAmount of budgets) {
        const key = {
          scoringModelId: run.model.id,
          useCase,
          currency: args.currency,
          catalogVersion: run.catalogVersion,
          budgetAmount,
        };
        // A dry run reports what a commit WOULD do, so it makes the same skip
        // decision and stops there: no pass, no write, no prune.
        if (args.mode === 'dry-run') {
          if (await inspectKey(client, key) === null) {
            created += 1;
          } else {
            kept += 1;
          }
          continue;
        }
        const outcome = await ensureKey(client, key);
        if (outcome.status === 'empty-pool') {
          emptyPool += 1;
          continue;
        }
        if (outcome.status === 'kept') {
          kept += 1;
          continue;
        }
        created += 1;
        // Pruning runs only after a row was actually written for this key: a
        // kept key's family is already down to this version, so re-deleting
        // would be a no-op statement per key on every run.
        const superseded = await repository.deleteSupersededPresets(client, key);
        pruned += superseded.length;
        if (superseded.length > 0) {
          const removed = await deletePasses(client, superseded);
          prunedPasses += removed.queries;
        }
      }
    }

    console.log((args.mode === 'dry-run' ? 'DRY-RUN (nothing written): ' : 'COMMIT: ')
      + created + (args.mode === 'dry-run' ? ' key(s) would be generated, ' : ' generated, ')
      + kept + ' kept (already present at this catalog version)'
      + (emptyPool > 0 ? ', ' + emptyPool + ' key(s) assembled nothing and were not recorded' : '')
      + (pruned > 0 ? ', ' + pruned + ' superseded row(s) pruned with ' + prunedPasses + ' pass(es)' : ''));
    if (args.mode === 'commit' && created > 0) {
      console.log('NOTE: the generated passes are unmarked `recommendation_query` rows, so'
        + ' `npm run eval:scenarios` will refuse to run until they are removed:'
        + ' node scripts/generate-presets.js --cleanup');
    }
  } finally {
    await client.end();
  }
}

module.exports = {
  parseArgs,
  budgetRibbon,
  deletePasses,
  generateOne,
  ensureKey,
  inspectKey,
  resolveRun,
  UsageError,
  ENGINE_VERSION,
  USAGE,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(error instanceof UsageError ? 2 : 1);
  });
}
