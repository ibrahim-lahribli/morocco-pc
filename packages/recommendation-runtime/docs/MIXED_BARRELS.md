# Recommendation runtime — the three mixed-barrel splits

Status: CURRENT for the publication split (RFC §11.2, §11.5) and for the W3 relocation recorded in §5.
`packages/recommendation-runtime/src/loaders/` exists (step 5 W1) and is a published subpath; the three
composites `src/{candidates,filtering,scoring}/index.js` are the legacy mixed barrels relocated, NOT a
publication, and they carry an open architectural question (§5) that this document does not self-approve.

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
2. **No *published* runtime module re-exports a core name.** The published surface is `loaders`,
   `orchestrator`, `persistence`; each is proved free of core names by
   `test/loaders-surface.test.js`, `test/orchestrator-index.test.js` and
   `test/persistence-surface.test.js`. The relocated composites of §5 are deliberately outside that
   surface — absent from `package.json` `exports`, from `src/index.js` and from
   `test/export-surface.json` — so the package name cannot reach them
   (`scripts/lib/runtime-package-exports.test.js` proves `ERR_PACKAGE_PATH_NOT_EXPORTED`). This rule
   previously read "no runtime module re-exports a core name" and prescribed that orchestrators build
   `Object.assign({}, core.candidates, { loadCandidates })`; §5 records why that prescription is
   incompatible with a byte-identical move plus the patch seam, and asks the owner to ratify or reject
   the relocation.
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
beside this package's SQL members. §5.1's rule 2 (as written before this revision) forbids that in a
runtime module, and §11.2's file mapping does not list these files. The composition is safe — every
pure member is the core's own function object, the key sets are committed and pinned, and no accessor
or non-enumerable member exists (`test/namespace-barrels.test.js`) — but safety is not compliance.

### 5.3 Is a compliant implementation feasible? No, not under the three constraints

| Alternative | What it is | Why it is not taken |
|---|---|---|
| **A. Relocated composite (current)** | one object at `src/<stage>/index.js`, old path shims to it | re-exports core names from a runtime file; §11.2 does not schedule the file. Needs owner ratification or a §11.2/§11.3 amendment |
| **B. Local merged namespace** (§11.3 rule 2 as written) | each orchestrator builds `Object.assign({}, core.candidates, { loadCandidates })` at load time; no composite barrel | requires editing `run.js` and `swap-preview.js`, so the batch is no longer byte-identical (needs an `edits[]` record), AND it **breaks the patch seam**: the suites patch the old path's object, the implementation would call its own copy, and `run.test.js` / `swap-preview.test.js` would silently stop observing their own patches. Rejected on requirement 3 |
| **C. Split the composites now** | move pure members to core-only barrels and SQL members to `runtime/loaders/*`, as §11.2's target column says | it is step 6 work by §11.2's own note (the API's imports move then); doing it now changes the published shape of `src/recommendation/**` before its only consumer moves, breaks `engine.js`'s and `import-boundary.test.js`'s six-barrel imports, and would still leave the byte-identical orchestrator needing a composite at `../candidates` |
| **D. Defer W3's orchestrator move** | revert the batch, wait for step 6 | abandons a completed, gated move over a packaging question; the same question returns at step 6 with the orchestrator already moved |

Compatibility consequences of A: none for any caller (identity shims, same objects, same key order,
same SQL). Of B: the patch seam, plus a manifest `edits[]` record. Of C: the API's six barrel imports
and the `engine-layout` gate. Of D: none, and no progress.

### 5.4 The decision requested (owner, not this PR)

**Question.** May `packages/recommendation-runtime/src/{candidates,filtering,scoring}/index.js` hold the
legacy composite barrel — pure members re-exported from core by identity, SQL members owned here — as an
unpublished, step-6-scoped relocation?

**Recommended: yes, with the following conditions, all of which are already enforced in this PR.**

1. The composites are not published: absent from `package.json` `exports`, from `src/index.js` and from
   `test/export-surface.json`; the package name throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for them
   (`scripts/lib/runtime-package-exports.test.js`).
2. Their exact key sets (and `scoring`'s key order) are committed and pinned
   (`test/namespace-barrels.test.js`), and every pure member is the core's own function object.
3. No published namespace carries a core name (`test/surface.test.js`, and the per-namespace suites).
4. Step 6 deletes them when the orchestrator's specifiers are rewritten to the two packages; §19.4.3's
   `exports` map already makes the deletion invisible to consumers.

**If the owner declines**, the compliant path is B or C, and the two consequences to accept are the
manifest `edits[]` record plus a replacement for the patch seam (B), or the API barrel churn and a
step-6 pull-forward (C). This document does not choose for the owner, and the PR is not merge-ready on
this point until the answer is recorded.
