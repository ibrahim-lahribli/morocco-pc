# W1 runtime extraction — preparation dossier

**Status: PROPOSED — NOT APPROVED. `W1 NOT READY — GATES OPEN` (0 of 7 gates closed).**

Owner: Agent 3 (runtime inventory, dependency analysis, provenance proposal, transaction test plan,
runtime test ownership, coordination). This document is preparation and evidence only. It moves no
module, rewrites no import, creates no shim, changes no transaction, does not touch
`extraction-manifest.json` or its verifier, and does not touch root `package.json`, CI, the Dockerfile,
`.dockerignore` or `api-image.yml`. Nothing in it becomes authoritative until the owners named in
section 13 approve it in writing.

Every section is headed `PROPOSED — NOT APPROVED`. Every claim carries one of these labels:

| Label | Meaning |
|---|---|
| `[inspected]` | read directly from this checkout or from a Git object in this repository |
| `[measured]` | produced by a command run in this session, with the command and result recorded |
| `[derived]` | computed from `[inspected]` data by a script whose rule is stated inline |
| `[CI verified]` | read from a GitHub Actions run/job/step for the exact commit SHA named |
| `[previously reported]` | claimed by a PR author or a prior report; not independently reproduced here |
| `[owner]` | requires another owner's decision (Agent 1, Agent 2, RFC A2/A6 owner, project authority) |
| `[proposed]` | designed here; unapproved |
| `[unresolved]` | no acceptable answer exists yet |

**This document is not an authorization.** Nothing here authorizes a module move, and approval of this
dossier is not approval of W1.

---

## 1. W0 preservation — measured

**PROPOSED — NOT APPROVED (this section is a record, not a change).**

### 1.1 Baseline state

`[inspected]` The W0 harness landed at `feat/runtime-harness` = `89e761d`, and the W0 review
corrections are now at `75f7823` (section 1.5). The runtime tree holds **12 files**:
`docs/LOADERS_AND_TRANSACTIONS.md`, `docs/MIXED_BARRELS.md`, `docs/ORCHESTRATOR_ENTRY_POINTS.md`,
`package.json`, `src/index.js`, `test/assert-discovery.js`, `test/boundary-scanner.js`,
`test/boundary.test.js`, `test/export-surface.json`, `test/index.test.js`, `test/surface.test.js`,
`test/transaction-ownership.test.js`.

`[inspected]` `src/index.js` is `module.exports = {}`, and `test/export-surface.json` declares
`"exports": []`. The header comment names the planned waves (loaders W1, persistence W2, orchestrator
W3) and nothing has shipped from them.

`[inspected]` On the historical `master` `45133d5` and in this checkout at `880bb18`, `src/recommendation/**` still contains every
loader, every persistence writer and every orchestrator module — no implementation has moved.

`[inspected]` PR #50 was **merged by the repository owner during this review**, at
2026-11-20T22:55:21Z, as `6fd31220fe2cbb421a56e28ada302f209f219691`; PR #49 merged immediately before
it as `2569647`. `origin/master` is now `6fd3122` and contains `75f7823`, so the runtime tree described
above is on `master`, not only on the branch. `[inspected]` PR #51, this dossier's branch, was rebased
onto `6fd3122` on 2026-11-21 (section 2.1): it is **0 commits behind** `master` and unmerged.

### 1.2 Deviation: this checkout is not the W0 branch

`[inspected]` `git status -sb` reports
`## feat/core-explanation-extraction...origin/feat/core-explanation-extraction [behind 1]` with two
untracked documentation copies; `HEAD` is `880bb18`, one commit behind that branch's remote head
`ac06a6a` (PR #49). The runtime package in this checkout therefore contains only `package.json` and
`docs/`, and no harness suite exists here.

Consequence: the harness cannot be executed from this working tree, and switching branches in a shared
checkout is out of scope. Section 1.3 measures it from an exported tree instead.

### 1.3 Suite re-measurement (independent of the author's report)

`[measured]` Command, from a temp directory inside the repository and outside the working tree:

```
git archive 89e761d | tar -x -C .agent3-tmp/w0
cd .agent3-tmp/w0/packages/recommendation-runtime
node test/assert-discovery.js
node --test "test/*.test.js"
```

Result on `node v24.21.0`, Windows: discovery printed `recommendation-runtime: 4 test suite(s)
discovered`, exit 0; the suite reported **tests 61, suites 13, pass 61, fail 0**, exit 0. The
previously reported `61 / 61 pass / 13 suites` is therefore **reproduced** — but on Node **24**, not the
Node 22 the gate requires. Node 22 execution remains CI-only evidence.

`[measured]` Re-measured on the merged `master` `6fd3122` with the same commands and the same Node:
discovery 4 suites; **tests 85, suites 17, pass 85, fail 0**, exit 0. The W0 corrections are on
`master`.

`[measured]` A partial export of `packages/**` alone (without the repository root `package.json`) fails
one assertion, `boundary.test.js` → "reports a package file outside src/ and a file outside the
package": `require('../../../package.json')` from `src/probe-fixture.js` resolves to the **repository
root** manifest, so the exported tree must include it. This is a coupling to the repository layout, not
a defect in the gate, and it is not to be "fixed" without authorization.

### 1.4 What must not change

`[inspected]` `src/index.js`, `test/export-surface.json`, `test/index.test.js`, `test/surface.test.js`,
`test/transaction-ownership.test.js`, `assert-discovery.js`, the package manifest and the three W0
documents are frozen W0 artifacts. The scanner may only change for a reproducible defect (section 1.5);
its scope may not grow into a scope or data-flow analyzer.

### 1.5 W0 review corrections — what the scanner now guarantees

`[measured]` Two files changed at `75f7823` (`test/boundary-scanner.js`, `test/boundary.test.js`), and
the suite is now **tests 85, suites 17, pass 85, fail 0** on `node v24.21.0`, exit 0
(`node test/assert-discovery.js` → `4 test suite(s) discovered`). Five reproducible defects were
corrected, each with a fixture in both directions:

| # | Defect (reproducible) | Correction | Suite delta |
|---|---|---|---|
| 1 | `object.release()` was reported as a client close on **any** receiver — the rule had no receiver check, unlike `.end()` | `.release()` is gated exactly like `.end()`: connection receiver allow-list (`client`, `pool`, `db`, `connection`, `database`, `pgPool`, `this.client`, …), stream/socket/formatter/response exempt, bare `release()` not attributed | +3 tests |
| 2 | `module[key].call(module,'pg')` / `.apply` / `.bind(...)()` slipped past the computed-member rule | a computed, non-static member followed by an invocation proxy is `dynamic-import`, including `module?.[key].call(...)` and `module?.[key]?.call(...)` | +3 tests |
| 3 | `function execute(require) { require('local-value') }` was a **false positive** | bounded shadowing: a function parameter, arrow parameter or `const|let|var` binding named `require`/`module`/`process`/`Date` suppresses the rule inside the enclosing braces only | +6 tests |
| 4 | `const load = require; load('pg')` and the `module.require` form were **missed** | bounded alias table (`require`, `module.require`, aliases of aliases) iterated to a fixpoint; call sites are imports; `.call` on an alias is held to the proxy rules | +6 tests |
| 5 | `createRequire`, `process.mainModule.require`, `globalThis.require`, `eval` and `Function` were invisible | new `code-evaluation` rule, plus `node:module` classified as a `loader` module | +6 tests |

`[inspected]` The scanner header now has four required sections — what it guarantees (six numbered
properties), what it detects syntactically (proxies, aliases, shadowing, each with its exact scope), what
it cannot determine semantically (a named list with the exact result for each example), and which
limitations require a W1 coding restriction (six numbered restrictions `R-CONN-1`, `R-ENV-1`,
`R-REQ-1`, `R-REQ-2`, `R-SHADOW-1`, `R-SPEC-1`).

`[inspected]` Accepted gaps, asserted CLEAN in the suite on purpose: `const c = client; c.end()` and
`const p = process; p.env.X`, plus any `require` held in a variable that is passed to a helper. These
are limits of a token scan, not defects; the W1 coding restrictions are what keep them from mattering.

`[measured]` **Correction (2026-11-21).** This paragraph previously also listed
`const load = require.bind(null); load('pg')` as an accepted gap, copying the scanner header's §3
example. **That is wrong.** Reproduced against `test/boundary-scanner.js` at `23f43c2b`, the scanner
reports it as `dynamic-import` **and** `forbidden-module`, because the `.bind` proxy is resolved back to
the `require` call site. It is therefore enforced, not a gap, and is no longer listed as one. Two other
header examples are also inaccurate — `client.end()` under a parameter named `client` **is** detected
(`connection-close`), because `client` is not in `SHADOWABLE_NAMES`. The header itself is not corrected
here (it lives in `test/boundary-scanner.js`, outside this PR's scope); the defect is recorded with E2
in `w1-rfc-decision-request.md`.

---

## 2. CI and PR state — evidence

**PROPOSED — NOT APPROVED.**

| Commit | Role | Tree state | `unit-and-docs` | Runtime step | `image` |
|---|---|---|---|---|---|
| `45133d5` | **historical** `master` (merge of #47); PR #51's base before the 2026-11-21 rebase | no `test:runtime` script, no runtime step in `ci.yml` | `success` (runs 44756114202 / 44756123305) | **did not exist** | not applicable |
| `75f7823` | **intermediate** #50 head (not the merged head) | scanner + fixtures only | **success** — runs 44832300705 (pull_request) / 44832308785 (push) | **does not exist in CI** — executed by no workflow | not applicable |
| `706e40b1` | **#50 merged head** | the 12 runtime files, merged as `6fd3122` | green before merge; merge commit run 44832844277 `success` | **does not exist in CI** | not applicable |
| `6fd3122` | **current `master`** (merge of #50) | the 12 runtime files are on `master` | `success` (run 44832844277) | **no `test:runtime` script and no runtime step in `ci.yml`** | not applicable |
| `7e27be6` | **historical** #48 head (superseded) | runtime step present at `ci.yml:56`, runtime test dir absent | **failure** at step 6 `npm run test:scripts`; steps 7–30 **skipped** | **never executed** (skipped) | failure (core exports map missing on master) |
| `23f43c2b` | **audited current** #48 head | runtime step at `ci.yml:56-57`, `test:runtime` at `package.json:12`, runtime suite present | **success** — run 44834047676, steps 5–30 executed | **step 10 success: 85 tests / 17 suites / 85 pass / 0 fail** | **success** — run 44834047614 |
| `07c1254` | scratch integration branch | all three merged | `success` | **step 10 success** | success |

`[inspected]` At `75f7823` neither the root `package.json` nor `ci.yml` mentions runtime, so the green
`unit-and-docs` on that head proves the repository's other gates still pass — it is **not** evidence for
gate 2. The 85/17 suite had never run on Node 22 under CI at that head; it now has, at `23f43c2b`.

`[inspected]` On the merged `master` `6fd3122`, `.github/workflows/ci.yml` runs `test:unit`,
`test:scripts`, `test:database-guard`, `test:core` and `test:api` and contains **no** runtime step,
while the root `package.json` defines **no** `test:runtime` script. The suite that ships on `master` is
therefore executed by nothing **on `master` itself**.

`[CI verified]` **PR-head evidence is not post-merge evidence.** At the audited #48 head `23f43c2b` the
harness is wired and green: `ci` run `44834047676` (pull_request) succeeded with steps 5–30 executed,
and step 10 "Runtime package harness (step 5)" logged `# tests 85`, `# suites 17`, `# pass 85`,
`# fail 0`; `api-image` run `44834047614` succeeded; push run `44834041407` succeeded. That closes the
**technical-evidence** half of gate 2 and nothing else: the change sits on an open PR branch, not on
`master`, so it is not integrated. A green PR-head run is not a merged gate and is not an approval.

`[inspected]` At `7e27be6` — the **historical** #48 head, not the current one — the root `package.json` defines
`"test:runtime": "node packages/recommendation-runtime/test/assert-discovery.js && node --test \"packages/recommendation-runtime/test/*.test.js\""`
— character-identical to the required command — but `packages/recommendation-runtime/` at that commit
contains only `docs/LOADERS_AND_TRANSACTIONS.md` and `package.json`.

`[CI verified]` Two green executions of the command now exist. `07c1254` (scratch): `ci` run 44820989559,
job `unit-and-docs` (ubuntu-latest, `node-version: '22'`), step 10 success; `image` run 44820989313
success — its internal counts were never read from the job log and remain `[previously reported]`.
`23f43c2b` (audited #48 head): run `44834047676`, step 10 success, counts read from the TAP log
(**85 / 17 / 85 / 0**). The mechanism (discovery guard + runner) is `[CI verified]` in both.

`[inspected]` `integration/pr48-pr49-pr50` is a scratch branch and is not a merge target. **Gate 2 is
therefore PARTIAL**: the step exists and is green on an open PR head, and is absent from `master`. It is
not closed, and it is no longer `OPEN` in the sense of "no evidence exists".

### 2.1 Merge sequence — resolved during this review

`[inspected]` The merge order recorded in the previous revision was **#49 → #50 → rebase #48**. The first
two resolved on 2026-11-20: PR #49 merged as `2569647` and PR #50 merged as `6fd3122` at 22:55:21Z,
after its **merged** head `706e40b1` had been verified (the merge commit's own `unit-and-docs` run
44832844277 succeeded); `75f7823` was an intermediate head, not the merged one. **Rebase #48 is still
outstanding.**

`[inspected]` PR #48's body lists #49→#50 as blockers but does not record that its `test:runtime` step
cannot pass without #50's files; the skipped steps hid that. Its description still cites head `96efc65`
and the two failed runs; the audited head is `23f43c2b` (section 2), and correcting that body is a
separate action this document does not perform.

`[inspected]` **PR #51 was rebased onto `6fd3122` on 2026-11-21** as part of this correction. Before it,
the branch was based on `45133d5` (the then-current `master`, the merge of #47) and reported `behind`;
the pre-rebase head was `cc6f0f28` and is now
historical. The rebase was clean — seven commits replayed with no conflict — and the branch's diff
against `master` remains exactly these two documentation files. `[owner]` No merge and no approval was
performed: rebasing a documentation branch is not an authorisation, and gate 7 is untouched.

---

## 3. C7 (Docker integration) — status

**PROPOSED — NOT APPROVED.** Requirements are in section 12; this section records the current state.

`[inspected]` **State at the audited #48 head `23f43c2b`** (PR #48 open, base `6fd3122`).
`apps/api/Dockerfile:69-70` ships the runtime package:

```dockerfile
COPY packages/recommendation-runtime/package.json ./packages/recommendation-runtime/package.json
COPY packages/recommendation-runtime/src ./packages/recommendation-runtime/src
```

Both instructions sit **after** `RUN npm ci --omit=dev` (`:31`) and **beside** the existing
`database-guard` (`:48-49`) and `recommendation-core` (`:56-57`) pairs. `.dockerignore` excludes `test`,
`docs` and `*.md` at any depth, so the pair ships the manifest and `src/` and nothing else.

`[CI verified]` `api-image` run `44834047614` (job `image`, success) asserted, in six executed steps:

| Step | What it asserted |
|---|---|
| Confirm the extracted core is in the image | `recommendation-core/package.json` and `src/` present; `apps/web` absent |
| Confirm the runtime package is in the image | `package.json` and `src/index.js` **present**; `test/` and `docs/` **absent** |
| Confirm the runtime package loads by path | `require('/app/packages/recommendation-runtime')` resolves; `private === true`; logs `runtime package OK (@morocco-pc/recommendation-runtime; root exports: 0)` |
| Confirm the shipped core matches its declared interface | `core surface OK (assembly,candidates,compatibility,explanation,filtering,offers,ranking,retention,scoring); exports-map negatives OK (6/6); engine graph OK` |
| Build the deployment image | the image builds from the repository root |
| Boot, health-check, clean up | `{"status":"ok","db":"down","engine_version":"ci-image"}`; `! grep -q 'MODULE_NOT_FOUND'` passes |

`[inspected]` **The limit, stated precisely.** These checks establish **presence and loadability**: the
COPY worked, `.dockerignore` did not swallow the package, the entry point exists and resolves by path.
They do **not** establish a W1 runtime API contract. At W0 the entry is `module.exports = {}`, so the
gate deliberately asserts no export keys — pinning emptiness would force the gate to change at W1. The
exact runtime surface is a W1 contract and gets the same shared-contract treatment as the core.

`[UNVERIFIED]` The C7 decision comment (`7052829377` §5) additionally claims the failure mode was
"verified on `morocco-pc-api:c7-neg`". **That claim is UNVERIFIED**: `grep -c "c7-neg"` over the
`44834047614` log returns **0**, `api-image.yml` has no negative-build step, and PR #48's body states
Docker was unavailable on the author's machine. It is a design argument, not a measurement, and is
recorded as such — not repeated as a test that ran.

`[inspected]` At the **merged** `master` `6fd3122` none of this exists yet: no runtime COPY, no runtime
assertion, no `test:runtime` script. C7 is evidenced on the #48 branch only.

`[owner]` C7 stays with Agent 1. Whether C7 must land **before** W1 remains unresolved (section 14);
the timing decision recorded in `7052829377` §1 is Agent 1's, and this document does not ratify it.

---

## 4. Inventory counts — eight quantities, never interchangeable

**PROPOSED — NOT APPROVED. `[unresolved]` — belongs to the RFC A2/A6 owner.**

`[inspected]` The §11.2 table contains **24 rows** whose target column includes runtime. That count was
re-measured in this review on the **merged** `master` `6fd3122` (after PR #49's Revision 15 landed) and
it matches the count on the historical `master` `45133d5` (PR #51's pre-rebase base) and on
`feat/core-explanation-extraction` `880bb18`:
the row set did not change when #49 merged, and the row count is not revision-dependent. Three of those
rows are the mixed barrels and are **split rather than moved**, leaving 21 moving rows. One of those 21
rows names **two** files (`persistence/validate-selected.js`, `validate-rejections.js`), so the moved set
is **22 files**.

`[measured]` The whole §11.2 table holds **49 rows**: **24** runtime-targeting (three of them
core+runtime), **23** core-only, **1** ingestion (target "neither", 8 modules) and **1** test-file row
(63 files, "follow their module"). On the core side the table's own "Counts" paragraph reports **47**
file-level moves, which equals the `blob-identical: 47 / 47` total `npm run verify:extraction` reports
across the six batches.

`[derived]` **Rows, modules, physical files and publication units are four different quantities**, and
the RFC uses the words interchangeably in different places (`33 files` at `:78`, `:380` and `:496`;
`47` in the §11.2 "Counts"; `24 runtime modules` at `:1527`). No single figure is wrong for every
quantity: 24 is a **row** count, 21 is a **row** count minus the three split barrels, 22 is a
**physical-file** count, and 47 is the **core** file count. The stale figure is `33`, which is not a
count of anything in the current table.

`[unresolved]` The **24 publication units** figure (22 moves + 2 prospective barrels) depends on a
counting convention the RFC never states — whether a split barrel's new half counts as a unit, and
whether a new barrel counts once or once per published subpath. **No owner-approved convention exists,
so this document declares no figure authoritative**; that is question A1/A4 in the decision request.

The "Counts" paragraph *is* revision-dependent, which is why this document cites sections and never
lines:

| Revision | §11.2 "Counts" bold figure | Its own parenthetical sums to | Runtime-targeting rows |
|---|---|---|---|
| `45133d5` (**historical** `master`, PR #51's pre-rebase base) | **24** modules ("2 candidates/filtering/offers loaders + 1 filtering pipeline + 3 candidates + 5 orchestrator + 5 persistence + 3 query + 2 scoring loaders") | **21** | **24** |
| `feat/core-explanation-extraction` `880bb18` | **21** modules ("3 loaders for candidates/filtering/offers + 1 filtering pipeline + 7 orchestrator + 5 persistence + 3 query + 2 scoring loaders") | **21** | **24** |
| `6fd3122` (**current `master`**, #49 + #50 merged) | **21** modules — PR #49's Revision 15 rewrote the figure | **21** | **24** |

Both parentheticals sum to 21, **one short of the 22 files the table moves**. The programme table's
"the 24 runtime modules" phrase sits at **line 1524 on `45133d5` and line 1527 on `6fd3122` and on the
branch**. The bold figure is therefore revision-dependent and the row count is not; that asymmetry is
the whole of question A1.

`[derived]` The five quantities this dossier uses, with the evidence that produces each:

| Term | Value | How it is produced | Appears in |
|---|---|---|---|
| RFC §11.2 **total rows** | **49** | every row of the table: 24 runtime-targeting + 23 core-only + 1 ingestion ("neither") + 1 test-file row | §4 |
| RFC runtime-targeting **rows** | **24** | count of §11.2 rows whose target column includes runtime | §4, §6 |
| Mixed **barrels** | **3** | `candidates/index.js`, `filtering/index.js`, `scoring/index.js` — target "core + runtime", split not moved | §6.2 |
| Remaining RFC **rows** | **21** | 24 − 3 | §4 |
| Core file-level **moves** | **47** | §11.2 "Counts"; equals `verify:extraction`'s `blob-identical: 47 / 47` | §4 |
| Proposed physical **file moves** | **22** | 21 rows, one of which names two files | §5.1 |
| Numbered **inventory rows** | **22** | one per unique physical path (section 5.1); a file appears once even when it publishes several names | §5.1 |
| Prospective **publication barrels** | **2** | `runtime/src/loaders/index.js`, `runtime/src/persistence/index.js` — neither exists; implied by RFC §11.5 | §5.2, §10 |
| Publication **units** | **24** | 22 moves + 2 prospective barrels. Coincides with the row count for a different reason; the coincidence is not evidence for either figure | §5.2 |
| Compatibility **shims** | **22** (proposed) | one identity shim per moved file, counted separately and never inside the move total | §9 |

`[unresolved]` The parenthetical arithmetic of both revisions is one short of 22. Either a moved file
is missing from the arithmetic or one of the 22 is not meant to move. This is question A1/A2 in the
decision request and is **not** explained away here.

---

## 5. Source-file inventory

**PROPOSED — NOT APPROVED.**

`[derived]` Every path in this section was resolved from the working tree at `880bb18` by a script that
reads each file's `module.exports` object literal, collects its `require('…')` specifiers, and resolves
every `require` in `src/`, `apps/`, `scripts/`, `packages/` and `test/` against the target path
(extension and `/index.js` resolution, `node_modules`, `.next` and `dist` skipped). Dependents are
therefore **resolved**, not string-matched: `require('./loader')` counts as a dependent of
`candidates/loader.js`.

### 5.1 The 22 unique physical paths

Columns 1–8 of the required ten (path, owner, role, wave, destination, confirmation, compatibility
treatment), then the evidence table 5.1b carries exports, imports and dependents keyed by the same `#`.
"Owner today" is the current owner of the *file*: `core` = the pure implementation already moved behind
the `packages/recommendation-core` shim, `runtime` = SQL-executing or composition code still in
`src/recommendation`, `legacy barrel` = a published namespace barrel.

| # | Source path (unique) | Owner layer today | Role | Wave | Proposed destination | Status | Compatibility treatment |
|---|---|---|---|---|---|---|---|
| 1 | `candidates/loader.js` | runtime | implementation (SQL loader) | W1 | `runtime/src/loaders/candidates.js` | confirmed by RFC §11.2 target | identity shim at old path |
| 2 | `filtering/context-loader.js` | runtime | implementation (SQL loader) | W1 | `runtime/src/loaders/filtering-context.js` | confirmed | identity shim |
| 3 | `filtering/pipeline.js` | runtime | composition (no SQL, no logic) | W1 | **`[unresolved]`** — §11.2 permits `runtime/orchestrator/filtering-pipeline.js` **or** a runtime loader entry point | unresolved (C4) | identity shim either way |
| 4 | `scoring/load-scoring-model.js` | runtime | implementation (SQL loader) | W1 | `runtime/src/loaders/scoring-model.js` | confirmed | identity shim |
| 5 | `scoring/load-assessments.js` | runtime | implementation (SQL loader) | W1 | `runtime/src/loaders/assessments.js` | confirmed | identity shim |
| 6 | `offers/select.js` | runtime | implementation (SQL loader) | W1 | `runtime/src/loaders/offer-selection.js` | confirmed (row exists; path is this dossier's proposal) | identity shim |
| 7 | `query/load-query-input.js` | runtime | implementation (SQL loader) | W1 | `runtime/src/loaders/query-input.js` | confirmed (same caveat) | identity shim |
| 8 | `query/catalog-version.js` | runtime | implementation (SQL loader) | W1 | `runtime/src/loaders/catalog-version.js` | confirmed (same caveat) | identity shim |
| 9 | `offers/index.js` | legacy barrel | namespace barrel (runtime-only, **not** mixed) | W1 candidate | **`[unresolved]`** — §11.2 gives no path | unresolved (C1) | shim only if the file moves |
| 10 | `query/index.js` | legacy barrel | namespace barrel (runtime-only, no split) | W1 candidate | **`[unresolved]`** — §11.2 gives no path | unresolved (C2) | shim only if the file moves |
| 11 | `orchestrator/index.js` | legacy barrel | namespace barrel (public entry surface) | W3 (barrel) | **`[unresolved]`** — §11.2 gives no path | unresolved (C3) | shim only if the file moves |
| 12 | `persistence/persist-ranked.js` | runtime | implementation (writer, uses `node:crypto`) | W2 | `runtime/src/persistence/persist-ranked.js` | confirmed | identity shim |
| 13 | `persistence/persist-pass-facts.js` | runtime | implementation (writer) | W2 | `runtime/src/persistence/persist-pass-facts.js` | confirmed | identity shim |
| 14 | `persistence/persist-rejections.js` | runtime | implementation (writer, uses `node:crypto`) | W2 | `runtime/src/persistence/persist-rejections.js` | confirmed | identity shim |
| 15 | `persistence/validate-selected.js` | runtime | implementation (validator) | W2 | `runtime/src/persistence/validate-selected.js` | confirmed | identity shim |
| 16 | `persistence/validate-rejections.js` | runtime | implementation (validator) | W2 | `runtime/src/persistence/validate-rejections.js` | confirmed | identity shim |
| 17 | `orchestrator/run.js` | runtime | implementation (orchestration, no transaction) | W3 | `runtime/src/orchestrator/run.js` | confirmed | identity shim |
| 18 | `orchestrator/snapshot.js` | runtime | implementation (**owns** the read-only transaction) | W3 | `runtime/src/orchestrator/snapshot.js` | confirmed | identity shim |
| 19 | `orchestrator/full-run.js` | runtime | composition (sequences snapshot → commit) | W3 | `runtime/src/orchestrator/full-run.js` | confirmed | identity shim |
| 20 | `orchestrator/commit.js` | runtime | implementation (**owns** the write transaction) | W3 | `runtime/src/orchestrator/commit.js` | confirmed | identity shim |
| 21 | `orchestrator/swap-preview.js` | runtime | implementation (one function owns a read-only transaction) | W3 | `runtime/src/orchestrator/swap-preview.js` | confirmed | identity shim |
| 22 | `orchestrator/swap-commit.js` | runtime | implementation (one function owns a write transaction) | W3 | `runtime/src/orchestrator/swap-commit.js` | confirmed | identity shim |

Wave totals: **W1 = 8 files** (rows 1–8), **W2 = 5** (rows 12–16), **W3 = 6 implementation files** (rows 17–22), and **3 barrels whose destination is unresolved** (rows 9, 10, 11 — row 11 is also the W3 barrel) → **22**.
No file appears twice, and no row counts a public name rather than a physical file.

### 5.1b Evidence per row (exports, imports, dependents)

`[derived]` Paths in *dependents* are shortened: `c/` = `src/recommendation/`, `p/` =
`packages/`, `api/` = `apps/api/`, `sc/` = `scripts/`. Test files are listed because they are
dependents that must keep resolving.

| # | Exports today | Imports today | Dependents today |
|---|---|---|---|
| 1 | `loadCandidates` | `./input`, `./candidate`, `./roles`, `./errors` | `c/candidates/index.js` |
| 2 | `loadFilteringContext`, `CONTEXT_COMPAT_KEYS` | `../candidates/{roles,input,candidate,errors}` | `c/filtering/{index.js,index.test.js,integration.test.js,pipeline.js,pipeline.test.js,context-loader.test.js,igpu-map.test.js}`, `c/assembly/{pipeline.test.js,gpu-input.test.js}` |
| 3 | `filterCandidatesForRecommendation` | `./context-loader`, `./filter` | `c/filtering/{index.js,index.test.js,pipeline.test.js}` |
| 4 | `loadScoringModel`, `SELECT_SCORING_MODEL_SQL` | `../candidates/errors`, `./configuration` | `c/scoring/{index.js,index.test.js,load-scoring-model.test.js}` |
| 5 | `loadComponentAssessments`, `SELECT_COMPONENT_ASSESSMENTS_SQL` | `../candidates/errors` | `c/scoring/{index.js,index.test.js,load-assessments.test.js}` |
| 6 | `selectOfferPrices`, `SELECT_OFFER_PRICES_SQL` | `../candidates/{input,candidate,errors}`, `../assembly/prices`, `./as-of` | `c/offers/{index.js,select.test.js}`, `c/assembly/pipeline.test.js` |
| 7 | `loadQueryInput`, `SELECT_QUERY_INPUT_SQL`, `REQUIRED_ROLES` | `../candidates/{errors,input}` | `c/query/{index.js,load-query-input.test.js}` |
| 8 | `catalogVersion`, `CATALOG_VERSION_SQL`, `CATALOG_COVERED_TABLES`, `CATALOG_VERSION_RE`, `buildCatalogVersionSql`, `fingerprintArm` | `../candidates/errors` | `c/query/{index.js,catalog-version.test.js}` |
| 9 | `selectOfferPrices`, `SELECT_OFFER_PRICES_SQL` | `./select` | `c/orchestrator/{run.js,run.test.js,swap-preview.js,swap-preview.test.js,swap-commit.test.js}`, `sc/measure-api-pass-phases.js` |
| 10 | `loadQueryInput`, `SELECT_QUERY_INPUT_SQL`, `REQUIRED_ROLES`, `catalogVersion`, `CATALOG_VERSION_SQL`, `CATALOG_COVERED_TABLES` | `./load-query-input`, `./catalog-version` | `c/orchestrator/{run.js,swap-preview.js,swap-preview.test.js,swap-commit.test.js}`, `api/src/engine.js`, `sc/measure-api-pass-phases.js` |
| 11 | `runRecommendation`, `runRecommendationSnapshot`, `runRecommendationFullRun`, `evaluateSwapPreview`, `evaluateSwapPreviewSnapshot`, `commitSwap`, `commitSwapInTransaction`, `readCommittedSwap` | `./run`, `./snapshot`, `./full-run`, `./swap-preview`, `./swap-commit` | `api/src/engine.js`, `sc/{eval-scenarios.js,measure-orchestrator.js,verify-pool-independence.js}`, `c/orchestrator/index.test.js` |
| 12 | `persistRanked` | `node:crypto`, `./validate-selected` | `c/orchestrator/{commit.js,commit.test.js}`, `c/persistence/persist-ranked.test.js` |
| 13 | `persistPassFacts`, `validatePassFacts`, `UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL`, `UPDATE_RECOMMENDATION_RESULT_FACTS_SQL` | `../candidates/errors` | `c/orchestrator/{commit.js,commit.test.js,full-run.test.js}`, `c/persistence/persist-pass-facts.test.js` |
| 14 | `persistRejections`, `INSERT_BUILD_REJECTION_SQL`, `DELETE_BUILD_REJECTION_SQL` | `node:crypto`, `../candidates/errors`, `./validate-rejections` | `c/orchestrator/{commit.js,commit.test.js}`, `c/persistence/persist-rejections.test.js` |
| 15 | `validateSelected` | `../candidates/errors`, `../candidates/roles` | `c/persistence/{persist-ranked.js,persist-ranked.test.js,validate-selected.test.js}` |
| 16 | `validateRejections`, `REJECT_STATUS` | `../candidates/errors` | `c/persistence/{persist-rejections.js,persist-rejections.test.js}` |
| 17 | `runRecommendation`, `SELECT_NOW_SQL` | `../offers/as-of`, `../query`, `../candidates`, `../offers`, `../filtering`, `../scoring`, `../retention`, `../assembly`, `../candidates/errors` | `c/orchestrator/{index.js,index.test.js,run.test.js,snapshot.js,snapshot.test.js,swap-commit.js,swap-commit.test.js}`, `sc/measure-api-pass-phases.js` |
| 18 | `runRecommendationSnapshot`, `BEGIN_SQL`, `ROLLBACK_SQL` | `../candidates/errors`, `./run` | `c/orchestrator/{full-run.js,full-run.test.js,index.js,index.test.js,run.test.js,snapshot.test.js}`, `sc/measure-api-pass-phases.js` |
| 19 | `runRecommendationFullRun` | `../ranking`, `./commit`, `./snapshot`, `../explanation` | `c/orchestrator/{index.js,index.test.js,full-run.test.js}`, `sc/test-orchestrator-full-run.js` |
| 20 | `runRecommendationCommit`, `BEGIN_SQL`, `COMMIT_SQL`, `ROLLBACK_SQL`, `LOCK_RECOMMENDATION_QUERY_SQL`, `EXISTING_BUILD_CANDIDATES_SQL` | `../candidates/errors`, `../persistence/{persist-ranked,persist-rejections,persist-pass-facts}` | `c/orchestrator/{full-run.js,full-run.test.js,commit.test.js}`, `sc/{measure-api-pass-phases.js,test-orchestrator-commit.js}` |
| 21 | `composeSwap`, `evaluateSwapPreview`, `evaluateSwapPreviewSnapshot`, `BEGIN_SQL`, `ROLLBACK_SQL`, `ELIGIBILITY_CHECK`, `NO_ELIGIBLE_OFFER`, `PRODUCT_NOT_CANDIDATE`, `INCOMPATIBLE` | `../query`, `../candidates`, `../offers`, `../filtering`, `../assembly`, `../candidates/errors` | `c/orchestrator/{index.js,index.test.js,swap-commit.js,swap-preview.test.js}` |
| 22 | `commitSwap`, `commitSwapInTransaction`, `readCommittedSwap`, `BEGIN_SQL`, `COMMIT_SQL`, `ROLLBACK_SQL`, `INSERT_BUILD_CANDIDATE_SQL`, `INSERT_BUILD_COMPONENT_SQL`, `INSERT_RECOMMENDATION_SWAP_SQL`, `SELECT_COMMITTED_SWAP_SQL` | `node:crypto`, `../assembly`, `../scoring`, `../candidates/errors`, `./swap-preview`, `./run` | `c/orchestrator/{index.js,index.test.js,swap-commit.test.js}` |

### 5.2 Reconciliation table

`[derived]` Each category is a separate accounting line; the totals at the bottom are the only figures
that may be quoted as "the move".

| Category | Count | Exact evidence |
|---|---|---|
| Non-barrel source files that move (unique paths) | **19** | eighteen implementations (rows 1, 2, 4–8, 12–22) plus one composition module (row 3) |
| Mixed-barrel sources (split, **not** moved) | **3** | `c/candidates/index.js`, `c/filtering/index.js`, `c/scoring/index.js` — stay byte-identical until step 6 |
| Namespace barrels to be **created** | **2** | `runtime/src/loaders/index.js`, `runtime/src/persistence/index.js` (RFC §11.5 publishes `./loaders` and `./persistence`; neither exists) |
| Unresolved legacy barrels | **3** | `c/offers/index.js`, `c/query/index.js`, `c/orchestrator/index.js` — rows 9, 10, 11; no destination in §11.2 |
| Compatibility shims (proposed) | **22** | one identity shim per moved file (section 9); a shim is a *component*, never counted as a move |
| Deferred files (explicitly out of W1) | **0** | no file is dropped from the 22; the three barrels are unresolved, not deferred |
| **Total proposed file moves** | **22** | 19 non-barrel files + 3 barrels whose destination is unresolved (C1–C3). Every one of the 22 has a numbered row in 5.1 |

`[unresolved]` **The arithmetic does not close, and is not forced to.** 24 rows − 3 split barrels = 21
rows; one of those rows names two files, so the move set is 22. The inventory therefore must contain
22 unique paths. Row 3 (`filtering/pipeline.js`) is a composition module, not a pure implementation, so
a strict "implementation file" count is 18 + 1 composition + 3 barrels = 22. The category table above
labels that split explicitly rather than hiding it: **19 non-barrel files move (18 implementations +
1 composition), 3 barrels are unresolved, 3 mixed barrels stay, 2 publication barrels are created.**
The sum that matters for the manifest is the **22**, and every one of them has a numbered row in 5.1.

### 5.3 The four destinations the RFC does not fix

`[unresolved]` None of these is decided here; each is question C1–C4 in the decision request.

| # | Row | Source path | Responsibility today | Proposed physical destination | Proposed public namespace | Kind | Wave | Shim needed | Exact decision needed |
|---|---|---|---|---|---|---|---|---|---|
| C1 | 9 | `c/offers/index.js` | publishes the offer-price loader (`selectOfferPrices`, `SELECT_OFFER_PRICES_SQL`) | `runtime/src/offers/index.js` **or** folded into `loaders/index.js` | `.` + `./loaders`, or `./loaders` only | barrel | W1 | only if it moves | does the barrel move at all, and to which path |
| C2 | 10 | `c/query/index.js` | publishes the query-input loader and the catalog-version loader | `runtime/src/query/index.js` **or** folded into `loaders/index.js` | `.` + `./loaders`, or `./loaders` only | barrel | W1 | only if it moves | same, for query |
| C3 | 11 | `c/orchestrator/index.js` | the eight public orchestrator entry points | `runtime/src/orchestrator/index.js` **or** becomes the package root namespace builder | `.` + `./orchestrator`, or `.` only | barrel | W3 | only if it moves | which surface the package root publishes |
| C4 | 3 | `c/filtering/pipeline.js` | composes `loadFilteringContext` → `filterCandidates`; owns no SQL and no logic | `runtime/src/orchestrator/filtering-pipeline.js` **or** `runtime/src/loaders/filtering-pipeline.js` | `./loaders` → `filterCandidatesForRecommendation` either way (RFC §11.5) | composition | W1 | yes | physical destination only; the public namespace is already fixed |

`[inspected]` The answer to C1–C3 decides whether the package publishes three subpaths with private
barrels or four subpaths with no internal barrels at all. That is why section 10 keeps the export map a
proposal.

### 5.4 Physical ownership is not public export

`[proposed]` A file's physical destination and its public export path are two independent decisions,
and the dossier records them separately. The clearest case is row 3: the RFC §11.2 places the
`filtering/pipeline.js` **composition responsibility** with the orchestrator, while RFC §11.5 places
`filterCandidatesForRecommendation` on the **`./loaders`** public namespace. Both statements can hold at
once — physical ownership `runtime/src/orchestrator/`, public export `require('…/runtime/loaders')
.filterCandidatesForRecommendation` — and collapsing them into one "destination" would silently pick a
side the RFC leaves open.

| Row | Physical destination (proposed) | Public export path (proposed) | Subject to |
|---|---|---|---|
| 3 | `runtime/src/orchestrator/filtering-pipeline.js` (**unresolved**) | `./loaders` → `filterCandidatesForRecommendation` | C4 (physical) / approved (public) |
| 1, 2, 4, 5, 6, 7, 8 | `runtime/src/loaders/*` | `./loaders` | gate 5 |
| 12–16 | `runtime/src/persistence/*` | `./persistence` | gate 5 |
| 17–22 | `runtime/src/orchestrator/*` | `./orchestrator` (and `.` for the eight entry points, per C3) | C3 (root surface) |
| 9, 10 | unresolved | `./loaders` (if moved) | C1 / C2 |
| 11 | unresolved | `./orchestrator` (if moved) | C3 |

---

## 6. Dependency analysis and the three mixed barrels

**PROPOSED — NOT APPROVED. No core file and no core import is modified here.**

### 6.1 Four edge kinds, kept apart

`[inspected]` The graph below distinguishes what exists **today** from what the extraction would
introduce. Solid arrows are current source evidence; the dashed one is proposed architecture.

| Edge kind | Example today | Evidence |
|---|---|---|
| physical module dependency | `orchestrator/commit.js` → `persistence/persist-ranked.js` | resolved `require` in row 20 |
| public namespace re-export | `orchestrator/index.js` → `./run`, `./snapshot`, … | row 11's five requires |
| legacy compatibility dependency | `c/filtering/index.js` → `p/recommendation-core/src/filtering` (deep) | barrel source, line 34 |
| runtime → core public dependency (proposed) | `runtime/src/loaders/filtering-context.js` → `require('…/recommendation-core')` | **does not exist**; today the loader imports `../candidates/roles` etc. |

Current graph (all edges `[inspected]`, all directions verified by resolution):

```
apps/api/src/engine.js ──► recommendation/orchestrator/index.js ──► {run, snapshot, full-run, swap-preview, swap-commit}
                                │                                          │
                                │                                          ├── run.js ──► {offers/index, query/index, candidates/index,
                                │                                          │              filtering/index, scoring/index, retention, assembly}
                                │                                          ├── snapshot.js ──► run.js
                                │                                          ├── full-run.js ──► {snapshot.js, commit.js, ranking, explanation}
                                │                                          ├── swap-preview.js ──► {query/index, candidates/index, offers/index,
                                │                                          │                        filtering/index, assembly}
                                │                                          └── swap-commit.js ──► {swap-preview.js, run.js, assembly, scoring}
                                └── commit.js ──► persistence/{persist-ranked, persist-rejections, persist-pass-facts}
                                                      └─► {validate-selected, validate-rejections}

loaders (rows 1,2,4,5,6,7,8) ──► core shims (candidates/index, and for offers ../assembly/prices, ./as-of)
barrels ──► packages/recommendation-core/src/** (deep; step 6 drift, unchanged)
```

Proposed addition (W1, unapproved): `runtime/src/loaders/*` → `require('../../../recommendation-core')`
(package root, the only core form the boundary gate permits).

### 6.2 The three mixed barrels, one by one

`[inspected]` verbatim imports, from the file text at `880bb18`:

- `c/candidates/index.js`: `const core = require('../../../packages/recommendation-core/src/candidates');`
  and `const { loadCandidates } = require('./loader');`
- `c/filtering/index.js`: `const core = require('../../../packages/recommendation-core/src/filtering');`,
  `const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('./context-loader');`,
  `const { filterCandidatesForRecommendation } = require('./pipeline');`
- `c/scoring/index.js`: **seven** pre-moved requires (`./load-scoring-model`, `./configuration`,
  `./use-cases`, `./load-assessments`, `./effective-score`, `./candidate-score`, `./build-score`) —
  it is the only mixed barrel that still imports its whole tree relatively. `[inspected]` Its pure half
  reaches core through the PR 4–6 shims at the old paths, not through a deep `core/src/**` require.

| Barrel | Core responsibility | Runtime responsibility | Composition responsibility | Private `core/src/**` import | Approved public Core import | Legacy-only dependency | Proposed future package dependency | Owner approval |
|---|---|---|---|---|---|---|---|---|
| `candidates/index.js` | role vocabulary, `ERROR_CODES`, `CandidateSelectionError`, factories, `selectCandidatePool`, `compareCandidates` | `loadCandidates` | — | **yes** (line 16) | none yet — core root only after step 6 | `./loader` | `require('…/recommendation-core')` + `./loader` shim → later the runtime loader | step 6 owner |
| `filtering/index.js` | `filterCandidates`, `CANDIDATE_STATUSES`, `buildIntegratedGpuPresentMap` | `loadFilteringContext`, `CONTEXT_COMPAT_KEYS` | `filterCandidatesForRecommendation` | **yes** (line 34) | none yet | `./context-loader`, `./pipeline` | same shape | step 6 owner |
| `scoring/index.js` | configuration + use-case validators, `GPU_POLICIES`, effective/candidate/build score | `loadScoringModel` + SQL constant, `loadComponentAssessments` + SQL constant | — | **no** (relative pure imports that are already core shims) | none yet | seven relative requires, three of which are already shims | same shape | step 6 owner |

`[inspected]` Rules the split must keep: one owner per public name (no runtime name may equal a core
name — enforced by `test/surface.test.js`); no runtime module re-exports a core name; the old barrel's
own test is not edited; SQL constants travel with their loader.

### 6.3 Direction, cycles and the W1 order

`[inspected]` Verified by the resolved graph in 6.1:

| Prohibition | Verdict | Evidence |
|---|---|---|
| no loader → orchestrator | **holds** | no row 1–8 file requires an `orchestrator/*` file |
| runtime → API | **holds** | no `require` of `apps/api` anywhere under `src/` or `packages/` |
| core → runtime | **holds** | no file under `packages/recommendation-core` mentions `recommendation-runtime` |
| no `core/src/**` import | **does not hold** | the two barrels at 6.2 deep-import `core/src/**`; row 4/5 import `../candidates/errors`, which today resolves to a core shim |

`[inspected]` No cycle exists today: `orchestrator/index.js` fans out to five modules that never import
it back; `full-run → snapshot → run`, `swap-commit → {swap-preview, run}`, `commit → persistence`, and
`persistence/{persist-ranked, persist-rejections} → validate-*`. The only cycles the extraction could
create are (a) a `loaders/index.js` that a loader imports (the new barrel must import loaders, never the
reverse) and (b) `orchestrator/index.js` requiring the package root — both are prohibited by the W0
boundary test's `root-cycle` rule, which the extracted tree must also pass.

`[proposed]` The order that keeps every edge pointing the same way: W1 loaders (rows 1–8, plus the two
publication barrels) → W2 persistence (12–16) → W3 orchestrator (17–22 and row 11). W1 adds no
orchestrator edge, W2 adds only `commit → persistence` edges that already exist, and W3 closes over
everything below it. A different order (orchestrator before loaders) would contradict 6.1.

---

## 7. Provenance: the `declared-rewrite` policy

**PROPOSED — NOT APPROVED. Design only — no verifier change, no manifest entry, no whitespace
exemption before approval.**

### 7.1 Current state

`[inspected]` `scripts/lib/extraction-manifest.js` implements exactly one `identity_policy`
(`byte-identical`) and refuses any other value. Post-move changes are recorded through `edits[]`, a
two-commit procedure (edit commit touching only the destination, then a record commit touching only the
manifest), with the record commit derived from history. There is **no** mechanism to declare an import
rewrite, so a W1 move whose specifiers must change cannot be represented today.

### 7.2 The eight steps the verifier must perform

`[proposed]` In order, with no step skippable:

1. **Authorize the source.** The batch names an immutable `baseline_sha`. The verifier resolves
   `baseline_sha:source_path` to a blob and refuses if the object is missing or is not a blob.
2. **Identify the original content.** `sha256(baseline_blob)` is compared with the digest the manifest
   records; a mismatch means history moved under the declaration.
3. **Declare the destination.** Every `modules[]` entry names exactly one `source` and one
   `destination`; both are repository-relative, normalized, and inside the workspace root.
4. **Declare the rewrites.** `rewrites[]` is ordered; each rule has an `id`, a `find`, a `replace` and
   an expected `count`. A rule without a count is invalid, not a default of 1.
5. **Check the rewrite counts.** Each rule must match its baseline input exactly `count` times; zero
   matches and extra matches are both errors. Rules are applied sequentially, so a later rule sees the
   bytes the earlier ones produced.
6. **Reconstruct the bytes.** `expected = apply(rewrites, baseline_blob)` as bytes, never as a parsed
   AST and never with line-ending or whitespace normalization.
7. **Compare against the destination.** `sha256(expected) == sha256(destination_blob)`, byte for byte.
   There is no path where a rule that did not fire is ignored.
8. **Reject missing and extra files.** Every declared destination must exist and match; every file the
   batch *added* under the batch's declared destination roots must be declared; every declared source
   must still exist at `baseline_sha`; deletions outside the declared set are refused.

`[proposed]` **What provenance does not establish:** byte equality with a declared rewrite proves the
move is what the manifest says it is. It does **not** prove behavioural equivalence, that the rewritten
imports resolve, or that the module still passes its tests. Those are separate requirements — the
characterization fixture, the suite, and the recording-fake-client tests of section 8 — and a green
`verify:extraction` must never be reported as "the move is behaviourally safe".

### 7.3 Path security requirements (D1)

`[proposed]` Every path in a manifest entry — source, destination, rewrite target — must satisfy all
twelve checks, in this order:

| # | Requirement | Rejection |
|---|---|---|
| 1 | repository-relative, no leading drive or volume | absolute path |
| 2 | no leading `/` or `\` | root-anchored path |
| 3 | no `..` segment after POSIX normalization | parent-directory traversal |
| 4 | `.` and empty segments collapsed before comparison, not after | non-canonical path |
| 5 | `\` normalized to `/` before comparison | separator ambiguity |
| 6 | case-sensitivity policy stated once: comparison is **case-sensitive** on every platform, so a Windows checkout cannot mask a case mismatch | case-only duplicate |
| 7 | the source real path must equal the resolved path (no symlink at the source) | symlink source |
| 8 | the destination real path must equal the resolved path, or must not exist yet | symlink destination |
| 9 | both real paths are contained in the workspace root after `realpath` | symlink escape |
| 10 | the destination must not be inside `node_modules/`, `.git/`, `.next/` or `dist/` | generated-tree target |
| 11 | the destination must not already be tracked at the baseline (a move creates it) | pre-existing destination |
| 12 | a shim and an implementation may never share a destination path | shim/implementation collision |

### 7.4 Manifest integrity requirements (D2)

`[proposed]` These are refused as batch errors, never as warnings:

| # | Rejection | Why |
|---|---|---|
| 1 | duplicate `source` strings | two rules would rewrite the same baseline blob |
| 2 | duplicate `destination` strings | two modules would claim one file |
| 3 | normalized-path collision (`a//b`, `a/./b`, `a\b` → same path) | passes a naive string check, fails a real one |
| 4 | missing source blob at `baseline_sha` | the move cannot be authorized |
| 5 | missing destination file at the batch's head | the move did not happen |
| 6 | changed baseline blob | history rewritten under the declaration |
| 7 | undeclared destination file inside a declared destination root | the batch smuggles a file |
| 8 | undeclared implementation file (a new file outside the destination roots) | the batch adds code it did not declare |
| 9 | unauthorized deletion (a source removed without a declared destination) | a module disappears |
| 10 | unauthorized modification (a tracked file outside `modules[]` changed by the batch) | the batch edits what it did not declare |
| 11 | a shim represented as an implementation move (identity shim in `modules[]` with `rewrites: []` and a destination ≠ a real move) | the shim is a component, not a move |
| 12 | `rewrites` present with any `identity_policy` other than `declared-rewrite`, or an unknown key anywhere | schema fail-closed |

### 7.5 Negative-test matrix — 24 cases, each must fail closed

`[proposed]` The 14 cases from the previous revision are preserved (1–14) and 10 are added (15–24).

| # | Case | Fixture | Expected failure |
|---|---|---|---|
| 1 | ambiguous | one rule whose `find` occurs twice with `count: 1` | count mismatch |
| 2 | duplicate rule | the same `id` twice in one module | schema |
| 3 | duplicate module | the same `source` or `destination` twice in a batch | schema |
| 4 | overlapping | two rules whose match ranges intersect | overlap detected |
| 5 | unmatched | `find` absent from the baseline blob | count = 0 |
| 6 | extra | a rule whose `find` appears after the expected bytes were produced | count mismatch |
| 7 | modified destination | destination edited after the move | destination sha256 |
| 8 | reordered | two independent rules swapped, different bytes | byte mismatch |
| 9 | source drift | baseline blob edited in history | baseline sha256 |
| 10 | destination drift | destination edited in a later commit | destination sha256 |
| 11 | binary | destination contains NUL / non-UTF-8 | binary refusal |
| 12 | CRLF/LF | destination or baseline line endings changed | byte mismatch |
| 13 | unauthorized target | rewrite pointing outside the declared destinations | scope |
| 14 | policy absent | `rewrites` without `identity_policy: declared-rewrite` | schema |
| 15 | parent traversal | `destination: "../../outside.js"` | path check 3 |
| 16 | absolute path | `destination: "C:/repo/x.js"` or `"/x.js"` | path checks 1–2 |
| 17 | symlink escape | destination directory is a symlink to a sibling of the workspace | path check 9 |
| 18 | symlink source | the source path is a symlink to another tracked file | path check 7 |
| 19 | duplicate normalized destination | `a/b.js` and `a//b.js` in two modules | D2 check 3 |
| 20 | extra destination file | an undeclared file under the destination root | D2 check 7 |
| 21 | missing source | `source` not present at `baseline_sha` | D2 check 4 |
| 22 | missing destination | declared module absent at head | D2 check 5 |
| 23 | modified source baseline | a different blob at the same path | D2 check 6 |
| 24 | shim as implementation | shim listed in `modules[]` as a move | D2 check 11 |

`[owner]` Adopting the policy is a review decision (gate 6). Agent 3 does not edit the manifest schema,
the verifier, or `check:whitespace`, and introduces no exemption.

---

## 8. Transaction behavioural contract

**PROPOSED — NOT APPROVED. No transaction behaviour changes; this is a specification for tests that
do not exist yet.**

### 8.1 Ownership verified against source

`[inspected]` Constants and control flow read from `880bb18`:

| Module / API | Transaction ownership | Evidence |
|---|---|---|
| `orchestrator/snapshot.js` / `runRecommendationSnapshot` | **owns** the read-only transaction; `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` (`BEGIN_SQL`, line 51), `ROLLBACK` (`ROLLBACK_SQL`, line 54) on **both** paths, `COMMIT` never, `BEGIN` outside the `try` (line 91) | file header + body |
| `orchestrator/run.js` / `runRecommendation` | owns **none**; exactly one `SELECT CURRENT_TIMESTAMP AS now` (`SELECT_NOW_SQL`, line 152) | header lines 117, 212, 250 |
| `orchestrator/commit.js` / `runRecommendationCommit` | **owns** the write transaction: plain `BEGIN` (Decision 18-D9), `LOCK_RECOMMENDATION_QUERY_SQL` + `EXISTING_BUILD_CANDIDATES_SQL` guards, the three writers, `COMMIT` on success, `ROLLBACK` on error; pass-facts validation happens **before** `BEGIN` (line 191) | header + constants 118–138 |
| `orchestrator/swap-preview.js` / `evaluateSwapPreviewSnapshot` | **owns** a read-only transaction, `BEGIN` … `ROLLBACK` always (lines 518, 528); `evaluateSwapPreview` and `composeSwap` own none | header lines 251, 272, 280 |
| `orchestrator/swap-commit.js` / `commitSwapInTransaction` | **owns** the write transaction, `BEGIN` (line 536) … `COMMIT` (549) / `ROLLBACK` (542); `commitSwap` owns none and runs on the caller's handle; `readCommittedSwap` issues one `SELECT_COMMITTED_SWAP_SQL` | lines 216, 244, 502, 534 |
| `orchestrator/full-run.js` | owns **none**; sequences `runRecommendationSnapshot` → `runRecommendationCommit` on one client | line 71 |

### 8.2 Success traces

`[proposed]` Notation: `→` is one `client.query(sql, params)` call in order; `[…]` is the constrained
argument shape; "prohibited" means the fake client must record a failure if the statement occurs.

| Operation | Initial state | Expected ordered SQL | Arguments | Result / final state |
|---|---|---|---|---|
| read-only snapshot | client connected, no transaction | `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → stage reads → `ROLLBACK` | `BEGIN`/`ROLLBACK` take no params; each stage read carries its constant SQL and array params | frozen pass result; transaction closed by `ROLLBACK`; **`COMMIT` is prohibited** |
| full recommendation run (W3 orchestration) | client connected, **no transaction open**; the function opens and closes **two sequential transactions** on the one client | `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → stage reads → `ROLLBACK` (**snapshot**) → pure stages, **no SQL** → `BEGIN` → guards → writers → `COMMIT` (**commit**) | the timestamp read takes no params; guard statements take `[queryId]` | frozen pass; **no `BEGIN`/`COMMIT`/`ROLLBACK` may appear in `run.js`'s trace**, and the snapshot's `ROLLBACK` index precedes the commit's `BEGIN` index |
| write commit | client connected, no transaction | `BEGIN` → `LOCK_RECOMMENDATION_QUERY_SQL` → `EXISTING_BUILD_CANDIDATES_SQL` → writer INSERT/DELETE/UPDATE statements → `COMMIT` | `BEGIN` no params; lock/guard/replace statements take `[queryId]`-shaped arrays | committed pass; transaction closed by `COMMIT`; a second `BEGIN` is prohibited |
| swap preview snapshot | client connected, no transaction | `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → preview reads → `ROLLBACK` | `[sourceResultId]`-shaped where the SQL declares `$1` | preview envelope; `COMMIT` prohibited |
| swap commit in transaction | client connected, no transaction | `BEGIN` → `SELECT_COMMITTED_SWAP_SQL`-shaped reads/writes → `COMMIT` | `[sourceResultId]` and identifier arrays | committed swap; `COMMIT` exactly once |
| swap commit (caller-owned) | client connected, **inside** the caller's transaction | the same statements, **no** `BEGIN`, **no** `COMMIT`, **no** `ROLLBACK` | as above | result; transaction left open for the caller |
| `readCommittedSwap` | any | one `SELECT_COMMITTED_SWAP_SQL` | `[sourceResultId]` | row or null; no transaction control |

### 8.3 Failure traces

`[proposed]` Each case names the exact statement that fails and the exact sequence after it.

| # | Failure point | Expected trace | Assertion that detects drift |
|---|---|---|---|
| 1 | `BEGIN` fails (snapshot, commit, swap-commit) | `BEGIN` throws; **no `ROLLBACK` attempted** (there is no transaction to end) | the trace has length 1; the original error is rethrown unchanged |
| 2 | first read fails inside the transaction | `BEGIN` → failing read → `ROLLBACK` | `ROLLBACK` exactly once, last |
| 3 | a later read fails | `BEGIN` → reads → failing read → `ROLLBACK` | the successful reads still appear, in order, before `ROLLBACK` |
| 4 | a writer fails inside commit | `BEGIN` → guards → failing write → `ROLLBACK` | no `COMMIT`; `ROLLBACK` last |
| 5 | `COMMIT` fails | `BEGIN` → guards → writes → `COMMIT` throws → `ROLLBACK` attempted | the `COMMIT` error wins over any `ROLLBACK` error |
| 6 | `ROLLBACK` fails | original error surfaces, rollback error discarded | the thrown value is the pass error, byte-identical message/code |
| 7 | error preservation | every path above | `Object.is(thrown, originalError)`, not a wrapper |
| 8 | cleanup failure / partial operation | a writer that throws after a partial INSERT | `ROLLBACK` issued; no retry; no `COMMIT`; the error is the writer's |
| 9 | pass-facts validation failure in commit | **no `BEGIN` at all** (validation precedes it, line 191) | the trace is empty; a `BEGIN` here is a regression |

### 8.4 What the recording fake client must assert

`[proposed]` The specification distinguishes four things, and a test that only asserts "some calls
happened" is not acceptable:

1. **Operations expected** — the exact ordered `(sql, params)` list, compared element by element. Not a
   subset, not a count.
2. **Operations prohibited** — a per-operation list (`COMMIT` prohibited for the snapshot; `BEGIN`,
   `COMMIT` and `ROLLBACK` prohibited for `run.js` and for `commitSwap`). Any prohibited statement is a
   failure, whether or not the expected list also matched.
3. **Ordering** — the index of every statement is asserted, so a reordering fails even when the
   multiset of statements is identical.
4. **Identity and ownership** — every statement of one pass goes to the **same** client object (the
   fake records `this`/receiver), and the client is never created, released or closed by the runtime.
   `full-run` additionally asserts that the snapshot's `ROLLBACK` index precedes the commit's `BEGIN`
   index on the same client.

`[inspected]` **Static ownership is not behavioural proof.** `test/transaction-ownership.test.js` lexes
each file's string tokens and asserts which transaction keywords may appear in which file. It proves
*that `snapshot.js` may contain `ROLLBACK` and `run.js` may contain none*. It proves **nothing** about
ordering, arity, error precedence, exactly-once rollback, or receiver identity. No behavioural
transaction test exists, and none has ever run.

`[inspected]` **Three real behaviours the nine failure points do not cover**, found by reading the
sources at `6fd3122`:

| # | Case | Real behaviour | Why the matrix misses it |
|---|---|---|---|
| 10 | **success-path `ROLLBACK` failure** | `snapshot.js:99-101` and `swap-preview.js` roll back in `finally`; when the pass succeeded and `ROLLBACK` throws, the rollback error is **thrown and the successful result discarded** | failure point 6 assumes an original error exists, so this path is untested |
| 11 | **refusal path** | `commitSwap` returns `{committed:false, reason:…}` rather than throwing, so `commitSwapInTransaction` issues **`COMMIT` with zero writes** | the matrix has no "refused but committed" trace |
| 12 | **`readCommittedSwap` malformed result** | a `null`/`undefined` query result is coerced to `rows = []` and reported as `{found:false}` — a broken client reads as "no swap committed" instead of failing | the matrix records the read but not its failure mode |

`[unresolved]` Cases 10–12 are recorded as **missing behavioural coverage**, not as defects: cases 10
and 11 match the documented error policy, and case 12 is caught downstream by the UNIQUE index on
`recommendation_source_id`. They are unverified, and this document does not claim otherwise.

### 8.5 Documentation wording correction (proposal only)

`[inspected]` `packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md` says:

> "**The read snapshot** is opened by the caller: `orchestrator/run.js` runs stages 1-10 inside a
> caller-owned `REPEATABLE READ READ ONLY` transaction"

`[proposed]` Correction: the **caller supplies the dedicated client**; `orchestrator/snapshot.js`
**owns** the transaction, `orchestrator/run.js` owns no transaction control at all. The change is one
sentence in a W0-owned document and needs its owner's approval; Agent 3 has not edited it.

---

## 9. Compatibility shim plan (path by path)

**PROPOSED — NOT APPROVED. No shim is created here.**

`[proposed]` Every moved file keeps an old-path identity re-export, mirroring the core's pattern. A shim
exports the **same object** (`module.exports = require('<new path>')` or an explicit identity
re-export), adds no behaviour, no default and no eager side effect, and is a *compatibility component*
— it is never counted as a move and never recorded in `modules[]`.

`[derived]` Consumers below are the resolved dependents from 5.1b; "required" is yes whenever a
dependent still exists at W1 time, which is every row (no consumer is being edited in W1).

| Old path (shim) | New implementation path | Consumers that must keep resolving | Shim required | Duration | Deprecation expected | Responsible owner | Identity assertion |
|---|---|---|---|---|---|---|---|
| `c/candidates/loader.js` | `runtime/src/loaders/candidates.js` | `c/candidates/index.js` | yes | until step 6 | yes, at step 6 | Agent 3 / step 6 owner | `require(old) === require(new)` |
| `c/filtering/context-loader.js` | `runtime/src/loaders/filtering-context.js` | `c/filtering/{index.js,pipeline.js}` + 7 test files | yes | until step 6 | yes | same | same |
| `c/filtering/pipeline.js` | **destination unresolved (C4)** | `c/filtering/{index.js,pipeline.test.js}` | yes | until step 6 | yes | same | same |
| `c/scoring/load-scoring-model.js` | `runtime/src/loaders/scoring-model.js` | `c/scoring/{index.js,load-scoring-model.test.js}` | yes | until step 6 | yes | same | same |
| `c/scoring/load-assessments.js` | `runtime/src/loaders/assessments.js` | `c/scoring/{index.js,load-assessments.test.js}` | yes | until step 6 | yes | same | same |
| `c/offers/select.js` | `runtime/src/loaders/offer-selection.js` | `c/offers/index.js`, `c/offers/select.test.js`, `c/assembly/pipeline.test.js` | yes | until step 6 | yes | same | same |
| `c/query/load-query-input.js` | `runtime/src/loaders/query-input.js` | `c/query/{index.js,load-query-input.test.js}` | yes | until step 6 | yes | same | same |
| `c/query/catalog-version.js` | `runtime/src/loaders/catalog-version.js` | `c/query/{index.js,catalog-version.test.js}` | yes | until step 6 | yes | same | same |
| `c/persistence/persist-ranked.js` | `runtime/src/persistence/persist-ranked.js` | `c/orchestrator/{commit.js,commit.test.js}`, `c/persistence/persist-ranked.test.js` | yes | until step 6 | yes | same | same |
| `c/persistence/persist-pass-facts.js` | `runtime/src/persistence/persist-pass-facts.js` | `c/orchestrator/{commit.js,commit.test.js,full-run.test.js}`, `c/persistence/persist-pass-facts.test.js` | yes | until step 6 | yes | same | same |
| `c/persistence/persist-rejections.js` | `runtime/src/persistence/persist-rejections.js` | `c/orchestrator/{commit.js,commit.test.js}`, `c/persistence/persist-rejections.test.js` | yes | until step 6 | yes | same | same |
| `c/persistence/validate-selected.js` | `runtime/src/persistence/validate-selected.js` | `c/persistence/{persist-ranked.js,persist-ranked.test.js,validate-selected.test.js}` | yes | until step 6 | yes | same | same |
| `c/persistence/validate-rejections.js` | `runtime/src/persistence/validate-rejections.js` | `c/persistence/{persist-rejections.js,persist-rejections.test.js}` | yes | until step 6 | yes | same | same |
| `c/orchestrator/run.js` | `runtime/src/orchestrator/run.js` | `c/orchestrator/{index.js,snapshot.js,swap-commit.js}` + 4 test files, `sc/measure-api-pass-phases.js` | yes | until step 6 | yes | same | same |
| `c/orchestrator/snapshot.js` | `runtime/src/orchestrator/snapshot.js` | `c/orchestrator/{index.js,full-run.js}` + 4 test files, `sc/measure-api-pass-phases.js` | yes | until step 6 | yes | same | same |
| `c/orchestrator/full-run.js` | `runtime/src/orchestrator/full-run.js` | `c/orchestrator/{index.js,full-run.test.js}`, `sc/test-orchestrator-full-run.js` | yes | until step 6 | yes | same | same |
| `c/orchestrator/commit.js` | `runtime/src/orchestrator/commit.js` | `c/orchestrator/{full-run.js,commit.test.js}`, `sc/{measure-api-pass-phases.js,test-orchestrator-commit.js}` | yes | until step 6 | yes | same | same |
| `c/orchestrator/swap-preview.js` | `runtime/src/orchestrator/swap-preview.js` | `c/orchestrator/{index.js,swap-commit.js,swap-preview.test.js}` | yes | until step 6 | yes | same | same |
| `c/orchestrator/swap-commit.js` | `runtime/src/orchestrator/swap-commit.js` | `c/orchestrator/{index.js,swap-commit.test.js}` | yes | until step 6 | yes | same | same |
| `c/offers/index.js` | **unresolved (C1)** | `c/orchestrator/{run.js,swap-preview.js}` + 3 test files, `sc/measure-api-pass-phases.js` | only if it moves | — | — | same | same |
| `c/query/index.js` | **unresolved (C2)** | `api/src/engine.js`, `c/orchestrator/{run.js,swap-preview.js}` + 2 test files, `sc/measure-api-pass-phases.js` | only if it moves | — | — | same | same |
| `c/orchestrator/index.js` | **unresolved (C3)** | `api/src/engine.js`, `sc/{eval-scenarios.js,measure-orchestrator.js,verify-pool-independence.js}` | only if it moves | — | — | same | same |

`[inspected]` One consumer is a documentation gate, not code: `verify-docs` `engine-layout` requires
`src/recommendation/persistence/persist-ranked.js` to exist at its old path, which the shim preserves.

`[proposed]` The identity test each shim needs, at W1: for every shim, `assert.strictEqual(require(old),
require(new))` on the exported object, plus one exported-name equality check, plus a `require`-cache
check (the module is evaluated once).

---

## 10. Proposed export map

**PROPOSED — NOT APPROVED. `package.json` is untouched and no export exists.**

`[proposed]` Four horizons, never merged into one table without the header:

| Name | Horizon | Intended consumer | Implementation available? | Core dependency | Public / internal | Cycle risk | In wave |
|---|---|---|---|---|---|---|---|
| `loaders.loadCandidates` | W1 | `candidates/index.js` shim, API | after row 1 moves | `errors`, `roles` (via core) | public | none (loader imports no barrel) | W1 |
| `loaders.loadFilteringContext` | W1 | `filtering/index.js` shim | after row 2 | `candidates/*` via core | public | none | W1 |
| `loaders.filterCandidatesForRecommendation` | W1 | `filtering/index.js` shim | after row 3 (destination C4) | `filterCandidates` via core | public | none | W1 |
| `loaders.loadScoringModel` + `SELECT_SCORING_MODEL_SQL` | W1 | `scoring/index.js` shim | after row 4 | none | public | none | W1 |
| `loaders.loadComponentAssessments` + `SELECT_COMPONENT_ASSESSMENTS_SQL` | W1 | `scoring/index.js` shim | after row 5 | none | public | none | W1 |
| `loaders.selectOfferPrices` + SQL | W1 | `offers/index.js` shim | after row 6 | `assembly/prices`, `as-of` | public | none | W1 |
| `loaders.loadQueryInput` + SQL, `REQUIRED_ROLES` | W1 | `query/index.js` shim | after row 7 | `candidates/input` via core | public | none | W1 |
| `loaders.catalogVersion` + SQL, `CATALOG_COVERED_TABLES` | W1 | `query/index.js` shim | after row 8 | none | public | none | W1 |
| `persistence.persistRanked` | W2 | `commit.js` shim | after row 12 | none | public | `commit → persistence` (exists) | W2 |
| `persistence.persistRejections` + SQL | W2 | `commit.js` shim | after row 14 | none | public | same | W2 |
| `persistence.persistPassFacts` + SQL | W2 | `commit.js` shim | after row 13 | none | public | same | W2 |
| `persistence.validateSelected`, `validateRejections`, `REJECT_STATUS` | W2 | writers | after rows 15–16 | `candidates/{errors,roles}` via core | public | none | W2 |
| `orchestrator.runRecommendation` | W3 | `orchestrator/index.js` shim, API | after row 17 | loaders' barrels | public | must not import `.` (root-cycle) | W3 |
| `orchestrator.runRecommendationSnapshot` | W3 | API, `full-run` | after row 18 | none | public | none | W3 |
| `orchestrator.runRecommendationFullRun` | W3 | API | after row 19 | persistence (W2) | public | needs W2 first | W3 |
| `orchestrator.runRecommendationCommit` | W3 | `full-run`, scripts | after row 20 | persistence (W2) | public | needs W2 first | W3 |
| `orchestrator.evaluateSwapPreview{,Snapshot}`, `commitSwap`, `commitSwapInTransaction`, `readCommittedSwap` | W3 | API, scripts | after rows 21–22 | persistence (W2) | public | none | W3 |
| `offers.*`, `query.*` subpaths | W1 if the barrels move (C1/C2) | old-path consumers | after the barrel decision | none | public or absent | none | W1 |
| individual loaders under `runtime/src/loaders/*` | W1 | internal | yes | — | **internal** | none | W1 |

`[proposed]` Package `exports` keys (RFC §11.5, gate 5): `.`, `./loaders`, `./orchestrator`,
`./persistence`. No `./package.json`, no deep `./src/**`. Nothing is published incomplete: a namespace
appears in `test/export-surface.json` in the same commit that populates it, so a half-built
`./orchestrator` cannot look approved.

---

## 11. Test ownership and discovery

**PROPOSED — NOT APPROVED. No root test script and no CI file is modified.**

### 11.1 The eleven suites

`[inspected]` Current paths and globs from the repository root manifest (`test:unit` =
`node --test "src/**/*.test.js"`, `test:core`, `test:api`, `test:scripts`) and from the runtime package
(`test` = `node test/assert-discovery.js && node --test "test/*.test.js"`).

| # | Current test path | Proposed owner | Proposed destination | App level? | Core-owned? | Runtime-owned? | Integration? | Executions | Future root command |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `src/recommendation/candidates/loader.test.js` | runtime | `packages/recommendation-runtime/test/loaders/candidates.test.js` | no | no | yes | no (fake db) | once | `test:runtime` (needs a deeper glob, 11.2) |
| 2 | `src/recommendation/filtering/context-loader.test.js` | runtime | `…/test/loaders/filtering-context.test.js` | no | no | yes | no | once | `test:runtime` |
| 3 | `src/recommendation/filtering/pipeline.test.js` | runtime | `…/test/loaders/filtering-pipeline.test.js` | no | no | yes | no | once | `test:runtime` |
| 4 | `src/recommendation/scoring/load-assessments.test.js` | runtime | `…/test/loaders/assessments.test.js` | no | no | yes | no | once | `test:runtime` |
| 5 | `src/recommendation/scoring/load-scoring-model.test.js` | runtime | `…/test/loaders/scoring-model.test.js` | no | no | yes | no | once | `test:runtime` |
| 6 | `src/recommendation/offers/select.test.js` | runtime | `…/test/loaders/offer-selection.test.js` | no | no | yes | no | once | `test:runtime` |
| 7 | `src/recommendation/query/catalog-version.test.js` | runtime | `…/test/loaders/catalog-version.test.js` | no | no | yes | no | once | `test:runtime` |
| 8 | `src/recommendation/query/load-query-input.test.js` | runtime | `…/test/loaders/query-input.test.js` | no | no | yes | no | once | `test:runtime` |
| 9 | `src/recommendation/filtering/index.test.js` | **stays** app-level | `src/recommendation/filtering/index.test.js` | yes | no | no | no (barrel contract) | once | `test:unit` |
| 10 | `src/recommendation/filtering/integration.test.js` | **stays** app-level | unchanged | yes | no | no | yes (barrel + DB-shaped fake) | once | `test:unit` |
| 11 | `src/recommendation/scoring/index.test.js` | **stays** app-level | unchanged | yes | no | no | no (barrel contract) | once | `test:unit` |

`[inspected]` Characterization fixtures (`scripts/characterize-pr2…pr7.js`) and the
`check:characterization*` scripts are **not** in this set and must remain active: they are the
pre-move behaviour proof and are referenced by `verify:extraction`.

### 11.2 Discovery risks found by reading the globs

1. **Silent disappearance.** `test:unit` is `src/**/*.test.js`. A suite moved out of `src/` is no
   longer matched by it. Unless `test:runtime` picks the file up in the same commit, the suite stops
   running and the repository still reports green. This is the exact failure mode `assert-discovery.js`
   exists to prevent at package level, but the root glob has no equivalent guard.
2. **Depth — verified, not hypothetical.** `test:runtime` is
   `packages/recommendation-runtime/test/*.test.js`: **one level**. A suite placed in `test/loaders/`
   (as 11.1 proposes) would **not** be discovered, and `assert-discovery.js` would still pass, because
   it calls `fs.readdirSync(__dirname)` — **non-recursive** — and only checks the four fixed names in
   its `REQUIRED` list. A nested file is invisible to the guard *and* to the glob, so the guard would
   even print a smaller "N test suite(s) discovered" and still exit 0. This is a silent-omission
   failure, not a cosmetic one.

   `[measured]` **Node 22 supports the recursive form here**, so the correction needs no new mechanism:
   `test:unit` is `node --test "src/**/*.test.js"` and discovers 726 tests across
   `src/recommendation/orchestrator/` and deeper on the same `node-version: '22'` CI runner. The
   convention is already load-bearing in this repository.

   `[proposed]` **Future action (not implemented in this task):** change the root runtime command to
   `packages/recommendation-runtime/test/**/*.test.js` **and** make `assert-discovery.js` walk
   recursively (or assert each expected subdirectory) in the same commit. Until then W1 must keep its
   runtime suites flat at `test/<name>.test.js`.
3. **Duplicate execution.** If a moved suite is *copied* rather than moved, both `test:unit` and
   `test:runtime` run it, `npm run test:unit` counts change, and the ownership audit sees two
   claimants. The move must be a move.
4. **Zero-test success.** `node --test` exits 0 on a glob that matches nothing (measured on Node
   24.22.1 for the package guard). Any new root command needs its own discovery assertion.
5. **Double ownership of integration suites.** `filtering/integration.test.js` exercises the barrel and
   the loader together. It stays app-level and must keep running while the loader moves; if it is
   classified as "moves with the module", the barrel loses its only cross-stage check.

---

## 12. C7 — Docker requirements (documentation only)

**PROPOSED — NOT APPROVED. Agent 1 owns the Dockerfile and the image workflow; nothing here is a
change.**

| Requirement | Statement |
|---|---|
| Does the image copy runtime today? | **Yes, on the #48 branch only.** `apps/api/Dockerfile:69-70` adds the `package.json` + `src` pair after `npm ci --omit=dev`, beside `database-guard` (`:48-49`) and `recommendation-core` (`:56-57`). On `master` `6fd3122` it is still absent |
| Required package files | `packages/recommendation-runtime/package.json`, `packages/recommendation-runtime/src/**` (the runtime's `exports`/`main` target). `test/`, `docs/` are excluded by `.dockerignore` and are not needed at runtime |
| Required package metadata | `name`, `version`, `main`, `engines.node >=22`; the `exports` map only if W1 publishes subpaths |
| Required destination directory | `./packages/recommendation-runtime/` — the same depth as `database-guard`/`recommendation-core`, so `require('../../../recommendation-core')` from a runtime loader resolves inside the image exactly as it does in the repo |
| Expected Node resolution | Node walks `node_modules` then package-relative paths; the runtime must resolve core through the **relative repository path** it uses today, which only works if both packages sit at the same relative depth |
| Container assertion — **shipped form** | `require('/app/packages/recommendation-runtime')` plus `private === true`, in `api-image.yml`; logs `root exports: 0`. Asserted by `api-image` run `44834047614` |
| Container assertion — **still open** | a namespace-name assertion naming the wave it expects (`loaders` at W1). Deliberately not written at W0: the entry is `module.exports = {}` and pinning emptiness would force the gate to change at W1 |
| Required namespace availability | `loaders` in W1, `persistence` after W2, `orchestrator` after W3; the assertion must name the wave it expects, so W1 cannot silently assert a W3 surface |
| Dependency requirements | none: the package declares no dependencies and the image must not need one |
| Ownership boundary | Agent 1 owns the COPY pair, the `.dockerignore` interaction and the workflow assertion; Agent 3 owns this requirement list only |

`[owner]` Whether C7 must land **before** W1 or may land with W1 stays unresolved (section 14, gate 3).
The COPY pair and the presence/loadability assertions exist on the #48 branch; the W1 surface assertion
does not exist and is a W1 deliverable, not a W0 one.

---

## 13. Gate ledger

**Statuses: 0 of 7 gates closed.** Gates 2 and 3 moved from `OPEN` to `PARTIAL` / `CONDITIONAL` on
2026-11-21; a status change is not a closure. Documentation approval closes **no** gate.

| # | Gate | Status | Owner | Evidence today | Would close it |
|---|---|---|---|---|---|
| 1 | Step 4 final acceptance | **OPEN** | Agent 2 | `[inspected]` PR #49 is now **merged** (`2569647`, and `master` = `6fd3122`), so merge order no longer blocks it — but no written acceptance exists in the PR trail, and a merge is not an acceptance | Agent 2's written acceptance of the nine core namespaces, the 11-key `exports` map and the identity shims |
| 2 | Runtime tests in CI on the merge path | **PARTIAL** | Agent 1 | `[CI verified]` at audited #48 head `23f43c2b`: `test:runtime` at `package.json:12`, step at `ci.yml:56-57`, `ci` run `44834047676` step 10 = **85 tests / 17 suites / 85 pass / 0 fail**. `[inspected]` `master` `6fd3122` still has no script and no step, so the change is **not integrated**; discovery is one level deep (§11.2 item 2) | merge #48, then a green `ci` on `master` **and** a recursive glob plus a recursive discovery guard |
| 3 | C7 image validation | **CONDITIONAL** | Agent 1 | `[inspected]` `Dockerfile:69-70` COPY pair; `[CI verified]` `api-image` run `44834047614` asserts presence, `test/`+`docs/` absence, path loadability, `private`, and the core interface (6/6 negatives). `[UNVERIFIED]` the `c7-neg` negative build | merge #48 and a green `api-image` on `master`; then either drop the `c7-neg` claim or add a real negative step |
| 4 | RFC count resolved | **OPEN** | A2/A6 | `[inspected]` 24 rows / 3 split barrels / 21 rows / 22 files; bold figure 24 on `45133d5`, 21 on `6fd3122` and on the branch `880bb18`, both parentheticals 21; no written answer (decision request A1–A5) | the A2/A6 owner's written answer on A1–A5 |
| 5 | Full-extraction scope and W1/W2/W3 labels | **OPEN** | A2/A6 | `[inspected]` the frozen W0 entry point names loaders/persistence/orchestrator as W1/W2/W3; "full extraction" is unreconciled (B1–B5) | the A2/A6 owner's written answer on B1–B5 |
| 6 | Provenance, transaction, compatibility and test-ownership contracts | **OPEN** | review | `[proposed]` declared-rewrite policy with 24 negative cases, verified transaction table, 22-row shim map, export map and test inventory are designs only | review approval of those designs **and** the negative-test matrix implemented and passing |
| 7 | Explicit written W1 authorization | **OPEN** | authority | no authorization exists; this document is preparation only | the project authority's explicit written authorization |

`[derived]` **Four dimensions, never collapsed into one cell.** A gate can be strong on one and empty on
another, and a single status word hides that:

| Gate | Technical evidence | Integration | Formal acceptance | Authorization |
|---|---|---|---|---|
| 1 · Step 4 acceptance | met — #49 merged, 697 core tests | merged | **absent** | n/a |
| 2 · Runtime tests in CI | **partial** — green at `23f43c2b` (85/17); absent from `master`; discovery one level deep | **not merged** | **absent** | n/a |
| 3 · C7 image validation | **conditional** — COPY + six assertions green at `23f43c2b`; `c7-neg` UNVERIFIED | **not merged** | **absent** | n/a |
| 4 · RFC count | partial — 49/24/3/21/22 measured; RFC self-inconsistent (`33` at `:78`, `:380`, `:496`) | n/a | **absent** (A1–A5 blank) | n/a |
| 5 · Scope and wave labels | partial | n/a | **absent** (B1–B5 blank) | n/a |
| 6 · Provenance, transaction, shim contracts | partial — designs only; static is not behavioural (§8.4) | n/a | **absent** | n/a |
| 7 · W1 authorization | n/a | n/a | n/a | **absent** |

**Verdict: `W1 NOT READY — GATES OPEN`.** 0 of 7 gates closed. W0 is frozen and independently
re-measured: `89e761d` = 61 tests / 13 suites / 61 pass / 0 fail, and the W0 correction head `75f7823` =
85 tests / 17 suites / 85 pass / 0 fail, both on a full exported tree with `node v24.21.0`. **No runtime
implementation has moved**: `src/recommendation/**` still contains every loader, every persistence
writer and every orchestrator module, and the runtime package still holds only its harness.

---

## 14. Outstanding decisions

`[owner]` Nothing in this section is decided here, and no other agent is being contacted by this
document.

| Decision | Owner | Question | Where asked |
|---|---|---|---|
| A1–A5 | RFC A2/A6 owner | which figure is authoritative; are the three split barrels counted; is `offers/index.js` in the moved set; are the two new barrels counted; which figure the manifest records | decision request §A |
| B1–B5 | RFC A2/A6 owner | are W1/W2/W3 loaders/persistence/orchestrator, and does "full extraction" span all three | decision request §B |
| C1–C4 | RFC A2/A6 owner | the physical destination of `offers/index.js`, `query/index.js`, `orchestrator/index.js`, `filtering/pipeline.js` | decision request §C, dossier §5.3 |
| D1–D5 | RFC A2/A6 owner | transaction ownership confirmation + the `LOADERS_AND_TRANSACTIONS.md` sentence | decision request §D, dossier §8.5 |
| Gate 1 | Agent 2 | written Step 4 acceptance | ledger |
| Gate 2 | Agent 1 | runtime step in `unit-and-docs`, recursive glob and discovery assertion | dossier §11.2 |
| Gate 3 | Agent 1 | C7 COPY pair, container assertion, and whether C7 precedes W1 | dossier §12 |
| Gate 6 | review | provenance policy, transaction traces, shim map, export map | dossier §7, §8, §9, §10 |
| E1 | A2/A6 owner | which core import specifier W1 may use: relative package root or bare package name | decision request §E |
| E2 | A2/A6 owner | accept the module-object alias limitation or authorise a separate alias mechanism (+ two header corrections) | decision request §E |
| E3 | A2/A6 owner | does `R-SHADOW-1` cover injected `client`/`pool`/`db` parameters or only globals | decision request §E |
| Gate 7 | project authority | explicit written W1 authorization | ledger |

**W1 has not started and remains unauthorized unless explicit project-owner authorization is
independently established.**
