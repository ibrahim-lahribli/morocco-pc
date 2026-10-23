import type { Metadata } from "next";
import Link from "next/link";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { PriceHistory } from "@/components/price-history";
import { Badge, LinkButton } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { compareHref } from "@/lib/catalog/compare";
import {
  catalogCategory,
  catalogProvenance,
  componentPageIndexable,
  fromPrice,
  offerProvenance,
} from "@/lib/catalog/model";
import {
  componentAppearancesCached,
  loadCatalogProductCached,
  loadPriceHistoryCached,
} from "@/lib/catalog/load";
import { presentSpecs, specCopy, type SpecCopy } from "@/lib/catalog/specs";
import { formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { pageAlternates } from "@/lib/seo/site";

/**
 * `/{locale}/composants/{slug}` — the catalogue product page (S17).
 *
 * What it is built from, and what it deliberately is not:
 *
 *   - **ONE read of `GET /v1/catalog/products/:slug`** (CD-5), server-side and
 *     cached for the revalidation window. The product's name, category, spec row,
 *     offers and disclaimer all come from that body; nothing here is a second
 *     copy of the catalogue.
 *   - **Appearances are DERIVED** from the preset pages the site already serves
 *     (`lib/catalog/load.ts` explains the narrowing). The contract has no
 *     "used in" endpoint, and this page does not invent one.
 *   - **`noindex` until the prices are real.** `componentIndexable()` requires
 *     every offer to be VERIFIED, not merely a `price_status` column that says so
 *     — the same "indexability follows the data" rule S16 applies to presets.
 *   - **The price series is a THIRD read, and the one surface the contract
 *     does not have yet** (S25): `loadPriceHistory()` reads
 *     `/v1/catalog/products/:slug/price-history`, which only the fixture mock
 *     serves today. An absent series is "aucun relevé" rather than an error,
 *     and `<PriceHistory>` owns the three states and the text summary — this
 *     page only places it.
 *   - **A stale or unreachable API keeps the last good page.** The read
 *     propagates anything that is not a 404, so Next serves the previous ISR copy
 *     instead of replacing a product with an error; only "this slug names
 *     nothing" becomes the locale's 404.
 *
 * The spec list is the module's decision, not this page's: `presentSpecs()`
 * owns the order, the units, the NULL omission and the id skip (see its header).
 * Everything this page adds is a heading and a layout.
 *
 * `revalidate` must be a statically analyzable literal. It is the same number as
 * `CATALOG_REVALIDATE_SECONDS` in `lib/catalog/load.ts` — the fetch lifetime —
 * and the two are pinned together by `e2e/catalog.spec.ts`.
 */
export const revalidate = 3600;

/**
 * An EMPTY param list, on purpose, and it is what makes the route ISR.
 *
 * The catalogue's slugs are not known at build time (CI builds with no API), so
 * nothing can be prerendered — but a dynamic segment with NO
 * `generateStaticParams` at all is rendered fully dynamically by Next, which
 * sends `no-store` and costs a catalogue read per visitor. Declaring the
 * (empty) list with `dynamicParams` left at its default `true` is the
 * documented shape for "render on first request, then cache": the first visitor
 * populates the entry and everyone after them is served the cached page for
 * `revalidate` seconds. `e2e/catalog.spec.ts` pins the resulting `s-maxage`.
 */
export function generateStaticParams() {
  return [];
}

/** The three badge words come from the results page's namespace (S12/S17). */
const BADGE_KEY = {
  demo: "provenance.demo",
  indicative: "provenance.indicative",
  verified: "provenance.verified",
} as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "catalog" });

  const outcome = await loadCatalogProductCached(slug);
  if (outcome.kind === "missing") {
    // About to be a 404: nothing here may promise a product we do not serve.
    return { robots: { index: false, follow: false } };
  }

  const { product } = outcome;
  const category = catalogCategory(product.category);
  const categoryLabel =
    category === null ? t("categoryFallback") : t(`categories.${category}`);

  return {
    title: t("meta.title", { name: product.display_name, category: categoryLabel }),
    description: t("meta.description", { name: product.display_name }),
    // S18: the canonical is the product page itself, in the language being
    // served — and `componentPageIndexable()` decides whether it may enter the
    // sitemap, not whether it may name itself.
    alternates: pageAlternates(safe, `/composants/${product.slug}`),
    robots: {
      // The SAME call `/sitemap.xml`'s catalogue walk makes; a demo or indicative
      // price keeps the page out of the index while its links stay followable.
      index: componentPageIndexable(outcome),
      follow: true,
    },
  };
}

export default async function ComponentPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const appLocale = locale as AppLocale;
  const outcome = await loadCatalogProductCached(slug);
  if (outcome.kind === "missing") notFound();

  const { product } = outcome;
  const t = await getTranslations({ locale, namespace: "catalog" });
  // The price words are the badge's own (S12), reused rather than duplicated:
  // one vocabulary for "this price is a placeholder", everywhere it appears.
  const tResult = await getTranslations({ locale, namespace: "result" });

  const category = catalogCategory(product.category);
  const categoryLabel = category === null ? t("categoryFallback") : t(`categories.${category}`);

  const copy: SpecCopy = specCopy(t);
  const specs = presentSpecs(product, appLocale, copy);

  const provenance = catalogProvenance(product);
  const price = fromPrice(product);
  const appearances = await componentAppearancesCached(product.slug);
  // S25: the series is read once and passed whole; the component decides which
  // of its three states that makes.
  const priceHistory = await loadPriceHistoryCached(product.slug);

  return (
    <section>
      <p className="text-micro tracking-wide text-muted uppercase">{categoryLabel}</p>
      {/* `break-words` + a wrapping h1 is the 360 px rule: a 60-character vendor
          SKU must wrap inside the heading, not scroll the page sideways.

          S20's addition is the `dir` split, and it is deliberately on a SPAN:
          the name is DATA, so it resolves its own direction from its first
          strong character (a Latin name must keep its order next to the page's
          RTL punctuation), while the h1 keeps the PAGE's direction so the
          heading still aligns with the rest of the column. Putting `dir="auto"`
          on the h1 itself pushed this one heading to the wrong edge of the
          Arabic page — visible in the RTL screenshots, and the reason the
          attribute moved onto the span. */}
      <h1 className="mt-1 text-heading break-words text-ink">
        <span dir="auto">{product.display_name}</span>
      </h1>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Badge tone={provenance}>{tResult(BADGE_KEY[provenance])}</Badge>
        {price === null ? (
          <span className="text-compact text-muted">{t("noPrice")}</span>
        ) : (
          <span className="num-tabular text-title text-ink">
            {t("fromPrice", { amount: formatMoney(price, appLocale) })}
          </span>
        )}
      </div>

      <section className="mt-6">
        <h2 className="text-subtitle text-ink">{t("specs.title")}</h2>
        {specs.length === 0 ? (
          <p className="mt-2 text-compact text-muted">{t("specs.none")}</p>
        ) : (
          <dl className="mt-3 divide-y divide-border rounded-card border border-border">
            {specs.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-3 px-4 py-2">
                <dt className="min-w-0 text-compact text-muted">{row.label}</dt>
                <dd
                  dir="auto"
                  className="num-tabular min-w-0 text-end text-compact break-words text-ink"
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-subtitle text-ink">{t("offers.title")}</h2>
        {product.offers.length === 0 ? (
          <p className="mt-2 text-compact text-muted">{t("offers.none")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-card border border-border">
            {product.offers.map((offer, index) => (
              <li
                key={`${offer.price}:${index}`}
                className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-2"
              >
                <span className="num-tabular text-compact text-ink">
                  {formatMoney(offer.price, appLocale)}
                </span>
                {/* The class is an enum; the badge is its word. `SEED_UNVERIFIED`
                    is never a thing a reader should see. */}
                <Badge tone={offerProvenance(offer.offer_class)}>
                  {tResult(BADGE_KEY[offerProvenance(offer.offer_class)])}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The direction is a PROP because the chart is drawn on the server: an
          SVG coordinate system does not inherit `dir`, so the time axis has to
          be projected from the inline start explicitly. */}
      <PriceHistory
        observations={priceHistory}
        locale={appLocale}
        direction={locale === "ar" ? "rtl" : "ltr"}
      />

      <section className="mt-6">
        <h2 className="text-subtitle text-ink">{t("appearances.title")}</h2>
        {appearances.length === 0 ? (
          <p className="mt-2 text-compact text-muted">{t("appearances.none")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {appearances.map((appearance) => (
              <li key={`${appearance.slug}:${appearance.rank}`}>
                <Link
                  href={localePath(locale, `/${appearance.slug}`)}
                  className="text-compact text-primary underline-offset-4 hover:underline"
                >
                  {t("appearances.item", {
                    budget: formatMoney(appearance.budget, appLocale),
                    rank: formatNumber(appearance.rank, appLocale),
                  })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-micro text-muted">{product.disclaimer}</p>

      {/* S23: the entry point into the compare view, pre-selecting this
          product so the reader lands on the picker with one column already in
          place — a comparison needs two, and the URL is where they add the
          second. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <LinkButton href={localePath(locale, "/configurer")} variant="secondary">
          {t("cta")}
        </LinkButton>
        <LinkButton href={compareHref(locale, [product.slug])} variant="secondary">
          {t("compare.entry")}
        </LinkButton>
      </div>
    </section>
  );
}
