/**
 * apps/web/e2e/g3-arabic-price.spec.ts — G3 check A, the Arabic price direction.
 *
 * The question is not "does it look Arabic" but where the glyphs actually land.
 * `formatMoney(8594, "ar")` is `"8 594 د.م."` — an LTR numeric run followed by an
 * RTL unit, in an RTL paragraph. The bidi algorithm decides the visual order of
 * those two runs, and a RANGE over the text node is the only way to read that
 * decision: `getBoundingClientRect()` on the element tells you the box, which is
 * true and useless here. So each character gets its own one-character Range and
 * its own rect.
 *
 * The measurement is printed in full on every run: the pack quotes positions,
 * not a verdict.
 *
 * THE LABEL IS THE UNIT. "the first Arabic letter of the label" is the د of
 * `د.م.`, not whatever Arabic word happens to start the text node — the wizard
 * hint begins "مبلغ صحيح، من 500 د.م. …", where the node's first Arabic letter is
 * the م of "مبلغ" and has nothing to do with the money. So the analysis anchors
 * on the unit substring and walks BACKWARDS from it over the digit group that
 * belongs to it.
 *
 * Dots are compared by CENTRE, not by edges: in an RTL run the unit's glyphs are
 * adjacent, so an edge-to-edge comparison of two touching boxes decides the
 * verdict on subpixel rounding (measured: 0.01 px decided one of these).
 *
 * Two surfaces, per the gate:
 *   1. the result page's build-card total (a bare money node);
 *   2. the wizard's budget display (the hint line under the field, which carries
 *      the bounds as money — the field itself keeps its digits in an <input>,
 *      where a Range cannot go, and paints the unit in a separate <span>).
 */

import { test, expect, type Page } from "@playwright/test";

import { IDS } from "../mock/fixtures.mjs";

const RESULT = `/ar/config/${IDS.threeBuilds}`;
const BUDGET = "/ar/configurer?etape=budget&use_case=GAMING";

/** The Arabic dirham, exactly as `CURRENCY_LABEL.ar` spells it. */
const UNIT = "د.م.";

interface CharRect {
  index: number;
  char: string;
  code: string;
  left: number;
  right: number;
  centre: number;
}

interface MoneyShape {
  text: string;
  direction: string;
  chars: CharRect[];
}

/**
 * Read one character at a time through a Range. Runs in the page.
 *
 * The element is found by `selector`, then the FIRST text node inside it that
 * contains the Arabic unit is measured.
 */
async function measureMoney(page: Page, selector: string): Promise<MoneyShape> {
  const shape = await page.evaluate((sel) => {
    const host = document.querySelector(sel);
    if (host === null) return null;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const value = node.nodeValue ?? "";
      if (!value.includes("د.م.")) continue;
      const chars: { index: number; char: string; code: string; left: number; right: number }[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = [...range.getClientRects()][0];
        chars.push({
          index,
          char: value[index] ?? "",
          code: (value.codePointAt(index) ?? 0).toString(16),
          left: rect === undefined ? Number.NaN : Math.round(rect.left * 100) / 100,
          right: rect === undefined ? Number.NaN : Math.round(rect.right * 100) / 100,
        });
      }
      const element = host as HTMLElement;
      return { text: value, direction: getComputedStyle(element).direction, chars };
    }
    return null;
  }, selector);
  if (shape === null) throw new Error(`no text node with the Arabic unit inside ${selector}`);
  return {
    ...shape,
    chars: shape.chars.map((char) => ({ ...char, centre: (char.left + char.right) / 2 })),
  };
}

/** The geometry questions, derived from one measured string. */
function analyse(shape: MoneyShape) {
  const unitStart = shape.text.indexOf(UNIT);
  if (unitStart < 0) throw new Error(`no unit in ${JSON.stringify(shape.text)}`);

  const unit = shape.chars.slice(unitStart, unitStart + UNIT.length);
  const letters = unit.filter((char) => /[\u0600-\u06FF]/.test(char.char));
  const dots = unit.filter((char) => char.char === ".");
  if (letters.length === 0) throw new Error(`no letters in the unit of ${JSON.stringify(shape.text)}`);

  // Walk backwards from the unit over the digit group that belongs to it.
  let cursor = unitStart - 1;
  while (cursor >= 0 && /[0-9\u0660-\u0669\u202F\u00A0 ]/.test(shape.text[cursor])) cursor -= 1;
  const digits = shape.chars
    .slice(cursor + 1, unitStart)
    .filter((char) => /[0-9\u0660-\u0669]/.test(char.char));
  if (digits.length === 0) throw new Error(`no digits before the unit in ${JSON.stringify(shape.text)}`);

  const firstDigit = digits[0];
  const lastDigit = digits[digits.length - 1];
  const firstLetter = letters[0];
  const lastLetter = letters[letters.length - 1];

  return {
    unit,
    digits,
    dots,
    firstDigit,
    lastDigit,
    firstLetter,
    lastLetter,
    digitsRightOfLabel: firstDigit.left > firstLetter.left,
    dotsRightOfDigits: dots.filter((dot) => dot.centre > lastDigit.centre).map((dot) => dot.left),
    dotsLeftOfLastLetter: dots.filter((dot) => dot.centre < lastLetter.centre).map((dot) => dot.left),
  };
}

function report(label: string, shape: MoneyShape): void {
  console.log(`REPORT ${label}: text ${JSON.stringify(shape.text)} dir=${shape.direction}`);
  console.log(
    `REPORT   ${shape.chars.map((c) => `${JSON.stringify(c.char)}@${c.left}-${c.right}`).join("  ")}`,
  );
}

/** The three questions of check A, shared by both surfaces. */
function assertPriceDirection(label: string, shape: MoneyShape): void {
  const geometry = analyse(shape);
  console.log(
    `REPORT   ${label}: digit ${JSON.stringify(geometry.firstDigit.char)} x=${geometry.firstDigit.left}..${geometry.firstDigit.right} centre ${geometry.firstDigit.centre.toFixed(2)}; unit letter ${JSON.stringify(geometry.firstLetter.char)} x=${geometry.firstLetter.left}, last letter ${JSON.stringify(geometry.lastLetter.char)} centre ${geometry.lastLetter.centre.toFixed(2)}; dots at ${geometry.dots.map((dot) => dot.left).join(", ")}`,
  );

  // (1) The number sits to the RIGHT of the unit.
  expect(
    geometry.digitsRightOfLabel,
    `first digit at x=${geometry.firstDigit.left} is not right of the unit at x=${geometry.firstLetter.left}`,
  ).toBe(true);

  // (2) No period to the right of the digits.
  expect(
    geometry.dotsRightOfDigits,
    `a "." sits right of the digits (dot left edges ${geometry.dotsRightOfDigits.join(", ")}; last digit centre ${geometry.lastDigit.centre.toFixed(2)})`,
  ).toHaveLength(0);

  // (3) No period to the left of the unit's last letter.
  expect(
    geometry.dotsLeftOfLastLetter,
    `a "." sits left of "${geometry.lastLetter.char}" (dot left edges ${geometry.dotsLeftOfLastLetter.join(", ")}; "${geometry.lastLetter.char}" centre ${geometry.lastLetter.centre.toFixed(2)})`,
  ).toHaveLength(0);
}

test.describe("G3 check A — Arabic price direction", () => {
  test("on the result page the unit sits left of the number, and no dot escapes the unit", { tag: "@layout" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(RESULT);

    // The build card's total: the bare money node the gate names.
    const shape = await measureMoney(page, "article p.num-tabular.text-title");
    report("result price", shape);
    assertPriceDirection("result price", shape);
  });

  test("the wizard budget display repeats the same geometry", { tag: "@layout" }, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    // The budget step is `etape=budget`; the wizard needs a use case to walk
    // its profile, and reads its options from the fixture mock.
    await page.goto(BUDGET);
    await page.waitForSelector("#wizard-budget-hint", { timeout: 20_000 });

    const shape = await measureMoney(page, "#wizard-budget-hint");
    report("wizard budget hint", shape);
    assertPriceDirection("wizard budget hint", shape);
  });
});
