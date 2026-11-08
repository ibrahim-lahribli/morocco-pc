import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design's type scale, declared as `text-*` SIZES.
 *
 * tailwind-merge cannot tell `text-label-lg` (a size token) from
 * `text-on-accent` (a colour token), so it files both under the same group and
 * keeps only the last one. Any variant that sets a colour and is then given a
 * size — every coloured button is — silently lost its colour. Naming the scale
 * here keeps the two groups apart; no token changes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-lg",
            "display",
            "headline-lg",
            "headline-md",
            "headline-sm",
            "body-lg",
            "body-sm",
            "body-md",
            "label-lg",
            "label-md",
            "label-sm",
            "price",
          ],
        },
      ],
    },
  },
});

/** Merge conditional class names and resolve Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
