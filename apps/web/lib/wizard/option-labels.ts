/**
 * `option-labels.ts` — the contract's own option words, translated where the
 * contract has no language (2026-10-25, closing UI audit finding F2).
 *
 * ## The problem this solves
 *
 * `GET /v1/meta/options` serves `{ value, label }` pairs whose labels are French
 * ("Jeu", "Bureau", "Travail", "Prix d'abord"). Those labels are what the wizard
 * renders — by value, never from the enum (`lib/wizard/model.ts`: "Labels still
 * come from `meta/options`, never from this file"), which is right: a use case
 * the contract adds tomorrow must appear without a code change. But the contract
 * has no language dimension, so on `/ar/configurer` an Arabic question sat above
 * three French answers. That is the defect; this module is the fix.
 *
 * ## Why a table HERE, and not in `messages/*.json`
 *
 * Two properties have to hold at once, and they rule out the catalogue:
 *
 *   1. **French must keep rendering the API's words verbatim.** The API is a
 *      French-language contract, and `e2e/wizard-steps.spec.ts` pins that the
 *      wizard shows the labels the RESPONSE supplies, not labels of its own
 *      ("never its own labels"). A `fr` catalogue entry would have to be dead
 *      text — present, keyed, and never allowed to win — or it would break that
 *      pin the day the API renames an option.
 *   2. **`ar` needs keys that `fr` does not.** `scripts/check-i18n.mjs` rule 5
 *      requires both catalogues to carry the same key set, because a key only
 *      `fr` has renders `MISSING_MESSAGE` on `/ar`. The mirror case is the one
 *      here, and exempting a key prefix from that gate would also exempt future
 *      keys that really are forgotten translations.
 *
 * So the overlay lives beside the model instead, keyed by the CONTRACT VALUE,
 * with the API's label as the fallback. That is the same shape
 * `lib/i18n/format.ts` already uses for `CURRENCY_LABEL` ("a copy decision …
 * it belongs in this map rather than at 40 call sites"), and it keeps the rule
 * this module must not break: **a value with no entry is rendered exactly as the
 * API sent it**, so a new option can never disappear or be mislabelled.
 *
 * ## What is deliberately absent
 *
 * `resolution` has no entry: its values are technical shelf names ("Full HD
 * (1080p)", "QHD (1440p)", "4K UHD (2160p)") that Arabic product pages write the
 * same way, and none of them is a French word. `priority` 2 and 4 have no entry
 * for the opposite reason: `PRIORITY_CHOICES` never offers them (`model.ts`), so
 * translating a label nothing renders would be invented copy.
 */
import type { AppLocale } from "@/lib/i18n/format";

/**
 * The option groups a label may be translated for — every group the wizard asks.
 * `resolution` has no table today (its values are technical shelf names); it is
 * in the union so translating one later is a data change, not a signature change
 * at three call sites.
 */
export type LabelledOptionKind = "use_case" | "resolution" | "priority";

/**
 * Translations, by locale and contract value. A locale with no table renders the
 * API's own label — which is why `fr` is empty rather than a copy of the API.
 */
const OPTION_LABELS: Record<AppLocale, Partial<Record<LabelledOptionKind, Record<string, string>>>> = {
  fr: {},
  ar: {
    use_case: {
      GAMING: "الألعاب",
      OFFICE: "المكتب",
      WORKSTATION: "العمل الاحترافي",
    },
    priority: {
      // The three values the wizard offers, in `PRIORITY_CHOICES` order.
      "1": "السعر أولاً",
      "3": "متوازن",
      "5": "الأداء أولاً",
    },
  },
};

/**
 * The label to render for one option of one group.
 *
 * `apiLabel` is the fallback, not a secondary source: when the locale has no
 * translation for this value, the contract's word is the answer.
 */
export function localizedOptionLabel(
  kind: LabelledOptionKind,
  value: string | number,
  locale: AppLocale,
  apiLabel: string,
): string {
  return OPTION_LABELS[locale][kind]?.[String(value)] ?? apiLabel;
}
