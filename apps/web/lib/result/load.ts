/**
 * Loading one committed result, as three outcomes rather than a throw (S11).
 *
 * The results page is a server component, so a failed fetch has nowhere to
 * "reject" to: there is no client error boundary around a render whose whole
 * input is the id in the URL, and an unhandled throw would hand a user Next's
 * error page in place of the screen. So the loader narrows the two failures the
 * page can actually do something about:
 *
 *   - **missing** — the API said 404 (unknown id) or 400 (an id it cannot even
 *     parse). From the reader's seat those are the same event: this reference
 *     names nothing. The page turns it into `notFound()`, which is the styled
 *     404 with a way back, and the 404 status the sprint's DoD asks for.
 *   - **unavailable** — anything else: a 5xx, a timeout, a refused connection, a
 *     2xx body that is not JSON. The page renders the "indisponible" state with a
 *     retry, because the reference may well be fine and the service may not be.
 *
 * The error is carried in the outcome rather than swallowed: the page logs it
 * server-side, where a failed fetch is actionable, and the USER gets a sentence
 * instead of a stack trace. What it must never do is fall through to "not found"
 * for a 503 — telling someone their link is dead because our engine is down is a
 * lie that also removes their reason to retry.
 */
import { ApiError, getRecommendationForServer, type RecommendationResponse } from "@/lib/api/client";

export type RecommendationOutcome =
  | { kind: "ok"; recommendation: RecommendationResponse }
  | { kind: "missing" }
  | { kind: "unavailable"; cause: unknown };

export async function loadRecommendation(id: string): Promise<RecommendationOutcome> {
  try {
    return { kind: "ok", recommendation: await getRecommendationForServer(id) };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return { kind: "missing" };
    }
    return { kind: "unavailable", cause: error };
  }
}
