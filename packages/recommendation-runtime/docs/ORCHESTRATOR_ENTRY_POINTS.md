# Recommendation runtime — orchestrator entry points and transaction ownership

Status: TARGET (RFC §11.5). The six orchestrator modules still live under
`src/recommendation/orchestrator/`; step 5 W3 moves them to
`packages/recommendation-runtime/src/orchestrator/` with their behaviour unchanged. This document is
the contract the move must preserve, not a redesign: every transaction boundary below is the one the
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

`runRecommendationCommit` is **internal** — it is exported from `orchestrator/commit.js` for the
barrel and for `full-run`, but it is not one of the eight entry points. It owns the pass's single
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

## W1 acceptance — behavioural transaction tests (required)

The keyword parity check in `test/transaction-ownership.test.js` is a **static pre-check**, not final
acceptance of the transaction contract. It can prove that a file mentions `BEGIN`/`COMMIT`/`ROLLBACK`
and cannot prove when, on which path, or in which order. W1 must therefore add behavioural tests
against a recording fake client (the `(sql, params)` style the existing `orchestrator/*.test.js`
suites use, no database) that prove:

- `snapshot.js` — `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` precedes the reads, `ROLLBACK` is
  issued on **both** the success and the error path, and `COMMIT` is never issued.
- `commit.js` (`runRecommendationCommit`) — one write transaction: `BEGIN`, the `FOR UPDATE` guard,
  then `COMMIT` on success / `ROLLBACK` on failure; a failing `ROLLBACK` preserves the original error.
- `swap-commit.js` — `commitSwapInTransaction` owns its own write transaction (`BEGIN` … `COMMIT`,
  `ROLLBACK` on error); `commitSwap` owns none on the handle it is given.
- `run.js` — no `BEGIN`/`COMMIT`/`ROLLBACK`, exactly one autocommit `SELECT CURRENT_TIMESTAMP AS now`.
- `full-run.js` and `swap-preview.js` — never nest; the snapshot transaction closes before the write
  transaction opens, on the same client.

These are W1 work, not W0: they test the runtime once the modules have moved.

## Step-5 ownership and prerequisites

- **W1 is complete.** Ten modules have moved (the Engine 2 offer query and its barrel, the two query
  loaders and their barrel, the two scoring loaders, the candidate and filtering-context loaders, and
  the filtering composition), each behind an identity shim at its old path; `src/index.js` now
  publishes the `loaders` namespace with the eight RFC §11.5 names.
- **W2 has moved the persistence modules, and publishes none of them.** The batch
  `step-5-w2-persistence` moved the three writers (`persist-ranked`, `persist-rejections`,
  `persist-pass-facts`) and the two validators (`validate-selected`, `validate-rejections`) into
  `packages/recommendation-runtime/src/persistence/`, each behind an identity shim at its old path.
  `src/index.js` still exports only `loaders`: the RFC §11.5 persistence table is an
  orchestrator-facing surface, and it is sliced when W3's call sites exist to review it against.
  `orchestrator` (W3) remains absent from the surface and still owns every transaction boundary.
- **Root CI integration belongs to Agent 1.** The root `test:runtime` script and the
  `.github/workflows/ci.yml` step are Agent 1's; W0 does not touch either.
- **Step 4 acceptance belonged to Agent 2.** Agent 2's interface acceptance of step 4
  (recommendation-core) was a prerequisite before W1 could extract any runtime module; W1 has since
  moved the ten modules above.
- **Docker COPY ownership (review C7) is resolved.** `apps/api/Dockerfile` copies both
  `packages/recommendation-core` and `packages/recommendation-runtime` (manifest plus `src`), which
  is what the old-path shims require at run time; W0 did not change the Dockerfile.
