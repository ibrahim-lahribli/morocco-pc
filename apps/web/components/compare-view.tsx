/**
 * components/compare-view.tsx — S23's comparison and its picker.
 *
 * ## One row set, two layouts, and exactly one of them in the tree
 *
 * The comparison is a real `<table>` at `lg` and up — `<caption>`, `<th scope="col">`
 * per product, `<th scope="row">` per characteristic — and at 360 px it is one card
 * per product with a `<dl>`. Both are built from the SAME row objects
 * (`buildCompareRows()`), so their text cannot drift, and each is `display:none`
 * at the other's breakpoint: a hidden table is out of the accessibility tree and
 * out of axe, so nothing is read twice, and the card reader gets a document in
 * reading order instead of a table whose label column is off-screen.
 *
 * The alternative — one table restyled into blocks with CSS at narrow widths — was
 * rejected: changing `display` on table elements makes browsers drop the table
 * semantics, so the reader who most needs the row labels loses them.
 *
 * ## The status is a WORD, on every row
 *
 * "Identique" / "Différent" sits beside each characteristic, and the tint is only
 * support. That is the DoD's "diff highlighting has a text equivalent": a reader
 * who cannot see the colour, and a screen reader that ignores it, still know which
 * rows agree. The word is repeated in each card because a card is read on its own —
 * a status stated once in a table header would not survive being linearised.
 *
 * ## The picker writes the URL and nothing else
 *
 * Every affordance is an `<a>` whose href is the whole next state
 * (`compareHref(locale, toggleCompareSlug(...))`), so adding or removing a product
 * is a navigation: no client component, no state to synchronise, keyboard support
 * from the browser, and Back works. The links carry the product's name in their
 * accessible name ("Ajouter RTX 4060 8GB"), because a list of links all called
 * "Ajouter" tells a screen-reader user nothing about which product they add.
 *
 * Server components: both fetch their own translations and hold no state, so
 * nothing here ships to the browser.
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { cn } from "@/components/ui";
import type { CatalogProductResponse } from "@/lib/api/client";
import {
  buildCompareRows,
  COMPARE_MAX,
  COMPARE_MIN,
  compareHref,
  toggleCompareSlug,
  type CompareRow,
} from "@/lib/catalog/compare";
import type { CatalogueListItem } from "@/lib/catalog/load";
import { catalogCategory } from "@/lib/catalog/model";
import { specCopy } from "@/lib/catalog/specs";
import { formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";

/** The one link treatment here; the tap height is the kit's 44 px floor. */
const LINK_CLASS =
  "inline-flex min-h-tap items-center text-compact font-medium text-primary underline-offset-4 hover:underline";

/** A product page link, used by both layouts. */
function productHref(locale: AppLocale, slug: string): string {
  return localePath(locale, `/composants/${slug}`);
}

export interface CompareViewProps {
  /** The products that resolved, in URL order. Two or more; the page owns fewer. */
  products: readonly CatalogProductResponse[];
  locale: AppLocale;
}

export async function CompareView({ products, locale }: CompareViewProps) {
  if (products.length < COMPARE_MIN) return null;

  const t = await getTranslations({ locale, namespace: "catalog" });
  const rows = buildCompareRows(products, locale, specCopy(t));
  const status = (row: CompareRow): string =>
    row.differs ? t("compare.differs") : t("compare.same");

  return (
    <section className="mt-6">
      <h2 className="text-subtitle text-ink">{t("compare.tableTitle")}</h2>

      <table className="mt-3 hidden w-full border-collapse text-compact lg:table">
        <caption className="pb-2 text-start text-caption text-muted">
          {t("compare.caption", { count: formatNumber(products.length, locale) })}
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-2 py-2 text-start text-caption font-semibold text-muted">
              {t("compare.specColumn")}
            </th>
            {products.map((product) => (
              <th
                key={product.slug}
                scope="col"
                className="px-2 py-2 text-start text-caption font-semibold"
              >
                <Link
                  href={productHref(locale, product.slug)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  <span dir="auto">{product.display_name}</span>
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={cn("border-b border-border", row.differs && "bg-warning-soft")}
            >
              <th scope="row" className="px-2 py-2 text-start align-top font-normal text-ink">
                <span className="block">{row.label}</span>
                <span
                  className={cn(
                    "text-micro font-semibold",
                    row.differs ? "text-warning" : "text-muted",
                  )}
                >
                  {status(row)}
                </span>
              </th>
              {row.cells.map((cell, index) => (
                <td
                  key={products[index].slug}
                  className="num-tabular px-2 py-2 text-start align-top text-ink"
                >
                  {cell ?? <span className="text-muted">{t("compare.unknown")}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 grid gap-3 lg:hidden">
        {products.map((product, index) => (
          <article key={product.slug} className="rounded-card border border-border bg-surface p-4">
            <h3 className="text-subtitle text-ink break-words">
              <Link
                href={productHref(locale, product.slug)}
                className="text-primary underline-offset-4 hover:underline"
              >
                <span dir="auto">{product.display_name}</span>
              </Link>
            </h3>
            <dl className="mt-2 divide-y divide-border">
              {rows.map((row) => (
                <div key={row.key} className="py-2">
                  <dt className="text-micro text-muted">
                    <span className="block">{row.label}</span>
                    <span
                      className={cn("font-semibold", row.differs ? "text-warning" : "text-muted")}
                    >
                      {status(row)}
                    </span>
                  </dt>
                  <dd className="num-tabular mt-0.5 text-compact text-ink">
                    {row.cells[index] ?? (
                      <span className="text-muted">{t("compare.unknown")}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

export interface ComparePickerProps {
  /**
   * The slugs that RESOLVED, not the ones the URL named: carrying a dead token
   * forward would rebuild the same broken link on every click.
   */
  slugs: readonly string[];
  /** The catalogue as the list endpoint serves it; empty when that read failed. */
  products: readonly CatalogueListItem[];
  locale: AppLocale;
}

/**
 * The selection control: one row per catalogue product, and a link that is the
 * next URL. No client state, so the page's only state stays the address bar.
 */
export async function ComparePicker({ slugs, products, locale }: ComparePickerProps) {
  const t = await getTranslations({ locale, namespace: "catalog" });
  const atLimit = slugs.length >= COMPARE_MAX;

  return (
    <section className="mt-8">
      <h2 className="text-subtitle text-ink">{t("compare.pickerTitle")}</h2>

      {products.length === 0 ? (
        <p className="mt-2 text-compact text-muted">{t("compare.pickerUnavailable")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-card border border-border">
          {products.map((product) => {
            const selected = slugs.includes(product.slug);
            const category = catalogCategory(product.category);
            const price = product.from_price;

            return (
              <li
                key={product.slug}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2"
              >
                <span className="min-w-0">
                  <span dir="auto" className="block text-compact break-words text-ink">
                    {product.display_name}
                  </span>
                  <span className="block text-micro text-muted">
                    {category === null ? t("categoryFallback") : t(`categories.${category}`)}
                    {" · "}
                    {price === null ? t("noPrice") : formatMoney(price, locale)}
                  </span>
                </span>

                {selected ? (
                  <Link
                    href={compareHref(locale, toggleCompareSlug(slugs, product.slug))}
                    aria-label={t("compare.removeNamed", { name: product.display_name })}
                    className={LINK_CLASS}
                  >
                    {t("compare.remove")}
                  </Link>
                ) : atLimit ? (
                  /* At the cap the control is a sentence, not a dead link: a link
                     that silently does nothing is worse than no link at all. */
                  <span className="text-micro text-muted">{t("compare.max")}</span>
                ) : (
                  <Link
                    href={compareHref(locale, toggleCompareSlug(slugs, product.slug))}
                    aria-label={t("compare.addNamed", { name: product.display_name })}
                    className={LINK_CLASS}
                  >
                    {t("compare.add")}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
