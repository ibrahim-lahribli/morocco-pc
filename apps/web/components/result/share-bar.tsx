/**
 * share-bar.tsx — the results page's three ways out (S15), as ONE composition.
 *
 * WhatsApp is an anchor so it works before JS exists and keeps the browser's
 * link semantics (open-in-new-tab, the status bar); the native Web Share and
 * the clipboard need the client, so the copy path and the share button are a
 * "use client" island smaller than any translated-catalogue provider would be.
 * The strings arrive as PROPS from the server page rather than from
 * `useTranslations`: the layout ships no client catalogue (I18N.md), and this
 * island is the one place the app would have paid for it.
 *
 * Announcements: the copy button writes its success into an empty
 * `aria-live="polite"` region that exists from the first render — speaking a
 * success into a region created at the same moment is exactly the bug that
 * swallows it on some screen readers.
 *
 * The feature check is `useSyncExternalStore`, not a state-assigning effect:
 * the server snapshot is `false` and the client snapshot comes from
 * `navigator.share`, so React re-renders once after hydration with no
 * mismatch and no setState-inside-effect cascade. The subscribe is a no-op
 * deliberately — the API does not appear mid-session, and modelling a
 * subscription for a fact that cannot change would be theatre.
 */
"use client";

import { useState, useSyncExternalStore } from "react";

import { Button, buttonClasses } from "@/components/ui";
import { trackEvent } from "@/lib/analytics";

export interface ShareBarLabels {
  /** The group's accessible name. */
  label: string;
  /** Visible text and accessible name of the wa.me anchor. */
  whatsapp: string;
  /** Visible text of the copy button, with the full name as its aria-label. */
  copy: string;
  /** Visible text of the native-share button, revealed only when supported. */
  share: string;
  /** What the live region says after the link was copied. */
  copied: string;
}

export interface ShareBarProps {
  /** The canonical absolute URL, shared by copy, share and preview (S15). */
  shareUrl: string;
  /** The pre-encoded wa.me intent link, built server-side so it needs no JS. */
  whatsappHref: string;
  /** Text WITHOUT the URL — the Web Share payload carries `url` separately. */
  shareText: string;
  labels: ShareBarLabels;
}

const NO_REACTIVE = () => () => {};

export function ShareBar({ shareUrl, whatsappHref, shareText, labels }: ShareBarProps) {
  const canShare = useSyncExternalStore(
    NO_REACTIVE,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );
  const [copied, setCopied] = useState(false);

  // A device with the Web Share API gets its third button (reconciled once after
  // hydration, see the header note); everything else keeps the two it always
  // had — nothing is hidden behind a sniff.

  async function copyLink(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(shareUrl);
      return true;
    } catch {
      // Clipboard API needs a secure context or user-granted permission; the
      // textarea fallback covers what it cannot (and is what every legacy
      // share widget fell back to). No document write, no focus steal.
      const field = document.createElement("textarea");
      field.value = shareUrl;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      let done = false;
      try {
        done = document.execCommand("copy");
      } catch {
        done = false;
      }
      field.remove();
      return done;
    }
  }

  async function onCopy() {
    if (await copyLink()) {
      setCopied(true);
      // S22: WHICH channel was used, never which URL was shared. The link names
      // one person's configuration, so it stays out of the payload entirely.
      trackEvent({ name: "share_used", props: { channel: "copy" } });
    }
  }

  async function onShare() {
    try {
      await navigator.share({ text: shareText, url: shareUrl });
      trackEvent({ name: "share_used", props: { channel: "native" } });
    } catch (error) {
      // The user cancelled the sheet: announce nothing, copy nothing.
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      // Any other failure takes the fallback the DoD names: copy the link and
      // say so, through the same live region.
      if (await copyLink()) {
        setCopied(true);
      }
    }
  }

  const anchorClasses = buttonClasses("whatsapp", "compact");

  return (
    <div>
      <div role="group" aria-label={labels.label} className="flex flex-wrap items-center gap-2">
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={labels.whatsapp}
          className={anchorClasses}
          // The anchor still works before JS and keeps its link semantics; the
          // handler only records that this channel was chosen.
          onClick={() => trackEvent({ name: "share_used", props: { channel: "whatsapp" } })}
        >
          {labels.whatsapp}
        </a>
        <Button variant="secondary" size="compact" onClick={onCopy}>
          {labels.copy}
        </Button>
        {canShare ? (
          <Button variant="secondary" size="compact" onClick={onShare}>
            {labels.share}
          </Button>
        ) : null}
      </div>
      <p aria-live="polite" className="mt-2 min-h-tap text-compact text-muted">
        {copied ? labels.copied : ""}
      </p>
    </div>
  );
}
