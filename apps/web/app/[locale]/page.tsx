import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";

/**
 * The home page: the shell's proof that copy comes from messages, not JSX.
 *
 * It is deliberately short. S7–S9 replace it with the wizard, and when they do
 * the only thing they keep is the rule this page demonstrates: no sentence that
 * a translator would need lives in a component.
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
      <p className="mt-4 max-w-prose text-compact text-muted">{t("note")}</p>
    </section>
  );
}
