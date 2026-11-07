# Step 3.4 — Homepage visual refinement: report

**Date:** 2026-11-07
**Branch:** `feature/v2-design`
**Baseline:** `3a65bad` (Step 3.3.1, pushed)
**Plan:** `docs/superpowers/plans/2026-11-07-step-3-4-homepage-visual-refinement.md`
**Scope:** `apps/web-v2` only. No token, `apps/web` (V1), `apps/api` or manifest change.

## A. Implementation summary

Eight tasks, all landed. The desktop homepage now matches the committed frame where the frame could
be measured: the hero heading is composed as two explicit lines with the frame's padding, the three
configuration cards align their score and price on one line and let a long specification wrap instead
of truncating it, the browser suite covers every width the brief names (768 and 1024 included) and
pins the `lg` grid boundary from both sides, a Vitest gate enforces the design system's
logical-direction rule that until now held only by reviewer attention, and the imagery decision is
recorded in the section specification with a test that fails if a foreign image origin appears.

Nothing was invented. Where the frame could not be read (the design file answered HTTP 429 for the
whole session) the change was measured against the committed frame-derived specification and, where
even that was silent, deliberately not made.

## B. Modified files

Source (2): `components/home/homepage-hero.tsx` (heading spans, `pt-10 lg:pt-16`),
`components/home/featured-build-card.tsx` (score `dd` box), `components/home/spec-pill.tsx`
(`min-w-0 break-words`), plus Task 2's `components/home/section-heading.tsx`, `trust-highlights.tsx`,
`featured-guides.tsx` and `recommended-build-section.tsx`.

Tests (7): `tests/homepage/section-heading.test.tsx`, `tests/homepage/spec-pill.test.tsx`,
`tests/homepage/rtl-utilities.test.ts`, `e2e/homepage.spec.ts`, `e2e/homepage-builds.spec.ts`,
`e2e/homepage-i18n.spec.ts`, `e2e/configurator.spec.ts`.

Docs: `apps/web-v2/docs/sections/01-homepage.md` (the Step 3.4 imagery decision),
`apps/web-v2/README.md` (spec count, widths, direction gate), this report, and the twelve evidence
PNGs under `apps/web-v2/docs/screenshots/step-3-4/` (six `before/`, six `after/`).

## C. Reference — what was measured, and what was not

**The design file could not be read.** `figma-context.get_figma_data` on file `OwaMKYnDfH2AQqj7y0bn2H`,
node `0:1` answered **HTTP 429** with `Retry after 56967` seconds, and a later attempt 56597. Every
figure below therefore comes from a committed, reviewable source instead:

| Source                                                                               | What it fixes                                                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `apps/web-v2/docs/sections/01-homepage.md` (frames `19:3` desktop, `23:1179` mobile) | 1280 px container, 6/6 hero grid, 40 px gap, 64 px hero padding, 22/28 px section headings, card anatomy |
| `stitch_morocco_pc_builder_app/accueil_morocco_pc/{code.html,screen.png}`            | the rendered reference the frames were derived from                                                      |

**No pixel-parity claim is made or implied.** The brief's rule — do not invent a measurement when it
can be read from the source — was followed by reading these sources; where they are silent (the hero
heading's exact size) the approved token stands: the frame is 48 px/800, the shipped value is
40 px/700, approved as **Q-02**. That deviation is deliberate and unchanged by this step.

## D. API behaviour — unchanged

- No request was added, removed or reordered: the homepage still issues `GET /v1/meta/options`, one
  `GET /v1/presets` per use case and one `GET /v1/recommendations/{id}` per rendered card.
- `git diff --stat 3a65bad..HEAD -- apps/api apps/web apps/web-v2/lib apps/web-v2/package.json` is
  empty: no contract, no client, no dependency and no V1 file moved.
- The browser tests continue to assert `expectNoApiViolations` — any non-GET is a 405 and a failure —
  and the 62-spec run reports zero writes and zero unmatched calls.
- `npm run check:api-types` exits 0, so the generated types still match `openapi-v1.10.json`.

## E. French / Arabic and RTL

- The two-line hero renders in both locales: French 212/260 px line tops at 1280, Arabic 212/260 with
  the heading text `الحاسوب المناسب،بالميزانية المناسبة.` and `dir="rtl"` from the layout.
- No string was added by this step, so dictionary parity is untouched
  (`tests/i18n/messages.test.ts` still passes).
- The direction rule is now **enforced, not remembered**: `tests/homepage/rtl-utilities.test.ts` scans
  every component and fails with `file: class` for `ml|mr|pl|pr`, `left|right`, `text-left|right`,
  `border-l|r` and `rounded-l|r|tl|tr|bl|br`. Today's tree has **0 offenders**.
- **Arabic is machine-authored and not native-approved.** `docs/homepage-arabic-review.md` remains an
  open gate; nothing here claims that review.

## F. Viewports

The overflow sweep in `e2e/homepage-i18n.spec.ts` now runs **seven widths × two locales** (360, 390,
430, 768, 1024, 1280, 1440); 768 and 1024 were the two the brief names that the suite never measured.
Geometry measured in a real browser against the production build and the live read-only API:

| Width | What was measured    | Result                                                                                                   |
| ----- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| 1440  | sweep, both locales  | 0 px horizontal overflow                                                                                 |
| 1280  | hero heading         | 2 line boxes, tops 212 / 260, `padding-top` 64                                                           |
| 1280  | card value boxes     | tops 1534 / 1534, bottoms 1562 / 1562 (28 px box)                                                        |
| 1280  | card heights         | 537 / 537 / 537, one row                                                                                 |
| 1280  | spec pills           | 11 pills, **1 wraps** — `CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18`                               |
| 1024  | card tops            | 1070 / 1070 / 1070 — one row at the `lg` boundary                                                        |
| 1023  | card tops            | 1200 / 1603 / 1778 — stacked one pixel below it                                                          |
| 1024  | configurator summary | `position: sticky`, x 640 beside a form ending at 608 — in the flow, not a fixed bar                     |
| 768   | sweep, both locales  | 0 px overflow                                                                                            |
| 390   | hero / cards         | 2 lines at 135 / 173, `padding-top` 40, values 1765–1793, cards 467 / 197 / 221 (compact rows by design) |
| 360   | Arabic homepage      | 0 px horizontal overflow, console clean                                                                  |

No console error or warning appeared at any measured width.

## G. Gates

Run from `apps/web-v2` on 2026-11-07, after every source and documentation edit:

| Command                   | Exit | Result                                               |
| ------------------------- | ---- | ---------------------------------------------------- |
| `npm run typecheck`       | 0    | clean (strict, `noUncheckedIndexedAccess`)           |
| `npm run lint`            | 0    | clean                                                |
| `npm run format:check`    | 0    | Prettier-clean                                       |
| `npm run check:api-types` | 0    | `schema.d.ts` matches `openapi-v1.10.json`           |
| `npm test`                | 0    | **154 passed** across 28 files (baseline 144 / 25)   |
| `npm run test:e2e`        | 0    | **62 passed** in 7.4 s (baseline 55)                 |
| `npm run build`           | 0    | dynamic routes, middleware compiled, no route change |

Two honest notes about this table. The **first** `format:check` of this session exited 1, naming
`scripts/verify-5-7.mjs` — the temporary measurement script itself, which was deleted immediately
after; the re-run above is the recorded value, and no repository file was ever unformatted. And every
count is the printed figure, not a rounded one.

## H. Remaining issues

1. **`HeroRigPreview` renders no build.** The preview card carries an eyebrow, a caption and a
   disabled `Détails specs`; `Homepage.hero.preview.score` is authored and unused. Owner-gated.
2. **No mobile discovery section.** `DiscoveryPathways` is `hidden lg:block`, so 360–1023 px has no
   discovery affordance; the frame's resolution tiles are deferred (Q-20).
3. **No photography** (Q-03). Recorded in §C of the specification and guarded by a test that fails on
   a foreign image origin; the page requests **0 images** today, so that guard is armed rather than
   exercised.
4. **The desktop hero's left column is shorter than the finder**, leaving open space under the
   preview card at 1280. Filling it means deciding the preview's content (issue 1), not moving a box.
5. **The third card's title wraps** (`PC Création & Professionnel`), so its pill row starts lower than
   its neighbours'; the card bottoms still align, which is the contract the test pins.
6. **Arabic copy is unsigned** (§E).

## I. Deviations deliberately not fixed

- The hero heading stays 40 px/700 against the frame's 48 px/800 (Q-02, a token change).
- The score value spells its line box as `leading-7` rather than referencing the price token: Tailwind
  cannot point a utility at a custom property without a new theme entry, and a token change was out of
  scope. The comment in `featured-build-card.tsx` records the coupling.
- The breakpoint additions extend the existing sweep in `e2e/homepage-i18n.spec.ts` rather than
  introducing a second overflow spec, so there is one place that answers "does any width scroll?".

**Card alignment is intra-card, not cross-card.** The `min-h-7 leading-7` box guarantees two things:
inside one card the score and the price values share a single 28 px line box, and the score keeps
that height when the card has no price, so an absent price does not shorten the row. It does **not**
guarantee that the rows of all three cards sit on one baseline: a card whose title wraps or whose
pills or rationale are taller pushes its own rows lower, and the cards stay the same height only
because the grid stretches them. Cross-card row alignment was not part of Step 3.4 and is not
claimed; it would need a separately approved geometry change.

## J. Open items needing owner approval

1. Render the real rank-1 preset inside `HeroRigPreview` (`Homepage.hero.preview.score`).
2. Enable a mobile discovery section, or a mobile variant of the resolution tiles (Q-20).
3. Approved photography for the three media slots (Q-03).
4. Raise the hero heading to the frame's 48 px/800, if Q-02 is to be revisited.

## K. Git state

The step's nine commits sit on `feature/v2-design` above the `3a65bad` baseline, and **the branch is
pushed**:

| Fact                                    | Verified value                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| Final Step 3.4 commit                   | `f68cb79` (`docs(web-v2): record the Step 3.4 refinement and its measured gates`) |
| Remote head, `origin/feature/v2-design` | `f68cb79486a60d8eaf86adb620ec814897bcc779`                                        |
| Local `HEAD`                            | the same commit — ahead 0, behind 0                                               |
| Commits above the baseline              | nine (`git rev-list --count 3a65bad..HEAD`)                                       |
| Working tree                            | clean                                                                             |

```
f68cb79 docs(web-v2): record the Step 3.4 refinement and its measured gates
a67f9ee docs(web-v2): record the imagery decision and pin it in a test
c552ca0 test(web-v2): enforce the design system's logical-direction rule
930a100 test(web-v2): cover 768 and 1024 and pin the lg boundaries
9bf897d fix(web-v2): align the build card's numbers and unclamp spec pills
eec672a fix(web-v2): compose the hero heading on two lines at the spec's padding
6e95ab3 feat(web-v2): give the homepage one section-header system
12b5350 chore(web-v2): let the screenshot harness target a subdirectory
6cb7a7d docs(web-v2): add the Step 3.4 homepage refinement plan
3a65bad Step 3.3.1 (baseline, on the remote)
```

**Corrected in Step 3.4.1.** An earlier revision of this section said "nothing was pushed" and that
`origin/feature/v2-design` still pointed at `3a65bad`. Both statements were true when written and
became false when the owner authorised the push; they are replaced above with values read from
`git rev-parse`. The follow-up's own commit is recorded in
`docs/superpowers/specs/step-3-4-1-verification-report.md` §J rather than being folded into this
historical list.

## L. Verdict

**PASS** — every gate is green with measured counts, no regression appears at any of the seven widths
in either locale, and no token, API, schema, manifest or V1 file changed. The four items in §J are
owner decisions the step deliberately did not take, not defects; the Arabic copy remains unsigned,
which is the same standing gate Step 3.3 closed its report on.
