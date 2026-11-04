# CONTEXT — the web-v2 redesign, in one page

Read this before any web-v2 task. It is the operational state; `PLAN.md` is the programme,
`TOKENS.md`/`DEVIATIONS.md` are the design record, `FEASIBILITY.md` is what the API can feed,
`PROGRESS.md` is the measured history, `SCREENS.md` maps Stitch screens to routes.

## What this is

A redesign of the public catalogue app `apps/web` (Next.js 16 App Router, Tailwind v4 tokens,
next-intl `fr`/`ar`) to the Stitch "Moroccan Hardware Studio" design: mobile-first, in place, no URL
changes except one new build-detail route. The engine, the API and the database are **not** part of
this work.

## Current state

| Phase | Status |
|---|---|
| 0 — baseline, feasibility, reference captures | **done** (8 tasks, 78 reference PNGs) |
| 1 — tokens | **done**: DESIGN.md adopted in full — 67 raw colours + 13 aliases, full type scale, Arabic +10 % leading |
| 2 — kit and mobile primitives | **done** — closed at gate G2 (T1-T8; D-15 to D-19) |
| 3 — shell | in progress — tab bar, landmark naming, review fixes, the `md+` header nav, `error.tsx` and the HEADER restyle (T6) are in and green; the FOOTER restyle (T7) is not, so **G3 is not claimed** |
| 4 — screens, one task each | not started (G4.n) |
| 5 — desktop + RTL pass | not started (G5) |
| 6 — hardening, Lighthouse, OG cards | not started |
| 7 — release | not started (human) |

Branch `web-redesign`. One task = one commit. Master is touched only at release.

## The numbers that constrain every decision

- **Suite: 395 specs, 393 passed, 2 skipped** (`wizard-browser-api`, `wizard-engine` — both opt-in).
  A flake FAMILY is live in the wizard's budget field: `wizard-budget.spec.ts` 76, 94, 220 and
  `wizard.spec.ts` 108 all reported flaky in one run on 2026-11-03, each passing on retry.
- **Lighthouse, `error` level, median of 3, on TWO URLs** (`/fr/config/<fixture>`, `/fr/config-pc-gamer-9000-dh`):
  LCP ≤ 2 500 ms (measured **2 480 / 2 484**), CLS ≤ 0.1 (0), script ≤ 174 080 B (**172 495 / 171 223**),
  performance ≥ 0.90 (0.98). **Headroom: 20 ms LCP and 1 585 B script on the result page, 2 857 B on the
  preset page — the result route is the binding one, and the error boundary's copy spent 3 785 B of what
  was there.** No screen may add above-the-fold weight without re-measuring.
- `check:tokens`: 104 files; no hex literal, no palette utility, no physical side, no `text-left/right`.
- `check:i18n`: 101 files; fr/ar keys and ICU placeholders identical; numbers/dates only via
  `lib/i18n/format.ts`; caller-filled templates read with `t.raw`.
- `check:api-types`: contract **1.10.0**, `lib/api/schema.d.ts` must stay byte-identical to the generator.

## Decisions already made (do not re-litigate without the owner)

- **D1** no images exist in the API → drawn fallback per role; **D2** no auth, no bell/avatar;
  **D3** "Où acheter" = price status + disclaimer (no merchant rows); **D4** new route
  `/{locale}/config/[id]/[rank]` reading `builds[]`, `notFound()` on unknown rank, `noindex`, no sitemap
  entry, no OG card; **D5** desktop built from Phase 5 rules at 1200 px; **D6** no dark mode;
  **D7** Arabic currency label `د.م.`; **D8** no PWA.
- **Colours and type now come from DESIGN.md in full** (owner decision, supersedes D-03/D-04/D-05/D-06).
  The only remaining override is accessibility: never ship a pairing under 4.5:1 body / 3:1 UI.
  White-on-amber (2.15:1) and `#10B981` as text (2.54:1) stay forbidden — see `DEVIATIONS.md`.

## Files that own what

| Path | Owns |
|---|---|
| `apps/web/app/globals.css` | the `@theme` token block (the ONLY place a raw colour lives) |
| `apps/web/components/ui/*` | the kit — props APIs are frozen while restyling |
| `apps/web/lib/**` | logic; **edit only by allowlist** (named file + reason recorded) |
| `apps/web/e2e/*.spec.ts` | the contract pins; rewrite selectors, never weaken assertions |
| `apps/web/design/stitch/**` | reference only — no code path imports it |
| `apps/web/design/v1-reference/**` | 78 before-images; compare every restyled screen against these |
| `docs/web-v2/**` | this pack |
| `apps/api/**`, `database/**`, `src/**` | **off limits**; needs go to `API_REQUESTS.md` |

## Commands (from `apps/web`)

`npm run typecheck` · `npm run lint` · `npm run check:tokens` · `npm run check:i18n` ·
`npm run check:api-types` · `npm run build` · `npm test` (needs a build; ports 3210/3211/3000 free) ·
`npm run test:lighthouse` (refuses if 3210 is busy) · `npm run capture:reference`.

## Traps, measured

1. `npm test` reuses a server already on 3210 — a stale `next dev` makes the run lie. Check ports first;
   stop servers by PID, never by pattern.
2. Next 16 emits CSS to `.next/static/chunks/<hash>.css`; the build log prints **no** CSS line, so
   assert the artifact and its `href`, not the log.
3. `str_replace` mis-resolves paths in this checkout; edit through an exact `split/join` script that
   asserts the substring was found.
4. `node -e "…"` with backticks inside double quotes is mangled by bash — use a heredoc script file.
5. CRLF: never "normalise" with `split('\n').join('\r\n')` (it writes `\r\r\n`).
6. Adding a decision to the root log breaks `verify-docs` (it hardcodes heading/status counts).
