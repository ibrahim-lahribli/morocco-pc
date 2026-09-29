# Recipe: add a pipeline stage

Stages are pure modules under `src/recommendation/`; composition lives in the orchestrator.

1. Read `AGENTS.md` §4–§5 (stage layout, purity rule) and
   `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` §2 (pipeline order) first.
2. Create `src/recommendation/<stage>/` with:
   - the pure implementation module(s) — no DB access, no clock, no randomness, no input
     mutation; deepFreeze outputs (children before container);
   - a boundary `index.js` barrel with a header comment stating inputs/outputs/ownership
     (the exception: `persistence/` has no barrel — imported via `persist-ranked` directly).
3. DB access goes ONLY in a loader (`*/loader.js` or `query/`) or the orchestrator.
4. Wire it into the composition in `orchestrator/run.js` (read pass) or `full-run.js`
   (snapshot → rank → select → explain → commit) — never inside engine modules.
5. Update `scripts/verify-docs.js` check 5 (`expected` stage list) — the layout check will
   FAIL until the new stage is listed.
6. Write the stage's `*.test.js`; add a row to `docs/TEST_MAP.md` for any contract it pins.
7. Update `CONTEXT.md` stage list and the architecture §2 table in the same session.

Verify:

```bash
npm run test:unit
npm run verify:docs          # engine-layout PASS with the new stage listed
```
