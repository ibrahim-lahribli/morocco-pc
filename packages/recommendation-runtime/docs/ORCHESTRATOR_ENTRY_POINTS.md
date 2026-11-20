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
  `pool.connect()`, `.release()`).
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
