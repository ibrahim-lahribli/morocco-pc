/**
 * apps/web/e2e/g3-shell.spec.ts — the SHELL half of the G3 evidence pack.
 *
 * G3 is a HUMAN gate (PLAN.md: only the owner marks it passed). This file does
 * not claim it. It measures the shell properties the gate's review is about, so
 * the owner reads numbers instead of taking a green suite on trust, and every
 * number is printed rather than merely asserted: a failure here says the
 * measurement, not just "expected true".
 *
 * WHAT IS PINNED vs WHAT IS PRINTED. Every row below ASSERTS (a regression
 * fails the suite); each also prints its measurement as `REPORT ...`, so a red
 * row says what it measured rather than only "expected true". The one row that
 * used to print without a verdict — S15, the tab label size — became an
 * assertion in the G3 fix round: `text-tab` puts the labels on PLAN.md's 12 px
 * caption floor (13 px Arabic, D-30), so the size is now a contract, not a
 * value a human has to accept or reject.
 *
 * Every test pins its own viewport. The four projects (360/390/768/1280) grep
 * `@layout`, so a test that inherited the project width would assert the phone
 * bar at 1280 px, where the bar is `md:hidden` by design. Pinning makes each
 * test the same measurement in every project — which is why the pack quotes a
 * command per assertion instead of a run count.
 *
 * The subject is the SHELL, so every route below is used only as a place for
 * the shell to stand on. Nothing here reads page content.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

import { IDS } from "../mock/fixtures.mjs";

/** The one result fixture the pack uses: three builds, all eight roles on the first. */
const RESULT = `/config/${IDS.threeBuilds}`;

type Locale = "fr" | "ar";

/**
 * The shell's own words, per locale. These are the ACCESSIBLE NAMES the specs
 * address landmarks by, so they must be copied exactly — the French bar's name
 * carries U+2019 (’).
 */
const SHELL: Record<Locale, { nav: string; tabNav: string; lang: string; home: string; guides: string }> = {
  fr: {
    nav: "Navigation principale",
    tabNav: "Navigation de l’application",
    lang: "Langue",
    home: "Accueil",
    guides: "Guides",
  },
  ar: {
    nav: "التنقل الرئيسي",
    tabNav: "التنقل في التطبيق",
    lang: "اللغة",
    home: "الرئيسية",
    guides: "الأدلة",
  },
};

/** The four routes the pack photographs, locale-less. */
const ROUTES = [
  { name: "home", path: "/" },
  { name: "contact", path: "/contact" },
  { name: "guides", path: "/guides" },
  { name: "result", path: RESULT },
] as const;

const LOCALES: readonly Locale[] = ["fr", "ar"];

/** A passage measured on the water: no wrap, so one rect per label. */
async function lineCount(label: Locator): Promise<number> {
  return label.evaluate((element) => {
    const node = element.firstChild;
    if (node === null) return 0;
    const range = document.createRange();
    range.selectNodeContents(node);
    // One rect per LINE BOX. A wrapped label returns 2; an ellipsised one
    // returns 1 with a scrollWidth wider than its clientWidth (checked below).
    return range.getClientRects().length;
  });
}

/**
 * Every VISIBLE control in the header, plus the five tab cells when the bar is
 * on screen.
 *
 * "Visible" is part of the measurement, not a convenience: at 360 px the header's
 * three page links are `md+` only and have no box to measure, and at 768 px the
 * bar itself is `md:hidden`, so its cells are 0x0 — a 0x0 cell is not a 44 px
 * shortfall, it is a control that does not exist at that width.
 */
async function shellControls(
  page: Page,
  options: { tabs: boolean },
): Promise<{ key: string; box: { x: number; y: number; width: number; height: number } }[]> {
  return page.evaluate((withTabs) => {
    const out: { key: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    const describe = (el: Element): string => {
      const label = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 20);
      return `${el.getAttribute("href") ?? "?"} "${label}"`;
    };
    const header = document.querySelector("header");
    if (header !== null) {
      for (const el of header.querySelectorAll("a")) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // md+ links at 360 px
        out.push({ key: `header ${describe(el)}`, box: rect.toJSON() });
      }
    }
    if (withTabs) {
      const navs = [...document.querySelectorAll("nav[aria-label]")];
      const tabs = navs.find((nav) => nav.className.includes("md:hidden"));
      if (tabs !== undefined) {
        for (const el of tabs.querySelectorAll("a")) {
          out.push({ key: `tab ${describe(el)}`, box: el.getBoundingClientRect().toJSON() });
        }
      }
    }
    return out;
  }, options.tabs);
}

/** Horizontal centre of each of the five tab cells, in DOM order. */
async function tabCentres(page: Page, locale: Locale): Promise<number[]> {
  return page
    .getByRole("navigation", { name: SHELL[locale].tabNav })
    .getByRole("link")
    .evaluateAll((els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect();
        return Math.round((rect.x + rect.width / 2) * 100) / 100;
      }),
    );
}

/** Is the header control row mirrored by locale? Reported, not assumed. */
async function switcherCentre(page: Page, locale: Locale): Promise<number> {
  const box = await page.getByRole("group", { name: SHELL[locale].lang }).boundingBox();
  if (box === null) throw new Error(`no locale switcher in ${locale}`);
  return Math.round((box.x + box.width / 2) * 100) / 100;
}

test.describe("G3 shell", () => {
  test("the header is the design's 64 px row at 360 px, in both locales", { tag: "@layout" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const locale of LOCALES) {
      await page.goto(`/${locale}`);
      const box = await page.locator("header").boundingBox();
      expect(box, `no header element on /${locale}`).not.toBeNull();
      const height = box === null ? 0 : box.height;
      // The row is `h-16` (64 px) plus `env(safe-area-inset-top)`, which is 0 in
      // a headless viewport with no cut-out — so exactly 64 here, ±1 for the
      // shadow's subpixel rounding.
      console.log(`REPORT header height /${locale} @360: ${height.toFixed(2)} px`);
      expect(Math.abs(height - 64)).toBeLessThanOrEqual(1);
    }
  });

  test("no route overflows horizontally at 360 or 768, in either locale", { tag: "@layout" }, async ({
    page,
  }) => {
    for (const width of [360, 768] as const) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 1024 });
      for (const locale of LOCALES) {
        for (const route of ROUTES) {
          await page.goto(`/${locale}${route.path}`);
          const measured = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          }));
          console.log(
            `REPORT overflow /${locale}${route.path} @${width}: scrollWidth ${measured.scrollWidth} vs innerWidth ${measured.innerWidth}`,
          );
          expect(
            measured.scrollWidth,
            `/${locale}${route.path} @${width} px overflows by ${measured.scrollWidth - measured.innerWidth} px`,
          ).toBeLessThanOrEqual(measured.innerWidth);
        }
      }
    }
  });

  test("the phone bar has exactly five tabs, each label on one line", { tag: "@layout" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const locale of LOCALES) {
      await page.goto(`/${locale}`);
      const bar = page.getByRole("navigation", { name: SHELL[locale].tabNav });
      await expect(bar).toBeVisible();

      const links = bar.getByRole("link");
      await expect(links).toHaveCount(5);

      for (let index = 0; index < 5; index += 1) {
        const link = links.nth(index);
        // `[data-tab-label]`, not "the last span": the current cell also holds
        // the active indicator, which is a span too.
        const label = link.locator("[data-tab-label]");
        const text = (await label.textContent()) ?? "";
        const lines = await lineCount(label);
        const metrics = await label.evaluate((el) => ({
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          clientHeight: el.clientHeight,
          textOverflow: getComputedStyle(el).textOverflow,
          whiteSpace: getComputedStyle(el).whiteSpace,
        }));
        console.log(
          `REPORT tab label /${locale} #${index} ${JSON.stringify(text)}: lines ${lines}, ${metrics.clientWidth}x${metrics.clientHeight} px, scrollWidth ${metrics.scrollWidth}, overflow ${metrics.textOverflow}/${metrics.whiteSpace}`,
        );
        // One line box — not two — and nothing clipped away.
        expect(lines, `tab ${index} of /${locale} wraps to ${lines} lines`).toBe(1);
        expect(
          metrics.scrollWidth,
          `tab ${index} of /${locale} truncates: content ${metrics.scrollWidth} px in ${metrics.clientWidth} px`,
        ).toBeLessThanOrEqual(metrics.clientWidth + 1);
      }
    }
  });

  test("at 768 the bar is not displayed and the header nav is", { tag: "@layout" }, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    for (const locale of LOCALES) {
      await page.goto(`/${locale}`);
      await expect(page.getByRole("navigation", { name: SHELL[locale].tabNav })).toBeHidden();
      await expect(page.getByRole("navigation", { name: SHELL[locale].nav })).toBeVisible();
      // And the bar's reserved space is released at the same breakpoint, so no
      // page is padded twice.
      const reserved = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
      expect(reserved).toBeLessThanOrEqual(0);
    }
  });

  test("every tab and visible header control is at least 44 x 44 px", { tag: "@layout" }, async ({ page }) => {
    const failures: string[] = [];
    for (const width of [360, 768] as const) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 1024 });
      for (const locale of LOCALES) {
        await page.goto(`/${locale}`);
        // The bar only exists on the phone: at 768 px it is `md:hidden`, so its
        // cells have no box and are not targets there.
        const controls = await shellControls(page, { tabs: width === 360 });
        console.log(`REPORT touch targets /${locale} @${width}: ${controls.length} controls`);
        for (const control of controls) {
          console.log(
            `REPORT   ${control.box.width.toFixed(1)} x ${control.box.height.toFixed(1)}  ${control.key}`,
          );
          if (control.box.width < 44 || control.box.height < 44) {
            failures.push(
              `/${locale} @${width}: ${control.key} is ${control.box.width.toFixed(1)}x${control.box.height.toFixed(1)} px`,
            );
          }
        }
      }
    }
    expect(failures, failures.join("; ")).toHaveLength(0);
  });

  test("Arabic mirrors the tab order and the locale switch", { tag: "@layout" }, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/fr");
    const frTabs = await tabCentres(page, "fr");
    const frSwitch = await switcherCentre(page, "fr");
    await page.goto("/ar");
    const arTabs = await tabCentres(page, "ar");
    const arSwitch = await switcherCentre(page, "ar");

    console.log(`REPORT tab centres fr: ${frTabs.join(", ")}`);
    console.log(`REPORT tab centres ar: ${arTabs.join(", ")}`);
    console.log(`REPORT locale switch centre fr ${frSwitch} / ar ${arSwitch} (viewport 360)`);

    // Ascending left-to-right in fr, descending in ar: the ORDER is mirrored.
    expect([...frTabs].sort((a, b) => a - b)).toEqual(frTabs);
    expect([...arTabs].sort((a, b) => b - a)).toEqual(arTabs);

    // And the cells land on mirrored coordinates: cell i of ar sits where cell i
    // of fr would if the row were flipped about the viewport's centre line.
    for (let index = 0; index < 5; index += 1) {
      const mirrored = 360 - frTabs[index];
      expect(
        Math.abs(arTabs[index] - mirrored),
        `tab ${index}: ar centre ${arTabs[index]} is not the mirror of fr ${frTabs[index]} (expected ~${mirrored})`,
      ).toBeLessThanOrEqual(2);
    }

    // The switcher changes SIDE. Exact mirroring is not asserted: the wordmark
    // is Latin text painted in the Arabic face on /ar, so the two header rows
    // do not have identical item widths and justify-between lands differently.
    expect(frSwitch).toBeGreaterThan(180);
    expect(arSwitch).toBeLessThan(180);
  });

  test("the current route's tab is aria-current, with a cue beyond colour", { tag: "@layout" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const locale of LOCALES) {
      for (const route of [
        { path: "/", tab: SHELL[locale].home },
        { path: "/guides", tab: SHELL[locale].guides },
      ]) {
        await page.goto(`/${locale}${route.path}`);
        const bar = page.getByRole("navigation", { name: SHELL[locale].tabNav });
        const current = bar.getByRole("link", { name: route.tab, exact: true });
        await expect(current, `/${locale}${route.path} does not mark "${route.tab}"`).toHaveAttribute(
          "aria-current",
          "page",
        );

        // THE CUE, and why it is not a colour. Colour alone fails the check the
        // review asks for, and so does the weight step the pack first recorded:
        // 500 vs 600 on a 12 px label is nearly invisible at a glance and
        // vanishes in greyscale. So the current cell carries a DRAWN INDICATOR
        // (`data-tab-indicator`, a 16x3 px pill under the label) that the other
        // four do not have — presence and geometry, both readable without
        // colour, and both asserted below rather than a hex value.
        const cells = await bar.getByRole("link").evaluateAll((els) =>
          els.map((el) => {
            const label = el.querySelector("[data-tab-label]");
            const indicator = el.querySelector("[data-tab-indicator]");
            const box = indicator === null ? null : indicator.getBoundingClientRect();
            return {
              text: (label?.textContent ?? "").trim(),
              weight: label === null ? null : getComputedStyle(label).fontWeight,
              current: el.getAttribute("aria-current") === "page",
              indicator:
                box === null
                  ? null
                  : {
                      width: Math.round(box.width * 100) / 100,
                      height: Math.round(box.height * 100) / 100,
                    },
            };
          }),
        );
        const active = cells.filter((row) => row.current);
        const inactive = cells.filter((row) => !row.current);
        expect(active, `/${locale}${route.path} marks ${active.length} tabs as current`).toHaveLength(1);
        console.log(
          `REPORT active tab /${locale}${route.path}: aria-current="page" on "${active[0].text}", indicator ${JSON.stringify(active[0].indicator)}, weight ${active[0].weight} vs ${[...new Set(inactive.map((row) => row.weight))].join("/")} inactive, ${inactive.filter((row) => row.indicator !== null).length} of ${inactive.length} inactive cells carry an indicator`,
        );

        // (a) The cue is PRESENT on the current cell and has a real box — a
        //     zero-height span would pass a presence check and show nothing.
        expect(active[0].indicator, `the current tab on /${locale}${route.path} has no indicator`).not.toBeNull();
        expect(active[0].indicator?.height ?? 0).toBeGreaterThanOrEqual(2);
        expect(active[0].indicator?.width ?? 0).toBeGreaterThanOrEqual(8);

        // (b) And it is EXCLUSIVE: an indicator on every cell would be
        //     decoration, not a cue.
        expect(
          inactive.filter((row) => row.indicator !== null).map((row) => row.text),
          `an inactive tab on /${locale}${route.path} carries the active indicator`,
        ).toHaveLength(0);

        // (c) The weight step is still there as a second cue, but it is no
        //     longer the one the state depends on.
        expect(Number(active[0].weight)).toBeGreaterThan(Number(inactive[0].weight));
      }
    }
  });

  test("every tab and header control shows a visible focus indicator", { tag: "@layout" }, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const locale of LOCALES) {
      await page.goto(`/${locale}`);
      // Tag the controls so a Tab walk can tell when it has reached one. This is
      // runtime instrumentation of the rendered page, not a change to the app.
      const expected = await page.evaluate(() => {
        const controls: Element[] = [];
        const header = document.querySelector("header");
        if (header !== null) {
          for (const el of header.querySelectorAll("a")) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            controls.push(el);
          }
        }
        const navs = [...document.querySelectorAll('nav[aria-label]')];
        const tabs = navs.find((nav) => nav.className.includes("md:hidden"));
        if (tabs !== undefined) for (const el of tabs.querySelectorAll("a")) controls.push(el);
        controls.forEach((el, index) => el.setAttribute("data-g3-focus", String(index)));
        return controls.length;
      });
      expect(expected).toBeGreaterThanOrEqual(6);

      const seen: { index: number; key: string; outline: string; shadow: string }[] = [];
      for (let press = 0; press < 160 && seen.length < expected; press += 1) {
        await page.keyboard.press("Tab");
        const hit = await page.evaluate(() => {
          const el = document.activeElement;
          if (el === null) return null;
          const index = el.getAttribute("data-g3-focus");
          if (index === null) return null;
          const style = getComputedStyle(el);
          return {
            index: Number(index),
            key: `${el.getAttribute("href") ?? "?"} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 18)}"`,
            outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
            shadow: style.boxShadow,
          };
        });
        if (hit === null) continue;
        if (seen.some((row) => row.index === hit.index)) continue;
        seen.push(hit);
      }

      console.log(`REPORT focus /${locale}: reached ${seen.length} of ${expected} controls by Tab`);
      for (const row of seen) {
        console.log(`REPORT   focus #${row.index} ${row.key}: outline[${row.outline}] shadow[${row.shadow}]`);
      }
      // Every control must have been REACHED by Tab: an unreachable control has
      // no focus indicator to speak of, so the count is an assertion of its own.
      expect(seen.map((row) => row.index).sort((a, b) => a - b)).toEqual(
        Array.from({ length: expected }, (_, index) => index),
      );
      for (const row of seen) {
        const outlineWidth = Number.parseFloat(row.outline.split(" ")[1]);
        const outlined = !row.outline.startsWith("none") && outlineWidth >= 1;
        const shadowed = row.shadow !== "none" && !row.shadow.endsWith(" 0px 0px 0px 0px");
        expect(outlined || shadowed, `${row.key} on /${locale} has no visible focus indicator`).toBe(true);
      }
    }
  });

  test("the shell claims the safe area and the bar never covers the footer", { tag: "@layout" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const locale of LOCALES) {
      // /guides is the long page: the footer is far below the fold.
      await page.goto(`/${locale}/guides`);

      // 1. The viewport meta opts into the notch, or every env() below is 0.
      const meta = await page.evaluate(
        () => document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
      );
      console.log(`REPORT viewport meta /${locale}: ${meta}`);
      expect(meta).toContain("viewport-fit=cover");

      // 2. The bar's bottom padding READS the inset. In a headless viewport the
      //    inset is 0, so the computed value is 0 px either way — the claim that
      //    is checkable here is that the declaration names env(), which is what
      //    makes the inset apply on a real device.
      const bar = page.getByRole("navigation", { name: SHELL[locale].tabNav });
      const barStyle = await bar.evaluate((el) => ({
        className: el.className,
        paddingBottom: getComputedStyle(el).paddingBottom,
      }));
      console.log(
        `REPORT tab bar /${locale}: padding-bottom ${barStyle.paddingBottom} (headless inset is 0), env() in class: ${barStyle.className.includes("env(safe-area-inset-bottom")}`,
      );
      expect(barStyle.className).toContain("env(safe-area-inset-bottom");

      // 3. At the bottom of a long page, the footer's LAST element ends above
      //    the bar's top edge.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(120);
      const clearance = await page.evaluate(() => {
        const footer = document.querySelector("footer");
        const navs = [...document.querySelectorAll('nav[aria-label]')];
        const tabs = navs.find((nav) => nav.className.includes("md:hidden")) ?? null;
        if (footer === null || tabs === null) return null;
        const last = footer.lastElementChild?.lastElementChild ?? footer.lastElementChild;
        return {
          lastBottom: last === null || last === undefined ? null : last.getBoundingClientRect().bottom,
          barTop: tabs.getBoundingClientRect().top,
        };
      });
      expect(clearance).not.toBeNull();
      console.log(
        `REPORT footer clearance /${locale} @360, scrolled to bottom: last footer element bottom ${clearance?.lastBottom?.toFixed(1)} px, bar top ${clearance?.barTop.toFixed(1)} px`,
      );
      expect(clearance?.lastBottom ?? 0).toBeLessThanOrEqual(clearance?.barTop ?? 0);
    }
  });

  test("the tab label meets PLAN.md's 12 px caption floor, one step higher on Arabic", { tag: "@layout" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const locale of LOCALES) {
      await page.goto(`/${locale}`);
      const sizes = await page
        .getByRole("navigation", { name: SHELL[locale].tabNav })
        .getByRole("link")
        .evaluateAll((els) =>
          els.map((el) => {
            const label = el.querySelector("[data-tab-label]");
            return {
              text: (label?.textContent ?? "").trim(),
              fontSize: label === null ? null : getComputedStyle(label).fontSize,
              lineHeight: label === null ? null : getComputedStyle(label).lineHeight,
            };
          }),
        );
      // PLAN.md: a 12 px caption floor for the tab labels, and Arabic one step
      // larger. The bar reads its own `text-tab` step (globals.css) so neither
      // locale can drift below its floor without this failing, and D-30 records
      // the departure from Stitch's 10 px.
      const floor = locale === "ar" ? 13 : 12;
      for (const row of sizes) {
        const size = Number.parseFloat(row.fontSize ?? "0");
        console.log(
          `REPORT label size /${locale} "${row.text}": font-size ${row.fontSize}, line-height ${row.lineHeight}, floor ${floor}px — ${size < floor ? "BELOW" : "meets"} the floor`,
        );
        expect(
          size,
          `tab label "${row.text}" on /${locale} is ${row.fontSize}, below the ${floor}px floor`,
        ).toBeGreaterThanOrEqual(floor);
      }
    }
  });
});
