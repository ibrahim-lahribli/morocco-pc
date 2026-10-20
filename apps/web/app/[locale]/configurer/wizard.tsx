"use client";

/**
 * The wizard (S7, narrowed per profile in S9) — the one client component in the
 * flow, and deliberately a dumb one: it OWNS no state that the URL can hold.
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
 * The only local state is presentation: the options fetch (status + body) here,
 * and the budget step's in-progress draft in `budget-step.tsx` (S8). Neither is
 * an answer: an answer exists only once the URL holds it, which is why an empty
 * field disables "Suivant" instead of silently keeping the old amount.
 *
 * S9's addition is that the FLOW is derived, not fixed. `stepsFor()` is the
 * profile's actual list (resolution only for the gaming family, and — once the
 * contract serves `inputs_applied` — no question it has declared inert), and
 * `resolveStep()` repairs a URL that names a step this profile does not walk.
 * Both are pure functions in `lib/wizard/model.ts`; this component only renders
 * what they answer, which is why the progress line, the step indicator and the
 * button cannot disagree about how long the flow is.
 *
 * Copy arrives as a prop from the server page: this app has no
 * `NextIntlClientProvider` (S5), so the client bundle carries no message
 * catalogue and no i18n runtime.
 */

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert, Button, ChoiceGroup, Skeleton } from "@/components/ui";
import type { ChoiceGroupOption } from "@/components/ui";
import { getMetaOptions, type MetaOptionsResponse } from "@/lib/api/client";
import type { AppLocale } from "@/lib/i18n/format";
import { readAppliedInputs } from "@/lib/wizard/applied";
import { fill, type WizardCopy } from "@/lib/wizard/copy";
import {
  isPriorityChoice,
  isStepValid,
  nextStep,
  normalizeAnswers,
  previousStep,
  readState,
  resolveStep,
  stepsFor,
  toHref,
  type Answers,
  type WizardStep,
} from "@/lib/wizard/model";
import { BudgetStep } from "./budget-step";

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
  const { step } = state;

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

  // What the contract says about the two optional answers. `null` means it is
  // silent (CD-1 is not served yet), which is why the questions are still asked —
  // with the honest label `inertHint` below rather than a claim that they matter.
  const applied = useMemo(() => (options === null ? null : readAppliedInputs(options)), [options]);

  // Answers whose step this profile does not walk are dropped HERE, on every
  // render, so a changed use case cannot leave a resolution behind that the flow
  // no longer asks for.
  const answers = useMemo(() => normalizeAnswers(state.answers, applied), [state.answers, applied]);
  const steps = useMemo(() => stepsFor(answers, applied), [answers, applied]);

  // A deep link is repaired on the server-visible URL, but the DECISION is made
  // in render: `shownStep` is what this profile can actually show, and the
  // effect below only writes it back. Rendering the URL's step first and
  // correcting it a frame later would flash a question the profile does not ask.
  const repairTo = resolveStep(step, answers, applied);
  const shownStep = repairTo ?? step;

  useEffect(() => {
    if (repairTo === null) return;
    router.replace(toHref(pathname, { step: repairTo, answers }), { scroll: false });
  }, [repairTo, answers, pathname, router]);

  const index = steps.indexOf(shownStep);
  const next = nextStep(shownStep, answers, applied);
  const previous = previousStep(shownStep, answers, applied);
  const needsOptions = shownStep !== "budget";
  const optionsReady = status === "ready" && options !== null;
  const blocked = needsOptions && !optionsReady;
  const canAdvance = next !== null && isStepValid(shownStep, answers) && !blocked;

  // OD1: an input the contract has not described is asked with a sentence saying
  // so. When it DOES describe one, it either names the input applied (no label)
  // or leaves it out (the step is not rendered at all).
  const inertHint = applied === null ? copy.storedNotApplied : undefined;

  function goTo(target: WizardStep | null) {
    if (target === null) return;
    router.push(toHref(pathname, { step: target, answers }), { scroll: false });
  }

  function setAnswer(patch: Partial<Answers>) {
    router.replace(toHref(pathname, { step: shownStep, answers: normalizeAnswers({ ...answers, ...patch }, applied) }), {
      scroll: false,
    });
  }

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
            hint={inertHint}
            onChange={(value) => setAnswer({ resolution: value })}
          />
        );
      case "priority":
        return (
          <ChoiceGroup
            name="priority"
            legend={copy.steps.priority.legend}
            // Three of the contract's five, and the narrowing is the model's
            // (`PRIORITY_CHOICES`): labels come from the response, never from a
            // table here, so 2 and 4 are dropped by value rather than relabelled.
            options={asOptions(
              body.priorities.filter((option) => isPriorityChoice(Number(option.value))),
            )}
            value={answers.priority === undefined ? undefined : String(answers.priority)}
            hint={inertHint}
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
        {fill(copy.progress, { current: index + 1, total: steps.length })}
      </p>

      <ol className="mt-3 flex flex-wrap gap-x-1.5 gap-y-1 text-caption text-muted">
        {steps.map((item, itemIndex) => (
          <li
            key={item}
            aria-current={item === shownStep ? "step" : undefined}
            className={item === shownStep ? "font-semibold text-ink" : undefined}
          >
            {copy.steps[item].label}
            {itemIndex < steps.length - 1 ? <span aria-hidden="true"> ·</span> : null}
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
          ? choicesFor(shownStep, options)
          : null}

        {shownStep === "budget" ? (
          <BudgetStep
            saved={answers.budget_amount}
            copy={copy}
            locale={locale}
            onCommit={(value) => setAnswer({ budget_amount: value })}
          />
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            onClick={() => goTo(previous)}
            disabled={previous === null}
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
