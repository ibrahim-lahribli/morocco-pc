import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { LinkButton } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/i18n/paths";
import { pageAlternates } from "@/lib/seo/site";

/**
 * The home page: the shell's proof that copy comes from messages, not JSX.
 *
 * It is deliberately short, and what it does is route: the wizard lives at
 * `/configurer` (S7), so this page's job is to send someone there — with a
 * LINK, not a button that pushes a route, because a navigation must be a link
 * to keep open-in-new-tab and an honest role.
 *
 * The rule this page demonstrates has not changed: no sentence a translator
 * would need lives in a component.
 */
/**
 * S18: the canonical is `/fr` (or `/ar`), self-referencing, with `fr` +
 * `x-default` hreflang. The title and description stay the layout's — Next
 * merges a page's metadata over its layout's, so this adds the crawl surface
 * without restating copy that already lives in one place.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  return { alternates: pageAlternates(safe, "/") };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <section>
      <h1 className="text-2xl font-semibold text-balance">{t("title")}</h1>
      <p className="mt-4 max-w-prose">{t("intro")}</p>
      <div className="mt-6">
        <LinkButton href={localePath(locale, "/configurer")}>{t("cta")}</LinkButton>
      </div>
    </section>
  );
}
