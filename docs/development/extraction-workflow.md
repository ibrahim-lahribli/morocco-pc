# Extraction workflow — proving a recommendation-module move

Status: the figures below were measured at `master` = `30b459b` (2026-11-17), after PR #33 (`7d5f3b6`) and
PR #34 (`30b459b`), and they still hold at `master` = `de659ad`, which adds the step 4B PR 3 assembly batch
(the second batch this workflow was used for; sections 3.4, 3.10 and 4 record what it needed beyond PR 2).
Re-measure before quoting any figure against a later commit.

Scope: how to plan, capture, move and **prove** a module extraction out of `src/recommendation/` into
`packages/recommendation-core/`. This document changes no engine behaviour and authorises no move: each
extraction is its own PR, reviewed against its own evidence.

## 1. The constraint that decides what can move first

The manifest's identity policy is `byte-identical` (`scripts/lib/extraction-manifest.js`,
`IDENTITY_POLICY` — the only implemented policy). A moved file keeps its bytes, so every relative
`require` inside it must still resolve **after** the move, from the destination package.

That is the ordering rule, and it is not a matter of taste:

| Stage | Its relative imports | Can it move alone? |
|---|---|---|
| `candidates`, `compatibility`, `filtering` | — | already moved (batch `step-4b-pr2`) |
| `assembly` | `../candidates/*`, `../filtering/*` | already moved (batch `step-4b-pr3`) — both namespaces were in the core first |
| `ranking` | `../assembly` (the barrel), `../candidates/errors` | no — needs `assembly` first |
| `retention` | `../assembly/prices`, `../candidates`, `../filtering/filter` | no — needs `assembly` first |
| `scoring` | `../assembly/assemble`, `../candidates/*` | no — needs `assembly`, and 2 of its 8 files are SQL loaders |
| `explanation` | `../assembly`, `../ranking`, `../scoring/use-cases` | no — needs three stages first |
| `offers` | `../candidates/*`, `../assembly/prices` | `as-of.js` only; `select.js` is an SQL loader |
| `query`, `persistence`, `orchestrator` | SQL, loaders, `pg` | no — runtime side |

A file that imports a still-unmoved stage cannot move without breaking resolution, and rewriting the
import would violate byte identity. So "move it because it is small" is not an option; the graph decides.

## 2. Four kinds of evidence, and what each one proves

| Evidence | Proves | Does **not** prove | Produced by |
|---|---|---|---|
| **Byte-identity (L3)** | every declared destination blob at `HEAD` equals its source blob at the batch baseline; both entries are regular files (`100644`/`100755`, not a tree/gitlink/symlink) | that the file belonged to a *coherent* module, that behaviour is unchanged, or that anything still calls it | `npm run verify:extraction` |
| **Fixture provenance (L2)** | the characterization fixture was **added by exactly one commit whose parent is the batch baseline**, that commit changed nothing except the fixture and its declared `capture_paths`, and the fixture has not been touched since | that the extracted code still reproduces the recorded behaviour | `npm run verify:extraction` |
| **Test ownership** | which test file moved / stayed / split / was added, and that moved and stayed files kept their test and assertion counts (counted from the token stream, loops expanded structurally) | that the suite is green, or that a *new* test proves the old behaviour | `npm run verify:ownership -- --base=<sha>` |
| **Behavioural characterization** | the current implementation returns the recorded output for the recorded inputs, field by field | **when** the fixture was captured, or by which commit — a fixture generated *after* the move would pass | `npm run check:characterization` |

A green `check:characterization` plus a missing provenance record is not evidence of a move; it is a
fixture agreeing with the code that produced it. Conversely a clean provenance record with no behaviour
check says nothing about semantics. Both are required, and they are separate gates for exactly this
reason.

## 3. The twelve steps

### 3.1 Identify candidate modules and their consumers

List the implementation files and every tracked consumer:

```bash
ls src/recommendation/<stage>/
grep -rn --include=*.js -e "\.\./<stage>" -e "recommendation/<stage>" src scripts apps
```

Then, for each candidate file, resolve its relative specifiers and confirm they land inside
`packages/recommendation-core/src/` **after** the move (section 1). Run the package's own purity scanner
over each candidate before proposing anything — it is the same rule the core gate applies, called the
way `audit-pr2-test-ownership.js` calls it: `scanSource(source, { file, coreRoot, sourceRoot })` from
`packages/recommendation-core/test/purity-scanner.js`. A stage whose every implementation file returns
zero violations is a candidate; one SQL loader in the directory means a barrel split, which is a
harder and different PR.

Also classify the **tests**, not just the source. A test that imports a runtime loader
(`filtering/context-loader`), a still-unmoved stage, or `node:fs` behaves differently from a pure one —
see `audit-pr2-test-ownership.js`'s `FILESYSTEM_EXCEPTIONS` for how a filesystem exception is granted
(named file, named specifier, stated reason; an unused exception fails the audit).

### 3.2 Establish an immutable baseline commit

Start from a clean tree and record the commit the code moves **from**:

```bash
git status --porcelain   # must be empty
git rev-parse HEAD       # 40-char SHA -> the batch's baseline_sha
```

The baseline is never re-derived later and never rewritten by a subsequent batch: `extraction-manifest.json`
holds one batch per PR, and a merged batch's baseline cannot drift when the next batch is measured.

### 3.3 Record current test ownership and assertion counts

```bash
npm run verify:ownership -- --base=<baseline-sha>
```

This prints the inventory table (class `moved` / `stayed` / `split` / `added`, tests before → after,
assertions before → after, detected runtime dependency, owner, reason) and then enforces the invariants:
`moved` and `stayed` rows must keep both counts, a `split` must preserve every assertion and never reduce
its test count, an `added` file must contribute at least one test and one assertion. Counts come from the
package's lexer, so `test()`/`it()` inside a comment or a string are not counted, and a
`for (const x of [a, b, c])` loop is expanded from its literal case list rather than guessed.

`--base=` selects the revision the before-counts are read from; without it the script uses the manifest's
`step-4b-pr2` baseline. **A new batch must pass its own `--base`.**

### 3.4 Capture characterization evidence before moving code

Write a capture script for this batch, run it **once** at the baseline, and commit it with the fixture in
a commit whose parent is the baseline and whose only changes are the fixture plus the declared
`capture_paths`:

```bash
node scripts/characterize-<batch>.js          # writes the fixture, once
git add <fixture> scripts/characterize-<batch>.js
git commit -m "test(core): freeze the <batch> surface before anything moves"
```

Rules the gate enforces on that commit (`scripts/verify-pr2-provenance.js`):

* it is the **only** commit that touched the fixture since the baseline, and it **added** it;
* its parent is the batch baseline;
* it changed nothing except the fixture and each declared `capture_path` (an `M`, `D`, `R` or `C` record
  fails even when the path is allowed — only additions are accepted);
* each `capture_path` was **absent** at the baseline and is a regular file at the capture commit;
* the fixture names the baseline SHA and the exact `capture_command`.

The capture must be deterministic: no clock, no randomness, no database, no environment input, literal
ids. `scripts/characterize-pr2.js` is the reference implementation of that discipline (its `--check`
never writes, and it reads the committed fixture from `HEAD:<path>`, never the working tree).

### 3.5 Create a manifest batch

Append one object to `extraction-manifest.json` (never edit a merged batch):

```json
{
  "id": "step-4b-pr3",
  "description": "...",
  "baseline_sha": "<40 lowercase hex, the commit from 3.2>",
  "identity_policy": "byte-identical",
  "characterization": {
    "fixture": "packages/recommendation-core/test/fixtures/<batch>-characterization.json",
    "capture_command": "node scripts/characterize-<batch>.js",
    "capture_commit_subject": "test(core): freeze the <batch> surface before anything moves",
    "expect_touch_commits": 1,
    "capture_paths": ["scripts/characterize-<batch>.js"]
  },
  "modules": [{ "source": "src/recommendation/...", "destination": "packages/recommendation-core/src/..." }]
}
```

The validator (`scripts/lib/extraction-manifest.js`) requires: kebab-case unique `id`, a full lowercase
SHA, `identity_policy` exactly `byte-identical`, at least one module, repo-relative POSIX paths, no
duplicate move and no two batches sharing a destination. `expect_touch_commits` other than `1` fails
closed. Omitting `characterization` is allowed and means "L3 only" — that batch then has **no**
behavioural evidence at all, which should be a deliberate decision, stated in the PR.

### 3.6 Move modules without changing behaviour

```bash
git mv src/recommendation/<stage>/<file>.js packages/recommendation-core/src/<stage>/<file>.js
```

Leave an identity re-export shim at every old path so existing consumers keep working unchanged:

```js
// src/recommendation/<stage>/<file>.js - identity shim (step 4B PR N).
module.exports = require('../../../packages/recommendation-core/src/<stage>/<file>');
```

Then publish the namespace from the core entry point (`packages/recommendation-core/src/index.js` —
namespaced and written by hand, never spread) and update the committed export snapshot
(`test/export-surface.json`) in the **same** commit. Nothing else changes: no logic, no import rewriting,
no formatting.

### 3.7 Verify byte-identical blobs

```bash
npm run verify:extraction
```

Per batch it checks the baseline exists and is an ancestor of `HEAD`, that every source and destination is
a regular file at its own revision, and that the source blob at the baseline equals the destination blob
at `HEAD`. It prints a per-move table plus `blob-identical: N / N` and exits non-zero on any mismatch.

### 3.8 Verify fixture provenance

The same command performs the L2 half for every batch that declares `characterization` (section 3.4).
Read its output lines — `fixture captured before the move: yes`, `fixture unchanged since its capture
commit: yes` — rather than only the exit code: the FAIL block names the claim that broke.

```bash
npm run check:characterization   # behaviour only; refuses to write; reads HEAD:<fixture>
```

### 3.9 Verify test ownership and behavioural equivalence

```bash
npm run verify:ownership -- --base=<baseline-sha>
npm run check:characterization
```

Ownership proves *which* tests moved and that their counts survived; characterization proves the moved
implementation still returns the recorded values. Neither substitutes for the other, and neither is a
proof that the fixture was captured before the move — that is 3.8.

### 3.10 Run the verification suite

The `unit-and-docs` job is broader than this workflow: it runs the repository-wide suite and two
read-only database gates alongside the extraction evidence. Only the three extraction-specific checks
below are required by this workflow, and only they carry the DB-free guarantee.

**Extraction-specific checks — DB-free**

```bash
npm run check:characterization
npm run verify:extraction
npm run verify:ownership -- --base=afccc671dae5abe6df80ad56dfcbc231d7947c7a
```

CI pins each batch's baseline explicitly and names the inventory it measures; a new batch passes its own
(`--base=<baseline-sha> --inventory=<name>`, section 3.3).

These three are DB-free by construction: they read Git objects, the working tree and the committed
fixture. None connects, none reads `DATABASE_URL`, and none reads a credential. That is a property of
these three commands, not of the CI job that happens to run them.

**Additional checks in the full `unit-and-docs` job**

The same job also runs, around them:

```bash
npm run test:unit
npm run test:scripts
npm run test:database-guard
npm run test:core
node packages/recommendation-core/test/hermetic-run.js
npm run test:api
npm run check:contract
node scripts/check-openapi-compatibility.js --base=origin/master
node scripts/gen-decision-index.js --check
node scripts/verify-docs.js --offline
node scripts/check-catalog-identity.js   # read-only; uses DATABASE_URL when configured
node scripts/check-deferred-rules.js     # read-only; uses DATABASE_URL when configured
```

**Those last two are why the job must not be called DB-free.** They issue SELECTs only and write
nothing, but they do contact the database and read its credential when the repository secret
`DATABASE_URL` is configured. When it is not — a pull request from a fork, which receives no secrets —
each step prints a `::notice` and exits 0, so the substantive check is *skipped*, not run offline. The
steps above them are given no `DATABASE_URL` by the workflow, and their suites are written DB-free.

What the package-level commands add beyond the engine suite:

* `npm run test:core` — the entry point loads through its declared `main`, the export surface matches
  `test/export-surface.json`, and every file under the core `src/` passes the purity scan;
* `node packages/recommendation-core/test/hermetic-run.js` — copies the package outside the repository,
  refuses to run if any `node_modules` is reachable, empties `NODE_PATH` and runs the suite there: an
  empty dependency list in `package.json` is a claim until this proves it;
* `npm run verify:docs -- --offline` / `node scripts/verify-docs.js --offline` — the doc-claim gates. The
  `--offline` flag is what keeps them DB-free; `--live` adds read-only database checks and is not run here.

`git diff --check` is **not** a step in `unit-and-docs`: run it locally before pushing (section 3.11).
`npm run verify:replay` and `npm run test:api:db` belong to the `recurring-gates` job, not this one.

The T0 rule (RFC §19.2) is about the extraction step: the three checks above, the local commands in this
section, and the move itself. It is not a claim that the whole CI job never touches the database — the
two read-only gates do, whenever the secret is configured.

### 3.11 Open a PR with evidence, measured counts and CI results

The PR body carries, as tables rather than prose: the manifest batch id and baseline SHA, the
per-move byte-identity table from 3.7, the fixture-origin lines from 3.8, the ownership table and totals
from 3.9, the test counts before/after, and the `unit-and-docs` run URL. A reviewer should be able to
re-run each command and get the same numbers.

### 3.12 Require successful CI before merging

Merge only when all of the following hold on the exact head commit being merged:

* `unit-and-docs` is green (the check run named after the job id in `.github/workflows/ci.yml`);
* the branch is up to date with `master` (so a green run cannot predate a conflicting merge) — enforced
  by the `master` ruleset since 2026-11-17 (section 6);
* the diff contains only the move, the shims, the entry point and export snapshot, the manifest batch,
  the capture script and fixture, and the inventory/CI wiring the batch needs.

`web` (`web.yml`) is path-filtered to `apps/web/**`, `contract/**` and the workflow file, so it does not
run on a recommendation-only PR and is not a merge gate for one.

## 4. Limits of the current tooling — do not over-claim

* **The manifest gate generalises; the capture and audit scripts do not.** `verify-pr2-provenance.js` is
  manifest-driven and verifies every batch. `scripts/characterize-pr2.js` hardcodes its fixture path, its
  output document kind and the PR 2 modules it imports, and `scripts/audit-pr2-test-ownership.js`
  hardcodes the `INVENTORY` and `SPLIT_FACTS`. A new batch needs a new capture script (declared in
  `capture_paths`) and its own inventory rows; `--base=` changes only the revision, never the inventory.
  PR 3 is the worked example of the second problem: its baseline is AFTER the PR 2 move, so the PR 2
  baseline paths no longer exist there. The audit therefore takes `--inventory=pr2|pr3` — one named
  inventory per batch, each measured against that batch's own baseline — and the two runs are separate CI
  steps. Do not merge two batches' rows into one measured set; a single row set cannot be measured against
  two different baselines.
* **`npm run check:characterization` is wired to the PR 2 fixture only.** Each later batch needs its own
  script entry and its own CI step (`npm run check:characterization:pr3` is the PR 3 one), or its
  behaviour is not checked anywhere.
* **CI pins one ownership command per batch, each with its own baseline and inventory**
  (`--base=afccc671... --inventory=pr2`, `--base=de659ad... --inventory=pr3`). A new batch's ownership
  step must name both the same way.
* **`scripts/lib/ci-workflow.test.js` asserts that `ci.yml` has exactly two jobs**, `unit-and-docs` and
  `recurring-gates`. New evidence belongs in a **step** inside `unit-and-docs`; adding a third job fails
  that suite.
* **Byte identity says nothing about callers.** Shims keep existing consumers working, but no gate proves
  that a consumer should stop importing the old path — that is review, or a later narrowing PR which is
  explicitly *not* byte-identical and must not be mixed into an extraction.
* **A per-batch fixture is a sample, not a proof of semantic equivalence.** It pins the inputs listed in
  the capture script. Widening it is a change to the evidence, and it must be a new batch's evidence, not
  an edit to a merged fixture.

## 5. Not covered here

Behaviour changes, barrel narrowing (e.g. `ranking/rank.js` importing the `assembly` barrel for one
constant — RFC §11.3), the `apps/api` migration (step 6), the runtime extraction (step 5) and anything
that touches a database. Those are separate steps with their own safety tiers.

## 6. Merge policy in force — dated operational snapshot (2026-11-17)

This section records repository **policy state**, not extraction guidance. It was read from GitHub at the
time stated, it will go stale, and it says nothing about how any earlier PR was reviewed. Re-check it with
`GET /repos/ibrahim-lahribli/morocco-pc/rules/branches/master` (effective rules) and
`GET /repos/ibrahim-lahribli/morocco-pc/rulesets/26943876` (the record) rather than trusting the table.

Verified 2026-11-17 at `master` = `30b459b`; ruleset `26943876` (`master`), `enforcement: active`,
`updated_at` 2026-11-17T10:42:40+01:00, `current_user_can_bypass: never`:

| Verified setting | Value |
|---|---|
| Pull requests | required; `required_approving_review_count: 0` |
| Required status check | `unit-and-docs` (GitHub Actions, integration `15368`) |
| Up-to-date enforcement | `strict_required_status_checks_policy: true` |
| Branch deletion | blocked (`deletion`) |
| Force pushes | blocked (`non_fast_forward`) |
| Bypass actors | none — the owner is bound too |
| Classic branch protection | none: `GET /branches/master/protection` returns 404 `Branch not protected`, so nothing compounds with the ruleset |

Two consequences for this workflow: every extraction lands through a pull request, never a direct push to
`master`; and the up-to-date requirement in 3.12 is enforced, so each out-of-date update costs one more
`unit-and-docs` run (~45 s wall clock, measured 2026-11-17).

**Not retroactive.** Ruleset `26943876` existed but was **disabled** — and `GET /rules/branches/master`
returned `[]` — when this document was first committed earlier the same day. Activation happened
afterwards; that earlier state describes how the document was written, not what is in force now.
