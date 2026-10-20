/**
 * Locale formatting helpers (S5, plan §2 V11).
 *
 * Rule: no component formats a number or a date by hand. Every amount, date and
 * percentage in the app goes through one of these functions, which is why
 * `scripts/check-i18n.mjs` fails on `new Intl.`, `toLocaleString()` or a literal
 * "8 500 MAD" anywhere outside this directory.
 *
 * Two decisions are worth knowing before changing a value here.
 *
 * 1. **`fr-MA` and `ar-MA` both group with a full stop** in CLDR ("7.300"), and
 *    a full stop reads as a DECIMAL separator to a French reader — "7.300 DH"
 *    can be read as seven dirhams and thirty centimes. The design also writes
 *    amounts with a space ("7 300 MAD"). So the grouping separator is
 *    normalized to U+202F NARROW NO-BREAK SPACE, built from `formatToParts`:
 *    the digits, the sign and the locale's own decimal separator still come
 *    from ICU; only the thousands separator is typographic.
 * 2. **The currency label is a word, not `Intl` style `currency`.** `MAD`
 *    formats as "7 300,00 MAD" — cents nobody quotes, and the wrong label for
 *    Moroccan copy, which writes "DH". S20 may switch the Arabic label to
 *    "د.م."; that is a copy decision, not a formatting one, and it belongs in
 *    this map rather than at 40 call sites.
 */

export type AppLocale = "fr" | "ar";

/** The BCP 47 tag each app locale formats with. */
const INTL_LOCALE: Record<AppLocale, string> = {
  fr: "fr-MA",
  ar: "ar-MA",
};

const CURRENCY_LABEL: Record<AppLocale, string> = {
  fr: "DH",
  // S20 owns the Arabic copy pass; "DH" is what the product uses today.
  ar: "DH",
};

const GROUP_SEPARATOR = "\u202F";
const NO_BREAK_SPACE = "\u00A0";

/**
 * A locale number with the thousands separator normalized to a narrow
 * no-break space. `formatToParts` (not a string replace) so a decimal comma in
 * another locale can never be mistaken for a grouping separator.
 */
export function formatNumber(
  value: number,
  locale: AppLocale,
  options: Intl.NumberFormatOptions = {},
): string {
  const formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
    maximumFractionDigits: 0,
    ...options,
  });
  return formatter
    .formatToParts(value)
    .map((part) => (part.type === "group" ? GROUP_SEPARATOR : part.value))
    .join("");
}

/** "7 300 DH" — narrow no-break space between groups, no-break before the unit. */
export function formatMoney(
  amount: number,
  locale: AppLocale,
  options: Intl.NumberFormatOptions = {},
): string {
  return `${formatNumber(amount, locale, options)}${NO_BREAK_SPACE}${CURRENCY_LABEL[locale]}`;
}

/** "12 octobre 2026" / "12 أكتوبر 2026". Takes a Date or an ISO string. */
export function formatDate(
  value: Date | string,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" },
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], options).format(date);
}

/** "79 %" — the space is the locale's, not the template's. */
export function formatPercent(ratio: number, locale: AppLocale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(ratio);
}
