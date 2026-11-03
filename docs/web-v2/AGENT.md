# AGENT — the web-v2 redesign agent

The role brief for any agent (human-directed or autonomous) working on the redesign of `apps/web`.
Read `CONTEXT.md` first, then this.

## Mission

Move `apps/web` from its v1 UI to the Stitch "Moroccan Hardware Studio" design **without** breaking
the engine's contract, the accessibility floor, the two enforced performance budgets, or the Arabic
experience. Mobile (360 px) is the product; tablet and desktop are adaptations.

## Operating rules

1. **One task = one commit.** A task is the smallest unit with its own verification cycle. Update
   `PROGRESS.md` after each, with the exact command and its result.
2. **Report PASS / FAIL / BLOCKED.** A check not run is BLOCKED, never PASS. Quote the command.
   Never claim a Lighthouse or screenshot result you did not produce.
3. **Stay in the layer.** `apps/api/`, `database/`, `src/` are off limits. Needing a field is a row in
   `API_REQUESTS.md`, not a backend edit. `lib/` edits are allowlisted (named file, reason, recorded).
4. **Tokens only.** No hex, no palette utility (`bg-slate-200`), no physical side (`ml-`, `left-`,
   `text-left`). `check:tokens` enforces all four; run it after any component edit.
5. **All text through `messages/`**, `fr` + `ar` parity, numbers and money only via
   `lib/i18n/format.ts`. `check:i18n` is not optional.
6. **Fidelity order:** accessibility and real-data resilience, then Stitch layout/hierarchy, then pixel
   detail. Every deviation goes in `DEVIATIONS.md` with a reason; silent drift is the failure mode.
7. **Never weaken a test to make it pass.** Rewrite selectors to `getByRole`/`getByLabel`; if a
   behaviour genuinely changed, change the assertion deliberately and say so in the commit.
8. **Measure before claiming headroom.** The LCP budget has 18 ms of slack and the preset route has
   6 973 B of script. Any kit addition that ships to those routes is measured, not assumed.
9. **Stop at gates.** G1 tokens · G2 kit · G3 shell · G4.n per screen · G5 desktop/RTL. Do not start
   the next phase to "keep moving"; present the evidence and wait.

## Work loop

1. Read `CONTEXT.md`, the phase's plan (`docs/superpowers/plans/` or `PLAN.md`), and the relevant
   `docs/TEST_MAP.md` rows.
2. Confirm the tree: `git status` first (shared checkout), then the gate set from a clean state.
3. Implement the smallest change that satisfies the task's stated check.
4. Verify: `typecheck`, `lint`, `check:tokens`, `check:i18n` always; `build` and the affected specs
   when markup changed; `test:lighthouse` only when a measured route's weight changed.
5. Record: `PROGRESS.md` row, `DEVIATIONS.md` entry if the design was not followed literally, commit
   with the measured result in the body.
6. Report: what changed, what was run, what passed, what is blocked, what the next gate needs.

## Escalate to the owner when

- A design decision would ship a contrast ratio under 4.5:1 body / 3:1 UI.
- A task needs a new dependency, a new route, or a `lib/` edit outside the allowlist.
- A budget is at risk (LCP, CLS, script bytes, axe) and cannot be fixed inside the task.
- Two documents disagree (DESIGN.md's YAML ramp vs its prose palette is the current example).
- Anything would touch a real `.env`, push to a remote, or delete tracked data.

## Definition of done, per screen

Markup rewritten to the kit; strings via `messages/` in both locales; RTL mirrored (icons and layout);
no horizontal scroll at 360; focus visible and ordered; touch targets ≥ 44 px; every data state
rendered (loading, empty, error, degenerate data); specs green; screenshot at 360/768/1280 in `fr` and
`ar` compared against `design/v1-reference/` and the Stitch screen; `DEVIATIONS.md` updated.
