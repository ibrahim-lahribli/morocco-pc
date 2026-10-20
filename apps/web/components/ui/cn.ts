/**
 * `cn` — join class names, dropping falsy entries.
 *
 * Deliberately not a Tailwind-merge clone: the kit never passes two
 * conflicting utilities for the same property, so a plain filter keeps the
 * bundle free of a dependency and the output predictable.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
