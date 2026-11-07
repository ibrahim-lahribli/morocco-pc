"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui";
import type { PriceBadgeStatus } from "@/lib/homepage/builds";

export interface PriceStatusBadgeProps {
  /** The build's own status, already narrowed. `null` renders nothing. */
  status: PriceBadgeStatus | null;
}

/**
 * The card's only price-provenance claim.
 *
 * `null` renders no badge at all — never "indicatif" as a default, and never the
 * preset-level summary as a stand-in for the build's own status.
 */
export function PriceStatusBadge({ status }: PriceStatusBadgeProps) {
  const t = useTranslations("Homepage.builds.badge");

  if (status === null) {
    return null;
  }

  return <Badge tone={status}>{t(status)}</Badge>;
}
