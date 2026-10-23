/**
 * lib/catalog/compare.ts — the compare view's decisions, as pure functions (S23).
 *
 * Three things live here, and each one is a way the obvious version lies:
 *
 * ## 1. The URL is the whole state, and it is PARSED leniently
 *
 * `/composants/comparer?composants=a,b,c` is shareable, so every reading of it has
 * to survive what a chat client or a mail app does to a URL: an empty entry, a
 * repeated slug, more than three, the same slug twice. `parseCompareSlugs()` drops
 * blanks, keeps the FIRST occurrence (so re-sharing a link never reorders the
 * columns), and stops at three. It never throws and never invents a slug: a product
 * that no longer exists is the loader's business, not the parser's.
 *
 * ## 2. A row is a UNION of what the products publish, not an intersection
 *
 * Comparing two GPUs is the easy case; comparing a GPU with a drive is legal here
 * and nearly empty. The intersection would hide exactly the facts a reader came for
 * — "this one does not publish a TGP" is information — so every key that ANY
 * selected product publishes becomes a row, and a product that does not publish it
 * gets `null`, which the view renders as a WORD rather than a blank cell. That is
 * the repo's NULL rule (NULL is UNKNOWN, never zero) applied to a comparison.
 *
 * ## 3. `differs` is computed on the RENDERED text, and includes "unknown"
 *
 * `40 mm` against `Non renseigné` is a difference a reader must be told about, so
 * the comparison is between the strings the page shows, not between raw values —
 * two products whose `2` and `2.0` both render as `2` agree in front of the reader,
 * which is the only place the question matters. A row `differs` when its cells are
 * not all identical, and the view states that in words on every row, because a
 * colour alone is not a text equivalent.
 *
 * Row ORDER is the union in product order: the first product's curated category
 * order (from `presentSpecs`, which owns labels, units and the id skip), then any
 * key only the later products publish, in their own order. Reusing `presentSpecs`
 * is deliberate — a second formatter here would be a second answer to "what is this
 * spec called, and in what unit".
 */
import type { CatalogProductResponse } from "../api/client";
import type { AppLocale } from "../i18n/format";
import { presentSpecs, type SpecCopy } from "./specs";

/** The query parameter that carries the selection. */
export const COMPARE_PARAM = "composants";
/** Three side by side is what a 360 px card stack and a table can both hold. */
export const COMPARE_MAX = 3;
/** Fewer than two is not a comparison; the page says so instead of drawing one. */
export const COMPARE_MIN = 2;

/** What the compare view needs from a product — nothing more. */
export type CompareProduct = Pick<CatalogProductResponse, "category" | "specs">;

/**
 * The slugs a URL names, in the order it names them, deduped, capped at three.
 *
 * A repeated query parameter (`?composants=a&composants=b`) arrives as an array,
 * which is why the input is both shapes.
 */
export function parseCompareSlugs(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const slugs: string[] = [];

  for (const value of values) {
    for (const part of value.split(",")) {
      const slug = part.trim();
      if (slug === "" || slugs.includes(slug)) continue;
      slugs.push(slug);
      if (slugs.length === COMPARE_MAX) return slugs;
    }
  }

  return slugs;
}

/**
 * The compare URL for a selection.
 *
 * `encodeURIComponent` per slug, then a literal comma: a slug is `[a-z0-9-]` in
 * practice, but this way a slug that ever contained a comma or a space cannot break
 * the one separator the parser depends on.
 */
export function compareHref(locale: string, slugs: readonly string[]): string {
  const base = `/${locale}/composants/comparer`;
  if (slugs.length === 0) return base;
  const selection = slugs.map((slug) => encodeURIComponent(slug)).join(",");
  return `${base}?${COMPARE_PARAM}=${selection}`;
}

/**
 * The selection with one slug added or removed — the ONE function behind every
 * "Ajouter" and "Retirer" link, so the two cannot disagree about the cap or the
 * order. At the cap, an add is a no-op rather than a silent replacement.
 */
export function toggleCompareSlug(slugs: readonly string[], slug: string): string[] {
  if (slugs.includes(slug)) return slugs.filter((entry) => entry !== slug);
  if (slugs.length >= COMPARE_MAX) return [...slugs];
  return [...slugs, slug];
}

/** One feature row: its label, one cell per product, and whether they agree. */
export interface CompareRow {
  /** The spec key — a stable React key, never printed. */
  key: string;
  label: string;
  /** One entry per compared product, in selection order; null = not published. */
  cells: (string | null)[];
  /** True when the cells are not all identical, including "value vs unknown". */
  differs: boolean;
}

/**
 * Merge the selected products' spec rows into one comparison.
 *
 * Assumes at least one product; the page only calls it with two or more (the
 * single-selection state has no table at all).
 */
export function buildCompareRows(
  products: readonly CompareProduct[],
  locale: AppLocale,
  copy: SpecCopy,
): CompareRow[] {
  const perProduct = products.map(
    (product) => new Map(presentSpecs(product, locale, copy).map((row) => [row.key, row])),
  );

  const keys: string[] = [];
  for (const rows of perProduct) {
    for (const key of rows.keys()) {
      if (!keys.includes(key)) keys.push(key);
    }
  }

  return keys.map((key) => {
    const cells = perProduct.map((rows) => rows.get(key)?.value ?? null);
    const first = cells[0];
    // The label is the first product that publishes the key; they share one copy
    // map, so any of them answers the same word.
    const label = perProduct.find((rows) => rows.has(key))?.get(key)?.label ?? key;
    return {
      key,
      label,
      cells,
      differs: cells.some((cell) => cell !== first),
    };
  });
}
