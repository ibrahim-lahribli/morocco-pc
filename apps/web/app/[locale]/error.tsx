"use client";

/**
 * app/[locale]/error.tsx — the segment's error boundary (Phase 3, gate G3).
 *
 * Next requires an error boundary to be a CLIENT component, and a client
 * component cannot be handed props by its layout — it replaces the segment's
 * content, so there is no parent render to read the catalogue in. Every other
 * screen in this app takes its copy as props from the server
 * (`lib/wizard/copy.ts`); this is the one place that cannot.
 *
 * WHICH IS WHY THE COPY IS GENERATED, AND WHAT THAT COST. The obvious fix was
 * `NextIntlClientProvider` with the `errors` namespace mounted in the layout.
 * It was built and MEASURED (2026-11-03): **+15 845 B** of script on the result
 * route (168 710 -> 184 555 B against a 174 080 B budget) and LCP 2 494 ->
 * 2 643 ms — two budget failures for seven sentences, because the provider pulls
 * next-intl's client runtime in. So `lib/i18n/error-copy.generated.ts` mirrors
 * the namespace into a plain object instead: the catalogues stay the source of
 * truth, `check:i18n` fails when they drift, and the client pays for strings
 * only.
 *
 * THREE DECISIONS WORTH KEEPING:
 *
 *   - **`Alert` carries the sentence, at `error` tone**, so a hard failure looks
 *     like every other error in the product ("one primitive, one voice", S22).
 *     The primitive's `role="alert"` is right here: the page it replaced is gone
 *     and the reader's next move may be wrong.
 *   - **The message shown is OURS, never `error.message`.** For a server render
 *     Next replaces the message with a generic one and keeps a `digest`, so the
 *     real text is either unavailable or internals; the digest is what a support
 *     request can actually be matched against, and it is shown only when it
 *     exists.
 *   - **`reset()` is a button, "back to home" is a link.** A retry re-renders the
 *     same route (an action); home is navigation — the distinction `button.tsx`
 *     and `LinkButton` exist to preserve.
 *
 * `console.error` is deliberate and not a stand-in for a reporter: Next already
 * logs the render failure, and this keeps the client stack in the console for a
 * bug report. Wiring a real error service is an operator decision (and an API
 * request), not something a boundary should invent.
 */
import { useParams } from "next/navigation";
import { useEffect } from "react";

import { Alert, Button, LinkButton } from "@/components/ui";
import { ERROR_COPY } from "@/lib/i18n/error-copy.generated";
import { localePath } from "@/lib/i18n/paths";

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ locale?: string }>();
  // The layout has already refused an unknown segment, so anything that is not
  // `ar` is the default locale — the same guard `not-found.tsx` applies.
  const locale = params?.locale === "ar" ? "ar" : "fr";
  const copy = ERROR_COPY[locale];

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section>
      <p className="text-micro tracking-wide text-muted uppercase">{copy.eyebrow}</p>
      <h1 className="mt-1 text-heading text-ink">{copy.title}</h1>
      <div className="mt-4">
        <Alert tone="error">{copy.body}</Alert>
      </div>
      {error.digest ? (
        // Filled by hand: the template is a generated string, and ICU would be an
        // extra runtime for one `{id}`.
        <p className="mt-3 text-compact text-muted">{copy.digest.replace("{id}", error.digest)}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={reset}>{copy.retry}</Button>
        <LinkButton href={localePath(locale, "/")} variant="secondary">
          {copy.home}
        </LinkButton>
      </div>
    </section>
  );
}
