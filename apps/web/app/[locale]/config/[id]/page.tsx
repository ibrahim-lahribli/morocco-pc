import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { LinkButton } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/i18n/paths";

/**
 * `/fr/config/[id]` — the destination of the wizard's POST (S10).
 *
 * SCOPE, stated plainly: this is a HAND-OFF, not the results page. S11 owns that
 * screen — the SSR fetch of `GET /v1/recommendations/:id`, the strategy cards,
 * the component list and the total-vs-budget bar — and S14 owns the zero-build
 * state. What S10 needs is somewhere honest to land, because the alternative is
 * handing a user who just pressed "Voir mes configurations" a 404 the moment the
 * request succeeds. So this page says exactly two true things (the request is
 * stored, and the detailed screen is the next step) and shows the identifier the
 * request produced, which is the one fact it actually has: the POST response is
 * not carried across a navigation, so re-fetching by id is S11's job, not a
 * client-side cache growing here.
 *
 * It is DYNAMIC rather than prerendered: the id is whatever the API minted, so
 * there is nothing to generate ahead of time. `noindex` is deliberate and
 * permanent — a result id is a durable reference to one person's query, and a
 * search result pointing at it would be a data leak dressed as a page (S11's
 * metadata policy will keep it).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "result" });
  return {
    title: `morocco-pc — ${t("title")}`,
    robots: { index: false, follow: false },
  };
}

export default async function ConfigPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "result" });

  return (
    <section>
      <h1 className="text-heading text-ink">{t("title")}</h1>
      <p className="mt-3 max-w-prose text-body text-ink">{t("stored")}</p>
      <p className="mt-1.5 max-w-prose text-caption text-muted">{t("pending")}</p>

      <p className="mt-6 flex flex-wrap items-center gap-2 text-caption text-muted">
        <span>{t("idLabel")}</span>
        {/*
          The identifier is a UUID, and Arabic is an RTL document: without `dir`
          the hyphens reorder and the value looks like a different id to anyone
          who copies it. `break-all` keeps a long id inside a 360 px column.
        */}
        <code dir="ltr" className="break-all rounded-control bg-subtle px-2 py-1 font-mono text-ink">
          {id}
        </code>
      </p>

      <div className="mt-8">
        <LinkButton href={localePath(locale, "/configurer")} variant="secondary">
          {t("back")}
        </LinkButton>
      </div>
    </section>
  );
}
