Superseded by: docs/OPEN_POINTS.md on 2026-11-02

# Catalogue Identity and Served-Model Pin — Remaining Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the two gaps the 2026-11-01 handoff leaves open — un-applied catalogue identity on shared and EU, an un-booked register row, three stale doc claims, and two untested halves of Decision 62 — without touching engine behaviour.

**Architecture:** Two new DB-free code artifacts (a pure identity evaluator plus a read-only CLI gate, and two API test files that exercise the pin against stubs-parity and a real `scoring_model` table), then documentation bookkeeping, then three owner-gated real-database acts that need restore points. No engine module, migration, seed body or API source file changes.

**Tech Stack:** Node.js 22, CommonJS, `node --test`, `pg` (root `node_modules`), GitHub Actions, PostgreSQL on Neon (shared + EU + TEST branch), Markdown docs that are CRLF (and, for the decision log, BOM-prefixed).

**Spec:** `docs/HANDOFF_2026-11-01_catalogue_identity.md` — this plan implements sections 4.1–4.7 and deliberately excludes 4.8 (OG-58), which is an engine-retention epic with its own Decision and full 20-scenario rebaseline.

## Global Constraints

- **Never reset, drop, truncate or restore the shared Neon database** (AGENTS.md §8). A restore point is a *precondition* of a write, never a remedy.
- **Write-capable tests go through `scripts/lib/db-url.js` and `TEST_DATABASE_URL` only.** Only the four tasks marked OPERATOR touch a real database, and each is gated on a recorded restore point supplied by the owner.
- **Read-only gates never invent a pass.** A gate that cannot see anything prints `INCONCLUSIVE` (exit 0) and says so in words; it does not print `PASS`.
- **Flags use the equals form and take variable NAMES, never URLs:** `--target=env:NAME`, `--max-examples=N`. A space form is a usage error (exit 2). No connection string is ever printed.
- **Determinism:** ordering is code-unit (never `localeCompare`); no clock read, no randomness, no mutation inside `scripts/lib/`.
- **No new dependencies.** `pg` and `dotenv` resolve from the root `node_modules`; `apps/api` has no `package.json` of its own, so every API test runs from the repo root (`npm run test:api`, `npm run test:api:db`).
- **Node 22 is what CI runs.** Reproduce a suite with `npx -y node@22 --test "<glob>"` before claiming green; a nested/unterminated test is `cancelledByParent` on 22 and silently runs on 24 (AGENTS.md §7 item 15).
- **CRLF + BOM.** `CONTEXT.md`, `AGENTS.md`, `docs/TEST_MAP.md` and `docs/OPEN_GAPS.md` are CRLF; `docs/RECOMMENDATION_ENGINE_DECISIONS.md` is CRLF **with a UTF-8 BOM**. Edit through an exact `split(from).join(to)` (or `replace`) in a node script, anchor wholly inside one physical line, and never "normalise" line endings — `str_replace`'s whitespace-insensitive matcher joins wrapped lines.
- **A table row in `docs/OPEN_GAPS.md` is one physical line.** Preserve `\r\n` terminators and keep the row contiguous with its table.

## Review Focus

The five input classes this work meets that no unit test of the changed functions would otherwise exercise, most likely first. Each is pinned by a named test in the task that owns the code.

1. **A catalogue that is EMPTY.** A gate run against a freshly replayed or freshly created database sees zero ACTIVE products. Expected: `INCONCLUSIVE` (exit 0) that says nothing could be checked — not `PASS`, which would read as "identity verified". Pinned in Task 1 (test: empty scope).
2. **A product missing only ONE of the two identity columns.** `slug` filled with `display_name` NULL (or the reverse) is still unservable-by-identity, and the report must name *which* column is missing rather than a generic failure. Pinned in Task 1 (tests: both single-column cases).
3. **More offenders than the report prints.** A broken catalogue can hold thousands of NULL-slug rows; the verdict must count them all while printing a bounded sample, or the nightly log becomes unreadable and nobody reads the count either. Pinned in Task 1 (test: 25 offenders, cap 20, count 25).
4. **A pin naming a row that exists but is INACTIVE.** This is the silent-activation hazard Decision 11 forbids: the answer must be a `503`-backed refusal, never "serve the inactive row" and never "fall back to the newest active row". Pinned in Task 3 against the real `scoring_model` table.
5. **A pin with surrounding whitespace, or a second `@`.** Operators paste values with trailing spaces; the two parsers must refuse or accept the *same* inputs, or the harness and the deployment disagree about the same string. Pinned in Task 4 (shared table, both parsers).

---

**Status 2026-11-02: Tasks 1-6 are DONE** (commits `a207d82`, `ea2e28f`, `00006db`, `c6ee910`,
`e38e0f9`, `d33f128`; this document is `8ef05a7`, and `0510089` corrected Decision 62's test count).
Measured at HEAD: `test:unit` 1261, `test:scripts` 443, `test:api` 193, `test:api:db` 17,
`verify:docs` OK. **Tasks 7-10 are OPERATOR-gated**: a shared restore point, an EU restore point and
a deploy, none of which this checkout can provide.

## Task 1: The pure identity evaluator

**Files:**
- Create: `scripts/lib/catalog-identity.js`
- Test: `scripts/lib/catalog-identity.test.js`

**Interfaces:**
- Consumes: nothing (pure module, no I/O).
- Produces:
  - `IDENTITY_COLUMNS: readonly ['slug', 'display_name']`
  - `VERDICTS: { PASS: 'PASS', FAIL: 'FAIL', INCONCLUSIVE: 'INCONCLUSIVE' }`
  - `missingIdentityColumns(row: object) -> string[]` — keys of `IDENTITY_COLUMNS` whose value is `null`/`undefined`, in `IDENTITY_COLUMNS` order.
  - `evaluateCatalogIdentity({ scopeSize: number, rows: object[] }) -> { verdict: string, scopeSize: number, offenderCount: number, offenders: { id: string, name: string, missing: string[] }[] }` — `offenders` sorted by `id` code-unit ascending and containing ONLY rows with a missing column.
  - `verdictExitCode(verdict: string) -> 0 | 1`
  - `formatReport(result, maxExamples = 20) -> string[]`

- [x] **Step 1: Write the failing tests**

```js
// scripts/lib/catalog-identity.test.js
const test = require('node:test');
const assert = require('node:assert');

const identity = require('./catalog-identity');

test('an EMPTY scope is INCONCLUSIVE, never PASS', () => {
  const result = identity.evaluateCatalogIdentity({ scopeSize: 0, rows: [] });
  assert.equal(result.verdict, identity.VERDICTS.INCONCLUSIVE);
  assert.equal(identity.verdictExitCode(result.verdict), 0);
});

test('a fully identified ACTIVE catalogue is PASS with no offenders', () => {
  const rows = [{ id: 'p1', name: 'A', slug: 'a', display_name: 'A' }];
  const result = identity.evaluateCatalogIdentity({ scopeSize: 1, rows });
  assert.equal(result.verdict, identity.VERDICTS.PASS);
  assert.equal(result.offenderCount, 0);
  assert.equal(identity.verdictExitCode(result.verdict), 0);
});

test('a row missing BOTH columns is a FAIL naming both, in fixed order', () => {
  const rows = [{ id: 'p1', name: 'A', slug: null, display_name: null }];
  const result = identity.evaluateCatalogIdentity({ scopeSize: 1, rows });
  assert.equal(result.verdict, identity.VERDICTS.FAIL);
  assert.equal(identity.verdictExitCode(result.verdict), 1);
  assert.deepEqual(result.offenders[0].missing, ['slug', 'display_name']);
});

test('either column alone is enough to fail, and the missing one is named', () => {
  assert.deepEqual(
    identity.missingIdentityColumns({ slug: null, display_name: 'X' }), ['slug']
  );
  assert.deepEqual(
    identity.missingIdentityColumns({ slug: 'x', display_name: null }), ['display_name']
  );
  assert.deepEqual(
    identity.missingIdentityColumns({ slug: 'x', display_name: 'X' }), []
  );
});

test('offenders are ordered by id code-unit, not locale', () => {
  const rows = [
    { id: 'b', name: 'b', slug: null, display_name: null },
    { id: 'A', name: 'A', slug: null, display_name: null },
    { id: '_z', name: 'z', slug: null, display_name: null },
    { id: 'a', name: 'a', slug: null, display_name: null },
  ];
  const result = identity.evaluateCatalogIdentity({ scopeSize: 4, rows });
  assert.deepEqual(result.offenders.map((o) => o.id), ['A', '_z', 'a', 'b']);
});

test('the report counts every offender but prints at most maxExamples', () => {
  const rows = [];
  for (let i = 0; i < 25; i += 1) {
    rows.push({ id: 'p' + String(i).padStart(2, '0'), name: 'n' + i, slug: null, display_name: null });
  }
  const result = identity.evaluateCatalogIdentity({ scopeSize: 25, rows });
  assert.equal(result.offenderCount, 25);
  const lines = identity.formatReport(result, 20);
  assert.match(lines[0], /FAIL/);
  assert.match(lines[0], /25/);
  assert.equal(lines.filter((l) => l.startsWith('  ')).length, 20);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/lib/catalog-identity.test.js`
Expected: FAIL — `Cannot find module './catalog-identity'`.

- [x] **Step 3: Implement `scripts/lib/catalog-identity.js`**

Header comment must state, in the house style: why the gate exists (a served `slug: null`), why the scope is EVERY ACTIVE product and not "ACTIVE products with an eligible offer" (`repository.js` filters `p.slug IS NOT NULL` and addresses the catalog by `slug`, so a NULL slug removes the product from the catalog entirely while its recommendation component still ships `slug: null`), why the column stays nullable (migration 020 says so in its own header, so a constraint would reverse that decision), and the three-valued verdict vocabulary.

`evaluateCatalogIdentity` builds `offenders` by mapping each row through `missingIdentityColumns`, keeping only non-empty results, then sorting with an explicit comparator (`a.id < b.id ? -1 : a.id > b.id ? 1 : 0`). Verdict order: `scopeSize === 0` → `INCONCLUSIVE`; else `offenderCount > 0` → `FAIL`; else `PASS`.

`formatReport` returns:
- `['RESULT: PASS - N ACTIVE product(s), every one carries slug and display_name']`
- `['RESULT: INCONCLUSIVE - no ACTIVE product exists; nothing could be checked']`
- `['RESULT: FAIL - X of N ACTIVE product(s) missing identity (showing M):', '  id=… name="…" missing=slug,display_name', …]`

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/lib/catalog-identity.test.js`
Expected: PASS, 6/6.

- [x] **Step 5: Confirm the suite picks it up on Node 22**

Run: `npx -y node@22 --test "scripts/lib/catalog-identity.test.js"`
Expected: PASS, `# cancelled 0`.

- [x] **Step 6: Commit**

```bash
git add scripts/lib/catalog-identity.js scripts/lib/catalog-identity.test.js
git commit -m "Add the pure half of the catalogue-identity gate"
```

---

## Task 2: The gate, its wiring, and its documentation

**Files:**
- Create: `scripts/check-catalog-identity.js`
- Modify: `.github/workflows/ci.yml` (`recurring-gates`, after the provenance step)
- Modify: `AGENTS.md` (§6 command table — one row)
- Modify: `docs/TEST_MAP.md` (one row, in the table that ends at line ~93)

**Interfaces:**
- Consumes: `evaluateCatalogIdentity`, `formatReport`, `verdictExitCode`, `VERDICTS` from Task 1.
- Produces: a CLI with exit codes `0` (PASS or INCONCLUSIVE), `1` (FAIL or the catalogue could not be read), `2` (usage).

- [x] **Step 1: Implement the CLI**

`scripts/check-catalog-identity.js`, mirroring `scripts/check-offer-provenance.js` structure (`require('dotenv').config()`, `USAGE` array, argv parse that rejects any non-`=` form with exit 2, `Client` connect, print, exit).

One SELECT, and NO offer join — the scope decision is deliberate (see Task 1's header) and must be stated in this file's header too:

```sql
SELECT p.id, p.name, p.slug, p.display_name
FROM product p
WHERE p.lifecycle_status = 'ACTIVE'
ORDER BY p.id ASC
```

Then `evaluateCatalogIdentity({ scopeSize: rows.length, rows })`, print `formatReport(result, maxExamples)`, `process.exit(verdictExitCode(result.verdict))`. A connection or query error prints `FAIL - the catalogue could not be read: <message>`, never the connection string, and exits 1. `--help` prints `USAGE` and exits 2.

- [x] **Step 2: Verify usage handling contacts nothing**

```bash
node scripts/check-catalog-identity.js --help; echo "exit=$?"
node scripts/check-catalog-identity.js --target env:DATABASE_URL; echo "exit=$?"
```
Expected: usage text, `exit=2`; then a usage error, `exit=2`.

- [x] **Step 3: Verify the verdict against both real catalogues**

```bash
node scripts/check-catalog-identity.js; echo "exit=$?"
node scripts/check-catalog-identity.js --target=env:TEST_DATABASE_URL; echo "exit=$?"
```
Expected **before Task 7 lands**: shared ⇒ `RESULT: FAIL - 13 of 113 ACTIVE product(s) missing identity`, `exit=1`; TEST branch ⇒ `RESULT: PASS - 113 ACTIVE product(s) …`, `exit=0`. The shared FAIL is the gate proving it detects the live defect; it is expected to stay red until Task 7.

- [x] **Step 4: Wire it into the nightly job**

In `.github/workflows/ci.yml`, inside `recurring-gates`, immediately after the `check-offer-provenance.js` step, add a commented step in the same style:

```yaml
      # Does every ACTIVE product carry the identity the API serves and orders by?
      # Seeds 023-025 once inserted 13 rows with NULL slug/display_name and shipped a
      # `slug: null` component to the deployed origin (HANDOFF_2026-11-01). RED here
      # means catalogue DATA, and the repair is a seed, not a code change.
      - run: node scripts/check-catalog-identity.js
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

- [x] **Step 5: Document the command and the contract**

- `AGENTS.md` §6: add one row in the table's style — `node scripts/check-catalog-identity.js [--target=env:NAME] [--max-examples=N]` … read-only; `PASS` only when every ACTIVE product carries both columns, `FAIL` (exit 1) naming each offender, `INCONCLUSIVE` when the catalogue is empty; nightly in `recurring-gates`.
- `docs/TEST_MAP.md`: add one row in the same table as the served-model row — the contract (identity is a served field, not an optional extra) and its pin (`scripts/lib/catalog-identity.test.js`, part of `npm run test:scripts`), plus the failure mode (`slug: null` reaching a client; a NULL-slug product vanishing from the keyset page walk).

Both files are CRLF: edit with a node `split(from).join(to)` anchored inside one physical line.

- [x] **Step 6: Run the gates**

```bash
npm run test:scripts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run verify:docs 2>&1 | tail -3
node scripts/gen-decision-index.js --check
```
Expected: 443 tests (437 + 6), 0 fail; `verify-docs: OK`; `gen-decision-index: OK`.

- [x] **Step 7: Commit**

```bash
git add scripts/check-catalog-identity.js .github/workflows/ci.yml AGENTS.md docs/TEST_MAP.md
git commit -m "Gate the catalogue identity the API serves"
```

---

## Task 3: The pin against a real `scoring_model` table

**Files:**
- Create: `apps/api/test/db/scoring-model-pin.db.test.js`

**Interfaces:**
- Consumes: `repository.selectActiveScoringModel(db, pin)` (already exported), `resolveTestDbUrl(env)` from `scripts/lib/db-url.js`.
- Produces: nothing importable; a read-only DB suite the `test:api:db` launcher picks up by glob.

- [x] **Step 1: Write the failing tests**

Read-only by construction: the file issues SELECTs only, so it needs no cleanup and asserts no residue. Header must say why a real database is required (the pin's contract is a `WHERE … is_active = true` over rows, and stub rows cannot prove the statement selects the row the operator named).

```js
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { resolveTestDbUrl } = require('../../../../scripts/lib/db-url');
const repository = require('../../src/repository');

const pool = new Pool({ ...resolveTestDbUrl(process.env), max: 1 });
test.after(async () => { await pool.end(); });

const ROWS_SQL = 'SELECT id, name, version, is_active, created_at FROM scoring_model'
  + ' ORDER BY created_at DESC, id ASC';   // the same order as SELECT_ACTIVE_SCORING_MODEL_SQL

test('a pin resolves THAT active row, not merely the newest', async () => {
  const { rows } = await pool.query(ROWS_SQL);
  const active = rows.filter((r) => r.is_active === true);
  assert.ok(active.length > 0, 'the TEST branch must hold at least one ACTIVE scoring model');
  const oldest = active[active.length - 1];
  const model = await repository.selectActiveScoringModel(pool, oldest.name + '@' + oldest.version);
  assert.equal(model.id, oldest.id);
  assert.equal(typeof model.configuration, 'object');
});

test('the pin and the implicit newest-row rule can disagree, which is the point', async () => {
  const { rows } = await pool.query(ROWS_SQL);
  const active = rows.filter((r) => r.is_active === true);
  const newest = active[0];
  const oldest = active[active.length - 1];
  const unpinned = await repository.selectActiveScoringModel(pool, null);
  assert.equal(unpinned.id, newest.id);
  if (active.length > 1) {
    assert.notEqual(unpinned.id, oldest.id, 'a second active row makes the two rules differ');
  }
});

test('a pin matching no row is SCORING_MODEL_UNAVAILABLE', async () => {
  await assert.rejects(
    () => repository.selectActiveScoringModel(pool, 'no-such-model@0.0.0'),
    (error) => error.code === 'SCORING_MODEL_UNAVAILABLE'
  );
});

test('a pin naming an INACTIVE row is refused, never activated', async (t) => {
  const { rows } = await pool.query(ROWS_SQL);
  const inactive = rows.filter((r) => r.is_active !== true);
  if (inactive.length === 0) {
    t.skip('no INACTIVE scoring_model row on this branch to pin');
    return;
  }
  await assert.rejects(
    () => repository.selectActiveScoringModel(pool, inactive[0].name + '@' + inactive[0].version),
    (error) => error.code === 'SCORING_MODEL_UNAVAILABLE'
      && /no ACTIVE row/.test(error.message)
  );
});
```

- [x] **Step 2: Run it and see it fail for the right reason**

Run: `npm run test:api:db`
Expected: the new file fails only on a VM-level reason first — if it reports `a pin matching no row` as *passing* but `a pin resolves THAT active row` failing, read the message: it must be a genuine assertion, not a missing table. (If `TEST_DATABASE_URL` is unset the launcher fails fast — that is the guard working, not a test result.)

- [x] **Step 3: Make it pass**

No production change is expected: `repository.selectActiveScoringModel` already implements all four behaviours. If a test fails, the DEFECT is in `apps/api/src/repository.js` and the fix belongs there with a matching unit pin in `apps/api/test/unit/scoring-model-pin.test.js` — do not weaken the DB assertion.

- [x] **Step 4: Run the suite and confirm the count moved**

Run: `npm run test:api:db`
Expected: `test:api:db: 17 passed, 0 failed` (13 existing + 4 new), residue 0, no `42501`.

- [x] **Step 5: Commit**

```bash
git add apps/api/test/db/scoring-model-pin.db.test.js
git commit -m "Pin the served-model setting against a real scoring_model table"
```

---

## Task 4: Parser parity with the harness

**Files:**
- Create: `apps/api/test/unit/scoring-model-pin-parity.test.js`

**Interfaces:**
- Consumes: `parseModelPin` from `apps/api/src/scoring-model-pin.js`; `parseModelPin` from `scripts/lib/model-pin.js`.
- Produces: nothing importable.

Requiring `scripts/lib/model-pin.js` from a **test** is allowed; Decision 62 rejects importing `scripts/` into the SERVED process (`apps/api/src/**`), which this does not do. State that in the file header so nobody "fixes" the import.

- [x] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert');
const apiPin = require('../../src/scoring-model-pin');
const harnessPin = require('../../../../scripts/lib/model-pin');

const TABLE = [
  'launch-v2@2.4.0', 'seed-minimal-v1@1.0.0', '  launch-v2@2.4.0  ',
  'launch-v2', '@2.4.0', 'launch-v2@', 'launch-v2@1@0', 'launch v2@2.4.0',
  '', '   ', 'a@b', 'v1@0.0.0-rc.1',
];

test('both parsers accept and refuse the same strings, and agree on the halves', () => {
  for (const value of TABLE) {
    let api = null;
    let harness = null;
    let apiError = null;
    let harnessError = null;
    try { api = apiPin.parseModelPin(value); } catch (error) { apiError = error; }
    try { harness = harnessPin.parseModelPin(value); } catch (error) { harnessError = error; }
    assert.equal(Boolean(apiError), Boolean(harnessError),
      JSON.stringify(value) + ' is accepted by one parser and refused by the other');
    if (api === null) continue;
    assert.equal(api.name, harness.name, JSON.stringify(value));
    assert.equal(api.version, harness.version, JSON.stringify(value));
    assert.equal(api.text, harness.name + '@' + harness.version, JSON.stringify(value));
  }
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --test apps/api/test/unit/scoring-model-pin-parity.test.js`
Expected: FAIL — `Cannot find module '../../../../scripts/lib/model-pin'` if the relative path is wrong (four levels up from `apps/api/test/unit/` is the repo root), otherwise PASS. Fix the path, not the assertion.

- [x] **Step 3: If a row disagrees, fix the API copy**

A disagreement is a real drift risk: the harness is the older, reviewed parser (Decision 39), so `apps/api/src/scoring-model-pin.js` moves to match it and the API's own unit test gains the offending input.

- [x] **Step 4: Run the API suite**

Run: `npm run test:api 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: 193 tests, 0 fail.

- [x] **Step 5: Confirm on Node 22**

Run: `npx -y node@22 --test "apps/api/test/unit/*.test.js" 2>&1 | grep -E "^# (tests|pass|fail|cancelled)"`
Expected: same counts, `# cancelled 0`.

- [x] **Step 6: Commit**

```bash
git add apps/api/test/unit/scoring-model-pin-parity.test.js
git commit -m "Pin agreement between the API and harness model-pin parsers"
```

---

## Task 5: The register row

**Files:**
- Modify: `docs/OPEN_GAPS.md` (section 1 open register)

**Interfaces:**
- Consumes: nothing.
- Produces: `OG-60`, referenced by Task 9's close.

- [x] **Step 1: Insert the row**

Insert as the LAST section-1 gap row — i.e. after the last line matching `/^\| OG-\d{2} \|/` in the file. All six cells, exactly six columns (`| ID | Gap | Class | Status | Owner | Source(s) |`), one physical line, CRLF:

```
| OG-60 | **The identity columns migration 020 introduced are OPTIONAL in practice, so a catalogue seed can insert products the API then serves with `slug: null`.** Found 2026-11-01 when `test:api:db` failed at `apps/api/test/db/recommendations.db.test.js:200` on `assert.equal(typeof component.slug, 'string')`: seeds 023/024/025 insert 13 products with BOTH `display_name` and `slug` NULL, and on EU **the entire catalogue of 100 rows** carries no identity, because EU replayed its seeds after 020 had backfilled an empty table. Repair shipped the same day: those three seeds now derive both columns at insert, and `028_backfill_product_identity.sql` backfills existing rows (applied to TEST twice, 13 -> 0 on both columns). **STILL OPEN on shared (13 rows) and EU (100 rows):** both are real-database applies that need a recorded restore point first, and the durable half is a read-only gate (`scripts/check-catalog-identity.js`) wired into `recurring-gates` - `test:api:db` is the only suite that caught this and it does not run on push/PR. Why not `ALTER COLUMN slug SET NOT NULL`: migration 020 keeps the column nullable ON PURPOSE so fixtures and writers that omit it stay legal, and a constraint would reverse that decision. Close when both applies land. | **IMPORTANT** | OPEN | data-research | HANDOFF_2026-11-01_catalogue_identity.md sections 2.3-2.5, 4.1-4.2; `database/migrations/020_product_identity_and_media.sql`; `database/seeds/023`-`025`, `028`; `apps/api/test/db/recommendations.db.test.js:200`; OG-54 |
```

Owner is `data-research` because that is the defect's class (catalogue DATA written without its identity) and the register's Owner vocabulary is `data-research / engine-code / schema-migration / tooling / docs / —`; the handoff's "engine/data" is not a value the register accepts.

- [x] **Step 2: Run the shape gate and the doc gate**

```bash
node --test scripts/lib/gap-register.test.js
npm run verify:docs 2>&1 | grep -E "gap-register-shape|verify-docs"
```
Expected: the shape tests pass; `PASS gap-register-shape`; `verify-docs: OK`.

- [x] **Step 3: Commit**

```bash
git add docs/OPEN_GAPS.md
git commit -m "Register the catalogue-identity gap and what closes it"
```

---

## Task 6: The three stale doc claims

**Files:**
- Modify: `CONTEXT.md` (the environment-consistency clause, ~line 67)
- Modify: `docs/TEST_MAP.md:93`
- Modify: `AGENTS.md:371` (§7 item 8)

**Interfaces:**
- Consumes: OG-60 (Task 5) — the correction cites the row, so the register stays the answer to "what is open".
- Produces: nothing importable.

- [x] **Step 1: Correct `CONTEXT.md`**

Replace, inside one physical line:

`while the shared dev database serves `seed-minimal-v1@1.0.0` alone (seed 013 unapplied) and reports DIFF `scoring-model-pins: count 1 vs 2``

with

`while the shared dev database serves `seed-minimal-v1@1.0.0` alone (seed 013 unapplied) and reports DIFF `scoring-model-pins: count 1 vs 2` — **CORRECTED 2026-11-01: this clause is now FALSE.** The seed 027 replay replayed every seed file onto shared, which holds SIX ACTIVE `launch-v2` rows (`1.0.0`-`2.4.0`) with `seed-minimal-v1@1.0.0` INACTIVE, so shared and TEST both serve `launch-v2@2.4.0` under the newest-active-row rule and EU is the release target (OG-54, OG-60; Decision 62 supplies the deploy-time pin)`

- [x] **Step 2: Correct `docs/TEST_MAP.md:93`**

`the full 100-row page walk with no duplicate or skipped slug` → `the full 113-row page walk with no duplicate or skipped slug` (both databases hold 113 products, measured 2026-11-01 — this cell describes the TEST branch run).

- [x] **Step 3: Correct `AGENTS.md:371`**

`(41 tables, 15-row ledger, 100 products)` → `(41 tables, 15-row ledger, 113 products)` — change the product count only. The `41 tables` figure was NOT re-measured in this pass; record that in the commit message rather than certifying it.

- [x] **Step 4: Apply, then verify line endings and the doc gate**

```bash
grep -cU $'\r' CONTEXT.md AGENTS.md docs/TEST_MAP.md   # unchanged from before the edit
npm run verify:docs 2>&1 | tail -3
git --no-pager diff --stat
```
Expected: the CR counts match the pre-edit counts exactly (no `\r\r\n`), `verify-docs: OK`, and each file shows `1 insertion(+), 1 deletion(-)`.

- [x] **Step 5: Commit**

```bash
git add CONTEXT.md AGENTS.md docs/TEST_MAP.md
git commit -m "Correct three doc claims the catalogue repair falsified"
```

---

## Task 7: OPERATOR — apply seed 028 to the shared database

**Files:** none. This task writes 13 rows in `public.product` on shared.

**Interfaces:**
- Consumes: `database/seeds/028_backfill_product_identity.sql` (committed in `784196a`).
- Produces: `slug IS NULL` = 0 and `display_name IS NULL` = 0 on shared, which Task 2's gate and Task 9's parity run read.

- [ ] **Step 1: Record a restore point FIRST**

The owner opens the Neon console for the shared project and supplies the id. No write happens without it. Do not reuse `br-restless-art-ax6fineh` or any historical id.

- [ ] **Step 2: Dry-run, then apply THIS FILE ONLY**

Do **not** run `node scripts/run-seeds.js`: it has no per-file mode and replays every seed, which re-asserts model activation and would make this a whole-catalogue act instead of a 13-row repair. Use the documented single-file pattern (AGENTS.md §6), against `DATABASE_URL`, sending the file WHOLE (never split on `;` — a `;` in a comment breaks a naive split) and printing each statement's `rowCount`:

```bash
node -e "
require('dotenv').config();
const fs=require('fs');const {Client}=require('pg');
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
  await c.connect();
  await c.query('SET search_path = public');
  const sql=fs.readFileSync('database/seeds/028_backfill_product_identity.sql','utf8');
  const r=await c.query(sql);
  console.log('statements:',Array.isArray(r)?r.map(x=>x.rowCount):r.rowCount);
  await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
"
```

- [ ] **Step 3: Prove idempotency and the end state**

```bash
node -e "
require('dotenv').config();const {Client}=require('pg');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const r=await c.query(\"SELECT count(*)::int AS products, count(*) FILTER (WHERE slug IS NULL)::int AS null_slug, count(*) FILTER (WHERE display_name IS NULL)::int AS null_display_name FROM product\");
console.log(r.rows[0]);await c.end();})();
"
```
Expected: first apply `UPDATE 13` / `UPDATE 13`; second apply `UPDATE 0` / `UPDATE 0`; the SELECT prints `products 113, null_slug 0, null_display_name 0`.

- [ ] **Step 4: Re-run the gate**

```bash
node scripts/check-catalog-identity.js; echo "exit=$?"
```
Expected: `RESULT: PASS - 113 ACTIVE product(s) …`, `exit=0`. This is the nightly going green.

---

## Task 8: OPERATOR — apply seed 028 to EU

**Files:** none. This task writes 100 rows in `public.product` on the EU project (`morocco-pc-eu`).

**Interfaces:**
- Consumes: the same seed file as Task 7; `TARGET_DATABASE_URL` from `.env.eu`.
- Produces: EU's 100 catalogue rows carry their canonical product key (Decision 47) for the first time.

- [ ] **Step 1: Record a SEPARATE restore point** on the EU Neon project (new id; never reuse the shared one).

- [ ] **Step 2: Apply THIS FILE ONLY, against EU**

Same script as Task 7 with the connection string taken from `.env.eu`'s `TARGET_DATABASE_URL`. Two hard constraints:

- **Never `node scripts/run-seeds.js` here.** EU holds 100 products and only `launch-v2@1.0.0` ACTIVE; replaying every seed would add seeds 023-027's 13 products and activate five more `launch-v2` rows, turning the release target into a copy of shared. That is not this task.
- Print `user=` and `host=` only, never the URL (it carries a password).

- [ ] **Step 3: Verify**

```bash
node -e "
require('dotenv').config({path:'.env.eu'});
const {Client}=require('pg');
(async()=>{const u=new URL(process.env.TARGET_DATABASE_URL);
console.log('user='+u.username+' host='+u.host);
const c=new Client({connectionString:process.env.TARGET_DATABASE_URL,connectionTimeoutMillis:15000});
await c.connect();await c.query('SET search_path = public');
const r=await c.query(\"SELECT count(*)::int AS products, count(*) FILTER (WHERE slug IS NULL)::int AS null_slug, count(*) FILTER (WHERE display_name IS NULL)::int AS null_display_name FROM product\");
console.log(r.rows[0]);await c.end();})();
"
```
Expected: `products 100, null_slug 0, null_display_name 0` after the first apply, unchanged after a second.

- [ ] **Step 4: Run the gate against EU**

```bash
node scripts/check-catalog-identity.js --target=env:TARGET_DATABASE_URL; echo "exit=$?"
```
Expected: `RESULT: PASS - 100 ACTIVE product(s) …`, `exit=0`.

---

## Task 9: Parity read, then close OG-60

**Files:**
- Modify: `docs/OPEN_GAPS.md` (move `OG-60` to the closed tables)

**Interfaces:**
- Consumes: Tasks 7 and 8 (both applies landed), Task 5 (`OG-60` exists).
- Produces: closed-table row `C-53` (the highest existing closed id is `C-52`).

- [ ] **Step 1: Read parity — a DIFF on counts is the expected answer**

```bash
node scripts/check-target-parity.js --a=env:DATABASE_URL --b=env:TARGET_DATABASE_URL; echo "exit=$?"
```
Expected: `exit=1` with `RESULT: DIFF`, and the named difference is catalogue **counts** (shared 113 vs EU 100 — EU has not had seeds 023-025). That is deliberate. What would be news: a shape/column difference, a `schema_migrations` difference, or a `scoring-model-pins` difference. Record the named difference verbatim; never "fix" parity by applying seeds to EU.

- [ ] **Step 2: Close the row**

Move `OG-60` out of section 1 into the closed table as `C-53`, in the register's own format (`| C-53 | OG-60 | … | CLOSED 2026-<date> | … |`), with the resolution naming both applies and their restore points, the measured `0/0` on both columns for both databases, and the gate that now prevents recurrence. Section 1's row is deleted in the SAME edit (a row present in both places is a shape defect) and any prose that cites `OG-60` must still resolve — the closed-table subject cell is what keeps `gap-register-shape` green.

- [ ] **Step 3: Run the gates**

```bash
node --test scripts/lib/gap-register.test.js
npm run verify:docs 2>&1 | tail -3
```
Expected: shape tests pass; `PASS gap-register-shape`; `verify-docs: OK`.

- [ ] **Step 4: Commit**

```bash
git add docs/OPEN_GAPS.md
git commit -m "Close the catalogue-identity gap now both applies have landed"
```

---

## Task 10: OPERATOR — the served model, in one restart

**Files:** none. This task changes a deployed origin, not the repository.

**Interfaces:**
- Consumes: Decision 62 in `master` (`27b64ad`) and the role credential documented in `docs/RECIPES/provision-the-api-role.md`.
- Produces: `check-deployed-role.js` PASS, and an origin that serves the model it names.

- [ ] **Step 1: Deploy FIRST**

The running image predates Decision 62, so `SCORING_MODEL_PIN` is inert until the deploy carries it. Confirm the deployed build includes `apps/api/src/scoring-model-pin.js` before touching any variable.

- [ ] **Step 2: Set BOTH variables in ONE restart**

`SCORING_MODEL_PIN=launch-v2@2.4.0` and `DATABASE_URL` = the role's URL. Build the credential locally and print only identity, never the value:

```bash
node -e "require('dotenv').config();const fs=require('fs'),os=require('os');const {roleConnectionString}=require('./scripts/lib/api-role');const pw=fs.readFileSync(os.homedir()+'/.morocco-pc/api-role.password','utf8').trim();const u=new URL(roleConnectionString(process.env.DATABASE_URL,'morocco_pc_api',pw));process.stdout.write('user='+u.username+' host='+u.host+'\n');"
```

Doing the credential without the deploy turns a working app into a 503; doing the pin without the deploy does nothing at all. The rotation procedure and its rollback are `docs/RECIPES/deploy-eu-colocation.md` §8.5.

- [ ] **Step 3: Warm, then prove the credential**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$ORIGIN/v1/health?probe=preflight"
node scripts/check-deployed-role.js --target=env:DATABASE_URL
```
Expected: `200` from the probe (a spun-down instance must be warmed first or the next step answers INCONCLUSIVE), then `PASS` — every tagged session is `morocco_pc_api`. `INCONCLUSIVE` is not a pass; re-warm and re-run once before reporting it.

- [ ] **Step 4: Prove the pin is being served**

`GET /v1/meta/options` answers from the pinned model, and the startup log carries `scoring_model: launch-v2@2.4.0`. A malformed value must fail the start, so do **not** "fix" a failed start by making the parse lenient (handoff trap 4).

---

## Self-review notes

- **Spec coverage:** 4.1 → Task 7; 4.2 → Task 8; 4.3 → Task 9; 4.4 → Tasks 1-2; 4.5 → Tasks 5-6; 4.6 → Task 10; 4.7 → Tasks 3-4. 4.8 (OG-58) is excluded on purpose: it is engine retention with its own Decision and a full 20-scenario rebaseline, and folding it in would make this plan two plans.
- **Scope correction carried into the code:** the handoff proposes scoping the gate to "ACTIVE products carrying an eligible offer". Task 1 scopes to every ACTIVE product instead, because `GET /v1/catalog/products` filters `p.slug IS NOT NULL` and addresses the catalog by `slug`, so a NULL slug removes the product from the catalog entirely while its recommendation component still ships `slug: null`. Narrowing the scope would have made the gate blind to the more damaging case.
- **Ordering constraint stated twice on purpose:** the gate is expected RED on shared until Task 7 lands. That is the gate describing a registered live defect, not a flaky gate.
- **Not claimed:** no task re-measures the engine, and none changes a score, a rank, a build or a scoring model row.
