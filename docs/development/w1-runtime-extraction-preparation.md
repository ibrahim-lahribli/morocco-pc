# W1 runtime extraction — preparation dossier

**Status: PROPOSED — NOT APPROVED. `W1 NOT READY — GATES OPEN` (0 of 7 gates closed).**

Owner: Agent 3 (runtime inventory, dependency analysis, provenance proposal, transaction test plan,
runtime test ownership, coordination). This document is preparation and evidence only. It moves no
module, rewrites no import, creates no shim, changes no transaction, does not touch
`extraction-manifest.json` or its verifier, and does not touch root `package.json`, CI, the Dockerfile,
`.dockerignore` or `api-image.yml`. Nothing in it becomes authoritative until the owners named in
section 11 approve it in writing.

Every section is headed `PROPOSED — NOT APPROVED`. Every claim carries one of these labels:

| Label | Meaning |
|---|---|
| `[inspected]` | read directly from this checkout or from a Git object in this repository |
| `[measured]` | produced by a command run in this session, with the command and result recorded |
| `[CI verified]` | read from a GitHub Actions run/job/step for the exact commit SHA named |
| `[previously reported]` | claimed by a PR author or a prior report; not independently reproduced here |
| `[owner]` | requires another owner's decision (Agent 1, Agent 2, RFC A2/A6 owner, project authority) |
| `[proposed]` | designed here; unapproved |
| `[unresolved]` | no acceptable answer exists yet |

---

## 1. W0 preservation — measured

**PROPOSED — NOT APPROVED (this section is a record, not a change).**

### 1.1 Baseline state

`[inspected]` Branch `feat/runtime-harness` = `89e761d8280cf597319004289684baecca1819fa`, which matches
the reported W0 baseline exactly. Its runtime tree holds **12 files**
(`docs/LOADERS_AND_TRANSACTIONS.md`, `docs/MIXED_BARRELS.md`, `docs/ORCHESTRATOR_ENTRY_POINTS.md`,
`package.json`, `src/index.js`, `test/assert-discovery.js`, `test/boundary-scanner.js`,
`test/boundary.test.js`, `test/export-surface.json`, `test/index.test.js`, `test/surface.test.js`,
`test/transaction-ownership.test.js`).

`[inspected]` `src/index.js` is `module.exports = {}`, and `test/export-surface.json` declares
`"exports": []`. The header comment names the planned waves (loaders W1, persistence W2, orchestrator
W3) and nothing has shipped from them.

`[inspected]` On `master` (`45133d5`) and in this checkout, `src/recommendation/**` still contains every
loader, every persistence writer and every orchestrator module — no implementation has moved.

`[inspected]` PR #50: state `open`, base `master` `45133d5`, head `89e761d`, 12 files changed,
`mergeable: clean`, 0 review comments.

### 1.2 Deviation: this checkout is not the W0 branch

`[inspected]` `git status -sb` reports
`## feat/core-explanation-extraction...origin/feat/core-explanation-extraction [behind 1]` with a clean
tree; `HEAD` is `880bb18`, one commit behind that branch's remote head `ac06a6a` (PR #49). The runtime
package in this checkout therefore contains only `package.json` and `docs/`, and no harness suite exists
here.

Consequence: the harness cannot be executed from this working tree, and switching branches in a shared
checkout is out of scope. Section 1.3 measures it from an exported tree instead.

### 1.3 Suite re-measurement (independent of the author's report)

`[measured]` Command, from a temp directory outside the repository:

```
git archive 89e761d | tar -x -C "$T"
cd "$T/packages/recommendation-runtime"
node test/assert-discovery.js
node --test --test-reporter=tap "test/*.test.js"
```

Result on `node v24.21.0`, Windows: discovery printed `recommendation-runtime: 4 test suite(s)
discovered`, exit 0; the suite reported **tests 61, suites 13, pass 61, fail 0**, exit 0. The
previously reported `61 / 61 pass / 13 suites` is therefore **reproduced** — but on Node **24**, not the
Node 22 the gate requires. Node 22 execution remains CI-only evidence.

`[measured]` A partial export of `packages/**` alone (without the repository root `package.json`) fails
one assertion, `boundary.test.js` → "reports a package file outside src/ and a file outside the
package": `require('../../../package.json')` from `src/probe-fixture.js` resolves to the **repository
root** manifest, so the exported tree must include it. This is a coupling to the repository layout, not
a defect in the gate, and it is not to be "fixed" without authorization. It does mean that any future
hermetic or relocated execution of the runtime suite must export the repository root manifest too.

### 1.4 What must not change

The scanner, its fixtures, `assert-discovery.js`, and the documented `.end()` limitation
(name-based receiver detection, no alias/data-flow analysis, stream/socket/response receivers
deliberately exempt) are frozen W0 artifacts. No expansion of scanner scope without a concrete
reproducible bypass.

---

## 2. CI and PR state — evidence

**PROPOSED — NOT APPROVED.**

| Commit | Tree state | `unit-and-docs` | Runtime step | `image` |
|---|---|---|---|---|
| `89e761d` (PR #50 head) | no `test:runtime` script, no runtime step in `ci.yml` | `success` (runs 44756114202 / 44756123305) | **did not exist** — runtime tests did not run | not applicable |
| `7e27be6` (PR #48 head) | runtime step present at `ci.yml:56`, runtime test dir absent | **failure** at step 6 `npm run test:scripts`; steps 7–30 **skipped** | **never executed** (skipped) | failure (reported: core exports map missing on master) |
| `07c1254` (`integration/pr48-pr49-pr50`) | all three merged | `success` | **step 10 "Runtime package harness (step 5)" success** | success |

`[inspected]` At `89e761d` neither the root `package.json` nor `ci.yml` mentions runtime, so the green
`unit-and-docs` there is **not** evidence for gate 2.

`[inspected]` At `7e27be6` the root `package.json` defines
`"test:runtime": "node packages/recommendation-runtime/test/assert-discovery.js && node --test \"packages/recommendation-runtime/test/*.test.js\""`
— character-identical to the required command — but `packages/recommendation-runtime/` at that commit
contains only `docs/LOADERS_AND_TRANSACTIONS.md` and `package.json`. The step would fail closed on the
missing `assert-discovery.js`; because `test:scripts` fails first, that failure mode is **unmeasured**.

`[CI verified]` `07c1254` is the only green execution of the command: `ci` run 44820989559, job
`unit-and-docs` (ubuntu-latest, `node-version: '22'`), step 10 success; `image` run 44820989313
success. The step's internal test counts were not read from the job log, so the 61/13 figure there
remains `[previously reported]`; the mechanism (discovery guard + runner) is `[CI verified]`.

`[inspected]` `integration/pr48-pr49-pr50` is a scratch branch and is not a merge target. **Gate 2
therefore stays OPEN**: it needs a green `unit-and-docs` on `master` (or on a PR head that will merge)
in which step 10 actually runs.

### 2.1 Merge sequence

`[owner]` Unchanged and unapproved here: **#49 → #50 → rebase #48**. `[inspected]` master's
`packages/recommendation-core/package.json` has no `exports` key, which independently explains PR #48's
`test:scripts` and image failures. `[inspected]` PR #48's own body lists #49→#50 as blockers but does
not record that its `test:runtime` step cannot pass without #50's files; the skipped steps hid that.
No merge, approval or force-push is performed by Agent 3.

---

## 3. C7 (Docker integration) — status

**PROPOSED — NOT APPROVED.**

`[inspected]` `apps/api/Dockerfile` copies `packages/database-guard` and `packages/recommendation-core`
only; there is no `packages/recommendation-runtime` COPY. `.github/workflows/api-image.yml` asserts
nothing about runtime. The green `image` job on `07c1254` therefore says nothing about runtime.

`[inspected]` `.dockerignore` excludes `docs`, `*.md`, `test`, `scripts`, `database`, `contract` and
`apps/web`; a `package.json` + `src` COPY of the runtime package is therefore compatible with it.

`[owner]` C7 stays with Agent 1. The proposed COPY pair (from the assignment) is:

```dockerfile
COPY packages/recommendation-runtime/package.json ./packages/recommendation-runtime/package.json
COPY packages/recommendation-runtime/src ./packages/recommendation-runtime/src
```

Placement must follow `database-guard`/`recommendation-core` (after `npm ci`), and the image gate must
be shown to exercise the runtime package (today it does not). Not verified, not edited by Agent 3.

---

## 4. RFC count reconciliation

**PROPOSED — NOT APPROVED. `[unresolved]` — belongs to the RFC A2/A6 owner.**

`[inspected]` The §11.2 table has **22** rows whose target project is runtime. Its "Counts" paragraph
says **21**, with the arithmetic "3 loaders for candidates/filtering/offers + 1 filtering pipeline +
7 orchestrator + 5 persistence + 3 query + 2 scoring loaders". That sum is arithmetically 21 and it
omits exactly one declared row: `offers/index.js` (the "whole barrel → runtime; **not** mixed" row).
`[inspected]` §5 of the RFC (line 1527) says "the 24 runtime modules".

Therefore:

- **22 files** are proposed to move.
- **24** = 22 moved files + 2 new namespace barrels (`loaders/index.js`, `persistence/index.js`).
- **21** is an arithmetic slip, not a scoping decision, as far as this inspection can tell.

`[unresolved]` Whether the three runtime-only barrels (`offers/index.js`, `query/index.js`,
`orchestrator/index.js`) move at all, and to which path, is **not stated** in §11.2 — the rows give a
target project but no destination. Until that is answered, neither count can be encoded.

---

## 5. A. Destination inventory (22 rows)

**PROPOSED — NOT APPROVED.**

Column meanings: *imports* = relative specifiers the file requires today; *dependents* = who requires
it today (`[inspected]`); *tx* = transaction involvement; *provenance* = what the move needs from the
manifest.

| # | Source (today) | Proposed destination | Owner kind | Imports today | Dependents today | Tx | Provenance |
|---|---|---|---|---|---|---|---|
| 1 | `candidates/loader.js` | `runtime/src/loaders/candidates.js` | loader | `./input`, `./candidate`, `./roles`, `./errors` | `candidates/index.js:17` | none | rewrite needed |
| 2 | `filtering/context-loader.js` | `runtime/src/loaders/filtering-context.js` | loader | `../candidates/{roles,input,candidate,errors}` | `filtering/index.js:35`, `filtering/pipeline.js:45`, `assembly/gpu-input.test.js:27`, `assembly/pipeline.test.js:33` | none | rewrite needed |
| 3 | `filtering/pipeline.js` | `runtime/src/orchestrator/filtering-pipeline.js` — **`[unresolved]`**: §11.2 allows "or a runtime loader entry point" | composition | `./context-loader`, `./filter` | `filtering/index.js:36` | none | rewrite needed |
| 4 | `scoring/load-scoring-model.js` | `runtime/src/loaders/scoring-model.js` | loader | `../candidates/errors`, `./configuration` | `scoring/index.js:56` | none | rewrite needed |
| 5 | `scoring/load-assessments.js` | `runtime/src/loaders/assessments.js` | loader | `../candidates/errors` | `scoring/index.js:71` | none | rewrite needed |
| 6 | `offers/select.js` | `runtime/src/loaders/offer-selection.js` | loader | `../candidates/{input,candidate,errors}`, `../assembly/prices`, `./as-of` | `offers/index.js:10`, `assembly/pipeline.test.js:32` | none | rewrite needed |
| 7 | `query/load-query-input.js` | `runtime/src/loaders/query-input.js` | loader | `../candidates/{errors,input}` | `query/index.js:28` | none | rewrite needed |
| 8 | `query/catalog-version.js` | `runtime/src/loaders/catalog-version.js` | loader | `../candidates/errors` | `query/index.js:34` | none | rewrite needed |
| 9 | `offers/index.js` | **`[unresolved]`** (barrel; §11.2 gives no path) | barrel | `./select` | `orchestrator/run.js:141`, `swap-preview.js:77`, `apps/api` via barrel? (no) | none | unknown |
| 10 | `query/index.js` | **`[unresolved]`** (barrel) | barrel | `./load-query-input`, `./catalog-version` | `orchestrator/run.js:139`, `swap-preview.js:75`, `apps/api/src/engine.js:35` | none | unknown |
| 11 | `orchestrator/index.js` | **`[unresolved]`** (barrel) | barrel | `./run`, `./snapshot`, `./full-run`, `./swap-preview`, `./swap-commit` | `apps/api/src/engine.js:31`, `orchestrator/index.test.js` | none | unknown |
| 12 | `persistence/persist-ranked.js` | `runtime/src/persistence/persist-ranked.js` | writer | `node:crypto`, `./validate-selected` | `orchestrator/commit.js:110`, `commit.test.js:39` | writes inside commit's tx | rewrite needed |
| 13 | `persistence/persist-pass-facts.js` | `runtime/src/persistence/persist-pass-facts.js` | writer | `../candidates/errors` | `orchestrator/commit.js:112`, `commit.test.js:47`, `full-run.test.js:430` | writes inside commit's tx | rewrite needed |
| 14 | `persistence/persist-rejections.js` | `runtime/src/persistence/persist-rejections.js` | writer | `node:crypto`, `../candidates/errors`, `./validate-rejections` | `orchestrator/commit.js:111`, `commit.test.js:43` | writes inside commit's tx | rewrite needed |
| 15 | `persistence/validate-selected.js` | `runtime/src/persistence/validate-selected.js` | validator | `../candidates/errors`, `../candidates/roles` | `persist-ranked.js:41` | none (payload shape) | rewrite needed |
| 16 | `persistence/validate-rejections.js` | `runtime/src/persistence/validate-rejections.js` | validator | `../candidates/errors` | `persist-rejections.js:89` | none (payload shape) | rewrite needed |
| 17 | `orchestrator/run.js` | `runtime/src/orchestrator/run.js` | orchestrator | `../offers/as-of`, `../query`, `../candidates`, `../offers`, `../filtering`, `../scoring`, `../retention`, `../assembly`, `../candidates/errors` | `snapshot.js:48`, `swap-commit.js:79` (`SELECT_NOW_SQL`), `orchestrator/index.js` | **none** (one autocommit `SELECT CURRENT_TIMESTAMP`) | rewrite needed |
| 18 | `orchestrator/snapshot.js` | `runtime/src/orchestrator/snapshot.js` | orchestrator | `../candidates/errors`, `./run` | `full-run.js:46`, `orchestrator/index.js`, `scripts/measure-api-pass-phases.js:64` | **owns read-only tx** | rewrite needed |
| 19 | `orchestrator/full-run.js` | `runtime/src/orchestrator/full-run.js` | composition | `../ranking`, `./commit`, `./snapshot`, `../explanation` | `orchestrator/index.js` | **none** (composes) | rewrite needed |
| 20 | `orchestrator/commit.js` | `runtime/src/orchestrator/commit.js` | orchestrator | `../candidates/errors`, `../persistence/persist-ranked`, `persist-rejections`, `persist-pass-facts` | `full-run.js:45`, `orchestrator/index.js`, `scripts/measure-api-pass-phases.js:65`, `scripts/test-orchestrator-commit.js:42` | **owns write tx** | rewrite needed |
| 21 | `orchestrator/swap-preview.js` | `runtime/src/orchestrator/swap-preview.js` | orchestrator | `../query`, `../candidates`, `../offers`, `../filtering`, `../assembly`, `../candidates/errors` | `swap-commit.js:78` (`composeSwap`), `orchestrator/index.js` | one fn owns read-only tx, one owns none | rewrite needed |
| 22 | `orchestrator/swap-commit.js` | `runtime/src/orchestrator/swap-commit.js` | orchestrator | `node:crypto`, `../assembly`, `../scoring`, `../candidates/errors`, `./swap-preview`, `./run` | `orchestrator/index.js` | one fn owns write tx, one owns none | rewrite needed |

`[inspected]` Four old-path consumers must keep working unchanged: `apps/api/src/engine.js` (barrels
only), `apps/api/test/unit/import-boundary.test.js` (barrel names), `scripts/measure-api-pass-phases.js`
(deep `orchestrator/snapshot`, `orchestrator/commit`) and `scripts/test-orchestrator-commit.js` (deep
`orchestrator/commit`). `verify-docs` `engine-layout` also requires `persistence/persist-ranked.js` to
exist at the old path.

`[inspected]` `eager-horizon-hare.md` and `silver-shore-roach.md`, named in the assignment as the
inventory and refinement references, are **not present in this repository** (glob: 0 matches). This
table is therefore derived from the §11.2 table and from the source imports, not from those files.

---

## 6. B. Dependency graph and the three mixed-barrel splits

**PROPOSED — NOT APPROVED.**

### 6.1 Direction and prohibition findings

`[inspected]` A grep of the whole tree for these four edges returned:

| Prohibition | Finding |
|---|---|
| no loaders → orchestrator | **holds** today: no loader requires an orchestrator module |
| runtime → API | **holds**: every `apps/api` mention under `src/`, `packages/` is a comment, not a `require` |
| core → runtime | **holds**: no file under `packages/recommendation-core` and no file under `src/recommendation` mentions `recommendation-runtime` |
| no import from `core/src/**` | **DOES NOT HOLD** at the three mixed barrels: `candidates/index.js:16` and `filtering/index.js:34` require `../../../packages/recommendation-core/src/<ns>` deep paths, and `scoring/index.js` uses the same pattern for its pure half |

`[inspected]` The runtime order is strictly: `orchestrator/index.js` → {run, snapshot, full-run,
swap-preview, swap-commit}; `full-run` → {snapshot, commit}; `snapshot` → `run`; `swap-commit` →
{swap-preview, run}; `commit` → persistence writers; loaders → core shims only. There is no cycle, and
no loader sits above an orchestrator.

The deep `core/src/**` imports in the barrels are **step 6 material**, not W1: the barrels must stay
byte-identical until the API stops importing them. W1 may not add a new deep core path; the runtime
package must reach core through the package root (`require('../../../recommendation-core')`, already
permitted by the boundary scanner) until step 6 lands.

### 6.2 The three mixed-barrel splits (publication, not filesystem)

`[inspected]` from the barrel sources and the W0 `docs/MIXED_BARRELS.md`:

| Stage | Core publishes (pure) | Runtime publishes (SQL) | Runtime composition |
|---|---|---|---|
| `candidates/index.js` | role vocabulary, `ERROR_CODES`, `CandidateSelectionError`, input/candidate factories, selection stages, `selectCandidatePool`, `compareCandidates` | `loadCandidates` (`./loader`) | — |
| `filtering/index.js` | `filterCandidates`, `CANDIDATE_STATUSES`, `buildIntegratedGpuPresentMap` | `loadFilteringContext`, `CONTEXT_COMPAT_KEYS` (`./context-loader`) | `filterCandidatesForRecommendation` (`./pipeline`) |
| `scoring/index.js` | configuration and use-case validators, `GPU_POLICIES`, `selectAssessmentRow`, `effective-score`, `candidate-score`, `build-score` | `loadScoringModel` + `SELECT_SCORING_MODEL_SQL`, `loadComponentAssessments` + `SELECT_COMPONENT_ASSESSMENTS_SQL` | — |

Rules the split must keep: one owner per name (no runtime public name may equal a core name — enforced
by `test/surface.test.js`); no runtime module re-exports a core name; the old barrel's own test is not
touched; SQL constants travel with their loader. The old barrels stay composite and byte-identical
until step 6; only their required modules become shims.

---

## 7. C. Provenance: a fail-closed `declared-rewrite` policy

**PROPOSED — NOT APPROVED. Design only — no verifier change, no manifest entry, no whitespace
exemption before approval.**

### 7.1 Current state

`[inspected]` `scripts/lib/extraction-manifest.js` implements exactly one `identity_policy`
(`byte-identical`) and refuses any other value. Post-move changes are recorded through `edits[]`, a
two-commit procedure (edit commit touching only the destination, then a record commit touching only the
manifest), with the record commit derived from history rather than declared. There is **no** mechanism
to declare an import rewrite, so a W1 move whose specifiers must change cannot be represented today.

### 7.2 Policy shape

`[proposed]` A second policy, selected per batch or per module, that reconstructs the expected
destination bytes from the **baseline source blob** and refuses anything that does not match exactly:

```json
{
  "id": "step-5-w1",
  "baseline_sha": "<40 hex>",
  "identity_policy": "declared-rewrite",
  "modules": [
    {
      "source": "src/recommendation/candidates/loader.js",
      "destination": "packages/recommendation-runtime/src/loaders/candidates.js",
      "rewrites": [
        { "id": "cand-input", "find": "require('./input')",   "replace": "require('../../../recommendation-core/candidates')", "count": 1 },
        { "id": "cand-roles", "find": "require('./roles')",   "replace": "require('../../../recommendation-core/candidates')", "count": 1 }
      ]
    }
  ]
}
```

Design constraints:

1. `rewrites` is **ordered** and applied sequentially to the baseline bytes; each rule declares an
   exact match `count`.
2. A rule that matches zero times, or more than `count`, is an error — never a partial success.
3. Candidate rules must be **non-overlapping** and each must fail if its own match count is not exact.
4. The verifier computes `sha256(apply(rewrites, baseline_blob))` and requires equality with
   `sha256(destination_blob)`, plus `sha256(baseline_blob)` equality with the recorded baseline.
   There is no path where an unmatched rule is ignored.
5. Byte-exact comparison only. No whitespace normalisation, no line-ending tolerance, no
   `git diff --ignore-*`. A CRLF/LF change is a mismatch, deliberately.
6. The manifest stays fail-closed on unknown keys and unknown policies, and `rewrites` is rejected
   unless the policy is `declared-rewrite`.
7. Every rule must name a target inside the batch's declared destination set; a rule that points at a
   file not declared in `modules` fails.

### 7.3 Negative-test matrix (each must fail closed)

| Case | Fixture | Expected |
|---|---|---|
| ambiguous | one rule whose `find` occurs twice with `count: 1` | FAIL (`count` mismatch) |
| duplicate | the same `id` twice in one module | FAIL (schema) |
| duplicate module | the same `source` or `destination` twice in a batch | FAIL (schema) |
| overlapping | two rules whose match ranges intersect | FAIL (overlap detected) |
| unmatched | `find` absent from the baseline blob | FAIL |
| extra | a rule surviving after the ordered application produced the expected bytes | FAIL |
| modified destination | destination edited after the move | FAIL (sha256) |
| reordered | two independent rules swapped, producing different bytes | FAIL (sha256) |
| source drift | baseline blob edited in history | FAIL (baseline sha) |
| destination drift | destination edited in a later commit | FAIL (destination sha) |
| binary | destination contains NUL / non-UTF-8 bytes | FAIL (binary refusal) |
| CRLF/LF | destination or baseline line endings changed | FAIL (byte mismatch) |
| unauthorized target | rewrite pointing outside the declared destinations | FAIL (scope) |
| policy absent | `rewrites` present without `identity_policy: declared-rewrite` | FAIL (schema) |

`[owner]` Adopting the policy is a review decision (gate 6). Agent 3 does not edit the manifest schema,
the verifier, or `check:whitespace` and does not introduce an exemption.

---

## 8. D. Transaction contract and behavioural test plan

**PROPOSED — NOT APPROVED. No transaction behaviour changes.**

### 8.1 Contract verified against source

`[inspected]` `snapshot.js:1-45` documents and implements `BEGIN ISOLATION LEVEL REPEATABLE READ READ
ONLY` … `ROLLBACK` on both paths, never `COMMIT`, `BEGIN` outside `try`; `run.js` has no transaction
control and issues one `SELECT CURRENT_TIMESTAMP AS now` (`run.js:152`); `swap-commit.js:534-552`
implements `commitSwapInTransaction` (`BEGIN` … `COMMIT`, `ROLLBACK` on error, original error wins);
`commitSwap` (`swap-commit.js:244`) takes the caller's handle; `full-run.js:72,125` calls
`runRecommendationSnapshot` then `runRecommendationCommit` sequentially on one client.

| Module / API | Transaction ownership | Evidence |
|---|---|---|
| `snapshot.js` / `runRecommendationSnapshot` | owns the read-only repeatable-read transaction | `snapshot.js:1-45` |
| `commit.js` / `runRecommendationCommit` | owns the write transaction | `W0 docs/ORCHESTRATOR_ENTRY_POINTS.md` + `commit.js` |
| `commitSwap` | caller-owned; opens none | `swap-commit.js:244` |
| `commitSwapInTransaction` | owns the write transaction | `swap-commit.js:534-552` |
| `run.js` / `runRecommendation` | owns none | `run.js:117,152` |
| `full-run.js` | owns none; sequences the two | `full-run.js:72,125` |

### 8.2 Recording-fake-client cases (W1 work, not W0)

`[proposed]` Each case asserts the exact ordered `(sql, params)` sequence against a recording fake:

1. **snapshot success** — `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` precedes every read;
   final statement is `ROLLBACK`; `COMMIT` never appears.
2. **snapshot failure after `BEGIN`** — `ROLLBACK` still issued exactly once; the pass error is
   rethrown unchanged.
3. **snapshot `BEGIN` failure** — no `ROLLBACK` attempted.
4. **rollback failure** — the failing `ROLLBACK` does not mask the original error.
5. **commit success** — one `BEGIN`, the `recommendation_query` `FOR UPDATE` guard, REPLACE-style
   writers, `COMMIT`; no second `BEGIN`.
6. **commit failure** — `ROLLBACK`, original error preserved.
7. **`commitSwapInTransaction`** — own `BEGIN`…`COMMIT`; `commitSwap` issues no `BEGIN`/`COMMIT`/
   `ROLLBACK` on the handle it is given.
8. **`run`** — no transaction statements at all; exactly one `SELECT CURRENT_TIMESTAMP AS now`.
9. **client identity** — every statement of one pass goes to the same client object; the runtime never
   creates, releases or closes one.
10. **no nesting** — no `BEGIN` occurs while another transaction is open in the recorded stream.
11. **`full-run` ordering** — the snapshot's `ROLLBACK` index precedes the commit's `BEGIN` index on
    the same client.

These replace the static keyword parity check as *acceptance*; the parity check stays as a pre-check.

### 8.3 Documentation wording correction (proposal only)

`[inspected]` `packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md` currently says:

> "**The read snapshot** is opened by the caller: `orchestrator/run.js` runs stages 1-10 inside a
> caller-owned `REPEATABLE READ READ ONLY` transaction"

`[proposed]` Correction: the **caller supplies the dedicated client**; `orchestrator/snapshot.js` **owns**
the transaction (`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` … `ROLLBACK` both paths, never
`COMMIT`), and `orchestrator/run.js` owns no transaction control at all. The change is one sentence in
a W0-owned document and needs its owner's approval; Agent 3 has not edited it.

---

## 9. E. Test ownership, shims and exports

**PROPOSED — NOT APPROVED.**

### 9.1 `step-5-w1` inventory (loaders batch)

Move with their module (8 suites):

`candidates/loader.test.js`, `filtering/context-loader.test.js`, `filtering/pipeline.test.js`,
`scoring/load-assessments.test.js`, `scoring/load-scoring-model.test.js`, `offers/select.test.js`,
`query/catalog-version.test.js`, `query/load-query-input.test.js`.

Stay with the composite barrels (3 suites):

`filtering/index.test.js` (pinned `SPLIT_FACTS.runtimeBarrel` row, 7 assertions),
`filtering/integration.test.js`, `scoring/index.test.js`.

Also staying, as evidence of old-path compatibility: `apps/api/test/unit/import-boundary.test.js` and the
`orchestrator/*.test.js` suites that exercise the barrels.

`[proposed]` Before/after test and assertion counts are **not** recorded here: the ownership gate
measures them at the capture commit (`scripts/audit-pr2-test-ownership.js`), and inventing them now
would be exactly the stale-figure defect the gate exists to prevent. The inventory row shape is
`{ current, kind: move|stay|split, batch: 'step-5-w1', before: {tests, assertions} }`, measured at the
baseline.

### 9.2 Discovery and surface

`[inspected]` `test/assert-discovery.js` pins four required suites as a **floor** ("Later waves add test
files; this list is the floor, not the ceiling"), so moved suites are picked up by the existing glob
without editing the guard. `[proposed]` W1 grows `test/export-surface.json` from `[]` to `['loaders']`
in the same commit that populates the namespace, and `test/surface.test.js` continues to assert no
overlap with core.

### 9.3 Old-path shims

`[proposed]` Every moved file keeps an identity shim at its old path, mirroring the core's pattern (for
example `src/recommendation/candidates/loader.js` becoming a three-level re-export of
`../../../packages/recommendation-runtime/src/loaders/candidates.js`). Guarantees a shim must satisfy:

1. It exports the **same object** the new module exports (identity, not a copy).
2. It adds no behaviour, no default values, no re-shaping, and no eager side effects.
3. `verify-docs` `engine-layout` still finds `persistence/persist-ranked.js`.
4. `apps/api` and `scripts/` consumers keep working with no edit at W1 (they are step 6 material).
5. The old barrel keeps its current contents and requires byte for byte.

### 9.4 Runtime package `exports` subpaths

`[proposed]` Per RFC §11.5: `.` → `src/index.js` (also `main`), `./loaders`, `./orchestrator`,
`./persistence`. No `./package.json`, no deep `./src/**` subpaths. The exact key set must be approved
with the scope decision (gate 5) before it is written.

### 9.5 Deferred

`[owner]` The `docs/TEST_MAP.md` runtime row is **not** written until scope is approved. No decision-log
entry is proposed here.

---

## 10. Coordination messages (drafts — not sent)

**PROPOSED — NOT APPROVED. Posting any of these requires explicit approval.**

**To Agent 1 (CI, Docker).**
1. `test:runtime` is wired correctly, but at `7e27be6` it never ran: `unit-and-docs` failed at step 6
   and steps 7–30 were skipped, so the 404/failure mode is unmeasured. At that SHA
   `packages/recommendation-runtime/` contains only `docs/` and `package.json`.
2. #48's `test:runtime` step therefore has a hard dependency on **#50** that is not in its blocker list.
3. Gate 2 needs a green Node 22 `unit-and-docs` in which step 10 actually executes, on `master` or on a
   PR head that will merge — `07c1254` is a scratch branch and does not close it.
4. C7: neither `apps/api/Dockerfile` nor `api-image.yml` references `recommendation-runtime`, so the
   green `image` job proves nothing about it. Please land the COPY pair and a container assertion that
   the packaged runtime resolves and exports its subpaths; `.dockerignore` already permits it.

**To Agent 2 (Step 4 acceptance).** Written acceptance is requested for the nine core namespaces, the
11-key `exports` map and the identity shims at `ac06a6a`, on the basis of the `verify:extraction`
47/47 and `verify:ownership` 105→105 evidence already recorded in PR #49. Gate 1 cannot be inferred
from merge order alone.

**To the RFC A2/A6 owner (count, scope, transaction).**
1. §11.2 enumerates 22 runtime rows; its arithmetic says 21 (it omits `offers/index.js`); RFC §5
   (line 1527) says 24. Confirm the authoritative figure and whether the 2 new barrels are counted.
2. §11.2 gives no destination for `offers/index.js`, `query/index.js` or `orchestrator/index.js`, and
   two options for `filtering/pipeline.js`. Please rule on all four.
3. Confirm the W1/W2/W3 labels (loaders / persistence / orchestrator) and that "full runtime
   extraction" spans all three rather than redefining W1 as the whole move.
4. Confirm the transaction attribution in `LOADERS_AND_TRANSACTIONS.md` (section 8.3) so the wording
   defect is corrected by its owner.

**To the project authority.** Gate ledger (section 11) with the evidence each gate still needs. W1 is
not authorised and no implementation has started.

---

## 11. Gate ledger

| # | Gate | Status | Owner | Evidence still needed |
|---|---|---|---|---|
| 1 | Step 4 final acceptance | **OPEN** | Agent 2 | written acceptance |
| 2 | Runtime tests in CI, green on the merge path | **OPEN** | Agent 1 | Node 22 `unit-and-docs` where step 10 runs, on master or a merging PR |
| 3 | C7 image validation | **OPEN** | Agent 1 | runtime COPY + container assertion + green `image` |
| 4 | RFC count resolved | **OPEN** | A2/A6 | authoritative 22/21/24 + the four destination rulings |
| 5 | Full-extraction scope and W1/W2/W3 labels | **OPEN** | A2/A6 | approved phase definitions |
| 6 | Provenance, transaction, compatibility, test-ownership contracts | **OPEN** | review | approved designs with negative-test evidence |
| 7 | Explicit written W1 authorization | **OPEN** | authority | authorization text |

**Verdict: `W1 NOT READY — GATES OPEN`.** 0 of 7 gates closed. W0 is frozen and independently
re-measured at `89e761d` (61 tests / 13 suites / 61 pass / 0 fail on a full exported tree outside the
repository).
