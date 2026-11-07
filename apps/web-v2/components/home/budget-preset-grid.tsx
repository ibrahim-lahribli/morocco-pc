"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { BUDGET_OPTIONS } from "@/lib/demo/store";
import { formatPrice } from "@/lib/format/price";
import { cn } from "@/lib/utils";

/**
 * The four budget presets: 2x2 on mobile, one row of four from `sm`.
 *
 * They are native radios, not buttons with `aria-pressed`, so a screen reader
 * announces "2 of 4" and arrow keys move within the group. The visible chip
 * shows the formatted amount and the input carries `finder.budget.presetLabel`
 * as its accessible name. Selection is never colour-only: the chosen chip also
 * gets a ring and a check icon.
 *
 * A preset is a budget, not a promise of a card — the builds section decides
 * what is served at or below it.
 */
export interface BudgetPresetGridProps {
  /** The selected preset in dirhams, or null before the visitor answers. */
  value: number | null;
  onChange: (amount: number) => void;
}

export function BudgetPresetGrid({ value, onChange }: BudgetPresetGridProps) {
  const t = useTranslations("Homepage.finder.budget");
  const currency = useTranslations("Price")("currency");

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {BUDGET_OPTIONS.map((option) => {
        const selected = option === value;
        const amount = formatPrice(option, currency);

        return (
          <label
            key={option}
            className={cn(
              "flex h-12 cursor-pointer items-center justify-center gap-1.5 rounded-control px-2 text-label-lg transition-colors",
              "focus-within:ring-2 focus-within:ring-primary/40 focus-within:ring-offset-2 focus-within:ring-offset-background",
              selected
                ? "bg-primary text-on-primary shadow-level-1 ring-2 ring-primary ring-offset-2 ring-offset-background"
                : "bg-surface-sunken text-muted hover:bg-surface-muted hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name="homepage-budget"
              value={option}
              checked={selected}
              aria-label={t("presetLabel", { amount })}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            <span aria-hidden="true" className="truncate">
              {amount}
            </span>
            {selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
          </label>
        );
      })}
    </div>
  );
}
