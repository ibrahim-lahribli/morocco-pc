import { Cpu } from "lucide-react";

import { Card, CardContent } from "@/components/ui";

export interface HeroRigPreviewProps {
  eyebrow: string;
  caption: string;
  /** Rendered as text: there is no product page to link to yet. */
  details: string;
}

/**
 * The desktop hero preview.
 *
 * Text-only shell by design: the preset it would preview lives in a client
 * island, and this is a server component, so it shows no price and no score
 * rather than inventing numbers (the spec's own allowed fallback). The media is
 * a token gradient — no photography ships with the repo.
 */
export function HeroRigPreview({ eyebrow, caption, details }: HeroRigPreviewProps) {
  return (
    <Card className="overflow-hidden">
      <div
        aria-hidden="true"
        className="relative h-44 bg-linear-to-br from-surface-sunken via-surface-muted to-primary-soft"
      >
        <span className="absolute inset-0 flex items-center justify-center text-primary/25">
          <Cpu className="size-16" />
        </span>
        <span className="absolute start-3 bottom-3 rounded-pill bg-surface/95 px-3 py-1 text-label-md text-primary shadow-level-1">
          {caption}
        </span>
      </div>
      <CardContent className="flex items-center justify-between gap-3">
        <p className="text-label-md font-semibold tracking-wide text-muted uppercase">{eyebrow}</p>
        <span aria-disabled="true" className="text-label-lg text-primary">
          {details}
        </span>
      </CardContent>
    </Card>
  );
}
