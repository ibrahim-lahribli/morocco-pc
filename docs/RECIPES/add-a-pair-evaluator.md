# Recipe: add a pair evaluator (compatibility relationship)

The **topology is declared twice** today — this is the recipe's main hazard (W3/K6).

1. Read `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` §3/§5/§6 (HARD/SOFT policy) and check
   whether a decision entry already covers the relationship.
2. Write the evaluator as a pure module in `src/recommendation/compatibility/`:
   - return `PASS | FAIL | UNKNOWN | CONDITIONAL` (Decision 1 asymmetric-UNKNOWN policy);
   - NULL input = UNKNOWN, never "unlimited"; explicit 0 = verified deficit (D4/D5 of seed 003);
   - include evidence in the result (see `gpu.js` Rule 11 for the shape).
3. Export it from the `compatibility/index.js` barrel.
4. Register it in **BOTH** topology declarations:
   - `filtering/filter.js` `PAIR_EVALUATORS` + per-role lists;
   - `assembly/assemble.js` `PAIRWISE_CHECKS` (this one also needs the orientation flag
     `leftIsNew` — copy it, don't re-derive it).
   A relationship registered in only one place silently diverges between the candidate filter
   and the assembly walk.
5. Decide derived-vs-stored: derive what is arithmetic (GPU↔PSU precedent), store what is not
   (explicit compatibility tables).
6. If the relationship corresponds to an architecture HARD rule, implement it — do not add
   another deferred-unenforced rule without a decision entry (Decision 26 is the precedent
   for recording a deferral).

Verify:

```bash
npm run test:unit
grep -rn "PAIR_EVALUATORS\|PAIRWISE_CHECKS" src --include=*.js | grep -v test   # both sites updated
```
