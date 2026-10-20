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
