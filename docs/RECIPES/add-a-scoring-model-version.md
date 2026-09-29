# Recipe: add a scoring-model version

Scoring policy lives in a **versioned `scoring_model` row**, never in code constants.

1. Read Decision 3 (`scoring_model.configuration` contract) and Decision 13 (score formula).
2. The active model is `seed-minimal-v1` `1.0.0` — do not mutate it; INSERT a new version row
   (new `version`, same or evolved `configuration` JSON: caps, weights, penalties).
3. Configuration keys in use: `top_k_per_role`, `max_builds_per_query`,
   `unknown_compat_penalty`, `neutral_baseline`, `no_evidence_penalty`, role weights.
4. Record the why in the decision log FIRST (a config change that changes outcomes is a
   decision, not a tweak) — see Decision 24 for the format of a re-evaluation entry.
5. Beware the interacting caps: Decision 25 shows `max_builds_per_query` starves the O4
   diversity objective; a cap change is not automatically an improvement.
6. Insert via a seed (see add-a-seed recipe); update `CONTEXT.md`'s "Active model" status in
   the same session.

Verify:

```bash
node scripts/run-seeds.js --dry-run && npm run seed
node scripts/measure-orchestrator.js    # behavior change measured, not assumed (TEST branch)
npm run test:unit
```
