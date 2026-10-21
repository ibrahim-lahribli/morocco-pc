/**
 * The results page's component row — board §11, one line per part.
 *
 * Composition, not a kit primitive (`docs/design/COMPONENTS.md` says so): it is
 * a `<li>` inside the card's list, and it owns exactly the three facts the
 * contract gives a component — its ROLE (translated, never the enum), its
 * display NAME plus its variant, and the price actually used for the build.
 *
 * Three rules are encoded here rather than in the card, because they are about
 * the row:
 *
 *   - **The role is a word, not an enum.** `roleLabel()` maps the engine's
 *     vocabulary to a catalogue key and anything it does not know to "Autre".
 *     A user must never read `SSD_BOOT`.
 *   - **The variant is only printed when it adds something (V5, and a stutter).**
 *     `display_name` usually already contains it ("RTX 4060 8GB" with
 *     `variant: "8GB"`), so the muted suffix is conditional — `showsVariant()`.
 *   - **A NULL price is a sentence, never 0.** `price_used` is nullable in the
 *     contract (the selected price was not recorded), and painting it as 0 DH
 *     would be the same lie as a 0 DH total: the standing NULL != 0 rule.
 *
 * `offer_class` is deliberately NOT rendered. It is one half of a price's
 * provenance and `price_status` is the other; the badge that names both states
 * is S12's, and printing the raw class here would put `SEED_UNVERIFIED` in front
 * of a user — the exact thing V5 forbids.
 */
import { getTranslations } from "next-intl/server";

import { cn } from "@/components/ui";
import { formatMoney, type AppLocale } from "@/lib/i18n/format";
import { roleLabel, showsVariant, type Build } from "@/lib/result/model";

export interface ComponentRowProps {
  component: Build["components"][number];
  locale: AppLocale;
}

export async function ComponentRow({ component, locale }: ComponentRowProps) {
  const t = await getTranslations({ locale, namespace: "result" });
  const variant = showsVariant(component.name, component.variant);

  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-micro tracking-wide text-muted uppercase">
          {t(`roles.${roleLabel(component.role)}`)}
        </span>
        <span className="mt-0.5 block text-compact text-ink break-words">
          {component.name}
          {variant ? <span className="text-muted"> · {component.variant}</span> : null}
        </span>
      </span>
      <span
        className={cn(
          "num-tabular shrink-0 text-compact",
          component.price_used === null ? "text-muted" : "text-ink",
        )}
      >
        {component.price_used === null ? t("priceUnknown") : formatMoney(component.price_used, locale)}
      </span>
    </li>
  );
}
