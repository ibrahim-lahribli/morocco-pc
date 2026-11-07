import { cn } from "@/lib/utils";

export interface SectionHeadingProps {
  /** The heading id; the owning `<section aria-labelledby>` points here. */
  id: string;
  /** The small indigo label above the title. */
  eyebrow: string;
  title: string;
  /** The supporting line under the title. */
  intro?: string;
  /**
   * The width from which the eyebrow and the intro appear. `base` matches the
   * configurations frame, which carries both on mobile; `md` matches the trust
   * and guides frames, whose mobile headers are a bare title.
   */
  from?: "base" | "md";
  /** `center` matches the trust frame's centred header. */
  align?: "start" | "center";
  /** A trailing action on the same row from `lg`, e.g. the all-guides link. */
  action?: React.ReactNode;
  /**
   * Makes the heading programmatically focusable. The configurator moves focus
   * to the configurations title after a submit, so that heading alone opts in.
   */
  focusableHeading?: boolean;
}

/**
 * One section header for the homepage.
 *
 * The three sections that own an `<h2>` used to spell the same eyebrow, title
 * and intro rules out by hand, and had drifted: the configurations eyebrow was
 * visible at every width while the other two were `md`-only, and the intro sat
 * at two different margins. This component is the single place those rules
 * live, so a later refinement cannot re-introduce the drift.
 *
 * It renders no wrapper element of its own beyond the header block: the section
 * keeps its `aria-labelledby`, its grid and its spacing.
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  intro,
  from = "md",
  align = "start",
  action,
  focusableHeading = false,
}: SectionHeadingProps) {
  const centered = align === "center";

  return (
    <div
      className={cn(
        action ? "flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between" : undefined,
      )}
    >
      <div className={cn(centered && "mx-auto max-w-2xl text-center")}>
        <p
          className={cn(
            "text-label-md font-semibold tracking-wide text-primary uppercase",
            from === "md" && "hidden md:block",
          )}
        >
          {eyebrow}
        </p>

        <h2
          id={id}
          tabIndex={focusableHeading ? -1 : undefined}
          className={cn(
            "mt-1 text-headline-md text-balance text-foreground lg:text-headline-lg",
            focusableHeading && "focus:outline-none",
          )}
        >
          {title}
        </h2>

        {intro ? (
          <p
            className={cn(
              "mt-1.5 max-w-prose text-body-md text-muted",
              centered && "mx-auto",
              from === "md" && "hidden md:block",
            )}
          >
            {intro}
          </p>
        ) : null}
      </div>

      {action}
    </div>
  );
}
