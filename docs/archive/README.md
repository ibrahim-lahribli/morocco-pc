# docs/archive

Superseded documents, kept because history belongs in the repo. **Nothing here is current.** Each file
opens with a one-line header naming the file that replaced it and the date. Nothing was deleted.

## Index

| Archived file | Superseded by | Why it was superseded |
|---|---|---|
| `SESSION_NOTES.md` | `CONTEXT.md` | session scratch notes replaced by a current-state file |
| `DOCUMENTATION_AUDIT_2026-09-28.md` | `docs/OPEN_POINTS.md` | its D1-D12 findings and A1-A12 recommendations are closed or re-homed in the register |
| `PROJECT_STATUS_REVIEW_2026-09-28.md` | `docs/OPEN_POINTS.md` | its K/U/W registers are folded into R-01 … R-23 |
| `ENGINE_BEHAVIOR_FINDINGS_2026-10.md` | `docs/OPEN_POINTS.md` | measured on a model that is no longer served; parts are now false (see R-03) |
| `OG-01_ASSESSMENT_RESEARCH_PLAN.md` | `docs/OPEN_POINTS.md` | OG-01 closed 2026-10-02; the rubric lives in the seeds |
| `OG-01_BATCH2_EXECUTION_PLAN.md` | `docs/OPEN_POINTS.md` | same closure; the executable companion to the above |
| `OG01_BATCH2_RESEARCH_CHECKLIST.md` | `docs/OPEN_POINTS.md` | committed output of `scripts/og01-research-checklist.js` for a closed gap |
| `OG01_BATCH2_RESEARCH_CHECKLIST.csv` | `docs/OPEN_POINTS.md` | same worksheet, machine-readable form |
| `OG-39_ACTIVATION_PLAN.md` | `docs/OPEN_POINTS.md` | model activation is now R-06 plus `docs/engine/recipes/add-a-scoring-model-version.md` |
| `HANDOFF_2026-11-01_catalogue_identity.md` | `docs/OPEN_POINTS.md` | its open half is R-07; the repair itself is in seed 028 |
| `STATUS_REVIEW.md` | `docs/OPEN_POINTS.md` | the 2026-11-02 review; its section 7 became the register |
| `HANDOFF_2026-11-04.md` | `docs/OPEN_POINTS.md`, `docs/CONTEXT.md` | dated handoff for the EU private-beta hardening; its open items are register rows |
| `HANDOFF_2026-11-07.md` | `docs/OPEN_POINTS.md`, `docs/CONTEXT.md` | dated handoff after PR #16; its measurements are evidence, its open items are register rows |
| `pr8-fix-saved-spec.patch` | not applied, archived as history | a stale saved-builds spec patch; the tree has since moved past it (recorded, never applied) |
| `IMPORT_OFFERS.md` | `docs/ingestion/recipes/import-offers.md` | merged with the two offer recipes below |
| `import-offers-manually.md` | `docs/ingestion/recipes/import-offers.md` | merged into one recipe |
| `refresh-offers.md` | `docs/ingestion/recipes/import-offers.md` | merged into one recipe |
| `PLAN_PLATFORM_CONSTRAINTS.md` | `docs/ROADMAP.md` | rules section of the merged roadmap |
| `PLAN_PLATFORM_P0.md` | `docs/ROADMAP.md` | sprint ledger section |
| `PLAN_PLATFORM_P1.md` | `docs/ROADMAP.md` | sprint ledger section |
| `PLAN_PLATFORM_P2.md` | `docs/ROADMAP.md` | sprint ledger section |
| `PLAN_PLATFORM_P3.md` | `docs/ROADMAP.md` | sprint ledger section |
| `PLAN_PLATFORM_STATUS.md` | `docs/ROADMAP.md` | the roll-up became the ledger |
| `briefs/requests.md` | `docs/ROADMAP.md` | cross-agent request table; the one open item is R-23 |
| `briefs/step2-launch-v2-runbook.md` | `docs/ROADMAP.md` | the run completed 2026-10-09; only its reversal steps remain |
| `plans/agent3-web-plan.md` | `docs/ROADMAP.md` | frontend plan; the web track section replaces it |
| `plans/agent3-web-sprints.md` | `docs/ROADMAP.md` | frontend sprint list |
| `design/ACCESSIBILITY_AUDIT.md` | `docs/ROADMAP.md` | frontend design record |
| `design/COMPONENTS.md` | `docs/ROADMAP.md` | frontend design record |
| `design/I18N.md` | `docs/ROADMAP.md` | frontend design record |
| `design/STATES.md` | `docs/ROADMAP.md` | frontend design record |
| `design/TOKEN_MAP.md` | `docs/ROADMAP.md` | frontend design record |
| `design/UI_UX_AUDIT_2026-10-25.md` | `docs/ROADMAP.md` | frontend design record |
| `superpowers/plans/2026-10-02-og26-budget-aware-retention.md` | `docs/OPEN_POINTS.md` | OG-26 closed 2026-10-02 |
| `superpowers/plans/2026-10-05-remaining-limitations.md` | `docs/OPEN_POINTS.md` | its items are R-01 … R-23 |
| `superpowers/plans/2026-10-05-structural-drift-gates.md` | `docs/OPEN_POINTS.md` | the gates landed; the register tracks what is left |
| `superpowers/plans/2026-10-31-og59-clear-the-red-gate.md` | `docs/OPEN_POINTS.md` | OG-59 closed 2026-10-31 |
| `superpowers/plans/2026-11-01-catalogue-identity-and-served-model-pin.md` | `docs/OPEN_POINTS.md` | its two halves are R-06 and R-07 |
| `superpowers/specs/2026-11-02-web-v2-design.md` | `docs/ROADMAP.md` | frontend design spec |

## Deliberately NOT archived

These stay in place because a script, a test or a gate reads them, or because they are the current
answer to a question:

| File | Why it stays |
|---|---|
| `docs/RECOMMENDATION_ENGINE_DECISIONS.md` | the immutable decision log; off-limits by policy |
| `docs/OPEN_GAPS.md` | `verify-docs.js` parses its rows (`gap-register-shape`); now the evidence trail behind `OPEN_POINTS.md` |
| `docs/GLOSSARY.md`, `docs/TEST_MAP.md` | `verify-docs.js` requires both to exist |
| `docs/RECIPES/` | `verify-docs.js` requires the directory to exist and be non-empty; deploy and first-launch recipes stay here |
| `docs/engine/ARCHITECTURE.md` | gate check 9 scans it for deferral claims that a shipped module contradicts |
| `docs/SCHEMA_REFERENCE.md`, `docs/DATA_STATE.md`, `docs/DECISION_INDEX.md` | generated; only their generators may write them |
| `DEVELOPMENT_NOTES.md` | the operational-command reference; archiving it would lose the verified commands |
| `docs/briefs/engine.md` | the E0-E8 epic spine that `test/golden/scenarios.json` cites by name |
| `docs/ingestion/PIPELINE_DESIGN.md` | the ingestion design behind R-01, still unbuilt |
| `docs/ENGINE_HYPOTHESIS_REVIEW_2026-10-24.md` | the review record the golden approvals cite as evidence |
| `docs/decisions/TEMPLATE.md`, `docs/RECIPES/` | live procedure |

## Notes

- `OG01_BATCH2_RESEARCH_CHECKLIST.csv` is the one archived file whose header line is a comment rather
  than valid CSV: it was an artifact for a closed gap, and nothing parses it.
- `docs/RECOMMENDATION_ENGINE_DECISIONS.md` still cites some archived filenames by their old paths
  (for example `docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md`). The log is immutable by policy, so those
  citations are historical references, not links: resolve them against this directory.
- Archiving moved files with `git mv`, so `git log --follow <path>` still reaches the original history.
