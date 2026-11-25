# Recommendation runtime — orchestrator entry points and transaction ownership

Status: IMPLEMENTED (RFC §11.5; step 5 W3, batch `step-5-w3-orchestrator`). **Four** of the **eight**
files under `packages/recommendation-runtime/src/orchestrator/` **own** a transaction boundary — `snapshot.js`, `commit.js`, `swap-preview.js` and `swap-commit.js`.
Two more issue no transaction control of their own but are part of the pass composition — `run.js`
and `full-run.js`, which run on the client they are handed. The remaining two are `orchestrator/index.js`
(the barrel) and `orchestrator/compute.js` (the pure assemble-and-score seam, which owns no
transaction and is not one of the entry points below). Step 5
W3 moved all **eight** to `packages/recommendation-runtime/src/orchestrator/` with their behaviour
unchanged, each behind an identity shim at its old path. This document is
the contract the move preserves, not a redesign: every transaction boundary below is the one the
code already has. `packages/recommendation-runtime/test/transaction-ownership.test.js` reads the
source and fails when a file's transaction keywords disagree with this table.

## The eight public entry points

Exported from `packages/recommendation-runtime/src/orchestrator/index.js`.

| # | Entry point | Owner file | Transaction behaviour |
|---|---|---|---|
| 1 | `runRecommendation` | `orchestrator/run.js` | **None.** No `BEGIN`, `COMMIT` or `ROLLBACK`. It issues one autocommit `SELECT CURRENT_TIMESTAMP AS now` and hands the value to the stages. |
| 2 | `runRecommendationSnapshot` | `orchestrator/snapshot.js` | **Read-only transaction.** `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, then `ROLLBACK` on both the success and the failure path. It never issues `COMMIT`. `BEGIN` is outside the `try`, so a failed `BEGIN` leaves no transaction to end. |
| 3 | `runRecommendationFullRun` | `orchestrator/full-run.js` | **None.** It composes snapshot → pure stages → commit (3) sequentially on one client. It never opens, nests or ends a transaction itself. |
| 4 | `evaluateSwapPreview` | `orchestrator/swap-preview.js` | **None.** It runs on the client the caller provides. |
| 5 | `evaluateSwapPreviewSnapshot` | `orchestrator/swap-preview.js` | **Read-only transaction.** `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, then `ROLLBACK` on both paths; never `COMMIT`. |
| 6 | `commitSwap` | `orchestrator/swap-commit.js` | **None.** It runs on the caller's handle and owns no transaction. |
| 7 | `commitSwapInTransaction` | `orchestrator/swap-commit.js` | **Write transaction.** Its own `BEGIN` … `COMMIT` on the success path, `ROLLBACK` on error; `COMMIT` is issued on the success path only. Append-only: no `UPDATE`/`DELETE`. |
| 8 | `readCommittedSwap` | `orchestrator/swap-commit.js` | **None.** One autocommit `SELECT`. |

`runRecommendationCommit` is **internal** — exported from `orchestrator/commit.js` and required
directly by `full-run.js`; `orchestrator/index.js` deliberately does not re-export it, so it is not
one of the eight entry points. It owns the pass's single
write transaction: `BEGIN`, the `recommendation_query` `FOR UPDATE` guard, the existing-candidate
guard, the REPLACE-style writers, then `COMMIT` on the success path and `ROLLBACK` on any failure.
A failing `ROLLBACK` never masks the original error.

## Client protocol (every entry point)

- The `client` is a **single dedicated connection**, provided by the caller. The API's bootstrap
  checks it out of its pool; the runtime never does.
- The runtime **never creates, checks out, releases or closes** a client, and never reaches for a
  pool. `test/boundary.test.js` enforces this statically (`new Pool`, `new Client`,
  `pool.connect()`, `.release()`, `.end()` on a client/pool/connection). Receiver detection for
  `.end()` is name-based — no alias or data-flow analysis — and the scan deliberately exempts
  stream/socket/response receivers rather than widen the rule into false positives.
- The runtime **never reads `process.env`** and never accepts a connection string; the caller decides
  which database it talks to.
- Transactions are **never nested**. `runRecommendationFullRun` opens the snapshot, finishes it, runs
  the pure stages, then opens the write transaction — sequentially, on the same client.
- The only database surface used is `client.query(sql, params)`.

## Determinism

- The process clock is never read. "Now" comes from the database
  (`SELECT CURRENT_TIMESTAMP AS now`) or from a caller-supplied value; `Date.now()`, a bare `Date()`
  and `new Date()` are boundary violations, while `new Date(value)` is permitted.
- The only randomness is `randomUUID()` from `node:crypto`, used for persisted row ids. `Math.random`
  is unused.

## Behavioural transaction tests (required; landed in PR #67, move with W3)

The keyword parity check in `test/transaction-ownership.test.js` is a **static pre-check**, not final
acceptance of the transaction contract. It can prove that a file mentions `BEGIN`/`COMMIT`/`ROLLBACK`
and cannot prove when, on which path, or in which order. Behavioural tests against a recording fake
client — the same `(sql, params)` style the `orchestrator/*.test.js` suites use, no database — must
therefore prove:

- `snapshot.js` — `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` precedes the reads, `ROLLBACK` is
  issued on **both** the success and the error path, and `COMMIT` is never issued.
- `commit.js` (`runRecommendationCommit`) — one write transaction: `BEGIN`, the `FOR UPDATE` guard,
  then `COMMIT` on success / `ROLLBACK` on failure; a failing `ROLLBACK` preserves the original error.
- `swap-commit.js` — `commitSwapInTransaction` owns its own write transaction (`BEGIN` … `COMMIT`,
  `ROLLBACK` on error); `commitSwap` owns none on the handle it is given.
- `run.js` — no `BEGIN`/`COMMIT`/`ROLLBACK`, exactly one autocommit `SELECT CURRENT_TIMESTAMP AS now`.
- `full-run.js` and `swap-preview.js` — never nest; the snapshot transaction closes before the write
  transaction opens, on the same client.

**Those tests landed in PR #67 (merged 2026-11-24 as `d21ec21`), in this package:** it added exactly
two files, `test/transaction-behavior.test.js` and the recording fake in `test/recording-client.js`
that it runs on, and added no suite under `src/recommendation/`. The behavioural suite drives the
modules through their **legacy paths**, because that is where they still are; when W3 moves them only
the requires change. That is what makes the move reviewable: the same assertions run before and after,
so a behaviour change cannot hide inside a path change. Since W3 they still drive the modules through
the identity shims at the legacy paths, while `test/transaction-ownership.test.js` reads the moved
implementation's source directly.

## Step-5 ownership and prerequisites

- **W1 is complete.** Ten modules have moved (the Engine 2 offer query and its barrel, the two query
  loaders and their barrel, the two scoring loaders, the candidate and filtering-context loaders, and
  the filtering composition), each behind an identity shim at its old path; `src/index.js` now
  publishes the `loaders` namespace with the eight RFC §11.5 names.
- **W2 has moved the persistence modules, and publishes none of them.** The batch
  `step-5-w2-persistence` moved the three writers (`persist-ranked`, `persist-rejections`,
  `persist-pass-facts`) and the two validators (`validate-selected`, `validate-rejections`) into
  `packages/recommendation-runtime/src/persistence/`, each behind an identity shim at its old path.
  W2 published none of them: the RFC §11.5 persistence table is an orchestrator-facing surface, and
  it is sliced when W3's call sites exist to review it against. **W3 supplied them**, so
  `src/index.js` now publishes `persistence` (see the W3 bullet).
- **W3 has moved the orchestrator, and publishes `orchestrator`.** The batch
  `step-5-w3-orchestrator` moved all eight modules into this package's `src/orchestrator/`, each
  behind an identity shim at its old path, and published the eight entry points above as the
  `orchestrator` namespace (`src/index.js` and `test/export-surface.json` in the same commit).
  `runRecommendationCommit` stays internal. W3 also **reconciled the root with RFC §11.5** by
  publishing `persistence` (`persistRanked`, `persistPassFacts`, `persistRejections`, plus the two
  validators §11.5 authorises for their callers), pinned by `test/persistence-surface.test.js` and
  `test/export-surface.json`, so the root is `{ loaders, orchestrator, persistence }` and
  `package.json` declares the §11.5 `exports` map (`.`, `./loaders`, `./orchestrator`,
  `./persistence`) — resolved through Node from outside the repository by
  `scripts/lib/runtime-package-exports.test.js`.

  The three namespaces the orchestrator resolves from both depths keep their runtime composites
  (`src/candidates/`, `src/filtering/`, `src/scoring/`), each composed from the pure core namespace
  plus the SQL members and pinned by `test/namespace-barrels.test.js`. Those composites are the
  legacy mixed barrels RELOCATED, not published namespaces: they are absent from `exports`, from
  `src/index.js` and from `test/export-surface.json`, and
  `packages/recommendation-runtime/docs/MIXED_BARRELS.md` §5 records the RFC question the relocation
  raises, its alternatives and the owner decision it requests.
- **W3's own prerequisites are NOT closed by the move.** Step 5 remains open until the runtime
  export surface is ratified, runtime characterization and provenance are verified, and the Step 5
  acceptance review happens.
- **Root CI integration belongs to Agent 1.** The root `test:runtime` script and the
  `.github/workflows/ci.yml` step are Agent 1's; W0 does not touch either.
- **Step 4 acceptance belonged to Agent 2.** Agent 2's interface acceptance of step 4
  (recommendation-core) was a prerequisite before W1 could extract any runtime module; W1 has since
  moved the ten modules above.
- **Docker COPY ownership (review C7) is resolved.** `apps/api/Dockerfile` copies both
  `packages/recommendation-core` and `packages/recommendation-runtime` (manifest plus `src`), which
  is what the old-path shims require at run time; W0 did not change the Dockerfile.
