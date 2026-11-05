# G3 review pack — the web shell

**Status: evidence complete, NOT passed.** G3 is a human gate (`docs/web-v2/PLAN.md`): only the
owner marks it passed. Nothing in this file does. It exists so every claim about the shell can be
read as a measurement, and so the images the review is about are one click away.

- Measured on `2026-11-05`, on the built app (`npm run build`), headless Chromium + headless WebKit.
- Base commit: `3d9256c46bd2f34ba4e197dfbddb83dfbab0cf51` (= `web-redesign` = `origin/web-redesign`).
- Branch the evidence was produced on: see §9 "Worktree note" — `web-redesign` was checked out in
  another worktree, so the commit landed on the chat branch whose HEAD **is** that commit.
- No app code was changed: `apps/web/app`, `apps/web/components` and `apps/web/lib` are untouched.
  The deliverables are two specs, one script, this document and `design/g3-review/`.

---

## 1. What was run

Every command below was run, in this order, from `apps/web` on the commit above.

| # | Command | Result |
|---|---|---|
| 1 | `npm ci` | PASS — 1 071 packages, 49 s |
| 2 | `npm run build` | PASS (exit 0) |
| 3 | `node scripts/g3-capture.mjs` | PASS (exit 0) — 65 images, **1 814 KB** of 3 072 KB, WebKit **INSTALLED** |
| 4 | `npx playwright test g3-shell.spec.ts g3-arabic-price.spec.ts --reporter=list` | **FAIL** (exit 1) — **36 passed / 12 failed**, 12.2 s. The 12 are 3 distinct assertions × 4 projects (360 / 390 / 768 / 1280), i.e. **3 real findings, reproduced at every viewport project** |
| 5 | `node -e` PNG header probe (`design/g3-review/og/*`) | 1 200×630 on both cards |

The 12 failures are reported below as **FAIL** with their measurements. They were **not fixed**:
this pack measures, it does not repair. Two of the three are findings about the app; one is
check A's assertion as worded (see §4.3, which explains why the wording and the render disagree).

To re-run exactly this pack:

```bash
cd apps/web
npm ci
npm run build
node scripts/g3-capture.mjs
npx playwright test g3-shell.spec.ts g3-arabic-price.spec.ts --reporter=list
```

Ports `3210` (app), `3211` (mock the server reads) and `3000` (mock the browser calls) must be free:
`g3-capture.mjs` starts its own three servers and refuses to photograph a server it did not start;
Playwright starts its own via `webServer`.

---

## 2. The task table

| Task | Deliverable | Verdict |
|---|---|---|
| 1 — screenshots | `design/g3-review/{fr,ar}/*.png` — viewport + full-page, 4 routes × 4 viewports × 2 locales; WebKit iPhone captures of home | **PASS** — 65 files, 1 814 KB (< 3 MB), WebKit installed and used |
| 2 — Stitch comparison | `design/g3-review/compare/*.png` — 6 composites (header / tab bar / footer × fr, ar) | **PASS** — each labelled with route, viewport and locale |
| 3 — `e2e/g3-shell.spec.ts` | 10 `@layout` tests, fr + ar | **FAIL** — 9 of 10 assertions hold; the touch-target test fails on one Arabic header link (§3, S7) |
| 4 — Arabic price direction (check A) | 2 `@layout` tests + `ar/arabic-price.ar.360x800@3x.png` | **FAIL as worded** — the number/unit order is correct (§4.1, §4.2 pass); the terminal stop of `د.م.` sits left of the م (§4.3 fails). See the note there before reading this as a defect |
| 5 — Arabic OG images (check B) | `og/og-result.ar.1200x630.png`, `og/og-preset.ar.1200x630.png` | **PASS** for the mechanical half (both 1 200×630, real glyphs, `د.م.` present); the *visual* judgement is in §5 and is a REPORT |
| 6 — this document | `docs/web-v2/G3_REVIEW_PACK.md` | **PASS** |

---

## 3. Assertion table (Task 3)

`e2e/g3-shell.spec.ts`, `@layout`, run in all four viewport projects. Every test pins its own
viewport, so the value is the same in each project — that is why one number is quoted, not four.

| # | Assertion | Measured | Verdict |
|---|---|---|---|
| S1 | Header height at 360 px is 64 ± 1 | `/fr` **64.00 px**, `/ar` **64.00 px** | **PASS** |
| S2 | `scrollWidth <= innerWidth` at 360 and 768, on home / contact / guides / result, both locales (16 combinations) | **16 / 16 with scrollWidth == innerWidth** (0 px overflow everywhere) | **PASS** |
| S3 | The bar has exactly 5 tabs at 360 | 5 links, both locales | **PASS** |
| S4 | Each tab label is on one line (Range → one line box) | fr `Accueil` 34×12, `Pièces` 30×12, `Configurer` 49×12, `Guides` 32×12, `Gardés` 33×12 · ar `الرئيسية` 31×13, `القطع` 23×13, `أنشئ` 19×13, `الأدلة` 20×13, `المحفوظة` 39×13 — **1 line box each** | **PASS** |
| S5 | No label is truncated (`scrollWidth <= clientWidth + 1`) | scrollWidth == clientWidth on all ten; `text-overflow: clip` | **PASS** |
| S6 | At 768 the bar is not displayed and the header nav is | bar `hidden`, header nav `visible`; `<body>` padding-bottom **0 px** (reserved space released) | **PASS** |
| S7 | Every tab and visible header control is ≥ 44×44, at 360 and 768 | 8 controls at 360, 6 at 768. All ≥ 44 high. **One is under 44 wide**: `/ar` @768 header link `الأدلة` = **43.4 × 44.0 px** (§3.1) | **FAIL** |
| S8 | In `/ar` the tab order along x is the mirror of `/fr` | fr `39.20, 109.59, 179.99, 250.39, 320.80` · ar `320.80, 250.41, 180.01, 109.61, 39.20`. Descending vs ascending; **max mirror error 0.02 px** at 360 px wide | **PASS** |
| S9 | The locale switch position is mirrored | switcher centre fr **277.98**, ar **83.02** (viewport centre 180) — the side swaps | **PASS** |
| S10 | The current route's tab carries `aria-current="page"` **and** a non-colour cue | `/fr` home → `Accueil`, `/fr/guides` → `Guides`, `/ar` home → `الرئيسية`, `/ar/guides` → `الأدلة`. **Cue: the label is `font-weight: 600` (semibold) where the others are `500` (medium)** — so the state survives greyscale; colour is the second cue, not the only one | **PASS** |
| S11 | Tabbing to each tab and header control gives a visible indicator | **8 of 8 reached by Tab, both locales**, each with `outline: solid 2px` (colour `lab(17.06 39.73 -66.43)`; `box-shadow: none`). Screenshot: `fr/focus.fr.360x800.png`, `ar/focus.ar.360x800.png` | **PASS** |
| S12 | The viewport meta opts into `viewport-fit=cover` | both locales: `width=device-width, initial-scale=1, viewport-fit=cover` | **PASS** |
| S13 | The tab bar's bottom padding uses `env(safe-area-inset-bottom)` | the class names `pb-[env(safe-area-inset-bottom,0px)]`; **computed `padding-bottom: 0px`** because a headless viewport has no inset. The declaration is pinned; the *effect* needs a device (§6) | **PASS** (declaration only) |
| S14 | At 360, scrolled to the bottom of a long page, the last footer element ends above the bar | `/fr/guides`: last footer element bottom **703.0 px** vs bar top **719.0 px** → **16.0 px of clearance**. `/ar/guides`: **703.4** vs **719.0** → **15.6 px** | **PASS** |
| S15 | Tab label size against `PLAN.md`'s 12 px caption floor | **fr 10 px** (line-height 12 px) · **ar 10 px** (line-height 13.2 px) — both **below** the floor | **REPORT** (not an assertion on the value; the report is the deliverable) |

### 3.1 The one failing touch target, in full

At 768 px, `/ar`, the header's `Guides` link:

| Control | Size |
|---|---|
| `/ar` @768 `الأدلة` (header nav) | **43.4 × 44.0 px** ← below the floor |
| `/ar` @768 `الأدلة` (tab cell, not displayed at 768) | — (the bar is `md:hidden`; not a target there) |
| `/fr` @768 `Guides` (header nav) | 62.3 × 44.0 px |

The link is `inline-flex h-tap px-2`: its height is the 44 px tap token and its width is
content-driven. `الأدلة` is a short word, so at its 14 px step it measures 27.4 px of text plus
2 × 8 px of padding = 43.4 px — **0.6 px under**. `PLAN.md`'s "Touch targets ≥ 44×44" is the
project's own (stricter than WCAG 2.2 AA, whose minimum is 24×24, which this passes).

Full 360 px and 768 px sizes, for the record:

`/fr` @360 — brand `118.0×44.0`, `Français` `73.6×44.0`, `العربية` `48.4×44.0`,
tabs `70.4×56.0` (raised `Configurer` `70.4×74.0`).
`/ar` @360 — brand `118.0×44.0`, `Français` `72.8×44.0`, `العربية` `51.2×44.0`,
tabs `70.4×56.0` (raised `أنشئ` `70.4×75.2`).
`/fr` @768 — brand `118.0×44.0`, `Composants` `99.2×44.0`, `Guides` `62.3×44.0`,
`Mes enregistrements` `155.5×44.0`, `Français` `73.6×44.0`, `العربية` `48.4×44.0`.
`/ar` @768 — brand `118.0×44.0`, `المكوّنات` `61.9×44.0`, **`الأدلة` `43.4×44.0`**,
`التكوينات المحفوظة` `119.6×44.0`, `Français` `72.8×44.0`, `العربية` `51.2×44.0`.

---

## 4. Check A — Arabic price direction

Measured with `Range.getClientRects()` over one-character ranges on the money text node, at 360 px,
`dir=rtl`. Positions are CSS px from the left edge of the viewport. The label is the **unit**
`د.م.`: the analysis anchors on that substring and walks back over the digit group belonging to it.

### 4.1 Result page — `/ar/config/3f5a1c7e-…`, build-card total

Text: `"8 594 د.م."` (U+202F between digit groups, U+00A0 before the unit).

| Char | `8` | U+202F | `5` | `9` | `4` | U+00A0 | `د` | `.` | `م` | `.` |
|---|---|---|---|---|---|---|---|---|---|---|
| x (left–right) | 67.22–78.88 | 78.86–81.28 | 81.28–92.94 | 92.92–104.58 | 104.56–116.22 | 62.38–67.22 | 53.41–62.39 | 48.58–53.42 | 37.83–48.59 | 33.00–37.84 |

| # | Assertion | Measured | Verdict |
|---|---|---|---|
| A1 | First digit is right of the unit's first letter | digit `8` at **x=67.22**, `د` at **x=53.41** → digits sit **13.81 px right** of the unit | **PASS** |
| A2 | No `.` is right of the digits | dots at x=48.58 and 33.00; the last digit ends at **116.22** | **PASS** |
| A3 | No `.` is left of the unit's last letter | the terminal dot (x=33.00, centre **35.42**) is left of `م` (centre **43.21**) — **7.79 px** left of the م's centre | **FAIL** |

### 4.2 Wizard budget display — `/ar/configurer?etape=budget&use_case=GAMING`, the hint line

Text: `"مبلغ صحيح، من 500 د.م. إلى 1 000 000 د.م."` — the first money run is `500 د.م.`.

| Char | `5` | `0` | `0` | U+00A0 | `د` | `.` | `م` | `.` |
|---|---|---|---|---|---|---|---|---|
| x | 244.19–251.31 | 251.30–258.89 | 258.88–266.45 | 240.80–244.19 | 235.19–240.81 | 231.73–235.20 | 225.06–231.75 | 221.61–225.08 |

| # | Assertion | Measured | Verdict |
|---|---|---|---|
| A4 | First digit is right of the unit's first letter | digit `5` at **x=244.19**, `د` at **x=235.19** | **PASS** |
| A5 | No `.` is right of the digits | dots at 231.73 and 221.61; digits end at **266.45** | **PASS** |
| A6 | No `.` is left of the unit's last letter | terminal dot (centre **223.14**) is left of `م` (centre **228.41**) — **5.27 px** | **FAIL** |

### 4.3 Read this before treating A3/A6 as a defect

The failing character is the **abbreviation's own terminal stop**, not a stray period:

- `د.م.` is four characters: `د` `.` `م` `.`. In an RTL run the *first logical* character paints
  **rightmost**, so the visual left-to-right order is `.` `م` `.` `د`.
- Reading the unit right-to-left therefore gives `د` `.` `م` `.` — **correct, and exactly what the
  screenshots show** (`ar/arabic-price.ar.360x800@3x.png`: digits at the right, then د, then a dot,
  then م, then the closing dot at the far left).
- The assertion as worded ("no `.` left of the label's last letter") forbids the leftmost glyph from
  being a dot. For a trailing stop in an RTL abjad that is the *correct* render, so the wording and
  the render cannot both be satisfied.
- The two checks that express the intent — **number to the right of the unit** (A1, A4) and **no dot
  escaping to the right of the digits** (A2, A5) — both pass, on both surfaces, and the dots stay
  inside the unit's own painted span (all four dot positions lie between the unit's left edge and
  the digits).

**Verdict reported: FAIL, as worded, with the measurement. Judgement is the owner's**; the reading
above is why it is listed under "Needs a human" (§6) rather than as a layout bug. If the intent was
"the dot must not escape the unit", the row is a PASS — say which reading the gate means and the
assertion gets fixed in the spec, not in the app.

---

## 5. Check B — the Arabic OG cards

Both fetched from the running build at 1 200 × 630 and inspected at full resolution.

| # | Check | Measured / observed | Verdict |
|---|---|---|---|
| B1 | Both cards are 1 200 × 630 | result **1 200×630**, 52 KB, `image/png` · preset **1 200×630**, 40 KB, `image/png` | **PASS** |
| B2 | Arabic glyphs are real: joined/isolated, no empty boxes, `د.م.` present | see below | **PASS** (with one REPORT, B3) |

**Result card** (`og/og-result.ar.1200x630.png`): brand tile `m` + `morocco-pc` top-left; two large
figures `8 594 د.م. / 15 000 د.م.`; a pale-blue `Vérifié` pill and `config / 3f5a1c7e`; a rule, then
`Configurations compatibles, prix en DH` (left) and `morocco-pc` (right).

**Preset card** (`og/og-preset.ar.1200x630.png`): brand tile `m` + `morocco-pc`; `9 000 د.م.`;
`Configurations compatibles`; footer rule with `Prix en DH` and `morocco-pc`.

- **Isolated or cursive?** The unit's two letters are `د` and `م`. **`د` is a non-joining letter in
  Arabic — it never connects to what follows — so the isolated shapes are correct here**, not a
  shaping failure. The `م` renders in its correct isolated/final shape. Nothing is `???` or a tofu box.
- **Empty boxes:** none, on either card.
- **Is `د.م.` present?** Yes — twice on the result card, once on the preset card, at full size.
- **Confidence: high.** Both PNGs were opened and read at native size; the glyph shapes, the
  numbers and the layout are unambiguous at 1 200 px wide.

**B3 (REPORT, not a pass/fail): the cards lay the money out LTR, the page lays it out RTL.** On the
cards the unit sits to the **right** of the digits (`8 594` then `د.م.`); on the page the unit sits
to the **left** (A1/A4). Both are internally consistent — the cards are LTR documents with French
supporting copy (`DEVIATIONS.md` D-28), the page is `dir="rtl"` — but the same amount therefore reads
in two different orders across the two surfaces. Whether the share card should mirror the page is a
design decision, not a measurement, so it is listed under "Needs a human".

---

## 6. Needs a human

These four cannot be settled by a headless browser on this machine. Each names what was measured and
what is missing.

1. **Safe area and the address bar on a real device.** `viewport-fit=cover` is in the meta (S12) and
   the bar's padding names `env(safe-area-inset-bottom)` (S13), but **every headless context reports
   the inset as 0** — Chromium's computed `padding-bottom: 0px`, and the WebKit iPhone captures have
   no cut-out either. So the *declaration* is proven and the *effect* is not: on a notched iPhone the
   bar must sit above the home indicator rather than under it, and the address bar's collapse must not
   move the bar. Needs iOS Safari and Android Chrome on hardware.
2. **Label legibility on a phone.** The tab labels compute to **10 px in both locales** (S15) —
   below the 12 px caption floor `PLAN.md` states, and below the "Arabic one step larger" note beside
   it (Arabic differs only in line-height: 13.2 px vs 12 px). The labels do fit on one line and are
   not clipped (S4/S5) and are set at weight 600, so this is a size question, not an overflow one.
   Only a human holding a phone can say whether 10 px is legible for `المحفوظة` on a 360 px screen.
3. **Arabic naturalness.** Nothing here reads Arabic as a native speaker. Open questions the review
   will answer: `أنشئ` as the "Configure" tab (imperative, "create"), `القطع` for "Pièces",
   `المحفوظة` for "Gardés"; whether `د.م.` is the intended abbreviation for the dirham versus
   `درهم` or `د.م` (no trailing dot); and the check-A terminal-dot question in §4.3. The Arabic copy
   is flagged `needs-review` in `PLAN.md` Phase 6 and this is that review.
4. **Visual fidelity against Stitch.** The six `compare/` images are the evidence; the departures are
   already recorded in `DEVIATIONS.md` (**D-22** drawn mark instead of the remote placeholder image,
   **D-23** no page subtitle, **D-24** header not `fixed`, **D-25** no bookmark badge, **D-26** no
   `© 2026` year line). Two differences a human will weigh:
   - the header drops the reference's bookmark-with-badge and account icons entirely;
   - the footer's legal row **wraps** at 360 px — `النماذج (تجريبي)` falls onto its own line, giving
     three text rows where the reference board has one © line plus one link row (visible in
     `compare/footer.ar.compare.png`).

---

## 7. Image index — all 65 files

`apps/web/design/g3-review/`. A `*.full.png` capture paints a `position: fixed` bar **once, at the
first viewport's bottom** — that is how full-page screenshots treat fixed elements, not a layout bug.

### 7.1 Viewport captures (32) — what a phone / tablet / desktop actually sees at first paint

| route | 360×800 | 390×844 | 768×1024 | 1280×800 |
|---|---|---|---|---|
| home (fr) | `fr/home.fr.360x800.viewport.png` | `fr/home.fr.390x844.viewport.png` | `fr/home.fr.768x1024.viewport.png` | `fr/home.fr.1280x800.viewport.png` |
| home (ar) | `ar/home.ar.360x800.viewport.png` | `ar/home.ar.390x844.viewport.png` | `ar/home.ar.768x1024.viewport.png` | `ar/home.ar.1280x800.viewport.png` |
| contact (fr) | `fr/contact.fr.360x800.viewport.png` | `fr/contact.fr.390x844.viewport.png` | `fr/contact.fr.768x1024.viewport.png` | `fr/contact.fr.1280x800.viewport.png` |
| contact (ar) | `ar/contact.ar.360x800.viewport.png` | `ar/contact.ar.390x844.viewport.png` | `ar/contact.ar.768x1024.viewport.png` | `ar/contact.ar.1280x800.viewport.png` |
| guides (fr) | `fr/guides.fr.360x800.viewport.png` | `fr/guides.fr.390x844.viewport.png` | `fr/guides.fr.768x1024.viewport.png` | `fr/guides.fr.1280x800.viewport.png` |
| guides (ar) | `ar/guides.ar.360x800.viewport.png` | `ar/guides.ar.390x844.viewport.png` | `ar/guides.ar.768x1024.viewport.png` | `ar/guides.ar.1280x800.viewport.png` |
| result (fr) | `fr/result.fr.360x800.viewport.png` | `fr/result.fr.390x844.viewport.png` | `fr/result.fr.768x1024.viewport.png` | `fr/result.fr.1280x800.viewport.png` |
| result (ar) | `ar/result.ar.360x800.viewport.png` | `ar/result.ar.390x844.viewport.png` | `ar/result.ar.768x1024.viewport.png` | `ar/result.ar.1280x800.viewport.png` |

**Look at:** the header row at 360 (brand + switcher only) vs 768 (page links appear, bar disappears);
the tab bar's five cells and the mirrored order on `/ar`; the absence of horizontal overflow (S2) on
the result page, the widest content of the four.

### 7.2 Full-page captures (16) — the whole document at the two phone widths

`fr/{home,contact,guides,result}.fr.{360x800,390x844}.full.png`
`ar/{home,contact,guides,result}.ar.{360x800,390x844}.full.png`

**Look at:** the footer band and the space reserved for the bar (S14: 15.6–16.0 px of clearance);
how much empty page the result route leaves below its last card.

### 7.3 Shell detail captures (9)

| File | What to look at |
|---|---|
| `fr/home.fr.360x800.bottom.png` | the home page scrolled to the footer, bar on screen — the footer/bar relationship in one frame |
| `ar/home.ar.360x800.bottom.png` | same, mirrored |
| `fr/footer.fr.360x800.png` | the footer element alone: three link rows and the price line |
| `ar/footer.ar.360x800.png` | same, mirrored — the wrapped `النماذج (تجريبي)` row (§6.4) |
| `fr/focus.fr.360x800.png` | keyboard focus on the `Accueil` tab: 2 px ring, visible but **clipped by the viewport's left/bottom edge** on an edge cell |
| `ar/focus.ar.360x800.png` | same, on `الرئيسية` |
| `fr/home.fr.iphone.390x664.webkit.png` | **WebKit**, iPhone 14 metrics (3×, 390×664) — the only non-Chromium render in the pack |
| `ar/home.ar.iphone.390x664.webkit.png` | same, Arabic; RTL shell under WebKit |
| `ar/arabic-price.ar.360x800@3x.png` | check A magnified (deviceScaleFactor 3): digits right, `د.م.` left, the terminal dot at the unit's far left |

### 7.4 Stitch comparisons (6) — ours on the left, the reference on the right

| File | Reference region | What to look at |
|---|---|---|
| `compare/header.fr.compare.png` | `accueil_morocco_pc/screen.png`, top 72 px | 64 px row, drawn mark vs remote placeholder (`img`), wordmark size, pill switcher, **missing bookmark/avatar icons** (D-25) |
| `compare/header.ar.compare.png` | `morocco_pc_1/screen.png`, top 72 px | the mirrored header: switcher on the left, brand on the right, no Arabic subtitle (D-23) |
| `compare/tabbar.fr.compare.png` | `accueil_morocco_pc/screen.png`, last 102 px | five cells, the raised centre circle, active cell weight |
| `compare/tabbar.ar.compare.png` | `morocco_pc_1/screen.png`, last 102 px | the mirrored cell order, Arabic label lengths |
| `compare/footer.ar.compare.png` | `morocco_pc_1/screen.png`, y 1400–1500 | the footer's centred column vs the board's © line + link row; ours carries three link rows |
| `compare/footer.fr.compare.png` | **the AR board's** footer band — the FR board draws no footer | same comparison in French; the caption notes the locale mismatch |

### 7.5 OG cards (2)

| File | What to look at |
|---|---|
| `og/og-result.ar.1200x630.png` | real Arabic glyphs, no boxes, `د.م.` twice, money laid out LTR (§5 B3) |
| `og/og-preset.ar.1200x630.png` | same, single figure |

---

## 8. Owner checklist — open these ten first

1. `compare/header.fr.compare.png` — does the header read as the same design as the board?
2. `compare/header.ar.compare.png` — the mirror: does the RTL header hold up?
3. `compare/tabbar.ar.compare.png` — five Arabic labels, mirrored order, raised centre.
4. `compare/tabbar.fr.compare.png` — the same in French, where the labels are longest.
5. `compare/footer.ar.compare.png` — the wrapping legal row and the missing © year line (§6.4).
6. `compare/footer.fr.compare.png` — the same, and the note that no French board draws a footer.
7. `ar/arabic-price.ar.360x800@3x.png` — check A at 3×: is the terminal dot where Arabic wants it?
8. `og/og-result.ar.1200x630.png` — the share card a Moroccan user will actually see.
9. `og/og-preset.ar.1200x630.png` — the preset share card.
10. `ar/home.ar.iphone.390x664.webkit.png` — WebKit, iPhone metrics: the only non-Chromium shell render.

Then, if those are fine: `fr/focus.fr.360x800.png` (focus ring on an edge cell),
`fr/home.fr.360x800.bottom.png` (footer/bar clearance), and the twelve `*.full.png` files.

---

## 9. Open items and limitations

**Findings this pack raises (not fixed here):**

1. **`/ar` header link `الأدلة` is 43.4 px wide at 768 px**, 0.6 px under `PLAN.md`'s 44×44 floor
   (§3.1). Either a `min-w-*` on the header nav links or an accepted deviation.
2. **Check A's third assertion fails as worded** on both surfaces (§4.3), on the abbreviation's
   terminal stop. Decide which reading the gate means.
3. **Tab labels compute to 10 px in both locales**, below the 12 px caption floor and without the
   "Arabic one step larger" step the same paragraph asks for (§3 S15, §6.2).
4. **The share cards order the money LTR while the page orders it RTL** (§5 B3).
5. **The Arabic header is 0.6 px from the floor but the French one is 18 px over it** — the same
   component, two locales, one rule: worth deciding whether the rule is per-control or per-role.

**Limitations of the evidence:**

- **No real device.** Safe area, notch, address-bar collapse and home indicator are all unverified
  (§6.1). `env()` reads 0 in every headless context, WebKit included.
- **No human reading of the Arabic** — naturalness and legibility are §6.2 and §6.3.
- **No visual judgement of fidelity** in this document: the comparisons are produced and labelled,
  and the reading of them is the owner's (§6.4).
- **The screenshots are palette-compressed** (`sharp`, quality 92) to stay inside the 3 MB budget.
  Positions and layout are unaffected; very fine anti-aliasing is approximated. Re-run the capture
  script for lossless PNG if a pixel-level question comes up.
- **Not run:** the rest of the suite. This pack runs only the two files it adds; the full
  `npm test` / Lighthouse figures quoted in `PROGRESS.md` belong to the earlier run, not this one.

**Worktree note.** `web-redesign` is checked out in `C:/projects/morocco-pc`, so it cannot be
checked out here as well. This worktree's branch is at **exactly** `web-redesign`'s commit
(`3d9256c`), the evidence was produced from this tree's own `npm run build`, and the commit below
carries the artefacts. Nothing was pushed and nothing was merged.

---

## 10. Arabic strings in the shell — for owner review

Every Arabic string the shell renders, the French it stands in for, and the key it
comes from. **No copy was changed in this round**: this is the list §6.3 asks a
native reader to judge (`PLAN.md` Phase 6, `needs-review`), collected in one place
so the review does not have to open `messages/`. Six of the rows are `aria-label`s
— a screen reader says them, so they are copy too.

### 10.1 Tab bar — five cells, 360 px (`components/ui/bottom-tab-bar.tsx`)

| # | Arabic (shipped) | French equivalent | Key | Owner question |
|---|---|---|---|---|
| 1 | الرئيسية | Accueil | `shell.tabItems.home` | Home. Uncontroversial. |
| 2 | القطع | Pièces | `shell.tabItems.components` | "Parts". The header calls the same destination المكوّنات ("components"); two words for one place. |
| 3 | أنشئ | Configurer | `shell.tabItems.configure` | Imperative "create/build", not "configure". The raised centre cell. |
| 4 | الأدلة | Guides | `shell.tabItems.guides` | Plural of دليل (guide/evidence). |
| 5 | المحفوظة | Gardés | `shell.tabItems.saved` | An adjective with no noun — "the saved (ones)". The header and footer use the full noun (§10.2, §10.3). |
| — | التنقل في التطبيق | Navigation de l’application | `shell.tabNav` | `aria-label` of the bar landmark. Must stay different from the header nav's (§10.2), or two landmarks share one accessible name. |

### 10.2 Header — three page links + the locale switcher

| # | Arabic (shipped) | French equivalent | Key | Owner question |
|---|---|---|---|---|
| 1 | morocco-pc | morocco-pc | `shell.brand` | The wordmark, identical in both catalogues: a brand name, not translated. |
| 2 | المكوّنات | Composants | `shell.navItems.components` | "Components". See the tab bar's القطع. |
| 3 | الأدلة | Guides | `shell.navItems.guides` | Same word as the tab cell. |
| 4 | التكوينات المحفوظة | Mes enregistrements | `shell.navItems.saved` | The long form: "the saved configurations". `md+` only. |
| 5 | العربية | العربية | `shell.switcher.ar` | The switcher's own labels are each in their own language, so this row is identical in both catalogues by design. |
| 6 | Français | Français | `shell.switcher.fr` | Latin text in the Arabic header — the one Latin word on `/ar` besides the wordmark. |
| 7 | اللغة | Langue | `shell.language` | `aria-label` of the switcher group. |
| 8 | التنقل الرئيسي | Navigation principale | `shell.navLabel` | `aria-label` of the header nav landmark. |

### 10.3 Footer — two named navs, four legal links, the price line

| # | Arabic (shipped) | French equivalent | Key | Owner question |
|---|---|---|---|---|
| 1 | morocco-pc | morocco-pc | `shell.brand` | The wordmark again, above the link rows. |
| 2 | تكويناتك | Vos configurations | `shell.savedNav` | `aria-label` of the shelf's nav: "your configurations". |
| 3 | التكوينات المحفوظة | Mes enregistrements | `saved.title` | The shelf link itself — the same key the saved-builds page's `h1` reads, and the same words as `shell.navItems.saved`. |
| 4 | معلومات قانونية | Informations légales | `shell.legalNav` | `aria-label` of the legal nav. **Indefinite** (معلومات), where the first link below is **definite** (المعلومات) — the same phrase in two forms, one row apart. |
| 5 | المعلومات القانونية | Mentions légales | `shell.legal.mentions` | "Legal information". |
| 6 | الخصوصية | Confidentialité | `shell.legal.privacy` | Privacy. |
| 7 | اتصل بنا | Contact | `shell.legal.contact` | "Contact us" — a verb phrase where French has a noun. |
| 8 | النماذج (تجريبي) | Formats (démo) | `shell.formats` | The proof sheet (§11). النماذج also means "models", which is not what the page is; the Latin parenthesis is transliterated rather than translated. |
| 9 | morocco-pc — مُكوِّن أجهزة الحاسوب للسوق المغربي. الأسعار بالدرهم. | morocco-pc — configurateur de PC pour le marché marocain. Prix en dirhams (DH). | `shell.footer` | The price line. مُكوِّن carries diacritics no other string in the shell uses, and the Arabic drops the "(DH)" the French keeps. |

The `·` between legal links is `aria-hidden` decoration, not a translated string,
so it has no key.
