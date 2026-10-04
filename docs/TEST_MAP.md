# Test Map

Which test pins which contract, in both directions — "is it safe to change this?"
is a lookup, not an archaeology project. Each row cites the file that enforces
the contract. Run everything with `npm run test:unit` (no DB needed; the test
count grows over time — check the current number, never cite a stale one).

## Data-semantics contracts

| Contract | Pinned by | What breaks if violated |
|---|---|---|
| NULL is never 0 (missing spec = UNKNOWN; explicit 0 = verified deficit) | `filtering/filter.test.js:737` "null is never 0" (and sibling PSU/GPU-connector cases in `compatibility/gpu-psu.test.js`) | Missing data becomes permissive; unsafe pairs silently PASS |
| Decision 27 cheapest-per-role reservation: per role, the first K-1 by Rule 3/5 order PLUS the cheapest eligible candidate by `selected_price`, ties by Rule 3/5 position, topped up to the unchanged cap; a bucket of n <= K is returned whole and consults no price at all | `retention/retain.test.js` — "the cheapest eligible candidate is reserved a slot", "the reserved set is re-emitted in Rule 3/5 score order", "an equal-price tie for the reservation is broken by Rule 3/5 position", "a single eligible candidate is never duplicated", "a REJECTed cheap candidate is never reserved", "a bucket that fits within K is returned untouched" | Retention silently shrinks below `min(K, eligible_count)`, or an unpriced candidate wins the reservation as if free and then fails every budget check |
| `budget_floor` semantics: `cheapest_total` sums `BUDGET_FLOOR_ROLES` = `EXPANSION_ORDER` minus GPU (the GPU is omissible under the OPTIONAL policy); a missing required role yields `null`, **never 0**, for both `cheapest_total` and `within_budget`; the field is present on every pass, empty builds or not | `retention/budget-floor.test.js` (19 tests) + `orchestrator/run.test.js` result-shape and zero-build assertions | A `0` floor reads as "everything is free" and `within_budget` reads true; or a GPU-inclusive floor reports "unaffordable" for a build that is serviceable without a discrete GPU |
| A budget-blind regression is visible without running a harness | `node scripts/measure-og01-reach.js --budget N --use-case U` prints `budget floor: <total> <ccy> vs budget N <ccy> (WITHIN/ABOVE)` on every run | The retained floor drifts again and is only noticed when a harness goes red — which is how OG-26 hid behind two raised budgets |
| `round2` half-up with shortest-decimal path (never `Math.round(x*100)` naively — `1.005` float trap) | `ranking/rank.test.js` (see `ranking/rank.js:66` for the documented pitfall) | Scores/rounding drift by a cent or a decimal between instances |
| deepFreeze ordering — seal children BEFORE the container | `scoring/build-score.test.js` (pitfall documented at `build-score.js:445`) | Frozen container exposes frozen-then-mutated internals; determinism violated |
| Determinism: tie-breaks are fixed code-unit compares (never `localeCompare`) | `ranking/rank.test.js` signature/tie-break assertions | Non-reproducible ranks across machines |
| Decision 16 gate: only FAIL prunes an assembly branch; UNKNOWN continues | `assembly/assemble.test.js` branch-gating cases | UNKNOWN pairs disappear instead of reaching scoring's penalty |
| Rule 11 high-TGP escalation: `board_tgp_watts >= 200` + NULL availability → FAIL `GPU_PSU_CONNECTOR_NULL_HIGH_TGP`, decided BEFORE the unknown-name branch; NULL requirements / unknown names / non-finite TGP stay UNKNOWN | `compatibility/gpu-psu.test.js:297–368`, `filtering/filter.test.js:808`, `assembly/assemble.test.js:1536` | The Decision 26 safety rule degrades back to UNKNOWN (or over-fires on UNKNOWN inputs) |
| `unknown_pairwise_count` is build-local, counted once per pair (Decision 23 O2) | `scoring/build-score.test.js`, `assembly/assemble.test.js` unknown-count cases | Double-counting silently over-penalizes builds (the W4 trap) |
| Candidate-level `unknown_pairwise_count` is computed but never read | documented in `retention/retain.js`; not pinned by a test — the W4 cleanup (status review Option D) is the real fix | Accidental revival would change every score |

## Boundary contracts (structural, not behavioral)

| Contract | Pinned by | What breaks if violated |
|---|---|---|
| `persistence/persist-ranked.js` stays write-only: no `require('pg')`, no `new Pool`, no `BEGIN/COMMIT/ROLLBACK`, no `SELECT`, no imports from other stages | `persistence/persist-ranked.test.js:162` banned-token list | Transaction control leaks into the writer; the single-write-transaction guarantee (Decision 19) erodes |
| Engine stage layout: one directory per stage, barrel `index.js` (persistence/ excepted, imported via `persist-ranked`) | `scripts/verify-docs.js` check 6 (`engine-layout`) + per-stage `index.test.js` | Barrels rot; boundary-only imports become unenforceable |
| Engine modules stay pure: no DB access, no clock, no randomness (DB lives only in loaders + orchestrator) | enforced by construction + `orchestrator/run.test.js` / `commit.test.js` transaction-boundary cases; the purity rule itself is `AGENTS.md` §5 | Unit suite can no longer run DB-free |

## Schema contracts

| Contract | Pinned by | What breaks if violated |
|---|---|---|
| At most one CPU / MOTHERBOARD / PSU / CASE / CPU_COOLER / SSD_BOOT per build candidate | `uq_build_component_role_singular` partial unique index (`database/migrations/011_reconcile_layer4.sql`), exercised by `scripts/test-layer4.js` | Multi-slot roles leak into builds the schema cannot represent (W10/K13) |
| Commit re-run guard: a query is committed exactly once; guards run after `SELECT … FOR UPDATE` on the query row | `orchestrator/commit.test.js` | Duplicate persistence; races between concurrent commits (reasoned, not concurrency-tested — U4) |
| Migrations form a contiguous 001→NNN range; decision log parses (26 global / 31 `Status:`); AGENTS cites the current range | `scripts/verify-docs.js` checks 1–3 | Doc drift on schema/status facts (the audit's root cause) |
| Generated docs stay fresh: `docs/DECISION_INDEX.md` and the `gen:schema` outputs | `gen-decision-index --check` (wired into verify-docs check 5) and `gen-schema-reference.js --check` | Hand-edited generated files mask drift |
| The gap register keeps its shape: every §1 row has exactly 6 cells, no id is duplicated, and every `OG-nn` cited anywhere in the document has a row (or is the *subject* of a closed-table row) | `scripts/verify-docs.js` check 4 (`gap-register-shape`) via `scripts/lib/gap-register.js`; unit tests `node --test scripts/lib/gap-register.test.js` | Two gaps merged into one line silently deletes a gap from the register — exactly how OG-26 disappeared in commit `10a8e87`, undetected by every other gate |
| Applied-migrations ledger: the runner applies only the pending tail recorded in `schema_migrations` (one transaction + ledger row per file); a stale ledger entry with no file on disk is surfaced as a warning, never silently dropped | `node --test scripts/lib/migrations.test.js` (10 tests: empty/full/partial ledger, ledger-order independence, duplicates, input immutability, TypeError guards, stale-entry detection) + the `node scripts/run-migrations.js --check` gate (exit 1 while anything is pending) | A second run re-executes `002_enums.sql` bare `CREATE TYPE` and aborts — or the applied-set drifts from disk when a migration is replayed by hand |

## Where to add a pin

New engine behavior lands **with** a test in the owning stage's `*.test.js`
plus, when it changes a documented contract, a line here. The convention that
made the Decision 23 O2 work safe: find the pin first, change behavior, watch
the exact pin fail, update pin + decision together.
