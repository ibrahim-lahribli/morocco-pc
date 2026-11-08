/**
 * Score formatting for the two locales.
 *
 * The product's digit rule is the price formatter's, not `Intl`'s: digits stay
 * Latin in both locales, because the supplied designs and every price render
 * them that way. Only the decimal separator is localized — French uses the
 * comma (`72,5`), Arabic keeps the point (`72.5`), which is the separator the
 * Arabic screens use beside Latin digits.
 *
 * `Intl.NumberFormat` is deliberately not used: its separator and its digit
 * family vary with the runtime's ICU data, and a score that changes with the
 * host is not reproducible. One decimal place always, so `70` reads `70,0` and
 * a card's value never reflows between one and two decimals.
 */
import type { AppLocale } from "@/i18n/routing";

const DECIMAL_SEPARATOR: Record<AppLocale, string> = {
  fr: ",",
  ar: ".",
};

export function formatScore(score: number, locale: AppLocale): string {
  if (!Number.isFinite(score)) {
    throw new TypeError("formatScore expects a finite number");
  }

  return score.toFixed(1).replace(".", DECIMAL_SEPARATOR[locale]);
}
