/**
 * lib/presets/model.ts — the preset page's decisions, as pure functions (S16).
 *
 * Three rules live here, and none of them is plumbing:
 *
 * ## 1. The slug is a closed grammar, parsed in one place
 *
 * `/fr/config-pc-gamer-9000-dh` is an SEO URL a stranger (or a crawler) can
 * mistype, so the page must be able to say NO without rendering anything. The
 * grammar is pinned here rather than split between a route regex and a page
 * check: the family list, the `-dh` suffix and the integer rule are the same
 * fact, and `presetSlug()` is the inverse so no test or link hand-builds a URL
 * the parser would reject.
 *
 * The budget is a PLAIN INTEGER in the slug (the sprint's DoD), never a
 * formatted amount: a narrow no-break space or a currency word in a path is a
 * second URL for the same page. It is accepted only when the wizard could also
 * ask that question (`BUDGET_MAX`), because the page's call to action
 * pre-fills the wizard — a preset above the wizard's ceiling would deep-link
 * into a query the app refuses, which is a broken page with a 200.
 *
 * ## 2. Indexability follows the DATA, and fixtures are never indexable
 *
 * A fixture page is a demonstration: its prices are placeholders, whatever
 * `offer_class` the fixture asserts. W3's rule is "noindex until real prices
 * exist", so the source is part of the predicate: a page may be indexed only
 * when it was served by the API AND every rendered build is `verified` — the
 * same `priceProvenance()` the S12 badge shows and the S19 JSON-LD gate
 * refuses. Reusing that function is the point: a page cannot be "verified" for
 * a crawler and "indicatif" for the reader.
 *
 * ## 3. Revalidation is a configured interval, not an accident
 *
 * `PRESET_REVALIDATE_SECONDS` is the fetch cache lifetime the loader uses. The
 * page must ALSO export a literal `revalidate` (Next requires a statically
 * analyzable value), which is why the number is stated here once and the page
 * carries a comment pointing at it; `e2e/preset.spec.ts` pins the resulting
 * `s-maxage` so a drift between the two is a red test rather than a page that
 * quietly never refreshes.
 */
// Relative imports on purpose: this module is pure, and `e2e/preset-model.spec.ts`
// imports it directly to test the slug grammar and the indexability rule without
// a browser. Relative paths keep that import resolvable by every runner, not just
// Next's aliasing.
import type { Build } from "../result/model";
import { priceProvenance } from "../result/model";
import { BUDGET_MAX } from "../wizard/model";

/** One SEO family: a slug prefix, the contract's `use_case`, and its currency. */
export interface PresetFamily {
  /** The prefix every slug in this family starts with, e.g. `config-pc-gamer`. */
  slug: string;
  /** The `use_case` value the ribbon is asked for (contract vocabulary). */
  useCase: string;
  /** The currency the ribbon is asked for; the app prices in MAD. */
  currency: string;
}

/**
 * The families this sprint ships.
 *
 * One entry is deliberate: S16's DoD pins `config-pc-gamer-{budget}-dh`, and the
 * OFFICE/Workstation families need their own fixtures and copy. Adding one is a
 * new entry here — the parser, the links and the page are all driven by this
 * list, so nothing else changes.
 */
export const PRESET_FAMILIES: readonly PresetFamily[] = [
  { slug: "config-pc-gamer", useCase: "GAMING", currency: "MAD" },
];

/** The unit suffix every preset slug ends with (Moroccan copy writes "DH"). */
export const PRESET_SLUG_SUFFIX = "dh";

/**
 * How long a preset page (and its data fetch) may be reused, in seconds.
 *
 * The ribbon is a pointer at ordinary passes (Decision 48) and changes only when
 * it is regenerated, so an hour is generous without being stale-forever. The
 * page exports the same number as a literal `revalidate`; change both together.
 */
export const PRESET_REVALIDATE_SECONDS = 3600;

/**
 * The grammar, built FROM the family list so a new family cannot be added to the
 * data and forgotten by the parser.
 *
 * `[1-9][0-9]{0,6}` refuses `0`, `007` and a sign: a budget is a positive
 * integer, and two spellings of one budget would be two indexed URLs.
 */
const SLUG_PATTERN = new RegExp(
  `^(${PRESET_FAMILIES.map((family) => family.slug).join("|")})-([1-9][0-9]{0,6})-${PRESET_SLUG_SUFFIX}$`,
);

export interface ParsedPresetSlug {
  family: PresetFamily;
  budget: number;
}

/**
 * The budget a slug may carry, or null when the value is not one.
 *
 * One rule, three callers: the parser (does this URL name a page?), the slug
 * builder (may I produce this URL?) and the ribbon reader (may this API value
 * become a page at all?). Splitting them is how a page ends up generated at a
 * URL the grammar refuses, or a build crashing on a bad API number.
 */
export function presetBudget(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value <= 0 || value > BUDGET_MAX) return null;
  return value;
}

/**
 * The family and budget a slug names, or null when it names nothing this app
 * owns. Null is a 404, never a crash: the route segment is generic, so every
 * single-segment path inside a locale lands here.
 */
export function parsePresetSlug(slug: string): ParsedPresetSlug | null {
  const match = SLUG_PATTERN.exec(slug);
  if (match === null) return null;
  const family = PRESET_FAMILIES.find((entry) => entry.slug === match[1]);
  if (family === undefined) return null;
  const budget = presetBudget(Number(match[2]));
  if (budget === null) return null;
  return { family, budget };
}

/**
 * The slug for a budget. Throws on an unusable budget: this is called from
 * `generateStaticParams` and from links, where a non-integer is a programmer
 * error, not a user input.
 */
export function presetSlug(budget: number, family: PresetFamily = PRESET_FAMILIES[0]): string {
  // The same ceiling as the parser: a slug this function emits is one
  // `parsePresetSlug()` accepts, so a caller cannot generate a page that 404s.
  if (presetBudget(budget) === null) {
    throw new RangeError(
      `presetSlug: ${String(budget)} is not a positive integer budget the slug grammar accepts`,
    );
  }
  return `${family.slug}-${budget}-${PRESET_SLUG_SUFFIX}`;
}

/** Where a page's data came from — the half of indexability that is not a price. */
export type PresetSource = "api" | "fixture";

/**
 * Whether a preset page may be indexed.
 *
 * `api` is required because a fixture is a demonstration, not a quote (see the
 * header). On top of that, EVERY rendered build must be `verified`: one demo or
 * indicative card on a page a crawler may read is the V6 lie with a canonical
 * URL. An empty build list is not indexable either — a landing page that
 * advertises no build should not exist, let alone rank.
 */
export function presetIndexable(
  source: PresetSource,
  builds: readonly Pick<Build, "price_status" | "components">[],
): boolean {
  if (source !== "api") return false;
  if (builds.length === 0) return false;
  return builds.every((build) => priceProvenance(build) === "verified");
}
