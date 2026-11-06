"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/format/price";
import { BUDGET_OPTIONS, useDemoStore } from "@/lib/demo/store";
import { cn } from "@/lib/utils";

/**
 * Quick-start budget presets from the supplied home direction, backed by the
 * Zustand demo store. Selection is exposed with `aria-pressed`, not colour
 * alone, and the chosen amount is announced by a visible status line.
 */
export function BudgetPicker({ currency }: { currency: string }) {
  const t = useTranslations("Home.budget");
  const budget = useDemoStore((state) => state.budget);
  const setBudget = useDemoStore((state) => state.setBudget);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div
          role="group"
          aria-label={t("groupLabel")}
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {BUDGET_OPTIONS.map((option) => {
            const selected = option === budget;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                aria-label={t("optionLabel", { amount: formatPrice(option, currency) })}
                onClick={() => setBudget(option)}
                className={cn(
                  "h-11 truncate rounded-control px-2 text-label-lg transition-colors",
                  selected
                    ? "bg-primary text-on-primary shadow-level-1"
                    : "bg-surface-sunken text-muted hover:bg-surface-muted hover:text-foreground",
                )}
              >
                {formatPrice(option, currency)}
              </button>
            );
          })}
        </div>
        <p className="text-label-md font-normal text-muted" role="status">
          {t("selected", { amount: formatPrice(budget, currency) })}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button type="button" size="lg" className="w-full">
          {t("cta")}
          <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
        </Button>
        <p className="text-center text-label-md font-normal text-muted">{t("note")}</p>
      </div>
    </div>
  );
}
