/**
 * The dirham unit as the OG share cards must DRAW it (D-31).
 *
 * Satori lays every string out in LOGICAL order and applies no bidi pass at
 * all. `formatMoney()`'s Arabic unit `د.م.` is an RTL run — its first logical
 * glyph (د) would be painted on the far side, so the abbreviation reads
 * backwards on the card (letter, dot, letter, dot). Handing Satori the unit
 * already reversed into VISUAL order is the whole fix: its own layout then
 * paints dot, م, dot, د, which an Arabic reader reads back as `د.م.`.
 *
 * This is the card's problem alone. The HTML pages keep the logical unit in
 * `lib/i18n/format.ts` and let the browser's bidi algorithm order it, and
 * French is untouched — `DH` has no direction to lose.
 *
 * Pinned by `e2e/og-unit-ink.spec.ts`, which reads the ink of both cards: a
 * Satori (or Next) upgrade that starts applying bidi reverses these four glyphs
 * a second time and fails that spec loudly.
 */
import { formatNumber, type AppLocale } from "./format";

export const OG_ARABIC_UNIT = "\u002E\u0645\u002E\u062F";

/** The same no-break space `formatMoney()` puts before the unit. */
const NO_BREAK_SPACE = "\u00A0";

/** Each locale's unit, as the drawn card spells it. */
const OG_UNIT: Record<AppLocale, string> = {
  fr: "DH",
  // The Arabic unit is the one string that is NOT the logical one: see above.
  ar: OG_ARABIC_UNIT,
};

/**
 * `formatMoney()` for a Satori canvas: the same digits and separator, the unit
 * spelled in the order the renderer will actually paint.
 */
export function formatOgMoney(amount: number, locale: AppLocale): string {
  return `${formatNumber(amount, locale)}${NO_BREAK_SPACE}${OG_UNIT[locale]}`;
}
