export interface SpecPillProps {
  children: React.ReactNode;
}

/** One component name on a build card. Copy arrives as children. */
export function SpecPill({ children }: SpecPillProps) {
  return (
    <span className="inline-flex max-w-full items-center rounded-pill bg-surface-sunken px-2.5 py-1 text-label-md text-muted">
      <span className="truncate">{children}</span>
    </span>
  );
}
