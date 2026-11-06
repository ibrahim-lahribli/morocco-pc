import { z } from "zod";

/**
 * Search validation, with its messages supplied by the caller so no
 * user-facing string lives outside the dictionaries. `trim` runs before the
 * length checks, so whitespace-only input is "required", not "too short".
 */
export interface SearchMessages {
  required: string;
  min: string;
}

export function createSearchSchema(messages: SearchMessages) {
  return z.object({
    query: z
      .string()
      .trim()
      .min(1, { message: messages.required })
      .min(2, { message: messages.min }),
  });
}

export type SearchValues = z.infer<ReturnType<typeof createSearchSchema>>;
