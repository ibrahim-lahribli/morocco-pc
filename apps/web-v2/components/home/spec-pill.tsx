export interface SpecPillProps {
  children: React.ReactNode;
}

/* * One component name on a build card. Copy arrives as children.
 *
 * The name wraps rather than truncating: real catalogue names run past a card's
 * width, and an ellipsis hid the part that distinguishes one part from another. */
export function SpecPill({ children }: SpecPillProps) {
  return (
    <span className="inline-flex max-w-full items-center rounded-pill bg-surface-sunken px-2.5 py-1 text-label-md text-muted">
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}
