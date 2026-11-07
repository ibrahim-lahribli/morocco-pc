import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ConfiguratorShell } from "@/components/configurator/configurator-shell";
import { routing } from "@/i18n/routing";
import { parseConfiguratorSearchParams } from "@/lib/configurator/schema";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "Configurator.metadata" });

  return {
    title: `${t("title")} — morocco-pc`,
    description: t("description"),
  };
}

/**
 * The configurator route.
 *
 * The server validates the handoff: each `use_case`, `budget` and `from` value
 * becomes seed data or a visible field error, and an invalid value never
 * discards a valid neighbour. Nothing is rewritten or clamped — the URL the
 * visitor arrived with stays the URL they keep.
 *
 * The page is dynamic by definition (it reads `searchParams`) and renders only
 * the heading on the server; the answers and the build sheet live in the
 * client shell.
 */
export default async function ConfiguratorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const seed = parseConfiguratorSearchParams(await searchParams);
  const t = await getTranslations({ locale, namespace: "Configurator.page" });

  return (
    <div className="flex flex-col gap-8 pt-2 lg:gap-10">
      <header className="flex max-w-3xl flex-col gap-2">
        <p className="text-label-sm font-semibold tracking-wide text-primary">{t("eyebrow")}</p>
        <h1 className="text-display text-balance text-foreground lg:text-display-lg">
          {t("title")}
        </h1>
        <p className="text-body-lg text-muted">{t("intro")}</p>
      </header>

      <ConfiguratorShell seed={seed} />
    </div>
  );
}
