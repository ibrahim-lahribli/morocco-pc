/**
 * lib/catalog/compare.ts — the compare view's decisions, as pure functions (S23).
 *
 * The comparison is a VIEW of the catalogue, not a second copy of it: every
 * value it prints comes from `presentSpecs()`, the same module the component
 * page uses, so a spec cannot be formatted one way on its own page and another
 * way beside a sibling. Four rules, and each one is a way a comparison lies:
 *
 * 1. **The URL is the selection.** `?slugs=a,b` is the whole state, so a shared
 *    link reproduces the view and the Back button works. There is no cookie, no
 *    localStorage and no client store — nothing that could make the page a
 *    different comparison for two people holding the same URL.
 * 2. **Two or three, never more.** `MAX_COMPARE` bounds the columns for a
 *    reason: at 360 px a comparison is a stack of labelled values, and beyond
 *    three it stops being readable even when it still fits.
 * 3. **A missing value is a WORD, not a zero and not a dash.** `presentSpecs()`
 *    omits a NULL row for a single product, which is right for a spec sheet. In
 *    a comparison the absence is itself information — "one of these publishes
 *    this fact, the other does not" — so the cell says so, and the row counts as
 *    a difference. It is never drawn as `0` or `—`.
 * 4. **Only the same category can be compared.** The spec tables are per
 *    category, so a GPU beside a RAM kit would render every row as "unknown"
 *    and call that a comparison. `commonCategory()` answers, and the page says
 *    why instead of drawing noise.
 */
import type { CatalogProductResponse } from "../api/client";
import type { AppLocale } from "../i18n/format";
import { localePath } from "../i18n/paths";
import { presentSpecs, type SpecCopy } from "./specs";

/** Columns a comparison may hold. Three fits a 360 px stack and a wide table. */
export const MAX_COMPARE = 3;

/** The route, without a locale prefix and without a query string. */
export const COMPARE_PATH = "/composants/comparer";

/** What the query string said, and what the view had to drop to honour it. */
export interface CompareSelection {
  slugs: string[];
  /** The same slug appeared more than once; it is shown once. */
  duplicates: boolean;
  /** More than `MAX_COMPARE` slugs were asked for; the tail is not shown. */
  overflow: boolean;
}

/**
 * `?slugs=a,b` as a selection, in URL order.
 *
 * Both shapes Next hands a page are accepted (`string` for one occurrence,
 * `string[]` for `?slugs=a&slugs=b`), and each value may still hold a
 * comma-separated list, so a hand-edited URL behaves like a shared one. Empty
 * segments are not "a product named nothing": they are ignored silently.
 */
export function parseCompareSlugs(raw: string | string[] | undefined): CompareSelection {
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const slugs: string[] = [];
  let duplicates = false;
  let overflow = false;

  for (const value of values) {
    for (const part of value.split(",")) {
      const slug = part.trim();
      if (slug === "") continue;
      if (slugs.includes(slug)) {
        duplicates = true;
        continue;
      }
      if (slugs.length >= MAX_COMPARE) {
        overflow = true;
        continue;
      }
      slugs.push(slug);
    }
  }

  return { slugs, duplicates, overflow };
}

/** The URL for a selection. Slugs are data, so each one is encoded. */
export function comparePath(locale: string, slugs: readonly string[]): string {
  const base = localePath(locale, COMPARE_PATH);
  if (slugs.length === 0) return base;
  return `${base}?slugs=${slugs.map((slug) => encodeURIComponent(slug)).join(",")}`;
}

/** The same selection without one slug — the "Retirer" link's target. */
export function withoutSlug(slugs: readonly string[], slug: string): string[] {
  return slugs.filter((value) => value !== slug);
}

/** The product as this module needs it: identity, category and its open specs. */
export type CompareProduct = Pick<
  CatalogProductResponse,
  "slug" | "display_name" | "category" | "specs"
>;

/**
 * The category every product shares, or null when they do not share one.
 *
 * One product trivially shares its own category; zero products have none. The
 * page only draws a table when this returns a category, which is rule 4.
 */
export function commonCategory(products: readonly { category: string }[]): string | null {
  if (products.length === 0) return null;
  const first = products[0].category;
  return products.every((product) => product.category === first) ? first : null;
}

/** One product's value in one row, or null when it publishes nothing here. */
export interface CompareCell {
  slug: string;
  value: string | null;
}

export interface CompareRow {
  key: string;
  label: string;
  cells: CompareCell[];
  /** True when the cells are not all the same — including a missing value. */
  differs: boolean;
}

export interface ComparisonSummary {
  total: number;
  same: number;
  different: number;
}

export interface Comparison {
  rows: CompareRow[];
  summary: ComparisonSummary;
}

/** The spec copy, plus the word for a value this product does not publish. */
export type CompareCopy = SpecCopy & { unknown: string };

/**
 * The rows of a comparison, in display order.
 *
 * Order is the CURATED spec order, not the products' arrival order: each
 * product's `presentSpecs()` rows already follow the category's curated list,
 * and the union preserves the first product's sequence, appending a key the
 * first product does not carry where the later one places it. A reader
 * therefore sees the same order as on a component page, with the extra facts
 * slotted in rather than dumped at the end.
 *
 * Labels come from the first product that carries the key. They are copy, not
 * data, so two products could not disagree about one — but taking the first is
 * still the rule that keeps the value single-sourced.
 */
export function buildComparison(
  products: readonly CompareProduct[],
  locale: AppLocale,
  copy: CompareCopy,
): Comparison {
  const rowsPerProduct = products.map((product) => presentSpecs(product, locale, copy));

  const order: string[] = [];
  const labels = new Map<string, string>();
  for (const rows of rowsPerProduct) {
    for (const row of rows) {
      if (labels.has(row.key)) continue;
      labels.set(row.key, row.label);
      order.push(row.key);
    }
  }

  const rows: CompareRow[] = order.map((key) => {
    const cells: CompareCell[] = rowsPerProduct.map((rows, index) => {
      const row = rows.find((candidate) => candidate.key === key);
      return { slug: products[index].slug, value: row === undefined ? null : row.value };
    });
    // `Set` over the rendered VALUES: formatting is shared with the spec sheet,
    // so "245 mm" and "245 mm" are equal and nothing compares raw JSON.
    const distinct = new Set(cells.map((cell) => cell.value));
    return { key, label: labels.get(key) ?? key, cells, differs: distinct.size > 1 };
  });

  const same = rows.filter((row) => !row.differs).length;
  return { rows, summary: { total: rows.length, same, different: rows.length - same } };
}
