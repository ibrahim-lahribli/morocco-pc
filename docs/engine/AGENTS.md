# AGENTS.md — engine (pure recommendation logic)

Scope: `src/recommendation/**` (except the loaders owned by
`packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md`), the engine recipes in
`recipes/`, and the unit suite. The authoritative design is `ARCHITECTURE.md` beside this file; the
decision log outranks it where they disagree.

## Non-negotiables

- **Purity.** A stage module performs no DB access, no clock read, no randomness, and never mutates its
  inputs. `require('pg')` / `require('dotenv')` / `fs` / `http` / `process.env` inside a stage is a
  defect. DB access lives only in the loaders (`candidates/loader`, `filtering/context-loader`,
  `scoring/load-*`, `offers/`, `query/`) and the orchestrator.
- **Determinism.** Same DB state + query + scoring-model version ⇒ identical candidates, scores,
  ranks and text. Tie-breaks are fixed and code-unit based: `compareCandidates()` breaks ties on
  `product_id` ASC, then `product_variant_id` NULL-first then ASC. Never `localeCompare`, never a
  random or UUID-derived tie-break.
- **Status vocabulary.** `PASS | FAIL | UNKNOWN | CONDITIONAL`; NULL is UNKNOWN, and UNKNOWN is never
  treated as PASS or FAIL. Every boundary is inclusive and NULL operands resolve UNKNOWN.
- **Orchestration is boundary-only.** `orchestrator/run.js` wires loaders and pure stages inside a
  caller-owned `REPEATABLE READ READ ONLY` snapshot; `orchestrator/commit.js` owns the single write
  transaction; `orchestrator/full-run.js` composes snapshot → rank → diversity → explanation → commit.
  New composition goes there, not inside a stage.
- **Module shape.** Most stages expose a boundary-only `index.js` barrel. `persistence/` has no barrel
  and is imported directly. A barrel that re-exports a runtime module is a classification defect —
  three are genuinely mixed today (`candidates`, `filtering`, `scoring`); `offers` and `query` are
  runtime-only.

## Commands

```bash
npm run test:unit                                  # the whole engine suite, no DB
node --test src/recommendation/<stage>/<file>.test.js   # one file
npm run test:coverage                              # Node's own coverage (no devDependency)
npm run eval:scenarios -- --model=<name@version>    # the 20-scenario golden matrix (TEST branch)
node scripts/verify:pi1                             # decision 23 criterion 3, pool independence
node scripts/measure-platform-cost.js               # read-only retention/assembly measurement
```

Comparison harnesses select a scoring model by a `name@version` **pin** (`scripts/lib/model-pin.js`;
override `--model=` or `SCORING_MODEL_PIN`). The pin fails closed on a malformed, ambiguous, INACTIVE
or unmatched pin. A pin is a selector, never an activation.

## Gotchas that cost real time

- **Driving the filter by hand needs the exact contract.** `filterCandidatesForRecommendation({input,
  pool}, db)` is positional. A pool entry is `{ component_role, product_id, product_variant_id: null,
  category }` where `category` is the `product_category` enum (`COOLER`, not `CPU_COOLER`). `product`
  has no `category` column — derive it from spec-table presence (`scripts/lib/og01-catalog.js`). Role
  `RAM` maps to category `MEMORY`.
- **A full-catalog pool legitimately yields 2 REJECTs and 12 UNKNOWNs.** Assert against that baseline,
  not against "zero REJECT".
- **`describeTarget` prints the pooled host while `apply-seed.js` prints the direct host** — the same
  branch, not a mismatch.
- **The golden harness is GREEN when no APPROVED assertion fails**, not when every row PASSes. Its
  totals belong to the scoring-model pin, so always name the pin with the figure. Never tune a
  threshold to make a scenario pass, and never read EXPECTED-RED rows as a regression.
- **`grep -c '^. (tests|pass|fail)'`** on `node --test` output matches nothing (the summary lines start
  with `ℹ`); capture the command's own exit status instead.
- **Adding a spec column to the loader breaks exact-shape fixtures across four files**, and the
  failures are legitimate — give the fixture real data, never relax the assertion.
- **`current_epic` in `test/golden/scenarios.json` is gate-affecting.** Advancing it can turn a
  measured UNKNOWN into a HARD FAIL; that is a decision, not a status edit.

## Recipes

`recipes/add-a-pipeline-stage.md`, `recipes/add-a-pair-evaluator.md`,
`recipes/add-a-scoring-model-version.md`. Schema, seed and role procedures are in
`docs/database/recipes/`.
