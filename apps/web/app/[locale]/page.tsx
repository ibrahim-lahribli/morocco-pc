import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { LinkButton } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/i18n/paths";

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
