import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { SavedBuilds } from "@/components/saved/saved-builds";
import { routing } from "@/i18n/routing";
import { type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { OTHER_KEY, STRATEGY_KEYS } from "@/lib/result/model";
import { pageAlternates } from "@/lib/seo/site";

/**
 * `/{locale}/enregistrements` — the builds saved on THIS device (S25).
 *
 * The page is a server component and prerenders per locale, because it has no
 * data of its own: the shelf lives in `localStorage`, which only the browser can
 * read, so the island inside renders the empty state in the HTML and reconciles
 * after hydration. Nothing here is fetched, so nothing here can be stale.
 *
 * **No account, and the copy says so.** A save is a browser-local list of links
 * back to `/config/[id]`; it is not synced, not shared and not recoverable on
 * another device. Saying that on the page is the whole honesty requirement of
 * this sprint — a list that looked like an account backlog would be a promise
 * this app cannot keep.
 *
 * **`index: false, follow: true`.** This is a user's own shelf, not a document:
 * a crawler has no business listing it (and the sitemap leaves it out for the
 * same reason, per S18's rule for user-generated views). The links back to
 * results stay followable, which is what `follow` keeps.
 */
const SAVED_PATH = "/enregistrements";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "saved" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: pageAlternates(safe, SAVED_PATH),
    robots: { index: false, follow: true },
  };
}

export default async function SavedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale, namespace: "saved" });
  // The strategy WORDS are the results page's own (S11), reused rather than
  // re-written: a saved build must not be called something the card never says.
  const tResult = await getTranslations({ locale, namespace: "result" });
  const strategies: Record<string, string> = Object.fromEntries(
    [...STRATEGY_KEYS, OTHER_KEY].map((key) => [key, tResult(`strategies.${key}`)]),
  );

  return (
    <section>
      <h1 className="mt-1 text-heading text-ink">{t("title")}</h1>
      <p className="mt-2 max-w-prose text-body text-muted">{t("intro")}</p>

      <SavedBuilds
        locale={appLocale}
        wizardHref={localePath(locale, "/configurer")}
        strategies={strategies}
        labels={{
          emptyTitle: t("emptyTitle"),
          emptyBody: t("emptyBody"),
          emptyCta: t("emptyCta"),
          readUnavailable: t("readUnavailable"),
          removeUnavailable: t("removeUnavailable"),
          open: t("open"),
          remove: t("remove"),
          removed: t("removed"),
          savedOnLabel: t("savedOnLabel"),
          noTotal: t("noTotal"),
        }}
      />
    </section>
  );
}
