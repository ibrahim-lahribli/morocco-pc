# States, copy and analytics (S22)

**What this file is.** The written half of S22: every error, empty and waiting state the web app
can show, the copy rule each one follows, the analytics contract that ships beside it, and the
measurement that decided when the loader is allowed to start. The machine-checkable part lives in
`apps/web/e2e/states.spec.ts` (the primitive), `apps/web/e2e/analytics.spec.ts` (the payload and the
ordering) and the specs named in the table below; the judgement part — whether a sentence says what
happened and what to do — is here, because no gate can read French.

## 1. One primitive, two roles

Every banner is `components/ui/alert.tsx`. The tone and the live-region role are separate decisions:

| Tone | Role by default | Used when |
|---|---|---|
| `error` | `alert` (interrupts) | the reader's next click may be wrong: a refusal, a service failure, a malformed answer |
| `warning` | none | the fact is true on arrival (a zero-build result) OR the fix is waiting, not a choice (a countdown) |
| `info` | none | context, never a problem |

A `warning` gets `role="status"` **only** when it appeared as the result of an action — S22 wired
that for the wizard's clamp and for the 429 countdown, and both are asserted. A `warning` that is
simply true on load must NOT be a live region: announcing a zero-build result on arrival would
interrupt a screen reader for a sentence the reader is already looking at.

## 2. The inventory

| State | Where | Renders as | Copy rule it follows | Pinned by |
|---|---|---|---|---|
| Options loading | wizard | skeleton, `aria-busy`, one `sr-only` label | what is happening, no fake progress | `wizard.spec.ts` |
| Options unavailable | wizard | `error` alert + "Réessayer" | what happened + the fix + the control that does it | `states.spec.ts` |
| Budget invalid | wizard | inline field error | the control it is about, never a banner | `wizard-budget.spec.ts` |
| Budget clamped to a bound | wizard | `warning` alert, `role="status"` | which bound moved it, and to what | `states.spec.ts`, `wizard-budget.spec.ts` |
| Submitting | wizard | progress bar (two facts, no percentage) + clock + `sr-only` status | sent vs answered | `wizard-submit.spec.ts` |
| Rate limited (wizard) | wizard | `warning` alert with the seconds, action disabled | wait time is a fact, not a scolding | `states.spec.ts`, `wizard-submit.spec.ts` |
| Request too large | wizard | `error` alert | what to check before retrying | `wizard-submit.spec.ts` |
| A field the service refused | wizard | inline error under the control + focus moved | the field, not a page-level apology | `wizard-submit.spec.ts` |
| Unexpected server error | wizard | `error` alert + request reference | what happened, retry, how to report it | `wizard-submit.spec.ts` |
| Result unavailable | result | `error` alert + retry (a document reload) + way back | retry must re-run the render | `result.spec.ts` |
| Result rate limited | result | `error` alert with the API's own `Retry-After` seconds | the moment the API named, never an invented countdown | `result.spec.ts` |
| No build for the budget | result | `warning` alert (not a live region), floor advice **only when priced**, way back pre-filled | a result, not an error; UNKNOWN ≠ 0 | `zero-states.spec.ts`, `states.spec.ts` |
| Total past the budget | result card | `warning` alert inside the card, bar drawn as over | the number and the overage | `result.spec.ts` |
| Unknown URL or unknown result id | shell | a 404 PAGE with a heading and a CTA — not an alert | a page is not a state banner | `legal.spec.ts`, `result.spec.ts` |

**Deliberately not a banner.** Inline field errors (they belong to a control), the 404 (it is a
document), and the skeletons (decoration — the announcement is the single polite region, so a screen
reader hears "searching" once rather than each shape arriving).

**What S22 changed in copy.** `notFound.body` now names a fix ("vérifiez le lien, ou lancez une
nouvelle configuration") instead of only describing the miss; `errorTooLarge` now says what to check
before retrying, because retrying an unchanged oversized request cannot succeed; the clamp notice
moved into the alert primitive; the 429 panel passes `role="status"`, which it did not. Everything
else was reviewed against "active voice, what happened + the fix" and left alone.

## 3. Analytics: one module, three events

`apps/web/lib/analytics.ts` is the only file that mentions a provider. OD5 left the vendor open, so
the contract is provider-shaped rather than vendor-shaped: Plausible and Umami are both supported by
configuration, and nothing else in the app knows which one is on.

**The events map is the documentation and the runtime check.** A prop is a closed set of values, or
a bounded count; an event that is not in the map is dropped, and so is a value outside its set.

| Event | Props | Why it is safe |
|---|---|---|
| `wizard_step` | `step`: `usage` / `budget` / `resolution` / `priority` | says WHICH question was answered, never what was answered |
| `config_generated` | `builds`: 0..1000 | how many builds came back; a count is not a user answer |
| `share_used` | `channel`: `whatsapp` / `copy` / `native` | which way out was used, never the shared URL |

`wizard_step` fires when the flow moves forward past a step, and on the last step's submit: that
step is completed by the REQUEST, not by a navigation, so the map's final value (`priority` in the
full profile) is reachable. `config_generated` is the separate fact that a pass was produced, and it
follows the step event rather than replacing it.

Never sent, because no member of `AnalyticsEvent` has a field for it: the budget, the resolution, the
priority, the result id, the shared URL, anything typed.

**Two mechanisms carry "no query string reaches the provider":**

1. the injected tag always sets `data-exclude-search` and `data-exclude-hash`, which is the
   providers' documented switch for stripping the query and the fragment from a pageview;
2. `sanitizeEvent()` re-checks the payload at the boundary, by VALUE.

`e2e/analytics.spec.ts` asserts the attributes on the element the browser actually got, and drives a
stub that stands in for the vendor — it computes the pageview URL from those attributes exactly as
the vendors document, so the spec can see that the URL it would send has no query. **What that does
not prove:** the vendors' own code. No real Plausible or Umami account has been exercised from this
repository, so the vendor half of the claim rests on their documented behaviour plus the attribute
this app sets — the same split `ACCESSIBILITY_AUDIT.md` draws for axe versus a screen reader.

**Configuration is per request, not per build.** `GET /api/analytics/config` reads the server's
environment (`ANALYTICS_PROVIDER`, `ANALYTICS_DOMAIN` or `ANALYTICS_WEBSITE_ID`,
`ANALYTICS_SCRIPT_URL`), so switching measurement on or off is a restart rather than a rebuild —
every page here is prerendered, and a `NEXT_PUBLIC_*` value would have been frozen into the HTML.
Unset is OFF and answers `{ "provider": null }`: no third-party request is made at all. A malformed
value is a logged 500 rather than a silent no-op, and the browser treats any non-2xx as "no
analytics".

## 4. The measurement that changed the loader

S22's first scenario is "the analytics script never blocks rendering (LCP unchanged ±5 %,
measured)". The first implementation started the loader at the window's `load` event, which is the
usual advice, and the harness said no:

| Configuration | Result page LCP (3 runs, median) | Preset page LCP | Verdict |
|---|---|---|---|
| provider OFF | 2406 / 2408 / 2416 ms → **2408** | 2411 / 2412 / 2562 ms → **2412** | pass |
| provider ON, starting at `load` | 2591 / 2584 / 2585 ms → **2585** | 2737 / 2586 / 2587 ms → **2587** | **FAIL** — over the 2 500 ms budget, +7.3 % over OFF |

The cause was not a render-blocking tag: `load` fires while the page's web font is still arriving,
and the analytics request (with its cross-origin connection) slowed that transfer enough that the
text repainted later — and a later repaint is a later LCP. So `afterQuiet()` waits for
`document.fonts.ready`, then for an idle callback, and the same harness then measured:

| Configuration | Result page LCP | Preset page LCP | Verdict |
|---|---|---|---|
| provider OFF | 2325 / 2337 / 2406 ms → **2337** | 2323 / 2324 / 2411 ms → **2324** | pass |
| provider ON, after fonts + idle | 2329 / 2329 / 2341 ms → **2329** | 2327 / 2330 / 2332 ms → **2330** | pass — **−0.3 % / +0.3 %** |

CLS was 0 in every run. Both were measured on this machine on 2026-10-22 with
`ANALYTICS_PROVIDER=plausible ANALYTICS_DOMAIN=test.local
ANALYTICS_SCRIPT_URL=http://localhost:3211/analytics.js npm run test:lighthouse`, so no request left
the machine and the "vendor script" was the fixture mock's 404 body. That is a stand-in, not
Plausible: its transfer size is smaller than the real script's, and the point being measured is the
REQUEST's position on the timeline rather than its bytes — the before/after above is the evidence
that a request at `load` was enough to move LCP and a request after the fonts was not. Note also
that the quiet wait improved the OFF case by about 70 ms: the config fetch itself had been
competing with the font.

## 5. The legal pages

`/{fr,ar}/mentions-legales`, `/confidentialite` and `/contact` are indexable documents, listed in the
sitemap and reachable from the footer of every page — including the 404, which renders inside the
layout (`e2e/legal.spec.ts`).

They say what is true today, which includes what is not known yet: there is no company behind the
project, no host chosen and no sale made, and the pages say so instead of printing a plausible ICE
number nobody would ever replace. **Before any commercial launch** the identity block in
`legal.mentions.publisherBody` and the contact channel in `legal.contact.channelBody` must be
replaced with the real ones; `legal.updated` (rendered from `LEGAL_UPDATED_AT`) is the date to move
with them. The privacy page tracks `lib/analytics.ts`: if the events map or the config variables
change, that page is part of the same edit.
