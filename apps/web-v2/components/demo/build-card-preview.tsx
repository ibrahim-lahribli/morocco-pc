import { Cpu } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

export interface BuildCardPreviewProps {
  title: string;
  specs: string;
  price: string;
  statusLabel: string;
  statusTone: BadgeTone;
  actionLabel: string;
}

/**
 * A build card in the supplied visual direction: media frame with a status
 * pill, title + spec summary, then a divided price/action row. The media is a
 * token gradient with the CPU mark until real product images exist.
 */
export function BuildCardPreview({
  title,
  specs,
  price,
  statusLabel,
  statusTone,
  actionLabel,
}: BuildCardPreviewProps) {
  return (
    <Card className="overflow-hidden">
      <div className="relative m-3 mb-0 aspect-video overflow-hidden rounded-field bg-linear-to-br from-primary-soft via-surface to-surface-sunken">
        <Cpu
          aria-hidden="true"
          className="absolute inset-0 m-auto size-12 text-primary/25"
          strokeWidth={1.5}
        />
        <Badge tone={statusTone} className="absolute end-2 top-2 shadow-level-1">
          {statusLabel}
        </Badge>
      </div>

      <CardContent className="flex flex-col gap-1">
        <h3 className="text-headline-sm text-foreground">{title}</h3>
        <p className="text-body-sm text-muted">{specs}</p>
      </CardContent>

      <CardFooter className="justify-between gap-3 py-3">
        <span className="text-[1.125rem] font-bold text-foreground tabular-nums">{price}</span>
        <span className="text-label-md font-semibold text-primary">{actionLabel}</span>
      </CardFooter>
    </Card>
  );
}
