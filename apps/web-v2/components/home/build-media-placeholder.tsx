import { Cpu } from "lucide-react";

import { cn } from "@/lib/utils";

export interface BuildMediaPlaceholderProps {
  /** Sizing comes from the card: 144 px mobile / 192 px desktop. */
  className?: string;
}

/**
 * The token-only media block.
 *
 * No photography ships with the repository, so the card's image slot is a
 * gradient in the design's own tokens. Decorative: the card's heading carries
 * the meaning, so this is absent from the accessibility tree.
 */
export function BuildMediaPlaceholder({ className }: BuildMediaPlaceholderProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-field bg-linear-to-br from-surface-sunken via-surface-muted to-primary-soft text-primary/25",
        className,
      )}
    >
      <Cpu className="size-8" />
    </div>
  );
}
