/**
 * components/result/swap-panel.tsx — S24's swap control, live against CD-8.
 *
 * One build card carries one panel. Opening it asks two questions (which role,
 * which replacement), then one button asks the API what would happen. A second
 * button KEEPS that answer (Decision 56): the API appends one derived build and
 * the pass itself is never rewritten - the card that follows names the swap
 * instead of inventing a new rank.
 *
 * The decisions this component does NOT make live in `lib/result/swap.ts`, so
 * they are stated once: which roles are swappable, which catalogue rows become
 * choices, what a GPU choice has to carry, and what each verdict MEANS. What is
 * left here is the state machine and the rendering.
 *
 * Four things are deliberate:
 *
 * 1. **It is a client island, and the copy arrives as props.** The result page
 *    is a server component and the app ships no client message catalogue
 *    (design/I18N.md), so the card renders the translated roles and every
 *    sentence once, on the server, and passes them in. That keeps the panel's
 *    bundle to code, not to a second copy of the catalogue.
 *
 * 2. **Nothing is fetched until the reader asks.** Opening the panel is local
 *    state; the catalogue read happens when a ROLE is chosen, and the preview
 *    only on the button. The endpoint's budget is 30 passes a minute, so an
 *    eager fetch per card would spend it on curiosity.
 *
 * 3. **UNKNOWN is rendered as its own state.** The engine's three-state
 *    vocabulary is load-bearing (a relationship nobody checked is not one that
 *    holds), so `UNKNOWN` gets its own word, its own sentence and its own
 *    `data-verdict` — never the PASS styling with a footnote.
 *
 * 4. **The answer is announced, and its numbers are the API's.** The result
 *    region exists from the first render and is `aria-live="polite"`, so the
 *    verdict is spoken when it arrives rather than being a silent DOM change.
 *    Every amount on screen comes from the response (`price`, `budget`), or from
 *    `formatMoney` over one of its numbers; the panel never recomputes a total.
 *
 * 5. **Applying is offered only where the server would accept it.** A `FAIL`
 *    verdict is refused by the commit route, so the button is absent rather
 *    than present-and-doomed (`canCommit`). After a 201 the panel asks Next to
 *    re-render the page, so the card above shows the swap the API actually
 *    stored - the panel does not paint a build the server has not served.
 */
"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ReactNode } from "react";

import { Alert, Badge, Button, ProgressBar } from "@/components/ui";
import { formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import {
  budgetTone,
  overBudgetBy,
  remainingBudget,
  type PriceProvenance,
} from "@/lib/result/model";
import {
  canCommit,
  eligibilityFailure,
  eligibilityReasonKey,
  offerProvenance,
  priceFigures,
  swapBar,
  swapCommitErrorKey,
  swapErrorKey,
  swapOptions,
  unknownPairwiseCount,
  verdictOf,
  type EligibilityReasonKey,
  type SwapCommitErrorKey,
  type SwapErrorKey,
  type SwapOption,
  type SwapVerdict,
} from "@/lib/result/swap";
import {
  commitSwap,
  getSwapPreview,
  listCatalogProducts,
  type SwapCommitResponse,
  type SwapPreviewResponse,
} from "@/lib/api/client";

/** Every sentence the panel says, translated by the server that renders it. */
export interface SwapLabels {
  /** The control's name. Unchanged while open: it names the ACTION. */
  label: string;
  /** One sentence: what this does, and that nothing is stored. */
  intro: string;
  roleLabel: string;
  rolePlaceholder: string;
  candidateLabel: string;
  candidatePlaceholder: string;
  /** The catalogue read is in flight. */
  loading: string;
  /** The catalogue answered, and there is nothing else for this role. */
  noCandidates: string;
  /** The catalogue read failed. */
  loadError: string;
  /** The button that asks the API. */
  preview: string;
  /** The same button while the preview is in flight. */
  previewing: string;
  verdictTitle: string;
  /** One word per engine status. UNKNOWN is a word, not a footnote. */
  verdict: Record<SwapVerdict, string>;
  /** One sentence per status, explaining what the verdict claims. */
  verdictNote: Record<SwapVerdict, string>;
  /** `{count}` relationships could not be checked. */
  unknownCount: string;
  /** One pairwise relation: `{role}` and `{partner}` came out `{status}`. */
  pairLine: string;
  /** A relation with no partner of its own: `{role}` came out `{status}`. */
  pairSelf: string;
  /** The word for a role this build does not name (never a raw enum). */
  otherRoleLabel: string;
  /** Every role word the page knows, keyed by the engine's vocabulary. */
  roleWords: Readonly<Record<string, string>>;
  /** The eligibility sentences, keyed by the API's reason codes. */
  eligibility: Record<EligibilityReasonKey, string>;
  /** The badge words, shared with the card's own price badge (S12). */
  provenance: Record<PriceProvenance, string>;
  priceTitle: string;
  /** `{previous}` → `{next}`. */
  pricePair: string;
  /** A role the build did not have: only the new price is known. */
  priceNewOnly: string;
  priceUnknown: string;
  priceUp: string;
  priceDown: string;
  priceSame: string;
  budgetTitle: string;
  barLabel: string;
  /** `{total}` of `{budget}` — the bar's accessible value. */
  barValueText: string;
  /** `{amount}` left. */
  barRemaining: string;
  /** `{amount}` past the budget. */
  barOver: string;
  budgetUnknown: string;
  /** The API's own verdict says the total no longer fits. */
  overBudget: string;
  errors: Record<SwapErrorKey, string>;
  /** The button that PERSISTS the preview (Decision 56). */
  apply: string;
  /** The same button while the commit is in flight. */
  applying: string;
  /** The commit's own failures, keyed by what the reader can do next. */
  commitErrors: Record<SwapCommitErrorKey, string>;
  /** The heading of the applied state. */
  appliedTitle: string;
  /** `{role}` was replaced; the build now totals `{total}`. */
  appliedNote: string;
  /** The stored commit's instant, as the API served it. */
  appliedWhen: string;
}

export interface SwapPanelProps {
  /** The recommendation this card belongs to. */
  resultId: string;
  /** The build's rank — the address the endpoint takes. */
  rank: number;
  /** This build's roles, in assembly order, with their translated names. */
  roles: readonly { role: string; label: string }[];
  /** The product currently in each role, so the picker cannot offer it back. */
  installed: Readonly<Record<string, string>>;
  locale: AppLocale;
  labels: SwapLabels;
}

/** The catalogue read for one role. */
type Candidates =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; options: SwapOption[] };

/** The preview call. */
type Preview =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; key: SwapErrorKey }
  | { kind: "result"; body: SwapPreviewResponse; option: SwapOption };

/** The commit call, kept apart from the preview so a refusal leaves the preview intact. */
type Commit =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; key: SwapCommitErrorKey }
  | { kind: "done"; body: SwapCommitResponse };

/**
 * The verdict's relationship lines, or null when none of them carries a name
 * this page knows.
 *
 * One line per PHYSICAL relationship, decided once: the API's pair rows are per
 * CHECK, so one RAM demand arrives as `motherboard_memory`, `mb_memory_slots`
 * and `mb_memory_capacity` — three rows that would print the same sentence
 * three times. Identical (role, partner, status) triples collapse; a pair whose
 * role this page has no word for is skipped rather than printed as an "other"
 * role whose sentence answers nothing. The `<li>` key is the collapsed
 * relationship, not one CHECK of N.
 */
function renderPairLines(
  pairs: readonly SwapPreviewResponse["compatibility"]["pairs"][number][],
  roleOf: (name: string) => string | undefined,
  labels: SwapLabels,
): ReactNode {
  const seen = new Set<string>();
  const lines: ReactNode[] = [];
  for (const pair of pairs) {
    const roleWord = roleOf(pair.role);
    const partnerWord = pair.partner_role === null ? null : roleOf(pair.partner_role);
    if (roleWord === undefined) continue;
    if (pair.partner_role !== null && partnerWord === undefined) continue;
    const key = `${pair.role}:${pair.partner_role ?? ""}:${pair.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const word = labels.verdict[pair.status];
    const text =
      pair.partner_role === null
        ? labels.pairSelf.replace("{role}", roleWord).replace("{status}", word)
        : labels.pairLine
            .replace("{role}", roleWord)
            .replace("{partner}", partnerWord ?? "")
            .replace("{status}", word);
    lines.push(
      <li key={key} data-pair-status={pair.status} className="text-caption text-ink">
        {text}
      </li>,
    );
  }
  if (lines.length === 0) return null;
  return <ul className="mt-2 space-y-1">{lines}</ul>;
}

export function SwapPanel({
  resultId,
  rank,
  roles,
  installed,
  locale,
  labels,
}: SwapPanelProps) {
  const panelId = useId();
  const roleId = useId();
  const candidateId = useId();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("");
  const [optionKey, setOptionKey] = useState("");
  const [candidates, setCandidates] = useState<Candidates>({ kind: "idle" });
  const [preview, setPreview] = useState<Preview>({ kind: "idle" });
  const [commit, setCommit] = useState<Commit>({ kind: "idle" });
  const router = useRouter();
  // A role can be changed while its read is in flight; only the newest read may
  // land, or a slow first answer would repaint the second question's choices.
  const requestId = useRef(0);

  async function chooseRole(next: string): Promise<void> {
    setRole(next);
    setOptionKey("");
    setPreview({ kind: "idle" });
    setCommit({ kind: "idle" });
    if (next === "") {
      setCandidates({ kind: "idle" });
      return;
    }
    const request = requestId.current + 1;
    requestId.current = request;
    setCandidates({ kind: "loading" });
    try {
      // `limit=100` is the API's maximum page: a role's whole catalogue fits,
      // which is what a picker needs. A cursor walk here would be a second
      // pagination to keep right for no reader benefit.
      const page = await listCatalogProducts({ role: next, limit: "100" });
      if (requestId.current !== request) return;
      setCandidates({
        kind: "ready",
        options: swapOptions(next, page.products, installed[next] ?? null),
      });
    } catch {
      if (requestId.current !== request) return;
      setCandidates({ kind: "error" });
    }
  }

  async function previewSwap(): Promise<void> {
    if (candidates.kind !== "ready") return;
    const option = candidates.options.find((entry) => entry.key === optionKey);
    if (option === undefined) return;
    setPreview({ kind: "loading" });
    setCommit({ kind: "idle" });
    try {
      const body = await getSwapPreview({
        id: resultId,
        rank,
        role: option.role,
        productId: option.productId,
        productVariantId: option.productVariantId,
      });
      setPreview({ kind: "result", body, option });
    } catch (error) {
      setPreview({ kind: "error", key: swapErrorKey(error) });
    }
  }

  /**
   * Ask the API to KEEP the previewed swap.
   *
   * The request repeats the same triple the preview sent: a commit re-evaluates
   * and re-prices on the server (the catalogue may have moved between the two
   * calls), so sending the preview's answer back would be asking the API to
   * agree with itself.
   */
  async function applySwap(): Promise<void> {
    if (preview.kind !== "result") return;
    const option = preview.option;
    setCommit({ kind: "loading" });
    try {
      const body = await commitSwap({
        id: resultId,
        rank,
        role: option.role,
        productId: option.productId,
        productVariantId: option.productVariantId,
      });
      setCommit({ kind: "done", body });
      // The card renders the build the SERVER holds, so a commit makes that
      // render stale by design. Re-rendering is the only honest way to show it.
      router.refresh();
    } catch (error) {
      setCommit({ kind: "error", key: swapCommitErrorKey(error) });
    }
  }

  const choices = candidates.kind === "ready" ? candidates.options : [];
  const ready = candidates.kind === "ready" && choices.length > 0;
  const busy =
    candidates.kind === "loading" || preview.kind === "loading" || commit.kind === "loading";
  const applied = commit.kind === "done";
  const canApply = preview.kind === "result" && canCommit(preview.body) && !applied;

  return (
    <div className="mt-3">
      <Button
        variant="secondary"
        size="compact"
        className="w-full"
        aria-expanded={open}
        aria-controls={panelId}
        data-swap={open ? "open" : "available"}
        onClick={() => setOpen((current) => !current)}
      >
        {labels.label}
      </Button>

      {open ? (
        <div id={panelId} className="mt-2 rounded-control border border-border bg-subtle p-3">
          <p className="text-caption text-muted">{labels.intro}</p>

          <div className="mt-3">
            <label
              htmlFor={roleId}
              className="block text-caption font-semibold uppercase tracking-wider text-muted"
            >
              {labels.roleLabel}
            </label>
            <select
              id={roleId}
              value={role}
              onChange={(event) => {
                void chooseRole(event.target.value);
              }}
              className="mt-1.5 h-tap w-full rounded-control border border-border bg-surface px-2 text-compact text-ink"
            >
              <option value="">{labels.rolePlaceholder}</option>
              {roles.map((entry) => (
                <option key={entry.role} value={entry.role}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <label
              htmlFor={candidateId}
              className="block text-caption font-semibold uppercase tracking-wider text-muted"
            >
              {labels.candidateLabel}
            </label>
            <select
              id={candidateId}
              value={optionKey}
              disabled={!ready}
              onChange={(event) => {
                setOptionKey(event.target.value);
                setPreview({ kind: "idle" });
              }}
              className="mt-1.5 h-tap w-full rounded-control border border-border bg-surface px-2 text-compact text-ink disabled:bg-track disabled:text-muted"
            >
              <option value="">{labels.candidatePlaceholder}</option>
              {choices.map((option) => (
                <option key={option.key} value={option.key}>
                  {optionLabel(option, locale)}
                </option>
              ))}
            </select>
            {candidates.kind === "loading" ? (
              <p className="mt-1.5 text-caption text-muted">{labels.loading}</p>
            ) : null}
            {candidates.kind === "error" ? (
              <p className="mt-1.5 text-caption text-warning">{labels.loadError}</p>
            ) : null}
            {candidates.kind === "ready" && choices.length === 0 ? (
              <p className="mt-1.5 text-caption text-muted">{labels.noCandidates}</p>
            ) : null}
          </div>

          <div className="mt-3">
            <Button
              size="compact"
              className="w-full"
              disabled={!ready || optionKey === "" || busy || applied}
              onClick={() => {
                void previewSwap();
              }}
            >
              {preview.kind === "loading" ? labels.previewing : labels.preview}
            </Button>
            {canApply ? (
              <Button
                size="compact"
                className="mt-2 w-full"
                disabled={busy}
                data-swap-apply="available"
                onClick={() => {
                  void applySwap();
                }}
              >
                {commit.kind === "loading" ? labels.applying : labels.apply}
              </Button>
            ) : null}
          </div>

          {/* Present from the first render: a live region created at the moment
              it is spoken into is how the announcement gets lost. */}
          <div aria-live="polite" className="mt-3">
            {preview.kind === "loading" ? (
              <p className="text-caption text-muted">{labels.previewing}</p>
            ) : null}
            {preview.kind === "error" ? (
              <Alert tone="warning">{labels.errors[preview.key]}</Alert>
            ) : null}
            {preview.kind === "result" ? (
              <SwapResult body={preview.body} locale={locale} labels={labels} />
            ) : null}
            {commit.kind === "error" ? (
              <div className="mt-2">
                <Alert tone="warning">{labels.commitErrors[commit.key]}</Alert>
              </div>
            ) : null}
            {commit.kind === "done" ? (
              <AppliedResult body={commit.body} locale={locale} labels={labels} roles={roles} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The applied state: what the API STORED, not what was hoped for.
 *
 * Every number here is the 201's own (`budget.total`, `swapped.committed_at`),
 * and nothing is re-derived - the committed build's total is `persisted -
 * previous + next` computed by the engine, on the server, in the transaction
 * that wrote the rows.
 */
function AppliedResult({
  body,
  locale,
  labels,
  roles,
}: {
  body: SwapCommitResponse;
  locale: AppLocale;
  labels: SwapLabels;
  roles: readonly { role: string; label: string }[];
}) {
  const role = body.swapped.role;
  const roleName = roles.find((entry) => entry.role === role)?.label ?? labels.otherRoleLabel;
  const stored = typeof body.budget.total === "number" ? body.budget.total : body.price.next;
  const total = stored === null ? labels.priceUnknown : formatMoney(stored, locale);
  const when = body.swapped.committed_at ?? labels.priceUnknown;

  return (
    <div
      data-swap-applied={role}
      className="rounded-control border border-success/20 bg-success-soft p-3"
    >
      <h4 className="text-compact font-semibold text-ink">{labels.appliedTitle}</h4>
      <p className="mt-1 text-compact text-ink">
        {labels.appliedNote.replace("{role}", roleName).replace("{total}", total)}
      </p>
      <p className="mt-1 text-caption text-muted">{labels.appliedWhen.replace("{when}", when)}</p>
    </div>
  );
}

/** One `<option>`'s text: the name, its SKU when it has one, and its price. */
function optionLabel(option: SwapOption, locale: AppLocale): string {
  const parts = [option.name];
  if (option.sku !== null) parts.push(option.sku);
  if (option.price !== null) parts.push(formatMoney(option.price, locale));
  return parts.join(" · ");
}

/** The three facts the endpoint answers with, rendered in words. */
function SwapResult({
  body,
  locale,
  labels,
}: {
  body: SwapPreviewResponse;
  locale: AppLocale;
  labels: SwapLabels;
}) {
  const status = verdictOf(body);
  const eligibility = eligibilityFailure(body);
  const pairs = body.compatibility.pairs.filter((pair) => pair.check !== "eligibility");
  const unknown = unknownPairwiseCount(body);
  const price = priceFigures(body.price);
  const provenance = offerProvenance(body.price);
  const bar = swapBar(body.budget);
  const tone = bar === null ? "normal" : budgetTone(bar.total, bar.budget);
  const over = bar === null ? null : overBudgetBy(bar.total, bar.budget);
  const left = bar === null ? null : remainingBudget(bar.total, bar.budget);
  const money = (value: number) => formatMoney(value, locale);
  // A role is a WORD, resolved from the page's whole role vocabulary
  // (`roleWords`), not just this build's slots: the API names roles the build
  // itself may not carry (a swapped-in part can make demands of a role the
  // build does not assemble). A pair whose role has NO word on the page is
  // DROPPED from the list — a line that would read "Autre : …" answers
  // nothing — and the verdict word above still carries the state.
  const role = (name: string): string | undefined => labels.roleWords[name];

  return (
    <div data-swap-verdict={status} className="rounded-control border border-border bg-surface p-3">
      <h4 className="text-compact font-semibold text-ink">{labels.verdictTitle}</h4>

      {/* The verdict word, then the sentence that says what it claims. PASS is
          the only one that needs no banner: it is the answer that was hoped for,
          and an Alert for it would make a warning state look normal. */}
      <p className="mt-1 text-compact font-semibold text-ink" data-verdict={status}>
        {labels.verdict[status]}
      </p>
      {status === "PASS" ? (
        <p className="mt-1 text-caption text-muted">{labels.verdictNote.PASS}</p>
      ) : (
        <div className="mt-2">
          <Alert tone={status === "FAIL" ? "warning" : "info"}>{labels.verdictNote[status]}</Alert>
        </div>
      )}

      {/* A candidate that could not be evaluated at all has ONE reason, and it
          is not a relation: the panel says why in words, and no partner role is
          named because there is none. */}
      {eligibility !== null ? (
        <p className="mt-2 text-caption text-ink">
          {labels.eligibility[eligibilityReasonKey(eligibility)]}
        </p>
      ) : null}

      {/* One line per PHYSICAL relationship, decided here once: the API's pair
          rows are per CHECK, so one RAM demand arrives as `motherboard_memory`,
          `mb_memory_slots` and `mb_memory_capacity` — three lines that would
          read the same. Identical (role, partner, status) triples collapse; a
          pair whose role this page cannot name is skipped rather than printed
          as "Autre". */}
      {renderPairLines(pairs, role, labels)}

      {unknown > 0 ? (
        <p className="mt-2 text-caption text-muted">
          {labels.unknownCount.replace("{count}", formatNumber(unknown, locale))}
        </p>
      ) : null}

      <div className="mt-3 border-t border-border pt-2">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-caption font-semibold uppercase tracking-wider text-muted">
            {labels.priceTitle}
          </h5>
          {provenance === null ? null : <Badge tone={provenance}>{labels.provenance[provenance]}</Badge>}
        </div>
        {price.next === null ? (
          <p className="mt-1 text-compact text-muted">{labels.priceUnknown}</p>
        ) : price.previous === null ? (
          <p className="mt-1 num-tabular text-compact text-ink">
            {labels.priceNewOnly.replace("{next}", money(price.next))}
          </p>
        ) : (
          <p className="mt-1 num-tabular text-compact text-ink">
            {labels.pricePair
              .replace("{previous}", money(price.previous))
              .replace("{next}", money(price.next))}
          </p>
        )}
        {price.delta === null ? null : price.delta === 0 ? (
          <p className="mt-0.5 text-caption text-muted">{labels.priceSame}</p>
        ) : (
          <p
            className="mt-0.5 text-caption"
            data-price-change={price.delta > 0 ? "up" : "down"}
          >
            {(price.delta > 0 ? labels.priceUp : labels.priceDown).replace(
              "{amount}",
              money(Math.abs(price.delta)),
            )}
          </p>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-2">
        <h5 className="text-caption font-semibold uppercase tracking-wider text-muted">
          {labels.budgetTitle}
        </h5>
        {bar === null ? (
          <p className="mt-1 text-compact text-muted">{labels.budgetUnknown}</p>
        ) : (
          <div className="mt-1.5">
            <ProgressBar
              label={labels.barLabel}
              value={bar.total}
              max={bar.budget}
              tone={tone}
              detail={
                over !== null
                  ? labels.barOver.replace("{amount}", money(over))
                  : left !== null
                    ? labels.barRemaining.replace("{amount}", money(left))
                    : undefined
              }
              valueText={labels.barValueText
                .replace("{total}", money(bar.total))
                .replace("{budget}", money(bar.budget))}
            />
          </div>
        )}
        {over !== null ? (
          <div className="mt-2">
            <Alert tone="warning">{labels.overBudget.replace("{amount}", money(over))}</Alert>
          </div>
        ) : null}
      </div>
    </div>
  );
}
