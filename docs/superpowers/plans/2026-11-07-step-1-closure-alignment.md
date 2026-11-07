# Step 1 Closure — Specification Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the independent review's documentation findings on the shipped V2 homepage — reconcile the pathways/trust order, correct the stale specification status, record the Arabic sign-off gate and the deferred polish — and establish, or explicitly block, real-API staging readiness.

**Architecture:** No product code changes. Three doc edits in one contract file, one browser assertion that pins the document order the contract now states, one readiness record, one Arabic gate record. Everything else in the brief is a verification or a stop-and-report gate.

**Tech Stack:** Next.js 16 App Router + Tailwind v4 (`apps/web-v2`), Vitest 5 (jsdom), Playwright 1.65, npm scripts in `apps/web-v2/package.json`.

**Spec:**
- `apps/web-v2/docs/sections/01-homepage.md` — the authoritative homepage contract being amended
- `apps/web-v2/docs/sections/01-homepage-api-mapping.md` — field-level API mapping
- `apps/web-v2/docs/homepage-arabic-review.md` — Arabic sign-off record
- The originating brief is the "Step 1 Closure — Specification Alignment and Real API Readiness" text (not yet a tracked file); each task below names the brief section it satisfies.

## Global Constraints

- Branch `feature/v2-design`; baseline `0dff27b`. Never amend, rebase or rewrite an existing commit; each task adds one commit.
- **Every command runs in `apps/web-v2`.** The repo root has no build, lint, typecheck or test command (AGENTS.md §6). Prefix each command with `cd apps/web-v2 && `.
- Never stage or modify `apps/web-v2/app/[locale]/simulateur-preview/` or `docs/superpowers/` (brief §1.5). The only permitted untracked paths before and after this pass are exactly those two.
- This plan file lives under `docs/superpowers/`. It is working material: never `git add` it, and never edit `docs/superpowers/plans/2026-11-07-homepage-v2-step-1.md`.
- Settled and **not** reopened by this plan: 12 000 MAD ceiling with the highest preset at or below it, never the median, never a row above; the three peers `GAMING`, `OFFICE`, `WORKSTATION` in that order; `builds[0].price_status` as the only badge source; no resolution field, tile or filtering; no recommendation `POST`; `NEXT_PUBLIC_HOMEPAGE_SUBMIT=off`; the three localized H3 titles; the neutral banner label; exact `fr`/`ar` key and placeholder parity.
- No change to API schemas, generated types (`lib/api/schema.d.ts`), endpoints, `apps/api/**`, `apps/web/**`, `.github/workflows/**`, `app/globals.css`, design tokens, card geometry, `PriceStatusBadge`, the card variants or the `recommended-build-section.tsx` file length.
- **Do not touch three adjacent inconsistencies** — they are owned elsewhere and would re-open settled decisions: the `four-tile` wording in §7 (the shipped grid is three tiles; resolved as conflict C3 in the Step 1 plan), the `shortcuts` step in the §16.1 390 px bullet (hidden by Q-20/§5.4), and the `(14)` guides count (Q-11).
- All three edited documents are **LF**, measured 2026-11-07 (`grep -qU $'\r'` prints nothing). Still anchor every edit inside **one physical line**: `str_replace`'s matcher ignores whitespace, so an anchor spanning a line wrap silently joins the two lines. The one edit that must span a wrap (§16.1) uses an exact `node -e` replacement that re-wraps deliberately.
- Prettier runs as `npm run format:check` (there is no `prettier` script), and it covers `docs/**` and `e2e/**`.

---

## Review Focus

The five conditions most likely to bite a person executing or reading this closure, with the step that pins each:

| Input / condition | Behaviour a reasonable person expects | Pinned by |
| ----------------- | ------------------------------------- | --------- |
| The spec states one section order while the DOM renders another | A reader following the Definition of Done builds the page the contract claims, not the previous draft | Task 2 Step 1 order assertion + Step 4 re-run |
| No staging API origin exists, so the "real API" smoke gets pointed at the shared-database demo origin | The report says BLOCKED and names the missing input; it never reports demo-origin traffic as staging verification | Task 4 Step 1–2 (`RESULT: BLOCKED` is the expected outcome today) |
| `NEXT_PUBLIC_API_BASE_URL` is inlined at build time, so an env change alone leaves the bundle pointing at `localhost:3000` | A smoke run proves the built bundle targets the intended origin before any data check is judged | Task 4 Step 3 asset grep |
| Arabic copy changes and the review table silently drifts from `ar.json` | The row count, and therefore what a reviewer approves, matches what ships | Task 5 Step 2 parity count (99 = 99 today) |
| The staging API rejects the browser's `Origin` | A CORS rejection is reported as CORS, not as "the frontend cannot read details" | Task 4 Step 4 preflight observation |

---

### Task 1: Verify the branch baseline

**Files:** none (no commit — this task changes nothing).

**Interfaces:**
- Produces: `BASE=0dff27b` confirmed as HEAD or an ancestor; the exact permitted untracked list, used by Task 7's scope audit.

- [ ] **Step 1: Fetch the remote branch**

```bash
cd apps/web-v2 && cd ../.. && git fetch origin feature/v2-design
```

Expected: `From https://github.com/ibrahim-lahribli/morocco-pc` plus any new refs, or silence when already current. A fetch failure (no credential, offline) is recorded in the final report and does **not** stop the pass — the baseline check below is against the local object database.

- [ ] **Step 2: Confirm the branch, HEAD and ancestry**

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git merge-base --is-ancestor 0dff27b HEAD && echo "0dff27b is an ancestor"
git --no-pager log --oneline 0dff27b..HEAD
```

Expected: `feature/v2-design`; HEAD `0dff27babd73cb2fe61da5311edd33077b291597`; the ancestry line printed; an **empty** `0dff27b..HEAD` log. If the log is non-empty, read those commits before continuing and name them in the final report.

- [ ] **Step 3: Confirm the working tree contains only the two permitted untracked paths**

```bash
git status --porcelain
```

Expected, exactly:

```
?? apps/web-v2/app/[locale]/simulateur-preview/
?? docs/superpowers/
```

Any tracked modification is a stop-and-report condition (brief §1.2/§1.4): report it, do not clean it up.

---

### Task 2: Reconcile the pathways/trust order (brief §2)

**Files:**
- Modify: `apps/web-v2/docs/sections/01-homepage.md` (§1.1 reconciliation note, §7 desktop-composition sentence, §16.1 1440 px bullet)
- Modify: `apps/web-v2/e2e/homepage.spec.ts` (one order test)

**Interfaces:**
- Consumes: section ids measured in the shipped tree — `#configurations` (`components/home/recommended-build-section.tsx`), `#pathways` (`components/home/discovery-pathways.tsx`), `#confiance` (`components/home/trust-highlights.tsx`), rendered in that order by `app/[locale]/page.tsx` lines 59–61.
- Produces: an e2e assertion that fails if the DOM order ever stops matching the contract; nothing imported by later tasks.

- [ ] **Step 1: Add the order assertion to `e2e/homepage.spec.ts`**

Inside the existing top-level `test.describe`, add — with `import { stubHomepageApi } from "./support/homepage-api";` at the top, matching `e2e/homepage-builds.spec.ts`:

```ts
test("renders discovery pathways between the configurations and the trust section", async ({ page }) => {
  await stubHomepageApi(page);
  await page.goto("/fr");

  const follows = await page.evaluate(() => {
    const ids = ["#configurations", "#pathways", "#confiance"].map((s) => document.querySelector(s));
    if (ids.some((el) => el === null)) return null;
    const [configurations, pathways, trust] = ids as HTMLElement[];
    return (
      Boolean(configurations.compareDocumentPosition(pathways) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      Boolean(pathways.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  });

  expect(follows).toBe(true);
});
```

DOM order, not pixel position: the requirement is document order, so it must hold at every breakpoint and without layout.

- [ ] **Step 2: Run it and confirm the shipped order**

```bash
cd apps/web-v2 && npx playwright test e2e/homepage.spec.ts
```

Expected: 4 passed. This is a **characterization** test — it goes green immediately because the shipped DOM already renders configurations → pathways → trust. If it FAILS, stop: the shipped order is not what this closure assumes, so the document must not be edited to match an unverified DOM. Report the failure with the observed order.

- [ ] **Step 3: Add the §1.1 reconciliation note**

In `docs/sections/01-homepage.md`, insert this block immediately before the line `### 1.2 Fidelity deltas between the frames and the Step 0 token set`:

```markdown
**Numbered order is authoritative where a frame's node order differs.** The frame audits
above are the design reference; the shipped page renders recommended configurations, then
discovery pathways, then trust, following the eight-section sequence in this list, §7 and
the §16.1 acceptance checks. A frame's node order is never edited to match the
implementation — it records what the design file contains.
```

Do not alter the desktop or mobile node lists themselves. The desktop frame genuinely orders trust (`19:371`) before categories & usages (`19:426`); rewriting that would falsify the audit.

- [ ] **Step 4: Fix the §7 prose**

Replace, inside the single line that begins ``(`19:426`) after the trust section,``:

- old: `` (`19:426`) after the trust section, with actions that preselect the corresponding finder``
- new: `` (`19:426`) after the recommended configurations and before the trust section, with actions that preselect the corresponding finder``

Leave the rest of the paragraph — including `four-tile` — unchanged (constraint: C3 is settled).

- [ ] **Step 5: Fix the §16.1 1440 px bullet**

This bullet wraps across three physical lines, so use an exact replacement rather than a whitespace-insensitive one:

```bash
cd apps/web-v2 && node -e "
const fs=require('fs');
const p='docs/sections/01-homepage.md';
const old='- [ ] At 1440 px the composition matches \`19:3\`: banner, hero with preview card and\n      side-by-side finder, three use-case cards, trust in three columns, desktop\n      Catégories & usages grid, four guides in a row, gradient CTA.';
const neu='- [ ] At 1440 px the composition matches \`19:3\`: banner, hero with preview card and\n      side-by-side finder, three use-case cards, the desktop Catégories & usages grid,\n      trust in three columns, four guides in a row, gradient CTA.';
const s=fs.readFileSync(p,'utf8');
if(!s.includes(old)){console.error('ANCHOR NOT FOUND');process.exit(1)}
fs.writeFileSync(p,s.replace(old,neu));
console.log('§16.1 bullet reordered');
"
```

Expected: `§16.1 bullet reordered`. A non-zero exit means the anchor does not match — re-read the bullet and fix the anchor; never edit around it.

- [ ] **Step 6: Verify the three edits and formatting**

```bash
cd apps/web-v2 && grep -n "after the recommended configurations and before the trust" docs/sections/01-homepage.md
grep -n "use-case cards, the desktop Catégories & usages grid" docs/sections/01-homepage.md
grep -n "Numbered order is authoritative" docs/sections/01-homepage.md
grep -c "after the trust section" docs/sections/01-homepage.md
npx prettier --check docs/sections/01-homepage.md
git --no-pager diff --stat docs/sections/01-homepage.md e2e/homepage.spec.ts
```

Expected: three matches; `0` for the retired phrase; `All matched files use Prettier code style!`; and a diff confined to those two files. If Prettier fails, run `npx prettier --write` on that one file and re-check.

- [ ] **Step 7: Re-run the spec and commit**

```bash
cd apps/web-v2 && npx playwright test e2e/homepage.spec.ts
git add apps/web-v2/docs/sections/01-homepage.md apps/web-v2/e2e/homepage.spec.ts
git commit -m "docs(web-v2): order discovery pathways before the trust section"
```

Expected: 4 passed.

---

### Task 3: Correct the stale specification status (brief §3)

**Files:**
- Modify: `apps/web-v2/docs/sections/01-homepage.md` (the `**Status:**` block, lines 3–4)

**Interfaces:**
- Consumes: Task 2's file state.
- Produces: the status text quoted in the final report.

- [ ] **Step 1: Replace the status block verbatim**

Old (two physical lines):

```markdown
**Status:** specification only. Nothing in this document is implemented. It is ready for
human review, then for the Step 1 implementation agent.
```

New:

```markdown
**Status:** **approved specification, Step 1 implemented.** The Step 1 homepage ships on
branch `feature/v2-design` (baseline `0dff27b`), and this document remains the
authoritative product and acceptance contract for it. Two release-readiness checks are
still outstanding: integration against the real API (the independent review ran against
stubbed `/v1/**` responses) and the native-language review of the Arabic copy recorded in
`../homepage-arabic-review.md`. Neither weakens an approved requirement in this document.
```

This states all four required facts — approved specification, Step 1 exists on the branch, the document stays authoritative, and the two open release checks — without weakening any requirement.

- [ ] **Step 2: Confirm no leftover staleness, and that the API mapping needs no change**

```bash
cd apps/web-v2 && grep -n "specification only\|Nothing in this document is implemented" docs/sections/01-homepage.md
grep -n "^**Status:**\|not implemented\|nothing in this document" -i docs/sections/01-homepage-api-mapping.md
grep -n "Status:" docs/homepage-arabic-review.md
```

Expected: the first two commands print nothing (no stale status), the third prints nothing — the Arabic doc states its gate in a blockquote, not a `Status:` line. **The API mapping is left unchanged.** Measured 2026-11-07: it carries no status line and no "not implemented" claim; its "Rules this document assumes" section is still true. Report this as a checked-and-no-change-needed finding, per brief §3's "correct it only if necessary".

- [ ] **Step 3: Commit**

```bash
cd apps/web-v2 && npx prettier --check docs/sections/01-homepage.md
git add apps/web-v2/docs/sections/01-homepage.md
git commit -m "docs(web-v2): record the homepage spec as approved and implemented"
```

---

### Task 4: Real API staging smoke (brief §5) — gate, and record the outcome

**Files:**
- Create: `apps/web-v2/docs/staging-smoke.md`

**Interfaces:**
- Consumes: Task 1's baseline; `lib/api/config.ts` (`NEXT_PUBLIC_API_BASE_URL` is build-time) and `.env.example`.
- Produces: a one-file readiness record whose `RESULT:` line is either `BLOCKED`, `PASS` or `FAIL`, and the per-check table the final report quotes.

**Measured precondition (2026-11-07):** no staging API base URL exists anywhere in this repository. `apps/web-v2` contains only `.env.example` (defaults `http://localhost:3000`), no `.env.local`, no occurrence of `staging`, and no deployed web-v2 environment. The only API origins named in repo docs are `https://morocco-pc.onrender.com` (a Free demo on the **shared** database, spins down after 15 idle minutes, serves `launch-v2@2.4.0`) and the EU host. Neither is declared staging. **Do not reuse the demo origin as staging without the owner naming it so** — that is precisely the silent substitution brief §5 forbids.

- [ ] **Step 1: Re-confirm the precondition, read-only**

```bash
cd apps/web-v2 && ls -a | grep -i "^\.env"
grep -rin "staging" --include="*.md" --include="*.ts" --include="*.yml" . | grep -v node_modules
grep -n "API_BASE_URL" ../.github/workflows/web-v2.yml .env.example | head
```

Expected today: only `.env.example`; no `staging` hits; no API origin in the web-v2 workflow. If an owner-supplied origin appears in `.env.local` or a workflow, use it and skip to Step 3.

- [ ] **Step 2: Write the blocked record and stop**

Create `apps/web-v2/docs/staging-smoke.md` with exactly this shape (fill the date; list only inputs that are genuinely missing):

```markdown
# Homepage — real API staging smoke

**Date:** 2026-11-07
**Branch:** `feature/v2-design` @ `0dff27b`
**RESULT: BLOCKED — no staging API origin is configured.**

The independent homepage review ran against stubbed `/v1/**` responses. This record exists
so that a real-API verification is a recorded gate rather than an assumed pass.

## Missing inputs

1. **A staging API origin.** No environment variable, workflow or document in this
   repository names one. `NEXT_PUBLIC_API_BASE_URL` defaults to `http://localhost:3000`.
2. **That origin's `ALLOWED_ORIGINS` entry for the browser origin under test**
   (`http://localhost:3220` for a local run, or the deployed frontend origin). The API
   rejects an unlisted browser Origin, which would read as a frontend defect.
3. **A statement that the chosen origin is not the shared-database demo origin**
   (`https://morocco-pc.onrender.com`). Using it would verify against live shared data
   under a different name; the closure brief forbids that substitution.

## Checks that remain unverified

- [ ] `GET /v1/meta/options` reaches the real API
- [ ] `GET /v1/presets` for `GAMING`, `OFFICE`, `WORKSTATION` (`use_case` + `currency` only)
- [ ] One `GET /v1/recommendations/{id}` per returned `recommendation_id`
- [ ] `catalog_version` consistent with the detail reads
- [ ] Build-level `price_status` renders through `builds[0]` only
- [ ] CORS, environment configuration and connectivity
- [ ] No recommendation `POST` on load or on finder interaction

Mocked coverage for the negative cases lives in the unit and Playwright suites and is
**not** a substitute for these checks.
```

Replace the whole checklist with `[x]` rows and verdicts when an origin is supplied. Then report the blocker with the three inputs named and commit:

```bash
cd apps/web-v2 && npx prettier --check docs/staging-smoke.md
git add apps/web-v2/docs/staging-smoke.md
git commit -m "docs(web-v2): record the real-API staging gate as blocked"
```

- [ ] **Step 3: When an origin IS supplied — rebuild, then prove the bundle targets it**

```bash
cd apps/web-v2 && NEXT_PUBLIC_API_BASE_URL=https://<staging-host> npm run build
grep -rl "<staging-host>" .next/static | head -3
NEXT_PUBLIC_API_BASE_URL=https://<staging-host> npm run start
```

Expected: the host appears in the built client assets. Without this grep the smoke is meaningless — an env var set only at `start` cannot change a value inlined at build time.

- [ ] **Step 4: Run the read-only checks and judge each one separately**

Open `http://localhost:3220/fr` in the browser panel and read the network log, then record `PASS` / `FAIL` / `BLOCKED` per check:

1. `GET /v1/meta/options` → 200; `currencies` includes `MAD`.
2. Three `GET /v1/presets?use_case=<X>&currency=MAD` → 200 each, no extra query parameter.
3. One `GET /v1/recommendations/{id}` per selected `recommendation_id` → 200.
4. The `catalog_version` in the three preset responses agrees with what the detail queries are keyed on (`["recommendation", id, catalogVersion]`).
5. Each badge matches that card's `builds[0].price_status`; no badge where the build list is empty.
6. **Record the response `Access-Control-Allow-Origin` header first.** A missing or wrong value is a CORS finding, not a data finding — say so instead of reporting "details unreadable".
7. Zero `POST` requests in the whole session, on load and after a finder interaction.

Never write to the staging API: no `POST`, no swap, no seed.

- [ ] **Step 5: Commit the result**

Update `docs/staging-smoke.md` with the origin **host only** (never credentials), the per-check table, and `RESULT: PASS` or `RESULT: FAIL — <first failing check>`. Commit as in Step 2 with the message `docs(web-v2): record the real-API staging smoke result`.

---

### Task 5: Arabic production readiness (brief §6)

**Files:**
- Modify: `apps/web-v2/docs/homepage-arabic-review.md` (sign-off block)

**Interfaces:**
- Consumes: `messages/ar.json`, `messages/fr.json`, `tests/i18n/messages.test.ts`, `e2e/homepage-i18n.spec.ts`.
- Produces: the sign-off block the owner fills when a reviewer is booked.

- [ ] **Step 1: Prove the parity and RTL coverage that already exists**

```bash
cd apps/web-v2 && npx vitest run tests/i18n
grep -n "test(" e2e/homepage-i18n.spec.ts
```

Expected: 3 tests pass (same keys in both locales, no empty message, same placeholders). Five Arabic specs exist: typeface + `dir="rtl"`, RTL mirroring, locale switch, no horizontal overflow at every breakpoint, and final CTA/footer clear of the bottom nav at 360.

- [ ] **Step 2: Prove the review table matches the dictionary**

```bash
cd apps/web-v2 && node -e "
const ar=require('./messages/ar.json');let n=0;
const walk=(o,p)=>{for(const k of Object.keys(o)){const v=o[k];const key=p?p+'.'+k:k;if(v&&typeof v==='object')walk(v,key);else n++;}};
walk(ar.Homepage,'Homepage');console.log('ar leaves:',n);
" && grep -c '^| `Homepage\.' docs/homepage-arabic-review.md
```

Expected: `ar leaves: 99` then `99` (measured 2026-11-07). Nothing pins this today — the doc says "regenerate after any copy change" and no generator exists. If the two numbers differ, do not edit the table by hand from memory: list the missing/extra keys by diffing the flattened key set against the table's first column, then report which copy change invalidated the table.

- [ ] **Step 3: Add the sign-off block**

Insert after the existing `**Rule.**` paragraph:

```markdown
## Sign-off

| Field      | Value                                                        |
| ---------- | ------------------------------------------------------------ |
| Reviewer   | — (native Arabic speaker, not the implementing agent)        |
| Date       | —                                                            |
| Scope      | every `Homepage` key in the table above                      |
| Status     | **PENDING — blocks the Arabic production release**            |

This table is not approved by default and is never self-approved. The French homepage is
unaffected by this gate: it is implemented and reviewed on `feature/v2-design`.
```

- [ ] **Step 4: Confirm nothing claims approval, and commit**

```bash
cd apps/web-v2 && grep -n "PENDING\|not production-ready\|never self-approved" docs/homepage-arabic-review.md
npx prettier --check docs/homepage-arabic-review.md
git add apps/web-v2/docs/homepage-arabic-review.md
git commit -m "docs(web-v2): record the Arabic sign-off field and keep the gate open"
```

Expected: three matches; Prettier clean. The Arabic release remains `BLOCKED` in the final report — a blocker for Arabic production readiness, not for the shipped French implementation.

---

### Task 6: Record the deferred cosmetic polish (brief §7)

**Files:**
- Modify: `apps/web-v2/docs/sections/01-homepage.md` (new §19, appended after §18)

**Interfaces:**
- Consumes: Task 2/3's file state.
- Produces: the two-item backlog the next pass can pick up, with no geometry change here.

- [ ] **Step 1: Append the section**

```markdown
## 19. Deferred cosmetic polish (not release-gating)

Two desktop-only presentation defects were observed during the independent review. They are
recorded here so they are not lost and are deliberately **not** fixed in the closure pass:
changing them would move approved card geometry.

1. **Spec-pill wrapping at desktop widths.** Four pills can wrap to a second line in the
   third card, which makes the three peer cards read as unequal heights.
2. **Score/price row offset.** The score row and the price row do not share a baseline
   across the three cards when a rationale is present.

Any fix belongs to a design-reviewed change that keeps the three cards at equal weight, may
not alter the token set, and must re-run `e2e/homepage-builds.spec.ts` plus
`e2e/homepage.spec.ts`. A visible loading indicator or `aria-busy` redesign is a separate
proposal and is not part of this backlog.
```

- [ ] **Step 2: Verify the addition is additive and commit**

```bash
cd apps/web-v2 && git --no-pager diff docs/sections/01-homepage.md
npx prettier --check docs/sections/01-homepage.md
git add apps/web-v2/docs/sections/01-homepage.md
git commit -m "docs(web-v2): record the deferred homepage polish items"
```

Expected: the diff shows only additions at the end of the file.

---

### Task 7: Gates, settled-decision audit and scope review (brief §4, §8)

**Files:** none changed.

**Interfaces:**
- Consumes: every prior task.

- [ ] **Step 1: Run every gate, recording each exit status separately**

```bash
cd apps/web-v2 && for c in typecheck lint format:check check:api-types test build test:e2e; do
  npm run "$c"; echo "EXIT $c=$?"
done
```

Report each line as PASS/FAIL with its status. A failure that predates this branch is reported with the exact command rather than folded in or "fixed" by weakening a test.

- [ ] **Step 2: Audit the settled decisions against the tests that already pin them**

```bash
cd apps/web-v2 && npx vitest run tests/homepage/builds.test.ts tests/homepage/recommended-build-section.test.tsx tests/homepage/finder-schema.test.ts
npx playwright test e2e/homepage-builds.spec.ts e2e/homepage-finder.spec.ts
grep -rn "1080p\|1440p" components app lib | grep -v node_modules
grep -n "HOMEPAGE_SUBMIT" lib/homepage/config.ts .env.example
```

Expected: all green; `1080p`/`1440p` appear only in the dictionary and the Arabic review doc, never in a component; `NEXT_PUBLIC_HOMEPAGE_SUBMIT=off` in `.env.example` and read as `=== "on"`. These four commands are the evidence that the closure did not reopen a settled decision — do not add new tests for them.

- [ ] **Step 3: Audit scope**

```bash
cd apps/web-v2 && git --no-pager diff --name-only 0dff27b
git status --porcelain
git --no-pager log --oneline 0dff27b..HEAD
```

Expected: changed paths are only `apps/web-v2/docs/**` and `apps/web-v2/e2e/homepage.spec.ts`; `git status` still shows exactly the two permitted untracked paths; four closure commits, none of them an amend.

- [ ] **Step 4: Report**

Report, with no claim beyond the evidence: gates (each PASS/FAIL + command), spec alignment (three edits + the pinning test), status correction (the API mapping checked and unchanged), staging (`BLOCKED` with the three missing inputs, or the per-check table), Arabic (`parity 99/99`, RTL/typography specs present, sign-off PENDING = Arabic production blocker), and the two deferred polish items.

---

## Out of scope (do not implement)

- Any edit to `apps/web-v2/components/**`, `lib/**`, `app/**`, `messages/**` or `globals.css`.
- `simulateur-preview/`, `docs/superpowers/` and `docs/superpowers/plans/2026-11-07-homepage-v2-step-1.md`.
- Re-testing or re-specifying the resolution, submission, badge or budget rules — §4 of the brief lists them as settled, and Task 7 Step 2 proves them.
- Fixing the tile count, the `shortcuts` DoD wording or the guides count (§7 of this plan's Global Constraints).
- Any `POST`, seed, migration or write against any API or database.
