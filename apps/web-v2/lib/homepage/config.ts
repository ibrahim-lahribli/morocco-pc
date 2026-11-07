/**
 * Homepage release flags.
 *
 * Both default to `off` and both are read from public environment variables,
 * because the value has to be the same in the browser and in the server render.
 *
 * - `HOMEPAGE_SUBMIT_ENABLED` gates the Step 2 write path. Step 1 implements no
 *   mutation at all: the finder's CTA hands its two answers to the configurator
 *   as query params and posts nothing, so this flag still decides only whether a
 *   future POST may be made once the results route exists.
 * - `GUIDES_ENABLED` gates the guide routes. No guide page exists yet, so the
 *   cards are `data-disabled` articles rather than links to a 404.
 *
 * Neither flag may be turned on without the feature behind it.
 */
export const HOMEPAGE_SUBMIT_ENABLED = process.env.NEXT_PUBLIC_HOMEPAGE_SUBMIT === "on";

export const GUIDES_ENABLED = process.env.NEXT_PUBLIC_GUIDES_ENABLED === "on";
