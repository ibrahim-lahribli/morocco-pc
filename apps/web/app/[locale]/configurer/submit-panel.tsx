"use client";

/**
 * The submit state box (S10) — what the last step shows while the engine runs,
 * and what it says when it does not come back.
 *
 * Purely presentational: it renders `submitting` / `failure` / `remaining` and
 * owns no request. The wizard owns the lifecycle, because the same state decides
 * whether the primary action is enabled, what its label is, and (on a 422) which
 * step the user is moved back to — none of which belongs in a box below the
 * button.
 *
 * ## The progress bar is deliberate, and deliberately still
 *
 * `POST /v1/recommendations` is one request with no progress channel: the server
 * assembles, scores and ranks before it answers, and reports nothing on the way.
 * So a percentage that creeps upward would be invented, and this project does
 * not invent numbers (V2, CD-6, OD1). The bar therefore moves only between the
 * two facts the client can observe — request handed to the network (half of what
 * we know) and answer received (all of it) — and says so in `aria-valuetext`,
 * which is what a screen reader reads instead of the number.
 *
 * What proves the page is alive is the CLOCK: a real elapsed-seconds caption,
 * ticking once a second, which is a fact rather than an estimate. That pairing
 * is the honest version of "determinate progress": determinate about the events
 * we know, honest about the waiting we cannot measure.
 *
 * ## Mounting is the animation
 *
 * The progress block is its own component so that mounting restarts its clock:
 * a `setState` on mount would be the cascading render the lint rule refuses, and
 * a `useState` that outlives a retry would resume at 8 s. Mounted fresh per
 * attempt, the clock starts at zero with no effect needed.
 *
 * The skeletons below it are `aria-hidden` decoration (as the kit says); the
 * announcement is the wizard's `role="status"` line, so a screen reader hears
 * "searching" once rather than the shapes arriving.
 */

import { useEffect, useState } from "react";

import { Alert, ProgressBar, SkeletonCard } from "@/components/ui";
import { formatNumber, type AppLocale } from "@/lib/i18n/format";
import { fill, type WizardCopy } from "@/lib/wizard/copy";
import { stepForField } from "@/lib/wizard/model";
import type { SubmitFailure } from "@/lib/wizard/submit";

export interface SubmitPanelProps {
  submitting: boolean;
  failure: SubmitFailure | null;
  /** Seconds left on a 429 countdown, or null when none is running. */
  remaining: number | null;
  copy: WizardCopy;
  locale: AppLocale;
}

export function SubmitPanel({ submitting, failure, remaining, copy, locale }: SubmitPanelProps) {
  if (submitting) {
    return <SubmitProgress copy={copy} locale={locale} />;
  }
  if (failure === null) return null;

  const message = messageFor(failure, remaining, copy, locale);
  if (message === null) return null;

  return (
    <div className="mt-6">
      <Alert tone={message.tone}>
        <p>{message.text}</p>
        {message.detail === undefined ? null : (
          <p className="mt-1 text-muted">{message.detail}</p>
        )}
      </Alert>
    </div>
  );
}

interface Message {
  tone: "warning" | "error";
  text: string;
  detail?: string;
}

/**
 * The sentence for a failure, or null when the screen already says it better
 * elsewhere.
 *
 * That null is the 422 case: when the failing field has a CONTROL, the error is
 * rendered inline under it and focus is moved there, so an alert with the same
 * sentence would announce it twice and point at nothing. Only a field with no
 * control on any step — `currency`, which the wizard fixes to MAD, or a name the
 * contract does not have — gets the general sentence here.
 */
function messageFor(
  failure: SubmitFailure,
  remaining: number | null,
  copy: WizardCopy,
  locale: AppLocale,
): Message | null {
  switch (failure.kind) {
    case "too-large":
      return { tone: "error", text: copy.errorTooLarge };
    case "rate-limited":
      return remaining !== null && remaining > 0
        ? {
            tone: "warning",
            text: fill(copy.errorRateLimited, { seconds: formatNumber(remaining, locale) }),
          }
        : { tone: "warning", text: copy.errorRateLimitedNoWait };
    case "unavailable":
      return { tone: "error", text: copy.errorUnavailable };
    case "server":
      return {
        tone: "error",
        text: copy.errorServer,
        detail:
          failure.requestId === null
            ? undefined
            : fill(copy.errorRequestId, { id: failure.requestId }),
      };
    case "fields": {
      const first = failure.fields[0];
      if (first === undefined) return { tone: "error", text: copy.errorFieldUnknown };
      if (stepForField(first) !== null) return null; // inline, under the control
      return {
        tone: "error",
        text: copy.fieldErrors[first] ?? copy.errorFieldUnknown,
      };
    }
  }
}

/** The in-flight block. Mounted per attempt, so its clock starts at zero. */
function SubmitProgress({ copy, locale }: { copy: WizardCopy; locale: AppLocale }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mt-6 space-y-3">
      <ProgressBar
        label={copy.submitProgressLabel}
        value={50}
        max={100}
        valueText={copy.submitProgressValueText}
        caption={fill(copy.submitElapsed, { seconds: formatNumber(seconds, locale) })}
      />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
