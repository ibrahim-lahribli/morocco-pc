/**
 * Price formatting for the Moroccan market.
 *
 * The design rule is exact: a NON-BREAKING space as the thousands separator,
 * then a space and the currency symbol — `8 594 DH` in French, `8 594 د.م.` in
 * Arabic. `Intl` is not used for grouping because its separator varies by ICU
 * version and locale (narrow no-break space, comma or dot), and a price whose
 * separator changes with the runtime is not reproducible. Digits stay Latin in
 * both locales, matching the supplied designs.
 */

export const NBSP = "\u00A0";

/** Group an integer with non-breaking spaces: 1234567 -> `1 234 567`. */
export function groupNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("formatPrice expects a finite number");
  }
  const rounded = Math.round(value);
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return rounded < 0 ? `-${grouped}` : grouped;
}

/** Format an amount and its currency symbol with a single NBSP before it. */
export function formatPrice(value: number, currency: string): string {
  return `${groupNumber(value)}${NBSP}${currency}`;
}
