# Step 5 W1 — RFC decision request (A2/A6 owner)

**Status: OPEN REQUEST. PROPOSED — NOT APPROVED. No answer exists yet.**

This is a decision request to the RFC A2/A6 architecture owner, not a decision. It asks for written
answers to four question groups that currently block gates 4 and 5 of the W1 ledger. Every other row
of that ledger stays closed until these are answered and the remaining evidence arrives.

Companion document: [`w1-runtime-extraction-preparation.md`](w1-runtime-extraction-preparation.md)
(inventory, dependency graph, provenance design, transaction plan, ownership and exports plan).

**This request is not an authorization.** Answering it authorizes no module move: approval of the
preparation dossier and approval of W1 are different acts, and W1 stays blocked until gate 7 (the
project authority's explicit written authorization) is closed in writing.

Every line in this document carries one label, so a fact is never read as a proposal:

| Label | Meaning |
|---|---|
| `[inspected]` | read from this repository at the revision named; a fact |
| `[interpretation]` | a reading of a source or RFC statement that the owner may reject; not a fact |
| `[proposal]` | designed by Agent 3, unapproved; never to be encoded before a written answer |
| `[unresolved]` | no acceptable answer exists yet, and the dossier does not invent one |

The "proposed answer" column is a `[proposal]`. The "Current evidence" column is `[inspected]` unless a
row says otherwise. No answer field below is filled in, and none will be: only the owner writes there.

## How to answer

Write the answer in the **Answer required** column (or reply in the PR with the same numbering). A
written answer is the only thing that closes gate 4 or gate 5: a verbal answer, an implied answer, a
merged unrelated PR or a green CI run does not. The "proposed answer" column is what this dossier
would use if the owner confirms it; it is **not authoritative** and must not be encoded before then.

```text
Owner:            RFC A2/A6 architecture owner
Closes gates:     4 (count resolved), 5 (scope + wave labels)
Blocks:           W1 destination table, extraction manifest batch, test ownership inventory
Answer format:    one line per row, e.g. "A1 = 22 file moves; A2 = rows only; A4 = yes (2)"
```

---

## A. Inventory count

`[inspected]` The §11.2 table is identical on `master` (`45133d5`, base of PR #51) and on
`feat/core-explanation-extraction` (`880bb18`): **24 rows** have runtime in their target column.
Three of those rows are the mixed barrels `candidates/index.js`, `filtering/index.js` and
`scoring/index.js`, which are split rather than moved; one of the remaining 21 rows names two files
(`persistence/validate-selected.js`, `validate-rejections.js`). That is **22 moved files**.

The "Counts" paragraph differs by revision, so this request cites sections, not lines:

| Revision | §11.2 bold figure | Its own parenthetical sums to | Programme table phrase |
|---|---|---|---|
| `master` `45133d5` | **24** modules | 21 | "the 24 runtime modules" at line **1524** |
| `feat/core-explanation-extraction` `880bb18` | **21** modules | 21 | "the 24 runtime modules" at line **1527** |

So the figures are not three opinions about one quantity: **24 is a row count**, **22 is a file
count**, and **21 is what each parenthetical sums to**, one short of the 22 moved files. 22 moves + 2
prospective namespace barrels = 24 publication units, which coincides with the row count by
coincidence, not by derivation.

`[inspected]` The dossier lists all eight quantities separately (rows, mixed barrels, remaining rows,
file moves, inventory rows, publication barrels, publication units, shims) in its §4 table, and each of
the 22 unique physical paths in its §5.1. The reconciliation does not close arithmetically, and the
dossier says so rather than manufacturing the missing file: see `[unresolved]` in its §5.2.

| # | Question | Current evidence | Proposed answer (not authoritative) | Answer required | Owner |
|---|---|---|---|---|---|
| A1 | Which figure is authoritative: **rows (24), file moves (22) or publication units (24)**? | §11.2 has 24 runtime rows; the moved set is 22 files; publication units would be 24 | **22 file moves**, reported with 24 rows and 24 publication units as separate quantities | | A2/A6 |
| A2 | Are the **three split barrels** (`candidates/index.js`, `filtering/index.js`, `scoring/index.js`) counted inside the 24? | Three rows carry target "core + runtime" and are split, not moved | **Yes as rows, no as moves** — they are why the row count exceeds the file count | | A2/A6 |
| A3 | Is `offers/index.js` **inside** the moved set? | §11.2 has its own row ("whole barrel → runtime; **not** mixed") | **Yes** — one of the 22 files | | A2/A6 |
| A4 | Are the **two new barrels** (`loaders/index.js`, `persistence/index.js`) counted in any figure? | Neither exists yet; §11.5 publishes `./loaders` and `./persistence`, so they are implied but never counted | **Yes**, as 2 publication units on top of the 22 moves | | A2/A6 |
| A5 | Which figure must `extraction-manifest.json` and the W1 report use? | The manifest records moves, not rows or units | **22 moves**, with rows/units stated alongside | | A2/A6 |

`[unresolved] Note for the owner:` both parentheticals are one short of the 22 files. Either a moved
file is missing from the arithmetic in each revision, or one of the 22 is not meant to move. That is
the underlying question behind A1 and A2.

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

`[inspected]` The dossier §5.3 records each of these four modules with its current responsibility,
proposed physical destination, proposed public namespace, barrel/implementation kind, wave, shim need
and the exact decision required — and chooses none of them. `[interpretation]` C4 is the weakest case of
the four: §11.5 already fixes the public name and namespace, so if the answer is (a) the only open
question is the directory.

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

`[inspected]` The dossier §8 turns these five confirmations into an executable specification: a success
trace and a failure trace per operation (nine failure points, including BEGIN, first read, later read,
write, COMMIT, ROLLBACK, error preservation, cleanup and partial operation), plus the four things a
recording fake client must assert — expected statements, prohibited statements, ordering, and client
identity/ownership. A test that only asserts "some calls happened" is explicitly rejected there.

---

## What these answers unlock, and what they do not

Answering A–D unlocks: the final destination table, the `step-5-w1` manifest batch shape, the test
ownership inventory's `current` paths, and the package `exports` key set. It **does not** authorise W1:
gates 1, 2, 3, 6 and 7 remain open, and gate 7 is the project authority's explicit written
authorisation. No module moves on the strength of this document.
