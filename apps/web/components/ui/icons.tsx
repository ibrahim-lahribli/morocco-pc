/**
 * Icons — the six glyphs the kit needs, drawn to the board's 24 px grid.
 *
 * The board draws them inline, at 20 px in a banner and 14 px in a badge. They
 * are `currentColor` strokes so a component can colour them with a token, and
 * they are `aria-hidden` by default: in every use the meaning is carried by
 * adjacent text, so announcing the icon would say everything twice.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: "badge" | "banner" };

function classes(size: IconProps["size"], className: string | undefined): string {
  const box = size === "badge" ? "h-3.5 w-3.5" : "h-5 w-5";
  return [box, "shrink-0", className].filter(Boolean).join(" ");
}

function base({ size, className, ...rest }: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    className: classes(size, className),
    ...rest,
  };
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)} strokeWidth={2.5}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

export function InfoCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

export function WarningTriangleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function ErrorCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  );
}

/** The "no evidence yet" glyph: a question mark in a circle. */
export function QuestionCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 4 2c-.9.7-1.5 1.3-1.5 2.5M12 17h.01" />
    </svg>
  );
}

/** The tab bar's five cells. Strokes on the same 24 px grid as the rest. */
export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

/** A chip: components / catalogue. */
export function ChipIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </svg>
  );
}

/** The wizard: a sparkle, as the board draws the raised centre cell. */
export function SparklesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
      <path d="M18 16.5 19 19l2.5 1-2.5 1-1 2.5-1-2.5L14.5 20l2.5-1 1-2.5Z" />
    </svg>
  );
}

/** Guides. */
export function BookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5Z" />
      <path d="M8 7h8M8 11h6" />
    </svg>
  );
}

/** The shelf: a bookmark, not a heart — it names a saved pointer, not a favourite. */
export function BookmarkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3h12v18l-6-4.5L6 21V3Z" />
    </svg>
  );
}
