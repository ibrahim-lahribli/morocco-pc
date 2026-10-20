"use client";

/**
 * The wizard (S7) — the one client component in the flow, and deliberately a
 * dumb one: it OWNS no state that the URL can hold.
 *
 * The step and the four answers are read from the query string on every render
 * (`readState`). Selecting an option calls `router.replace`, so the URL is
 * always the truth; moving between steps calls `router.push`, so Back is the
 * previous step rather than "leave the wizard". That split is the whole design:
 *
 *   - answers  → replace: editing a field must not create a history entry, or
 *                Back would walk through a user's keystrokes;
 *   - steps    → push: S7's DoD asks that browser Back returns to the previous
 *                step with the values intact, which is exactly what a history
 *                entry per step gives.
 *
 * The only local state is presentation: the options fetch (status + body) and
 * the budget field's in-progress draft. The draft is not an answer — it becomes
 * one through `onChange` only when it parses into the allowed range, which is
 * why an empty field disables "Suivant" instead of silently keeping the old
 * amount.
 *
 * Copy arrives as a prop from the server page: this app has no
 * `NextIntlClientProvider` (S5), so the client bundle carries no message
 * catalogue and no i18n runtime.
 */

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert, Button, ChoiceGroup, Skeleton, TextField } from "@/components/ui";
import type { ChoiceGroupOption } from "@/components/ui";
import { getMetaOptions, type MetaOptionsResponse } from "@/lib/api/client";
import { formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import { fill, type WizardCopy } from "@/lib/wizard/copy";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  STEPS,
  firstInvalidStepBefore,
  isStepValid,
  nextStep,
  parseAmount,
  previousStep,
  readState,
  stepIndex,
  toHref,
  type Answers,
  type WizardStep,
} from "@/lib/wizard/model";

type OptionsStatus = "loading" | "ready" | "error";

/** `meta/options` items are `{ value, label }`; the group wants strings. */
function asOptions(
  list: readonly { value: string | number; label: string }[],
): ChoiceGroupOption[] {
  return list.map((option) => ({ value: String(option.value), label: option.label }));
}

export function Wizard({ copy, locale }: { copy: WizardCopy; locale: AppLocale }) {
  const router = useRouter();
  const pathname = usePathname() ?? `/${locale}`;
  const search = useSearchParams();

  // The URL is the state; `search` changing is the only thing that moves it.
  const state = useMemo(() => readState(search), [search]);
  const { step, answers } = state;

  const [options, setOptions] = useState<MetaOptionsResponse | null>(null);
  const [status, setStatus] = useState<OptionsStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  // No `setStatus("loading")` in here: a synchronous setState inside an effect is
  // a cascading render, and the lint rule that refuses it is right. The initial
  // state IS "loading"; a retry flips it back from its click handler.
  useEffect(() => {
    const controller = new AbortController();
    getMetaOptions({ signal: controller.signal })
      .then((body) => {
        if (controller.signal.aborted) return;
        setOptions(body);
        setStatus("ready");
      })
      .catch(() => {
        // An aborted request is not a failure: the user is just not on this
        // render any more, and setting state would warn after unmount.
        if (controller.signal.aborted) return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [attempt]);

  function goTo(target: WizardStep | null) {
    if (target === null) return;
    router.push(toHref(pathname, { step: target, answers }), { scroll: false });
  }

  function setAnswer(patch: Partial<Answers>) {
    router.replace(toHref(pathname, { step, answers: { ...answers, ...patch } }), {
      scroll: false,
    });
  }

  // A deep link that skips an unanswered step is repaired HERE, on the client,
  // because the answers are only readable in the browser. `firstInvalidStepBefore`
  // looks backwards only, so this can never fight a field the user is typing in.
  const repairTo = firstInvalidStepBefore(step, answers);
  useEffect(() => {
    if (repairTo === null) return;
    router.replace(toHref(pathname, { step: repairTo, answers }), { scroll: false });
  }, [repairTo, answers, pathname, router]);

  const index = stepIndex(step);
  const next = nextStep(step);
  const needsOptions = step !== "budget";
  const optionsReady = status === "ready" && options !== null;
  const blocked = needsOptions && !optionsReady;
  const canAdvance = next !== null && isStepValid(step, answers) && !blocked;

  function choicesFor(current: WizardStep, body: MetaOptionsResponse) {
    switch (current) {
      case "usage":
        return (
          <ChoiceGroup
            name="use_case"
            legend={copy.steps.usage.legend}
            options={asOptions(body.use_cases)}
            value={answers.use_case}
            onChange={(value) => setAnswer({ use_case: value })}
          />
        );
      case "resolution":
        return (
          <ChoiceGroup
            name="resolution"
            legend={copy.steps.resolution.legend}
            options={asOptions(body.resolutions)}
            value={answers.resolution}
            onChange={(value) => setAnswer({ resolution: value })}
          />
        );
      case "priority":
        return (
          <ChoiceGroup
            name="priority"
            legend={copy.steps.priority.legend}
            options={asOptions(body.priorities)}
            value={answers.priority === undefined ? undefined : String(answers.priority)}
            onChange={(value) => setAnswer({ priority: Number(value) })}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="mt-6">
      <p className="font-mono text-caption uppercase tracking-wider text-primary">
        {fill(copy.progress, { current: index + 1, total: STEPS.length })}
      </p>

      <ol className="mt-3 flex flex-wrap gap-x-1.5 gap-y-1 text-caption text-muted">
        {STEPS.map((item, itemIndex) => (
          <li
            key={item}
            aria-current={item === step ? "step" : undefined}
            className={item === step ? "font-semibold text-ink" : undefined}
          >
            {copy.steps[item].label}
            {itemIndex < STEPS.length - 1 ? <span aria-hidden="true"> ·</span> : null}
          </li>
        ))}
      </ol>

      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (canAdvance) goTo(next);
        }}
      >
        {needsOptions && status === "loading" ? <OptionsSkeleton label={copy.loading} /> : null}

        {needsOptions && status === "error" ? (
          <div className="space-y-3">
            <Alert tone="error">{copy.optionsError}</Alert>
            <Button
              variant="secondary"
              onClick={() => {
                setStatus("loading");
                setAttempt((value) => value + 1);
              }}
            >
              {copy.retry}
            </Button>
          </div>
        ) : null}

        {needsOptions && options !== null && status === "ready"
          ? choicesFor(step, options)
          : null}

        {step === "budget" ? (
          <BudgetField
            saved={answers.budget_amount}
            copy={copy}
            locale={locale}
            onCommit={(value) => setAnswer({ budget_amount: value })}
          />
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            onClick={() => goTo(previousStep(step))}
            disabled={previousStep(step) === null}
          >
            {copy.back}
          </Button>
          {/* `type="submit"` is what makes Enter advance from a radio group or
              the numeric field — form semantics rather than a click handler. */}
          <Button type="submit" disabled={!canAdvance}>
            {next === null ? copy.finish : copy.next}
          </Button>
        </div>

        {next === null ? <p className="mt-2 text-caption text-muted">{copy.submitNote}</p> : null}
      </form>
    </div>
  );
}

/**
 * The budget field (S8 replaces this with the slider + field pair; the CONTRACT
 * it already honours is the one that matters here: the draft is local, the
 * answer is the URL, and an unparseable or out-of-range draft removes the answer
 * rather than leaving a stale amount behind a disabled button).
 */
function BudgetField({
  saved,
  copy,
  locale,
  onCommit,
}: {
  saved: number | undefined;
  copy: WizardCopy;
  locale: AppLocale;
  onCommit: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(() =>
    saved === undefined ? "" : formatNumber(saved, locale),
  );
  const [touched, setTouched] = useState(false);

  const parsed = parseAmount(draft);
  const inRange = parsed !== null && parsed >= BUDGET_MIN && parsed <= BUDGET_MAX;
  const bounds = { min: formatMoney(BUDGET_MIN, locale), max: formatMoney(BUDGET_MAX, locale) };

  return (
    <TextField
      id="wizard-budget"
      label={copy.budgetLabel}
      suffix="MAD"
      inputMode="numeric"
      autoComplete="off"
      value={draft}
      hint={fill(copy.budgetHint, bounds)}
      error={touched && !inRange ? fill(copy.budgetError, bounds) : undefined}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const value = parseAmount(raw);
        onCommit(value !== null && value >= BUDGET_MIN && value <= BUDGET_MAX ? value : undefined);
      }}
      onBlur={() => setTouched(true)}
      onKeyDown={(event) => {
        // Enter submits the form; this only makes the message visible when the
        // submission is refused because the amount is out of range.
        if (event.key === "Enter") setTouched(true);
      }}
    />
  );
}

/** Loading placeholder for the options — progress announced once, not per block. */
function OptionsSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="space-y-2.5">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-control w-full rounded-card" />
      ))}
    </div>
  );
}
