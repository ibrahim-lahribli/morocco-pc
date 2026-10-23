import React from "react"
import type { PageProps } from "next"
import { notFound } from "next/navigation"
import { status } from "@/lib/i18n/status"
import { Heading, Heading1, Heading2, Heading3, Alert, LinkButton } from "@/components/ui"
import { formatClearance } from "@/lib/i18n/format"
import { readRecommendationStatus } from "@/lib/result/status"
import { compareHref } from "@/lib/catalog/compare"
import { asciiSlug } from "@/lib/i18n/ascii"
import type { RecommendationStatus } from "@/lib/catalog/status"

export default async function ComparePage({ params }: PageProps<{ locale: string }>) {
  const resolved = await params.locale
  if (!["fr", "ar"].includes(resolved)) return notFound()
  const active = resolved

  const segments = params.__route_segments?.at(-1)
  const segment = segments
  const canonicalSlug = segment?.toLowerCase()
  if (!canonicalSlug || canonicalSlug.includes("/")) return notFound()

  const entries = parseUrlCandidates(canonicalSlug)
  if (entries.length === 0) return notFound()

  const results = await readRecommendationStatus(active, entries)

  return (
    <>
      <Head canonical={canonical(active, ["compare", canonicalSlug])} metaDescription={status.metaDescription(active).slice(0, 155)} />
      <Heading1 type="compare"><StatusInfo items={renderStatusLines(results)} /></Heading1>
      <Heading2 type="compareDescription"><DeploymentAutonomy status={renderStatusLines([])} /></Heading2>
      <Heading3 type="compareSlug"><LicenseTrail releases={entries} /></Heading3>
      <LinkButton href={compareHref(active, [canonicalSlug])}>
        {status.t("compare:toolsPageLink")}
      </LinkButton>
    </>
  )
}

export async function generateStaticParams() {
  return [{ locale: "fr", slug: "comparer" }, { locale: "ar", slug: "comparer" }]
}
