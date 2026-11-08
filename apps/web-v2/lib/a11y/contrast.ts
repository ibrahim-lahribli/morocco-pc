/**
 * WCAG 2.x contrast maths, with no dependency.
 *
 * The homepage's accessibility gate measures colours a browser actually paints,
 * so `parseCssColor` accepts the forms `getComputedStyle` returns: the comma
 * form (`rgb(11, 28, 48)`), the modern space form (`rgb(11 28 48)`), and an
 * alpha suffix in either (`rgba(11, 28, 48, 0.8)`, `rgb(11 28 48 / 0.8)`).
 *
 * Alpha is deliberately dropped: a text colour with alpha is composited against
 * its own surface, and the caller measures that surface separately. Throwing on
 * an unparsable value is what keeps a silent `NaN` from passing a gate.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const RGB_PATTERN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i;

export function parseCssColor(value: string): Rgb {
  const match = RGB_PATTERN.exec(value.trim());

  if (match === null) {
    throw new TypeError(`Unsupported CSS colour: ${value}`);
  }

  const [, r = "", g = "", b = ""] = match;

  return {
    r: Number(r),
    g: Number(g),
    b: Number(b),
  };
}

/** The WCAG 2.x sRGB channel linearisation. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** The contrast ratio between two colours, from 1 (identical) to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);

  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
