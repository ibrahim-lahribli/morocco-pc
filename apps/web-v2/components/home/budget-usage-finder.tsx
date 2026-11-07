"use client";

import { ArrowRight } from "lucide-react";
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
 * visible numbered markers are decorative.
 */
export function BudgetUsageFinder() {
  const router = useRouter();
  const t = useTranslations("Homepage.finder");
  const currency = useTranslations("Price")("currency");
  const setBudgetAmount = useHomepageStore((state) => state.setBudgetAmount);
  const setUseCase = useHomepageStore((state) => state.setUseCase);
  const storedUseCase = useHomepageStore((state) => state.useCase);

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
          <fieldset id="finder-budget" className="flex flex-col gap-3">
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

          <fieldset id="finder-usage" className="flex flex-col gap-3">
            <legend className="mb-1 flex w-full items-center gap-2 text-headline-sm text-foreground">
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
