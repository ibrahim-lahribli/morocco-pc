import { Cpu } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Logo placeholder for Step 0: an indigo tile with the CPU mark. Replaced by
 * the final brand asset after design review; the component API (size + label)
 * stays the same so the swap does not touch layout code.
 */
export function Logo({
  className,
  label,
  size = "md",
}: {
  className?: string;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-control bg-primary text-on-primary shadow-level-1",
        size === "sm" ? "size-9" : "size-10",
        className,
      )}
      role="img"
      aria-label={label}
    >
      <Cpu aria-hidden="true" className={size === "sm" ? "size-4" : "size-5"} />
    </span>
  );
}
