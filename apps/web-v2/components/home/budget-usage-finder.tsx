"use client";

import { ArrowRight, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRouter } from "@/i18n/navigation";
import { buildConfiguratorHref } from "@/lib/configurator/schema";
import { formatPrice, groupNumber } from "@/lib/format/price";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  EMPTY_FINDER_VALUES,
  createFinderSchema,
  resolveBudgetAmount,
  type FinderValues,
} from "@/lib/homepage/finder-schema";
import { useHomepageStore } from "@/lib/homepage/store";
import type { HomeUseCase } from "@/lib/homepage/builds";

import { BudgetPresetGrid } from "./budget-preset-grid";
import { CustomBudgetField } from "./custom-budget-field";
import { UsageSelector } from "./usage-selector";

const CUSTOM_BUDGET_ID = "homepage-custom-budget";

/**
 * The homepage's only interactive block: two answers, one CTA.
 *
 * Three things it deliberately does NOT do. It never asks for a resolution —
 * the shortcuts are deferred and nothing here stores or sends one. Its submit
 * never posts: the CTA hands the two answers to the configurator as query
 * params, so no engine pass is fired from here. And it does no data fetching of
 * its own, so loading the page still makes no API request.
 *
 * Validation is the Task 1 Zod schema, run synchronously on every render: the
 * answers are two values, and a resolver pass that lands a tick later would let
 * the CTA and its error text disagree with what is on screen.
 *
 * Both questions are `<fieldset>` + `<legend>` groups of native radios; the
 * visible numbered markers are decorative. The chosen amount sits at the end of
 * the budget legend rather than on a line of its own, and the custom amount is
 * behind a compact action (`finder.budget.customToggle`) — both match the phone
 * frame, which has to show the whole finder without scrolling.
 */
export function BudgetUsageFinder() {
  const router = useRouter();
  const t = useTranslations("Homepage.finder");
  const currency = useTranslations("Price")("currency");
  const setBudgetAmount = useHomepageStore((state) => state.setBudgetAmount);
  const setUseCase = useHomepageStore((state) => state.setUseCase);
  const storedUseCase = useHomepageStore((state) => state.useCase);

  const [values, setValues] = useState<FinderValues>(EMPTY_FINDER_VALUES);
  const [customOpen, setCustomOpen] = useState(false);

  const schema = useMemo(
    () =>
      createFinderSchema({
        required: t("error.required"),
        budgetRange: t("error.budgetRange", {
          min: groupNumber(BUDGET_MIN),
          max: groupNumber(BUDGET_MAX),
        }),
      }),
    [t],
  );

  const budgetAmount = resolveBudgetAmount(values);
  const canSubmit = budgetAmount !== null && storedUseCase !== null;

  // Only a typed amount can be out of range: a preset always is one of the four.
  const parsed = schema.safeParse({ ...values, useCase: storedUseCase });
  const typedAmountInvalid =
    values.budgetPreset === null &&
    values.customBudget.trim() !== "" &&
    !parsed.success &&
    parsed.error.issues.some((issue) => issue.path[0] === "customBudget");

  const rangeError = typedAmountInvalid
    ? t("error.budgetRange", { min: groupNumber(BUDGET_MIN), max: groupNumber(BUDGET_MAX) })
    : undefined;

  // The store owns the usage answer: the usage radios and a discovery tile both
  // write it, so the selected radio and the cards can never disagree. Only the
  // budget is form-local, and it is mirrored here for the builds section.
  useEffect(() => {
    setBudgetAmount(budgetAmount);
  }, [budgetAmount, setBudgetAmount]);

  // The field exists only once the visitor revealed it, so this is the reveal's
  // focus move rather than a focus steal on load.
  useEffect(() => {
    if (!customOpen) return;
    document.getElementById(CUSTOM_BUDGET_ID)?.focus();
  }, [customOpen]);

  // One budget answer only: picking a preset drops a typed amount, and typing
  // drops the preset.
  const onPresetChange = (amount: number) =>
    setValues({ budgetPreset: amount, customBudget: "", useCase: null });

  const onCustomChange = (raw: string) =>
    setValues({ budgetPreset: null, customBudget: raw, useCase: null });

  const onUsageChange = (useCase: HomeUseCase) => setUseCase(useCase);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    // The contract owns the shape, so the finder never assembles a URL by hand:
    // a null href keeps the visitor here rather than opening a configurator the
    // route would have to flag as invalid.
    const href = buildConfiguratorHref({ useCase: storedUseCase, budgetAmount });
    if (href === null) {
      return;
    }

    router.push(href);
  };

  return (
    <section id="simulateur" aria-labelledby="simulateur-heading" className="scroll-mt-24">
      <Card variant="elevated" className="rounded-sheet p-4 sm:p-6">
        {/* Desktop frame only: the phone frame starts the card on the budget
            question. The heading stays the section's accessible name — a
            `display: none` element referenced by `aria-labelledby` is still
            used to compute it. */}
        <div className="hidden items-center justify-between gap-2 lg:flex">
          <h2
            id="simulateur-heading"
            className="inline-flex items-center gap-2 text-label-md font-semibold text-foreground"
          >
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            {t("badge")}
          </h2>
          <span className="rounded-pill bg-surface-sunken px-3 py-1 text-label-md text-primary">
            {t("step", { current: 1, total: 2 })}
          </span>
        </div>

        <form noValidate onSubmit={onSubmit} className="mt-0 flex flex-col gap-4 lg:mt-5">
          <fieldset id="finder-budget" className="flex flex-col gap-2.5">
            <legend className="flex w-full items-center gap-2 text-headline-sm text-foreground">
              <span
                aria-hidden="true"
                className="inline-flex size-6 items-center justify-center rounded-full bg-primary-soft text-label-md text-primary"
              >
                1
              </span>
              <span>{t("budget.question")}</span>
              <span
                role="status"
                className="ms-auto shrink-0 text-end text-label-md font-semibold text-primary"
              >
                {budgetAmount === null ? t("budget.unset") : formatPrice(budgetAmount, currency)}
              </span>
            </legend>

            <BudgetPresetGrid value={values.budgetPreset} onChange={onPresetChange} />

            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={customOpen}
              aria-controls={customOpen ? CUSTOM_BUDGET_ID : undefined}
              onClick={() => setCustomOpen((open) => !open)}
              className="min-h-11 w-fit justify-start px-0 text-label-md hover:bg-transparent hover:underline"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
              {t("budget.customToggle")}
            </Button>

            {/* Mounted only when revealed: a numeric field the visitor never
                asked for is the vertical space this step reclaims. Once open it
                keeps its value if the action is used again, so collapsing never
                resets the answer. */}
            {customOpen ? (
              <CustomBudgetField
                id={CUSTOM_BUDGET_ID}
                value={values.customBudget}
                error={rangeError}
                onChange={onCustomChange}
              />
            ) : null}
          </fieldset>

          <fieldset id="finder-usage" className="flex flex-col gap-2.5">
            <legend className="flex w-full items-center gap-2 text-headline-sm text-foreground">
              <span
                aria-hidden="true"
                className="inline-flex size-6 items-center justify-center rounded-full bg-primary-soft text-label-md text-primary"
              >
                2
              </span>
              {t("usage.question")}
            </legend>

            <UsageSelector value={storedUseCase} onChange={onUsageChange} />
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Button type="submit" variant="cta" size="lg" className="w-full" disabled={!canSubmit}>
              {t("cta")}
              <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
            </Button>
            <p className="text-center text-label-md font-normal text-muted">{t("note")}</p>
          </div>
        </form>
      </Card>
    </section>
  );
}
