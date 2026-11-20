# Step 5 W1 — RFC decision request (A2/A6 owner)

**Status: OPEN REQUEST. PROPOSED — NOT APPROVED. No answer exists yet.**

This is a decision request to the RFC A2/A6 architecture owner, not a decision. It asks for written
answers to four question groups that currently block gates 4 and 5 of the W1 ledger. Every other row
of that ledger stays closed until these are answered and the remaining evidence arrives.

Companion document: [`w1-runtime-extraction-preparation.md`](w1-runtime-extraction-preparation.md)
(inventory, dependency graph, provenance design, transaction plan, ownership and exports plan).

## How to answer

Write the answer in the **Answer required** column (or reply in the PR with the same numbering). A
written answer is the only thing that closes gate 4 or gate 5: a verbal answer, an implied answer, a
merged unrelated PR or a green CI run does not. The "proposed answer" column is what this dossier
would use if the owner confirms it; it is **not authoritative** and must not be encoded before then.

```text
Owner:            RFC A2/A6 architecture owner
Closes gates:     4 (count resolved), 5 (scope + wave labels)
Blocks:           W1 destination table, extraction manifest batch, test ownership inventory
Answer format:    one line per row, e.g. "A1 = 22 files; A2 = yes; A3 = yes (2)"
```

---

## A. Inventory count

`[inspected]` Three different figures exist in the RFC today:

| Source | Figure | Note |
|---|---|---|
| §11.2 table rows targeting runtime | **22 files** | counted row by row |
| §11.2 "Counts" paragraph | **21** | arithmetic: 3 loaders + 1 pipeline + 7 orchestrator + 5 persistence + 3 query + 2 scoring; omits the `offers/index.js` row |
| §5 programme table (line 1527) | **24** | "the 24 runtime modules" |

22 moved files + 2 prospective namespace barrels (`loaders/index.js`, `persistence/index.js`) = 24
publication units, which is the only reading found so far that reconciles two of the three figures.
The third (21) appears to be an arithmetic slip, not a scoping decision.

| # | Question | Current evidence | Proposed answer (not authoritative) | Answer required | Owner |
|---|---|---|---|---|---|
| A1 | Is the authoritative count **21, 22 or 24**? | §11.2 enumerates 22 runtime rows; §11.2 arithmetic says 21; §5 line 1527 says 24 | **22 files**, with 24 as the publication-unit count | | A2/A6 |
| A2 | Is `offers/index.js` **inside** the moved set? | §11.2 has a row for it ("whole barrel → runtime; **not** mixed") but the arithmetic that produces 21 does not count it | **Yes** — it is one of the 22 | | A2/A6 |
| A3 | Are the **two new barrels** (`loaders/index.js`, `persistence/index.js`) counted in the figure? | Neither exists yet; §11.5 publishes `./loaders` and `./persistence`, so barrels are implied but never counted | **Yes**, as publication units separate from the 22 moved files | | A2/A6 |
| A4 | Which figure must `extraction-manifest.json` and the W1 report use? | The manifest records moves, not units, so it needs the file count | **22 moves**, reported alongside "24 publication units" | | A2/A6 |

---

## B. Wave definitions

`[inspected]` The runtime package's frozen W0 entry point already names the waves:
`loaders` → W1, `persistence` → W2, `orchestrator` → W3. The assignment direction is "full runtime
extraction", which the current documentation does not reconcile with a loaders-only W1: either W1 is a
batch inside a three-wave programme, or W1 means the whole extraction and the labels collapse.

| # | Question | Current evidence | Proposed answer (not authoritative) | Answer required | Owner |
|---|---|---|---|---|---|
| B1 | Is **W1 loaders only**? | `packages/recommendation-runtime/src/index.js` header (W0): "loaders W1, persistence W2, orchestrator W3" | **Yes** — W1 is the loaders batch | | A2/A6 |
| B2 | Is **W2 persistence**? | same header | **Yes** | | A2/A6 |
| B3 | Is **W3 orchestrator**? | same header | **Yes** | | A2/A6 |
| B4 | Does "**full extraction**" mean **all three waves** in sequence? | The selected direction says full extraction; the wave labels say three batches | **Yes** — full extraction = W1 + W2 + W3, in that order, each independently authorised | | A2/A6 |
| B5 | If B4 is yes, may W1's manifest batch be recorded and verified **before** W2/W3 exist? | The extraction workflow requires a per-batch baseline and identity evidence; the core did exactly this across six batches | **Yes** — one batch per wave | | A2/A6 |

---

## C. Destinations

`[inspected]` §11.2 gives a **target project** for every runtime row but no **destination path** for
three of them, and two options for a fourth. A move cannot be recorded without a destination.

| # | Module | Current evidence | Options | Answer required | Owner |
|---|---|---|---|---|---|
| C1 | `offers/index.js` | §11.2: "whole barrel → runtime; **not** mixed" — no path | (a) `runtime/src/offers/index.js`; (b) folded into `loaders/index.js`; (c) not moved, left as an old-path barrel | | A2/A6 |
| C2 | `query/index.js` | §11.2: "whole directory → runtime; **no split**" — no path | (a) `runtime/src/query/index.js`; (b) folded into `loaders/index.js`; (c) not moved | | A2/A6 |
| C3 | `orchestrator/index.js` | §11.2: barrel row, target runtime, no path | (a) `runtime/src/orchestrator/index.js`; (b) becomes the package root namespace builder; (c) not moved until W3 | | A2/A6 |
| C4 | `filtering/pipeline.js` | §11.2: "→ `runtime/orchestrator/filtering-pipeline.js` (**or a runtime loader entry point**)"; §11.5 publishes `loaders.filterCandidatesForRecommendation` | (a) source `orchestrator/filtering-pipeline.js`, published from `./loaders` (current proposal); (b) lands under `loaders/filtering-pipeline.js` | | A2/A6 |

Note for C1–C3: whichever option is chosen decides whether the runtime package publishes three
subpaths (`.`, `./loaders`, `./orchestrator`, `./persistence`) plus private barrels, or only the three
subpaths with no internal barrels at all.

---

## D. Transaction contract

`[inspected]` The table below was verified line by line against the current source, and the W0
harness already pins the entry points against it. The request is a confirmation, not a redesign: no
transaction behaviour is to change in W1.

| # | Claim | Evidence in source | Proposed answer (not authoritative) | Answer required | Owner |
|---|---|---|---|---|---|
| D1 | `snapshot.js` **owns** the read-only repeatable-read transaction and rolls back on both paths | `snapshot.js` header + body: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` … `ROLLBACK` on success **and** failure, never `COMMIT`, `BEGIN` outside the `try` | **Confirmed** | | A2/A6 |
| D2 | `run.js` owns **no** transaction | `run.js`: no `BEGIN`/`COMMIT`/`ROLLBACK`; one autocommit `SELECT CURRENT_TIMESTAMP AS now` | **Confirmed** | | A2/A6 |
| D3 | `commit.js` (`runRecommendationCommit`) **owns** the write transaction | `commit.js`: `BEGIN`, the `recommendation_query` `FOR UPDATE` guard, REPLACE-style writers, `COMMIT` on success / `ROLLBACK` on failure | **Confirmed** | | A2/A6 |
| D4 | `commitSwapInTransaction` **owns** its write transaction; `commitSwap` owns none | `swap-commit.js`: `BEGIN` … `COMMIT`, `ROLLBACK` on error, original error preserved; `commitSwap` runs on the caller's handle | **Confirmed** | | A2/A6 |
| D5 | Documentation correction: `LOADERS_AND_TRANSACTIONS.md` says the read snapshot "is opened by the caller: `orchestrator/run.js` runs stages 1-10 inside a caller-owned … transaction" | Contradicts D1/D2: the caller supplies the **client**, `snapshot.js` opens the transaction | **Correction approved** — attribute ownership to `snapshot.js`; the caller supplies the client and owns no transaction | | A2/A6 |

---

## What these answers unlock, and what they do not

Answering A–D unlocks: the final destination table, the `step-5-w1` manifest batch shape, the test
ownership inventory's `current` paths, and the package `exports` key set. It **does not** authorise W1:
gates 1, 2, 3, 6 and 7 remain open, and gate 7 is the project authority's explicit written
authorisation. No module moves on the strength of this document.
