"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button, Card, TextField } from "@/components/ui";
import {
  createRequirementsSchema,
  resolveRequirementsBudget,
  type ConfiguratorErrorCode,
  type RequirementsValues,
} from "@/lib/configurator/schema";
import type { ConfiguratorRequirements } from "@/lib/configurator/store";
import { cn } from "@/lib/utils";

const BUDGET_FIELD_ID = "configurator-budget";
const USE_CASE_ERROR_ID = "configurator-use-case-error";

/** The three use cases, in the approved display order. The API value is the radio's value. */
const USAGE_OPTIONS = [
  { value: "GAMING", key: "gaming" },
  { value: "OFFICE", key: "office" },
  { value: "WORKSTATION", key: "creation" },
] as const;

export interface RequirementsFormProps {
  defaultValues: RequirementsValues;
  /**
   * URL-level errors for the fields they belong to, shown on mount and until
   * the first submit. `from` is not a form field; the shell reports it.
   */
  initialErrors?: Partial<Record<"useCase" | "budget", ConfiguratorErrorCode>>;
  submitted?: boolean;
  onSubmit: (requirements: ConfiguratorRequirements) => void;
}

/**
 * The configurator's only form: usage and budget, nothing else.
 *
 * It asks no resolution, no priority and no preset ladder, and it never posts:
 * a valid submit hands the two answers to the shell, which owns the next step.
 *
 * Validation is the Task 1 Zod schema with dictionary messages, so both locales
 * reject the same values and speak their own language. A URL-invalid value is
 * kept verbatim in its field and marked invalid on mount — it is never clamped
 * and never silently replaced by a valid neighbour.
 */
export function RequirementsForm({
  defaultValues,
  initialErrors,
  submitted = false,
  onSubmit: onSubmitRequirements,
}: RequirementsFormProps) {
  const t = useTranslations("Configurator.requirements");
  const tErrors = useTranslations("Configurator.errors");

  const schema = useMemo(
    () =>
      createRequirementsSchema({
        useCaseRequired: tErrors("useCaseRequired"),
        budgetRequired: tErrors("budgetRequired"),
        budgetRange: tErrors("budgetRange"),
      }),
    [tErrors],
  );

  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, submitCount },
  } = useForm<RequirementsValues>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onSubmit",
  });

  // Captured once: the shell rebuilds its object on every render, so an effect
  // keyed on the prop would keep resurrecting errors the visitor has fixed.
  const [mountErrors] = useState<Partial<Record<"useCase" | "budget", ConfiguratorErrorCode>>>(
    initialErrors ?? {},
  );
  const [showMountSummary, setShowMountSummary] = useState(
    () => !submitted && (mountErrors.useCase !== undefined || mountErrors.budget !== undefined),
  );
  const mountErrorsApplied = useRef(false);

  useEffect(() => {
    // Once per mount: the translator is not a dependency worth re-running this
    // for, and re-applying would resurrect an error the visitor has fixed.
    if (mountErrorsApplied.current) return;
    mountErrorsApplied.current = true;

    if (mountErrors.useCase !== undefined) {
      setError("useCase", { type: "manual", message: tErrors("useCaseRequired") });
    }
    if (mountErrors.budget !== undefined) {
      setError("budget", {
        type: "manual",
        message:
          mountErrors.budget === "BUDGET_INVALID"
            ? tErrors("budgetInvalid")
            : tErrors("budgetRange"),
      });
    }
  }, [mountErrors, setError, tErrors]);

  const selectedUseCase = useWatch({ control, name: "useCase" });
  const useCaseError = errors.useCase?.message;
  const budgetError = errors.budget?.message;

  const submit = handleSubmit((values) => {
    const budgetAmount = resolveRequirementsBudget(values);
    if (values.useCase === null || budgetAmount === null) {
      return;
    }
    onSubmitRequirements({ useCase: values.useCase, budgetAmount });
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // Field messages take over from the URL summary from here on.
    setShowMountSummary(false);
    void submit(event);
  };

  return (
    <Card variant="elevated" className="p-4 sm:p-6">
      <p className="text-label-sm font-semibold tracking-wide text-primary">{t("badge")}</p>
      <h2 className="mt-1 text-headline-sm text-balance text-foreground">{t("title")}</h2>
      <p className="mt-2 text-body-sm text-muted">{t("intro")}</p>

      {submitted ? (
        <p
          role="status"
          className="mt-3 inline-flex items-center gap-2 rounded-pill bg-primary-soft px-3 py-1 text-label-md font-semibold text-primary"
        >
          <Check aria-hidden="true" className="size-4" />
          {t("saved")}
        </p>
      ) : null}

      <form noValidate onSubmit={onSubmit} className="mt-5 flex flex-col gap-6">
        {showMountSummary ? (
          <p
            role="alert"
            className="rounded-control border border-danger bg-surface px-3 py-2 text-label-md font-medium text-danger"
          >
            {t("errorSummary")}
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-headline-sm text-foreground">{t("usageLegend")}</legend>

          <div className="flex flex-col gap-2">
            {USAGE_OPTIONS.map((option) => {
              const selected = selectedUseCase === option.value;

              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-start gap-3 rounded-card border p-3 transition-colors",
                    "focus-within:ring-2 focus-within:ring-primary/40 focus-within:ring-offset-2 focus-within:ring-offset-background",
                    selected
                      ? "border-primary bg-primary-soft ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "border-border bg-surface hover:bg-surface-muted",
                  )}
                >
                  <input
                    type="radio"
                    value={option.value}
                    {...register("useCase")}
                    checked={selected}
                    aria-describedby={useCaseError ? USE_CASE_ERROR_ID : undefined}
                    onChange={() =>
                      setValue("useCase", option.value, { shouldValidate: submitCount > 0 })
                    }
                    className="sr-only"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-label-lg font-semibold text-foreground">
                      {t(`usage.${option.key}.title`)}
                    </span>
                    <span className="text-label-md font-normal text-muted">
                      {t(`usage.${option.key}.body`)}
                    </span>
                  </span>
                  {selected ? (
                    <Check aria-hidden="true" className="ms-auto size-4 shrink-0 text-primary" />
                  ) : null}
                </label>
              );
            })}
          </div>

          {useCaseError ? (
            <p id={USE_CASE_ERROR_ID} className="text-label-md font-medium text-danger">
              {useCaseError}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          {/* The field's own label names it visibly; the legend only groups it. */}
          <legend className="sr-only">{t("budgetLabel")}</legend>
          <TextField
            id={BUDGET_FIELD_ID}
            type="number"
            inputMode="numeric"
            step={500}
            min={0}
            label={t("budgetLabel")}
            hint={t("budgetHint")}
            placeholder={t("budgetPlaceholder")}
            error={budgetError}
            {...register("budget")}
          />
        </fieldset>

        <div className="flex flex-col gap-2">
          <Button type="submit" variant="cta" size="lg" className="w-full">
            {submitted ? t("update") : t("submit")}
            <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
          </Button>
          <p className="text-center text-label-md font-normal text-muted">{t("note")}</p>
        </div>
      </form>
    </Card>
  );
}
