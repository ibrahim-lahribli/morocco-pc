"use client";

/**
 * The wizard (S7, narrowed per profile in S9, submitted in S10) — the one client
 * component in the flow, and deliberately a dumb one: it OWNS no state that the
 * URL can hold.
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
 * S9's addition is that the FLOW is derived, not fixed. `stepsFor()` is the
 * profile's actual list (resolution only for the gaming family, and — once the
 * contract serves `inputs_applied` — no question it has declared inert), and
 * `resolveStep()` repairs a URL that names a step this profile does not walk.
 * Both are pure functions in `lib/wizard/model.ts`; this component only renders
 * what they answer, which is why the progress line, the step indicator and the
 * button cannot disagree about how long the flow is.
 *
 * S10's addition is the HAND-OFF: the last step posts the body `toRequest()`
 * describes, and what happens next is one of two things — navigate to the
 * result, or explain. Three decisions live in this file:
 *
 *   1. **One action, not two.** After a failure the primary button becomes
 *      "Réessayer" and re-posts. A separate retry button beside it would be the
 *      same request behind two controls, and the user would have to guess which
 *      one the countdown applies to.
 *   2. **A 422 moves the user to the field it names.** The service refused a
 *      value on a screen they have already left, so the failure handler uses
 *      `stepForField()` to go BACK there, the sentence is rendered under that
 *      control, and focus follows it. A message about a field three steps away
 *      is a message nobody can act on.
 *   3. **Success does not clear `submitting`.** Navigation is not awaited by
 *      `next/router`, so resetting the flag first would flash the form back for
 *      a frame before the result appeared; the state is left true and the
 *      component unmounts instead.
 *
 * Copy arrives as a prop from the server page: this app has no
 * `NextIntlClientProvider` (S5), so the client bundle carries no message
 * catalogue and no i18n runtime.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert, Button, ChoiceGroup, Skeleton } from "@/components/ui";
import type { ChoiceGroupOption } from "@/components/ui";
import { trackEvent } from "@/lib/analytics";
import { createRecommendation, getMetaOptions, type MetaOptionsResponse } from "@/lib/api/client";
import type { AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
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
  stepForField,
  stepsFor,
  toHref,
  toRequest,
  type Answers,
  type WizardStep,
} from "@/lib/wizard/model";
import { mapSubmitFailure, validateRequest, type SubmitFailure } from "@/lib/wizard/submit";
import { BudgetStep } from "./budget-step";
import { SubmitPanel } from "./submit-panel";

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

  // The hand-off's own state. `submitting` is the request in flight; `failure`
  // is the last answer that was not a result; `remaining` is a 429's countdown.
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<SubmitFailure | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  // A ref, not state: the double-tap guard has to be true SYNCHRONOUSLY, before
  // a re-render could disable the button, or two clicks in one frame both post.
  const inFlight = useRef(false);

  const cooling = remaining !== null && remaining > 0;

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

  // One tick a second while a countdown runs. At zero the timer stops and the
  // action is enabled again; the sentence stays, because it is still what
  // happened.
  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const timer = setTimeout(() => {
      setRemaining((value) => (value === null ? null : Math.max(0, value - 1)));
    }, 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

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
  const stepValid = isStepValid(shownStep, answers);
  const isLast = next === null;
  const canAdvance = !isLast && stepValid && !blocked;
  const canSubmit = isLast && stepValid && !blocked && !submitting && !cooling;

  // OD1: an input the contract has not described is asked with a sentence saying
  // so. When it DOES describe one, it either names the input applied (no label)
  // or leaves it out (the step is not rendered at all).
  const inertHint = applied === null ? copy.storedNotApplied : undefined;

  // The 422's sentence, under the control it is about. `undefined` when this
  // attempt failed for another reason, or about another field.
  const refused = failure !== null && failure.kind === "fields" ? failure.fields : [];

  function fieldError(field: string): string | undefined {
    return refused.includes(field)
      ? (copy.fieldErrors[field] ?? copy.errorFieldUnknown)
      : undefined;
  }

  // `failure` is a stable object and `shownStep` only changes on a repair, so
  // this focuses once per refusal instead of on every keystroke.
  useEffect(() => {
    if (failure === null || failure.kind !== "fields") return;
    const field = failure.fields[0];
    if (field === undefined) return;
    const target =
      field === "budget_amount"
        ? document.getElementById("wizard-budget")
        : document.querySelector<HTMLInputElement>(`form input[name="${field}"]`);
    target?.focus();
  }, [failure, shownStep]);

  function goTo(target: WizardStep | null) {
    if (target === null) return;
    router.push(toHref(pathname, { step: target, answers }), { scroll: false });
  }

  function setAnswer(patch: Partial<Answers>) {
    router.replace(
      toHref(pathname, { step: shownStep, answers: normalizeAnswers({ ...answers, ...patch }, applied) }),
      { scroll: false },
    );
  }

  async function submit() {
    if (inFlight.current) return;

    const request = toRequest(answers, applied);
    if (request === null) return; // unreachable: the button is disabled

    // The client's own 422 (scenario 1): a body the contract would refuse never
    // reaches the network, and it is reported exactly like one that did.
    const problems = validateRequest(request);
    if (problems.length > 0) {
      setFailure({ kind: "fields", fields: problems });
      moveToField(problems[0]);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setFailure(null);
    setRemaining(null);

    try {
      const { body } = await createRecommendation(request);
      // S22's third event, and the reason it is a COUNT: the size of the result
      // is the only fact about this pass that analytics may know. The budget,
      // the answers and the id stay on this side of the boundary (the events
      // map in `lib/analytics.ts` has no field for them).
      trackEvent({ name: "config_generated", props: { builds: body.builds.length } });
      // 201 (a new pass) and 200 (a reused one) are the same outcome here; the
      // result page owns the difference, and a zero-build body is a RESULT, not
      // an error (V2), so it navigates exactly like any other.
      router.push(localePath(locale, `/config/${encodeURIComponent(body.id)}`));
      return; // `submitting` stays true: the form must not flash back
    } catch (error) {
      const mapped = mapSubmitFailure(error);
      setFailure(mapped);
      if (mapped.kind === "rate-limited") setRemaining(mapped.retryAfterSeconds);
      if (mapped.kind === "fields") moveToField(mapped.fields[0]);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  /** Take the user back to the step that owns a refused field, if it has one. */
  function moveToField(field: string | undefined) {
    if (field === undefined) return;
    const target = stepForField(field);
    if (target === null || target === shownStep || !steps.includes(target)) return;
    router.replace(toHref(pathname, { step: target, answers }), { scroll: false });
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
            error={fieldError("use_case")}
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
            error={fieldError("resolution")}
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
            error={fieldError("priority")}
            onChange={(value) => setAnswer({ priority: Number(value) })}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="mt-6">
      {/*
        The polite region exists BEFORE the text it announces, which is what makes
        a screen reader speak it at all: mounting a live region with its message
        already inside is a coin toss across browsers. Errors do not come through
        here — `Alert` is a `role="alert"` and interrupts, which is what a refusal
        deserves — and success needs nothing: the result is a navigation, and the
        router announces the new page.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {submitting ? copy.submitAnnouncement : ""}
      </p>

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
        aria-busy={submitting}
        onSubmit={(event) => {
          event.preventDefault();
          if (isLast) {
            if (canSubmit) {
              // The last step is completed by SUBMITTING, not by advancing, so it
              // is the one step a forward navigation never records. Emit it here
              // too, or the map's final value is unreachable; the pass itself is
              // the separate `config_generated` event fired by `submit()`.
              trackEvent({ name: "wizard_step", props: { step: shownStep } });
              void submit();
            }
          } else if (canAdvance) {
            // S22: a step is "completed" when the flow moves FORWARD past it —
            // Back is not a completion, and neither is a repaired URL, so the
            // event is fired here rather than in `goTo()`.
            trackEvent({ name: "wizard_step", props: { step: shownStep } });
            goTo(next);
          }
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
            serverError={fieldError("budget_amount")}
            onCommit={(value) => setAnswer({ budget_amount: value })}
          />
        ) : null}

        <SubmitPanel
          submitting={submitting}
          failure={failure}
          remaining={remaining}
          copy={copy}
          locale={locale}
        />

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            onClick={() => goTo(previous)}
            disabled={previous === null || submitting}
          >
            {copy.back}
          </Button>
          {/* `type="submit"` is what makes Enter advance from a radio group or
              the numeric field — form semantics rather than a click handler. */}
          <Button type="submit" disabled={isLast ? !canSubmit : !canAdvance}>
            {isLast ? (failure === null ? copy.finish : copy.retry) : copy.next}
          </Button>
        </div>
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
