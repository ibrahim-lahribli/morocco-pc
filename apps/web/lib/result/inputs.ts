/**
 * lib/result/inputs.ts — the "what your choices changed" facts (Decision 52).
 *
 * `input_effects` IS in contract v1.7, so the generated types describe it. This
 * module still reads it through `unknown`, for the same reason
 * `lib/wizard/applied.ts` and `lib/result/reasons.ts` do, and the reason is
 * concrete rather than stylistic: a result id is a durable reference, and an id
 * created by a 1.6 server can still be fetched by this app. The 1.6 body has no
 * `input_effects`, which at runtime is `undefined` where the type says the field
 * is required — so the parse has to be able to say "the contract was silent"
 * WITHOUT that collapsing into "nothing applied".
 *
 * Three rules:
 *
 *   1. **Silence is not emptiness.** No array (an older server, a hand-made
 *      fixture) yields `null` and the page renders no block at all. An EMPTY
 *      array yields `[]`; today that cannot happen, but a client that treated
 *      the two alike would lose the ability to tell "this server predates the
 *      field" from "this server says none of your inputs were read".
 *   2. **An entry outside the vocabulary is DROPPED, not guessed.** A typo'd or
 *      future `effect` is not rendered as `APPLIED`; the input it names simply
 *      has nothing to say. The mirror rule on the API side keeps the writers
 *      closed, so a drop here means a client older than the server.
 *   3. **A reason is an explanation, not a code to print.** The component maps
 *      it to a catalogue key and falls back to the EFFECT's generic sentence, so
 *      an unknown reason never reaches a user as `SOME_NEW_CODE`.
 *
 * The order is the API's own (`use_case`, `resolution`, `priority`), not
 * re-sorted here: the served order is the product's order, and re-ordering it in
 * a view would make two clients disagree about the same body.
 */

/** The three inputs, as the contract names them. */
export const INPUT_NAMES = ["use_case", "resolution", "priority"] as const;
export type InputName = (typeof INPUT_NAMES)[number];

/** The three-valued effect vocabulary. */
export const INPUT_EFFECTS = ["APPLIED", "NO_EFFECT", "UNKNOWN"] as const;
export type InputEffectStatus = (typeof INPUT_EFFECTS)[number];

/** One renderable effect: the input, its status, and the API's reason code. */
export interface InputEffectView {
  input: InputName;
  effect: InputEffectStatus;
  reason: string;
}

function isInputName(value: unknown): value is InputName {
  return typeof value === "string" && (INPUT_NAMES as readonly string[]).includes(value);
}

function isEffectStatus(value: unknown): value is InputEffectStatus {
  return typeof value === "string" && (INPUT_EFFECTS as readonly string[]).includes(value);
}

/**
 * Read `input_effects` off a recommendation body.
 *
 * `null` = the contract did not say. An array = it did. Never throws: a page
 * that crashes over an explanatory field is worse than one that omits it.
 */
export function readInputEffects(raw: unknown): InputEffectView[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as Record<string, unknown>).input_effects;
  if (!Array.isArray(list)) return null;

  const views: InputEffectView[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (!isInputName(record.input) || !isEffectStatus(record.effect)) continue;
    if (typeof record.reason !== "string" || record.reason.trim() === "") continue;
    views.push({ input: record.input, effect: record.effect, reason: record.reason });
  }
  return views;
}
