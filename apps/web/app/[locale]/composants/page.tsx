import type { Metadata } from "next";
import Link from "next/link";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { CATALOG_CATEGORIES, catalogCategory } from "@/lib/catalog/model";
import { catalogListingCached } from "@/lib/catalog/load";
import { localePath } from "@/lib/i18n/paths";
import { pageAlternates } from "@/lib/seo/site";

/**
 * `/{locale}/composants` — the catalogue index, the route the bare prefix lands
 * on. Before this page existed, `/fr/composants` fell into the catch-all and
 * answered the 404; every other catalogue case already had its home.
 *
 * What it is, and the two decisions worth naming:
 *
 *   - **One listing walk, no detail reads.** `catalogListing()` walks
 *     `GET /v1/catalog/products` the same keyset way the sitemap's candidate
 *     half does, and lists what the catalogue SERVES — placeholder price or
 *     none — because every entry's destination (`composants/[slug]`) exists
 *     regardless of its prices; the sitemap applies the stricter indexable
 *     predicate AFTER this step, which is why the two walkers stay separate
 *     stages of the same route file.
 *   - **A walk that fails is words, not an error.** No API configured, a 5xx, a
 *     timeout, a 429 — all render the `unavailable` copy and the wizard CTA,
 *     `catalogCandidates()`'s degradation for the picker. A navigation page
 *     that 500s would be the one catalogue URL that leads nowhere, which is
 *     exactly what this page exists to prevent. The copy is ONE sentence for
 *     both "no API configured in this build" and "the catalogue did not
 *     answer tonight" — the visitor-facing difference between those two is
 *     nil.
 *
 * **`force-dynamic`, for the comparer's reason.** CI builds with no API, and
 * an ISR prerender of this route would freeze the empty copy into the HTML
 * the first post-deploy hour serves — the same hazard `comparer/page.tsx`
 * documents for its own route. The WALK inside stays cheap: the fetches carry
 * the catalogue's `revalidate` window, so a warm deployment averages one
 * cached set of reads per window, not one per visitor.
 *
 * The category grouping is the enum's own order (`CATALOG_CATEGORIES`), so
 * today's catalogue and tomorrow's render the same shape, and a category value
 * the copy has no word for is not dropped — it renders under the
 * `categoryFallback` heading rather than silently vanishing.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "catalog" });

  return {
    title: t("index.meta.title"),
    description: t("index.meta.description"),
    alternates: pageAlternates(safe, "/composants"),
  };
}

export default async function CatalogIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const products = await catalogListingCached();
  const t = await getTranslations({ locale, namespace: "catalog" });

  // The enum's own order, dropping the categories with no entries. A product
  // whose category is a value the copy has no word for still appears, under the
  // generic heading — the same `categoryFallback` rule the product page uses.
  const groups = new Map<string, typeof products>();
  for (const category of CATALOG_CATEGORIES) {
    const entries = products.filter((product) => product.category === category);
    if (entries.length > 0) groups.set(category, entries);
  }
  const unmatched = products.filter(
    (product) => catalogCategory(product.category) === null,
  );
  if (unmatched.length > 0) groups.set("__fallback__", unmatched);

  return (
    <section>
      <h1 className="text-heading break-words text-ink">{t("index.title")}</h1>
      <p className="mt-2 text-compact text-muted">{t("index.intro")}</p>

      {products.length === 0 ? (
        <p className="mt-6 text-compact text-muted">{t("index.unavailable")}</p>
      ) : null}

      {unmatched.length > 0 && products.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-subtitle text-ink">{t("categoryFallback")}</h2>
          <ul className="mt-3 divide-y divide-border rounded-card border border-border">
            {unmatched.map((product) => (
              <li key={product.slug}>
                <Link
                  href={localePath(locale, `/composants/${product.slug}`)}
                  className="block px-4 py-3 text-compact break-words text-primary underline-offset-4 hover:underline"
                >
                  <span dir="auto">{product.display_name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {Array.from(groups.entries())
        .filter(([category]) => category !== "__fallback__")
        .map(([category, entries]) => (
          <section key={category} className="mt-6">
            <h2 className="text-subtitle text-ink">{t(`categories.${category}`)}</h2>
            <ul className="mt-3 divide-y divide-border rounded-card border border-border">
              {entries.map((product) => (
                <li key={product.slug}>
                  <Link
                    href={localePath(locale, `/composants/${product.slug}`)}
                    className="block px-4 py-3 text-compact break-words text-primary underline-offset-4 hover:underline"
                  >
                    <span dir="auto">{product.display_name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

      <div className="mt-6">
        <Link
          href={localePath(locale, "/configurer")}
          className="text-compact text-primary underline-offset-4 hover:underline"
        >
          {t("cta")}
        </Link>
      </div>
    </section>
  );
}
