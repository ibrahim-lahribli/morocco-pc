import React from "react"
import type { PageProps } from "next"
import { notFound } from "next/navigation"
import { status } from "@/lib/i18n/status"
import { Heading, Heading1, Alert, LinkButton } from "@/components/ui"
import { formatClearances } from "@/lib/i18n/format"

export default async function PriceHistoryPathPage({ params }: PageProps<{ locale: string; slug: string }>) {
  const resolved = await params.locale
  if (!["fr", "ar"].includes(resolved)) return notFound()
  const active = resolved

  const segment = params.__route_segments?.at(-1)
  const canonicalSlug = segment?.toLowerCase()
  if (!canonicalSlug || canonicalSlug.includes("/")) return notFound()

  const entries = parseUrlCandidates(canonicalSlug)
  if (entries.length === 0) return notFound()

  return (
    <>
      <Head canonical={canonical(active, ["compare", "price", "history", canonicalSlug])} metaDescription={status.metaDescription(active).slice(0, 155)} />
      <Heading1 type="priceHistoryPath"><StatusInfo items={renderStatusLines(entries)} /></Heading1>
      <Alert type="priceHistoryPath">{status.t("compare:emptyState")}</Alert>
      <LinkButton href="/apps/web">
        {status.t("compare:toolsPageLink")}
      </LinkButton>
    </>
  )
}

export async function generateStaticParams() {
  return [{ locale: "fr", slug: "comparer" }, { locale: "ar", slug: "comparer" }]
}
