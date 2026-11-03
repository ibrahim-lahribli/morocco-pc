# HANDOFF — web-redesign, end of session 2026-11-03

Read this first, then `CONTEXT.md`. This file is the state of the branch, not the plan.

## Where the branch stands

- Branch `web-redesign`, **22 commits** since `master` (`e3fe882`), **nothing pushed**, no upstream.
- Phases 0 and 1 are **closed**. Phase 2 (**kit**) is **partly done**: T1, T2, T3, T4a, T5 landed; T6, T7, T8 remain.
- `docs/web-v2/PROGRESS.md` is the ledger; `docs/superpowers/plans/2026-11-03-web-redesign-phase-2.md` is the ladder.

### Gates on the final tree (measured, all re-run at handoff)

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS, **0 warnings** |
| `npm run check:tokens` | PASS — 91 files |
| `npm run check:i18n` | PASS — 89 files, 2 catalogues, key + placeholder parity |
| `npm run check:api-types` | PASS — contract 1.10.0, byte-identical |
| `npm run build` | PASS |
| `CI=1 npm test` | **PASS — 380 passed / 2 skipped** (35.4 s) |
| `npm run test:lighthouse` | **PASS** — but see the budget below |

The two skips are `e2e/wizard-browser-api.spec.ts` (needs `E2E_BROWSER_API=1`) and `e2e/wizard-engine.spec.ts` (opt-in real-engine harness). Both are by design.

### The budget got tighter — act on this first

| Route | LCP (median) | CLS | Script | Slack vs 174 080 |
|---|---|---|---|---|
| `/fr/config/{id}` | 2 487 ms | 0 | **161 758 B** | 12 322 B |
| `/fr/config-pc-gamer-9000-dh` | 2 484 ms | 0 | **170 512 B** | **3 568 B** |

At the G1 baseline these were 158 831 / 167 107 B. **The bundle grew ~3 KB during Phase 2** and the cause is NOT established: the likely suspect is the `@/components/ui` barrel now exporting `StatusBadge`, `StepHeader`, `ChoicePills` and `BudgetPicker`, which the two fixture routes never render. `Sheet` was deliberately kept OUT of the barrel for this reason and measured +0 B.

Before T6 adds primitives, measure this: export the new primitives directly (as `sheet.tsx` is) or confirm the barrel is not the cause. A 3.5 KB margin will not survive T6.

## Decisions recorded this session

- **DESIGN.md adopted in full** (owner decision): 67 raw colours + 14 aliases, full type scale, Arabic +10 % leading. D-03…D-06 are closed.
- **D-14**: the header bell and account avatar are NOT shipped — no auth (D2), no notification source. Do not re-introduce them as disabled icons.
- **`Sheet` on Radix Dialog**, animated never (CLS 0), out of the barrel, with `trigger`/`returnFocusTo` — Radix only restores focus to a `Dialog.Trigger`; a controlled sheet opened by a plain button dropped focus to `<body>` until the spec caught it.
- **`StatusBadge`** carries `PASS`/`UNKNOWN` only (the engine rejects the rest), separate from `Badge`'s three price states so the vocabularies cannot mix.
- **Media**: CC0 only, from Openverse, committed locally with provenance in `apps/web/media/CREDITS.md`. Four covers exist (16 files, 292 KB). **No screen uses them yet** — wiring is Phase 4, where LCP is measured. Build/component cards stay unillustrated on purpose (a CC0 photo of different hardware beside a specific SKU is a false claim).

## Bugs this session found, and why the gates missed them

1. **`error-soft` had vanished** — `Alert tone="error"` rendered with **no background** since Phase 1. `check:tokens` cannot see a token that stopped existing, and axe passes dark text on white. Found by resolving every colour class against the defined `--color-*` names. **The gate gap is still open**: nothing prevents the next rename from doing the same.
2. **Focus return was false** — the Sheet claimed it, the spec disproved it, the primitive now proves it. Lesson: a spec that only asserts rendering would have missed this too.
3. **`check:i18n` scans comments.** A money literal inside a doc comment failed the gate, and an earlier commit went in with it red because the commit guard checked only typecheck/build/suite. Guard every gate's exit code.

## Traps (each already cost at least one red run)

- **Playwright reuses whatever answers 3210.** A `next start` started WITHOUT `API_BASE_URL` gets tested, and exactly the four server-side-data specs fail (catalog, compare, sitemap, analytics) while 376 pass. Under `CI=1` Playwright instead **refuses to start** — which reads as a red suite and is really no suite.
- **`netstat -ano` lies here.** Its state column is localised (no `LISTENING` rows match) and the listening row is often absent entirely, so port checks built on it always report free. Use PowerShell: `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` filtered on `next` / `mock.server.mjs`, then confirm `curl --max-time 2` returns `000`.
- **The suite runs the PRODUCTION build.** A component change is invisible until `npm run build` runs again — rebuild before believing a spec failure *or* a pass.
- **`bash` mangles `node -e` with backticks inside double quotes**, and a ~9 KB heredoc gets truncated (`here-document delimited by end-of-file`). Use `write_file` for scripts, or single-quoted `node -e` with no backticks.
- **`str_replace` mis-resolves paths in this repo.** Use exact `split/join` node scripts with assertions, and never normalise CRLF (check with `grep -cU $'\r'` first).
- **Openverse is slow and dishonestly so**: a probe answered HTTP 500 after 45 s; the first queries of a session succeed and later ones stall. `scripts/fetch-media.mjs` retries with a widening pause and fails soft per slot.

## What is left in Phase 2

- **T6** — `BottomTabBar`, `StickyBar`, `BuildCard` (drawn fallback), `PartRow`, `RetailerRow` (D-10 reduced), `SnapRow`, `TrustItem`, `ExplainerSheet`. Gallery-verify each; axe must stay at 0 violations.
- **T7** — rebuild `/kit`, and add the `viewport` export with `viewport-fit=cover`. **The Sheet's footer currently sits under the home indicator on a notched phone** (review finding P2, still open). Add `env(safe-area-inset-bottom)` padding with it.
- **T8** — the G2 evidence pack: the bundle table above **re-measured after the barrel question is settled**, LCP/CLS medians, axe count, fr + ar screenshots at 360, and the five FEASIBILITY NOs written into `DEVIATIONS.md` (per-part compatibility, images, retailer rows, price verification date, single-build GET), plus the never-drawn `configurateur_tape_2`.

## Open, unfinished, or unverified

- **Per-commit gate replay was NOT run.** 22 commits × (build + suite) is ~40 minutes of machine time. What is verified: HEAD is fully green, and `f339d37` is **known red in history** (its spec failed until `c119c54` fixed the primitive). If history hygiene matters, squash or note it before the PR.
- **`apps/web-v2/` is untracked** — a duplicate of `design/stitch/` (including a `.docx` handoff). Deleting it is the owner's call; it is not referenced by any code path.
- **`globals.css` is 403/403 CRLF** — the earlier mixed-ending worry was wrong; the file is consistent.
- **The gallery `/kit` is French-only** (`generateStaticParams` returns `fr`), `noindex`, and uses French literals rather than `messages/`. Pre-existing precedent, but it contradicts AGENT rule 5 and is not recorded as a deviation.
- **`/ar`'s h1 renders 24 px** — a Tailwind `text-2xl`, not a token step, so the type scale is not yet exclusive (`check:tokens` cannot see size utilities).
- **Media assets are committed but unused**; `guide-motherboard` is 127 KB, 4× the others. Re-encode it before it lands above the fold.

## Commands that matter

```
cd apps/web
npm run typecheck && npm run lint && npm run check:tokens && npm run check:i18n
npm run build && CI=1 npm test      # CI=1 so Playwright starts its own servers
npm run test:lighthouse             # 4 assertions, median of 3, 2 fixtures
npm run media:fetch -- --only=<key>  # CC0 covers, --force to refetch
```

Verify the ports are free (`curl` → `000`) before any suite run; kill strays by PID from `Get-CimInstance`, never by pattern.
