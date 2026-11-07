"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
 * never posts: while the results route does not exist, the CTA moves the
 * visitor to the configurations section instead of firing an engine pass. And
 * it does no data fetching of its own, so loading the page still makes no API
 * request.
 *
 * Validation is the Task 1 Zod schema, run synchronously on every render: the
 * answers are two values, and a resolver pass that lands a tick later would let
 * the CTA and its error text disagree with what is on screen.
 *
 * Both questions are `<fieldset>` + `<legend>` groups of native radios; the
 * visible numbered markers are decorative.
 */
export function BudgetUsageFinder() {
  const t = useTranslations("Homepage.finder");
  const currency = useTranslations("Price")("currency");
  const setBudgetAmount = useHomepageStore((state) => state.setBudgetAmount);
  const setUseCase = useHomepageStore((state) => state.setUseCase);

  const [values, setValues] = useState<FinderValues>(EMPTY_FINDER_VALUES);

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
  const canSubmit = budgetAmount !== null && values.useCase !== null;

  // Only a typed amount can be out of range: a preset always is one of the four.
  const parsed = schema.safeParse(values);
  const typedAmountInvalid =
    values.budgetPreset === null &&
    values.customBudget.trim() !== "" &&
    !parsed.success &&
    parsed.error.issues.some((issue) => issue.path[0] === "customBudget");

  const rangeError = typedAmountInvalid
    ? t("error.budgetRange", { min: groupNumber(BUDGET_MIN), max: groupNumber(BUDGET_MAX) })
    : undefined;

  // Mirror every change into the store; the builds section reads it.
  useEffect(() => {
    setBudgetAmount(budgetAmount);
    setUseCase(values.useCase);
  }, [budgetAmount, values.useCase, setBudgetAmount, setUseCase]);

  // One budget answer only: picking a preset drops a typed amount, and typing
  // drops the preset.
  const onPresetChange = (amount: number) =>
    setValues({ budgetPreset: amount, customBudget: "", useCase: values.useCase });

  const onCustomChange = (raw: string) =>
    setValues({ budgetPreset: null, customBudget: raw, useCase: values.useCase });

  const onUsageChange = (useCase: HomeUseCase) => setValues((current) => ({ ...current, useCase }));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    // The builds section is rendered by a later task; until then the CTA is a
    // no-op rather than a dead link or a premature POST.
    const section = document.getElementById("configurations");
    if (section === null) {
      return;
    }

    section.scrollIntoView({ behavior: "smooth", block: "start" });
    const heading = section.querySelector<HTMLElement>("h2");
    if (heading !== null) {
      heading.tabIndex = -1;
      heading.focus();
    }
  };

  return (
    <section id="simulateur" aria-labelledby="simulateur-heading" className="scroll-mt-24">
      <Card variant="elevated" className="rounded-sheet p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2">
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

        <form noValidate onSubmit={onSubmit} className="mt-5 flex flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 flex w-full items-center gap-2 text-headline-sm text-foreground">
              <span
                aria-hidden="true"
                className="inline-flex size-6 items-center justify-center rounded-full bg-primary-soft text-label-md text-primary"
              >
                1
              </span>
              {t("budget.question")}
            </legend>

            <p role="status" className="text-end text-label-md font-normal text-muted">
              {budgetAmount === null
                ? t("budget.unset")
                : t("budget.presetLabel", { amount: formatPrice(budgetAmount, currency) })}
            </p>

            <BudgetPresetGrid value={values.budgetPreset} onChange={onPresetChange} />
            <CustomBudgetField
              id={CUSTOM_BUDGET_ID}
              value={values.customBudget}
              error={rangeError}
              onChange={onCustomChange}
            />
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 flex w-full items-center gap-2 text-headline-sm text-foreground">
              <span
                aria-hidden="true"
                className="inline-flex size-6 items-center justify-center rounded-full bg-primary-soft text-label-md text-primary"
              >
                2
              </span>
              {t("usage.question")}
            </legend>

            <UsageSelector value={values.useCase} onChange={onUsageChange} />
          </fieldset>

          <div className="flex flex-col gap-2">
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
