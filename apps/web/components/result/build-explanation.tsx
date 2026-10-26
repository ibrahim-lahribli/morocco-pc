/**
 * The "pourquoi ce choix" disclosure — board §13, one per build (S13).
 *
 * A native `<details>`/`<summary>`, collapsed by default. That is the whole
 * accessibility story and it is deliberate: the element carries its own
 * expanded/collapsed state to the platform accessibility tree, opens with
 * Enter/Space, and needs no `"use client"` island — a hand-rolled ARIA
 * disclosure would be a second state machine to keep in sync with the first.
 * The visible content is not merely hidden: a closed `<details>` does not
 * render it, so a screen reader never reads an unopened panel.
 *
 * What it renders is a FEATURE CHECK, not a preference:
 *
 *   - `reasons[]` present and readable → one catalogue line per reason, in the
 *     engine's order, plus one generic line for anything unnameable. No raw
 *     code, no raw enum, no invented sentence.
 *   - otherwise → `build.explanation` VERBATIM. That string is the committed
 *     Engine 6 text (Decision 22); paraphrasing it here would create a second
 *     explanation that could drift from the one the engine recorded.
 *
 * The date/number formatting lives here rather than in `lib/result/reasons.ts`
 * because this is the layer that has a locale: the module returns a ratio and a
 * catalogue key, and every amount or percentage is `formatPercent`'s.
 */
import { getTranslations } from "next-intl/server";

import { formatPercent, type AppLocale } from "@/lib/i18n/format";
import { reasonViews, type ReasonView } from "@/lib/result/reasons";
import type { Build } from "@/lib/result/model";

export interface BuildExplanationProps {
  build: Build;
  locale: AppLocale;
}

export async function BuildExplanation({ build, locale }: BuildExplanationProps) {
  const t = await getTranslations({ locale, namespace: "result" });

  // `reasons` is not in contract v1.5 (CD-2). Read it through `unknown` in the
  // one place allowed to name a field the contract does not have.
  const raw = (build as { reasons?: unknown }).reasons;
  const views = reasonViews(raw);

  const line = (view: ReasonView): string => {
    switch (view.kind) {
      case "strategy":
        return t("reasons.strategy", { strategy: t(`strategies.${view.key}`) });
      case "budget":
        return t("reasons.budget", { percent: formatPercent(view.ratio, locale) });
      case "gpuShare":
        return t("reasons.gpuShare", { percent: formatPercent(view.ratio, locale) });
      case "dominantRole":
        return t("reasons.dominantRole", { role: t(`roles.${view.key}`) });
      case "bios":
        return t("reasons.bios", { versions: view.versions.join(", ") });
      case "unknownSpec":
        return t("reasons.unknownSpec", {
          roles: view.keys.map((key) => t(`roles.${key}`)).join(", "),
        });
      case "inputs":
        return t("reasons.inputs");
      case "limitedCatalog":
        return t("reasons.limitedCatalog");
      case "unknown":
        return t("reasons.unknown");
    }
  };

  return (
    <details className="mt-3 border-t border-border pt-3">
      <summary className="cursor-pointer text-compact font-medium text-ink">
        {t("whySummary")}
      </summary>
      <div className="mt-2">
        {views.length === 0 ? (
          // Decision 56: a committed swap leaves NO explanation - the stored
          // text described parts the build no longer carries - so the
          // disclosure says that instead of opening onto an empty panel.
          <p className="max-w-prose text-compact text-muted">
            {build.swapped !== null && build.swapped !== undefined
              ? t("explanationSwapped")
              : build.explanation}
          </p>
        ) : (
          <ul className="list-disc space-y-1 ps-4 text-compact text-muted">
            {views.map((view, index) => (
              <li key={`${view.kind}:${index}`}>{line(view)}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
