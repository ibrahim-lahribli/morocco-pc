"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui";

/**
 * The closing call to action.
 *
 * It repeats the finder's destination rather than its work: clicking moves the
 * visitor back to `#simulateur` and focuses the budget group, so the answers are
 * one screen away. It never submits and emits nothing — Step 1 has no analytics
 * seam and no POST (Q-13).
 *
 * One tree for both frames: `bg-primary` on mobile, the deeper gradient from
 * `lg`. The flare is decorative and cannot intercept a click.
 */
export function FinalRecommendationCTA() {
  const t = useTranslations("Homepage.finalCta");

  const returnToFinder = () => {
    const budgetGroup = document.getElementById("finder-budget");
    if (budgetGroup === null) {
      return;
    }

    budgetGroup.scrollIntoView({ behavior: "smooth", block: "start" });
    budgetGroup.tabIndex = -1;
    budgetGroup.focus();
  };

  return (
    <section
      aria-labelledby="final-cta-title"
      className="relative isolate overflow-hidden rounded-sheet bg-primary p-4 text-on-primary lg:bg-linear-to-br lg:from-primary-deep lg:via-primary lg:to-primary-deep lg:p-10"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-10 -top-16 size-56 rounded-full bg-accent/30 blur-3xl"
      />

      <div className="relative flex flex-col gap-3 lg:items-center lg:text-center">
        <p className="w-fit rounded-pill bg-on-primary/15 px-3 py-1 text-label-md">
          {t("eyebrow")}
        </p>
        <h2
          id="final-cta-title"
          className="text-headline-md text-balance text-on-primary lg:text-headline-lg"
        >
          {t("title")}
        </h2>
        <p className="max-w-2xl text-body-md text-on-primary/80">{t("body")}</p>
        <Button variant="cta" size="lg" className="w-full lg:w-auto" onClick={returnToFinder}>
          {t("cta")}
          <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
        </Button>
      </div>
    </section>
  );
}
