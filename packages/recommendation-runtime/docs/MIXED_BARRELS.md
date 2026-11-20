# Recommendation runtime — the three mixed-barrel splits

Status: TARGET (RFC §11.2, §11.5). The runtime's `src/loaders/` does not exist yet; step 5 W1-W3
moves the modules named here out of `src/recommendation/**`. This document records how the three
directories whose barrel holds both pure and SQL-side members are split — and, just as important,
what is **not** split.

## What a publication split is

Three stage barrels publish modules of two different kinds:

| Stage | Pure members (no database) | Runtime members (execute SQL) |
|---|---|---|
| `candidates/index.js` | the role vocabulary, `ERROR_CODES`, `CandidateSelectionError`, `createCandidateSelectionInput`, `createCandidate`, the selection stages, `selectCandidatePool`, `compareCandidates` | `loadCandidates` |
| `filtering/index.js` | `filterCandidates`, `CANDIDATE_STATUSES`, `buildIntegratedGpuPresentMap` | `loadFilteringContext`, `CONTEXT_COMPAT_KEYS`, `filterCandidatesForRecommendation` |
| `scoring/index.js` | the configuration and use-case validators, `GPU_POLICIES`, `selectAssessmentRow`, `computeEffectiveScore`, `computeCandidateScore(s)`, `computeBuildScore(s)`, `computeBuildScoreContributions` | `loadScoringModel`, `SELECT_SCORING_MODEL_SQL`, `loadComponentAssessments`, `SELECT_COMPONENT_ASSESSMENTS_SQL` |

The split is by **publication**: `recommendation-core` publishes the pure half (one namespace per
stage) and `recommendation-runtime` publishes the SQL half (`loaders`). Nothing is physically split
out of the old barrel.

`offers/index.js` and `query/index.js` are runtime-only and need no split.

## The old barrels stay composite until step 6

`src/recommendation/{candidates,filtering,scoring}/index.js` keep their current contents and their
current requires, byte for byte. They keep working because each required file's old path becomes a
**shim** — the implementation exists once, in a package, and the old path is a short re-export. This
is what preserves, with no edit:

- `apps/api/src/engine.js` and `apps/api/test/unit/import-boundary.test.js`, which name the six
  `src/recommendation/*` barrels;
- the `verify-docs` `engine-layout` gate, which requires all twelve stage directories and
  `persistence/persist-ranked.js` to exist;
- `scripts/` consumers that deep-import `orchestrator/commit`.

Splitting a barrel physically is **step 6** work. Doing it now would change the documented public
shape of the old tree before the API has moved, and would break the pinned ownership row below.

## Rules the split must keep

1. **One owner per name.** Core publishes the pure names, runtime publishes the runtime names; the
   two surfaces do not overlap. `packages/recommendation-core/test/surface.test.js` asserts the
   runtime names are absent from core; `packages/recommendation-runtime/test/surface.test.js`
   asserts no runtime public name is a core name.
2. **No runtime module re-exports a core name.** Orchestrators that need both halves build an
   explicit merged namespace (`Object.assign({}, core.candidates, { loadCandidates })`) so a member
   call site keeps its local name while the boundary test can still see which half is which.
3. **The old barrel's test is not touched.** `src/recommendation/filtering/index.test.js` is the
   pinned `SPLIT_FACTS.runtimeBarrel` row in `scripts/audit-pr2-test-ownership.js` (7 assertions).
   It follows the old barrel and is step 6 material.
4. **SQL stays visible.** The runtime's `loaders` namespace carries the SQL constants their callers
   use (`SELECT_*_SQL`), because a loader and its query are one unit; the pure halves carry none.
