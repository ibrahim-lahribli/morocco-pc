# Recommendation runtime — the three mixed-barrel splits

Status: CURRENT for the publication split (RFC §11.2, §11.5) and for the W3 relocation recorded in §5.
`packages/recommendation-runtime/src/loaders/` exists (step 5 W1) and is a published subpath. The three
composites `src/{candidates,filtering,scoring}/index.js` are the legacy mixed barrels relocated, NOT a
publication: **the repository owner approved them on 2026-11-26 as a temporary, step-6-scoped exception
(Option A) that step 6 must delete** (§5.4). The general RFC boundary rule is unchanged — one scoped
exception, not a relaxation of the Core/Runtime separation.

## What a publication split is

Three stage barrels publish modules of three different kinds (RFC §6.1, §6.4, §11.2):

| Stage | Core (pure) | Runtime loaders (SQL) | Runtime composition |
|---|---|---|---|
| `candidates/index.js` | the role vocabulary, `ERROR_CODES`, `CandidateSelectionError`, `createCandidateSelectionInput`, `createCandidate`, the selection stages, `selectCandidatePool`, `compareCandidates` | `loadCandidates` | — |
| `filtering/index.js` | `filterCandidates`, `CANDIDATE_STATUSES`, `buildIntegratedGpuPresentMap` | `loadFilteringContext`, `CONTEXT_COMPAT_KEYS` | `filterCandidatesForRecommendation` |
| `scoring/index.js` | the configuration and use-case validators, `GPU_POLICIES`, `selectAssessmentRow`, `computeEffectiveScore`, `computeCandidateScore(s)`, `computeBuildScore(s)`, `computeBuildScoreContributions` | `loadScoringModel`, `SELECT_SCORING_MODEL_SQL`, `loadComponentAssessments`, `SELECT_COMPONENT_ASSESSMENTS_SQL` | — |

The split is by **publication**: `recommendation-core` publishes the pure half (one namespace per
stage) and `recommendation-runtime` publishes the database-facing half (`loaders`). Nothing is
physically split out of the old barrel.

**Composition is a third kind, and it is not a loader.** `filterCandidatesForRecommendation`
composes the filtering-context loader with the pure filter. RFC §11.2 classifies
`filtering/pipeline.js` as **infrastructure composition**, owned at
`runtime/orchestrator/filtering-pipeline.js` (or a runtime loader entry point); RFC §11.5 separately
publishes the same name from `./loaders`
(`loaders.filterCandidatesForRecommendation`). Source ownership and the public subpath are different
axes: the pipeline executes no SQL itself, and it is not a core member either. Do not call it "the
SQL half" — the SQL half of `filtering` is `loadFilteringContext` plus the `CONTEXT_COMPAT_KEYS`
vocabulary it exports.

`offers/index.js` and `query/index.js` are runtime-only and need no split.

## The old barrels stay composite until step 6

`src/recommendation/{candidates,filtering,scoring}/index.js` keep their current **public shape** — the
published names and, for `scoring`, the published key order. They keep working because each required
file's old path becomes a **shim** — the implementation exists once, in a package, and the old path is
a short re-export. **Step 5 W3 changed where the composite is IMPLEMENTED**: the object now lives at
`packages/recommendation-runtime/src/{candidates,filtering,scoring}/index.js`, and the old path is an
identity shim to it, because the byte-identical orchestrator's `require('../candidates')` (and
`../filtering`, `../scoring`) must resolve to the same object at both depths. §5 records that
relocation as an open question. What is preserved, with no caller edit:

- `apps/api/src/engine.js` and `apps/api/test/unit/import-boundary.test.js`, which name the six
  `src/recommendation/*` barrels;
- the `verify-docs` `engine-layout` gate, which requires all twelve stage directories and
  `persistence/persist-ranked.js` to exist;
- `scripts/` consumers that deep-import `orchestrator/commit`;
- the behavioural suites' patch seam: `src/recommendation/orchestrator/run.test.js` (and
  `swap-preview.test.js`) patch `require('../candidates')` and the implementation calls through that
  same object. One object at both depths is what makes the patch visible to the implementation.

Splitting a barrel physically is **step 6** work. Doing it now would change the documented public
shape of the old tree before the API has moved, and would break the pinned ownership row below.

## Rules the split must keep

1. **One owner per name.** Core publishes the pure names, runtime publishes the runtime names; the
   two surfaces do not overlap. `packages/recommendation-core/test/surface.test.js` asserts the
   runtime names are absent from core; `packages/recommendation-runtime/test/surface.test.js`
   asserts no runtime public name is a core name.
2. **No runtime module re-exports a core name — RFC §6.4 requires the split, RFC §9.3 is how a
   forbidden import is caught — and the three composites of §5 are a scoped, OWNER-APPROVED exception
   to that rule, not compliance with it.** The rule is not narrowed here to a "published" surface: it
   applies to every module in this package and stays authoritative as written. On the published surface the rule holds and is enforced — `loaders`, `orchestrator` and
   `persistence` are each proved free of core names by `test/loaders-surface.test.js`,
   `test/orchestrator-index.test.js` and `test/persistence-surface.test.js`. The relocated composites
   violate it: they re-export core names beside this package's SQL members. That they are unpublished —
   absent from `package.json` `exports`, from `src/index.js` and from `test/export-surface.json`, so the
   package name cannot reach them (`scripts/lib/runtime-package-exports.test.js` proves
   `ERR_PACKAGE_PATH_NOT_EXPORTED`) — is one of the approval CONDITIONS, not the justification. The
   exception covers exactly those three files, expires with step 6, and settles no precedent (§5.4,
   condition 6).
3. **The old barrel's test is not touched.** `src/recommendation/filtering/index.test.js` is the
   pinned `SPLIT_FACTS.runtimeBarrel` row in `scripts/audit-pr2-test-ownership.js` (7 assertions).
   It follows the old barrel and is step 6 material.
4. **SQL stays visible.** A loader keeps its query in its own module, and the SQL constants stay
   public at the old stage barrels (`scoring/index.js` still publishes `SELECT_SCORING_MODEL_SQL`,
   for example); they never appear at the pure core surface. The published `loaders` namespace is
   the RFC §11.5 eight-function table and deliberately carries none of them, because that approved
   table lists functions only. This corrects the earlier wording of this rule, which had the
   namespace carrying the constants.

## 5. Step 5 W3 — the relocation, and the owner decision it needs

### 5.1 What W3 did

RFC §11.2 maps the mixed barrels to a **split**: `core/candidates/index.js` (pure) plus
`runtime/loaders/candidates.js` (SQL), and likewise for `filtering` and `scoring`. It does not map an
`index.js` composite into the runtime package. W3 nevertheless put one there, for three constraints
that hold simultaneously:

1. the eight orchestrator modules must remain **byte-identical** to their pre-move baseline
   (`extraction-manifest.json`, batch `step-5-w3-orchestrator`, baseline `598e442`), so their
   `require('../candidates')`, `require('../filtering')` and `require('../scoring')` cannot change;
2. the old stage paths must stay loadable as identity shims, because the API and `scripts/` name them;
3. the **patch seam** must keep working: `run.test.js` / `swap-preview.test.js` patch
   `require('../candidates')` and expect the moved implementation to call through the same object.

From `packages/recommendation-runtime/src/orchestrator/` the specifier `../candidates` can only resolve
inside the package, so the same object has to exist at `packages/recommendation-runtime/src/candidates/`.
That object is the legacy composite, implemented once, with the old path as an identity shim.

### 5.2 The deviation, stated exactly

`packages/recommendation-runtime/src/{candidates,filtering,scoring}/index.js` each re-export core names
beside this package's SQL members. RFC §6.4 requires the split and §9.3 forbids the import that makes a
runtime module re-export a core name; §11.2's file mapping does not list a runtime `index.js` composite
either. The composition is safe — every pure member is the core's own function object, the key sets are
committed and pinned, and no accessor or non-enumerable member exists
(`test/namespace-barrels.test.js`) — but safety is not the argument: the owner's scoped approval is, and
it expires when step 6 deletes the files (§5.4).

### 5.3 Is a compliant implementation feasible? No, not under the three constraints

| Alternative | What it is | Why it is not taken |
|---|---|---|
| **A. Relocated composite (current)** | one object at `src/<stage>/index.js`, old path shims to it | re-exports core names from a runtime file; §11.2 does not schedule the file. **Owner-approved 2026-11-26 as a temporary exception (§5.4)**: it needs no RFC amendment because it is scoped to three files and expires with step 6 |
| **B. Local merged namespace** (§11.3 rule 2 as written) | each orchestrator builds `Object.assign({}, core.candidates, { loadCandidates })` at load time; no composite barrel | requires editing `run.js` and `swap-preview.js`, so the batch is no longer byte-identical (needs an `edits[]` record), AND it **breaks the patch seam**: the suites patch the old path's object, the implementation would call its own copy, and `run.test.js` / `swap-preview.test.js` would silently stop observing their own patches. Rejected on requirement 3 |
| **C. Split the composites now** | move pure members to core-only barrels and SQL members to `runtime/loaders/*`, as §11.2's target column says | it is step 6 work by §11.2's own note (the API's imports move then); doing it now changes the published shape of `src/recommendation/**` before its only consumer moves, breaks `engine.js`'s and `import-boundary.test.js`'s six-barrel imports, and would still leave the byte-identical orchestrator needing a composite at `../candidates` |
| **D. Defer W3's orchestrator move** | revert the batch, wait for step 6 | abandons a completed, gated move over a packaging question; the same question returns at step 6 with the orchestrator already moved |

Compatibility consequences of A: none for any caller (identity shims, same objects, same key order,
same SQL). Of B: the patch seam, plus a manifest `edits[]` record. Of C: the API's six barrel imports
and the `engine-layout` gate. Of D: none, and no progress.

### 5.4 The owner decision — Option A APPROVED (2026-11-26)

**Status: APPROVED by the repository owner on 2026-11-26 as a TEMPORARY, STEP-6-SCOPED EXCEPTION.**
This section no longer asks for a decision; it records one. The same approval is recorded in RFC §21.4
(Revision 19) and in `docs/OPEN_POINTS.md` R-33 (F1).

**The approved arrangement.** `packages/recommendation-runtime/src/{candidates,filtering,scoring}/index.js`
may hold the legacy composite barrel — pure members re-exported from core by identity, SQL members owned
by this package — as an **unpublished, step-6-scoped compatibility seam**. The approval applies to exactly
those three files and to nothing else.

**Why it is temporary.** It exists only because the eight orchestrator modules must stay byte-identical to
baseline `598e442`, so their `require('../candidates')`, `require('../filtering')` and
`require('../scoring')` specifiers cannot change until step 6 rewrites them together with the API's
imports. Once that happens the seam has no consumer and must go.

**The conditions of approval — all six, as approved.**

1. The three composites remain **unpublished** and inaccessible through the Runtime package-name exports
   (`package.json` `exports`, `src/index.js`, `test/export-surface.json`;
   `scripts/lib/runtime-package-exports.test.js` proves `ERR_PACKAGE_PATH_NOT_EXPORTED`).
2. Their **exact key sets** and `scoring`'s key order remain pinned
   (`test/namespace-barrels.test.js`).
3. **Every pure member remains identical** to its corresponding Core member — the core's own function
   object, no wrapper, no copy (`test/namespace-barrels.test.js`).
4. **No published Runtime namespace exposes a Core name** (`test/surface.test.js`, plus the per-namespace
   suites `test/loaders-surface.test.js`, `test/orchestrator-index.test.js` and
   `test/persistence-surface.test.js`).
5. **The three composites must be DELETED during step 6**, once the relevant imports and compatibility
   consumers have migrated. Deleted — not repointed to core, not emptied, not kept "just in case".
6. **No future module may use this exception as precedent** without a separate architectural decision.

Conditions 1-4 and 6 are enforced by tests that run today; condition 5 is enforced by the lifecycle gate in
§5.4.1, whose MIGRATED branch fails while any trace of the exception survives.

**What the approval does not do.** It does not narrow, amend or reinterpret the general rule. RFC §6.4
still requires the mixed barrels to be split, RFC §9.3 still catches a forbidden import, RFC §11.2's
mapping and RFC §11.5's published interface are unchanged, and the Core/Runtime separation is not
relaxed. This is a scoped deferral of the split's *physical* removal — recorded so the debt has an owner, a
scope and an expiry condition instead of being a silence. Reading the relocation as generally compliant
would still be wrong.

#### 5.4.1 The lifecycle gate (condition 5, executable)

`packages/recommendation-runtime/test/composite-lifecycle.test.js` — with its pure half
`test/composite-lifecycle-scanner.js` — runs inside `npm run test:runtime`, so it is part of the
ordinary CI suite rather than a document nobody executes. It recognises **exactly two valid states and no
third**:

- **ACTIVE** — the orchestrator requires the composites from exactly the four committed modules
  (`run.js` → candidates + filtering + scoring, `swap-preview.js` → candidates + filtering,
  `swap-commit.js` → scoring, `compute.js` → scoring); the only runtime barrels that reach the core are
  the three composites; the old paths are identity shims to them; nothing is published; the key-set proof
  is still discoverable.
- **MIGRATED** — no orchestrator module requires a composite, and nothing of the exception survives: no
  composite file, no core-spreading runtime barrel, no old-path shim that still re-exports one, and no
  in-package or path-based consumer still pointing at
  `recommendation-runtime/src/{candidates,filtering,scoring}`.
- **PARTIAL is a FAILURE.** A tree where some consumers were rewritten and others were not is
  mid-migration; the gate prints the observed consumer map so the state is diagnosable instead of
  ambiguous.

The MIGRATED branch is driven by synthetic trees inside the same suite, so the check that must block a
future merge is exercised today rather than for the first time on the day it matters.

**How the question in this document closes:** step 6 deletes the three files and their old-path shims,
every consumer migrates, and `npm run test:runtime` runs green in MIGRATED state. Nothing else is owed.
