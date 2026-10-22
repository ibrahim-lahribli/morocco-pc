/**
 * lib/analytics.ts — the ONE place this app talks to an analytics provider (S22).
 *
 * OD5 left the vendor open, so what is written here is the CONTRACT, not a
 * vendor integration: a small allowlist of events, a loader that runs after the
 * page has loaded, and a configuration read at REQUEST time so a deployment can
 * switch a provider on without rebuilding.
 *
 * ## Why the config is a request, not a build constant
 *
 * `NEXT_PUBLIC_*` is inlined while `next build` runs, and every page here is
 * prerendered, so a build-time analytics value is frozen into the HTML. That is
 * wrong twice: a deployment cannot turn analytics on (or off) without a rebuild,
 * and the test suite cannot exercise the loader at all — a green spec would then
 * only mean "no script was configured". So the browser asks
 * `GET /api/analytics/config` (a force-dynamic route that reads the server's
 * environment) AFTER the load event, and the script is part of that answer.
 * Unconfigured is the default and the honest one: `{ "provider": null }`, no
 * third-party request ever made.
 *
 * ## What "no PII" means in code, not in a policy
 *
 * The brief's rule is that no query parameter carrying user input reaches the
 * provider. Three mechanisms, each doing a different part:
 *
 *   - the pageview is the VENDOR's, and both providers strip the query string
 *     when they are told to — `data-exclude-search` / `data-exclude-hash`, which
 *     this module always sets. That attribute is the whole of our side of the
 *     claim; the injection below is where it is pinned, and `e2e/analytics.spec.ts`
 *     reads it off the element the browser actually got.
 *   - `AnalyticsEvent` is a discriminated union: an event cannot carry a
 *     budget, a resolution or a URL, because no member has a field for one. A
 *     call site that tries is a type error, not a review comment.
 *   - `sanitizeEvent()` re-checks at runtime, because a type is a compile-time
 *     promise and this is the boundary where data leaves the app. It checks
 *     VALUES, not shapes: every string prop is matched against the value set
 *     the map declares, so `step: "7000"` is not "a short string", it is not a
 *     step and it is dropped. Free text, an amount or a URL has no value set to
 *     belong to, which is what makes "no PII" a property of the code rather
 *     than of the review.
 *
 * ## Why it is lazy, and why it waits for quiet
 *
 * Analytics is the last thing a page needs, and Largest Contentful Paint is
 * measured before it. `afterQuiet()` waits for the load event, then for the
 * page's fonts, then for an idle callback — because "after `load`" turned out
 * not to be late enough: measured LCP rose 7 % when the loader started there
 * (see that function's comment for the numbers and the cause). Nothing here may
 * be on the critical path, and the Lighthouse budgets in CI (LCP and total
 * script bytes) are the gate that notices when it is; the on/off measurement is
 * recorded in `docs/design/STATES.md`.
 *
 * ## Events that happen before the script arrives
 *
 * A wizard step can be completed while the config request is still in flight, so
 * events are QUEUED (bounded) and flushed once the provider's global exists. An
 * unconfigured deployment simply never flushes them; the queue is capped so a
 * page with no analytics cannot grow one.
 */

export type AnalyticsProvider = "plausible" | "umami";

export interface AnalyticsConfig {
  provider: AnalyticsProvider;
  /** Plausible's `data-domain`, or Umami's `data-website-id`. */
  domain: string;
  /** The script to inject — the vendor's default, unless overridden. */
  scriptSrc: string;
}

/** Where the browser asks what is configured. One endpoint, both callers. */
export const ANALYTICS_ENDPOINT = "/api/analytics/config";

const DEFAULT_SCRIPT: Record<AnalyticsProvider, string> = {
  plausible: "https://plausible.io/js/script.js",
  umami: "https://cloud.umami.is/script.js",
};

/**
 * The events this app is allowed to send, with the props each may carry and the
 * values each prop may take. This object IS the documentation the sprint asks
 * for: one place to read what leaves the page, and the list the runtime checks
 * against (see `sanitizeEvent`).
 *
 * `"count"` is a bounded non-negative integer, nothing else. A prop declared as
 * a value set accepts only those values.
 *
 * Deliberately absent: the budget, the resolution, the priority, the result id
 * and the shared URL. `config_generated` carries how MANY builds came back (a
 * count is not a user answer); `wizard_step` says which question was answered
 * and never what was answered; `share_used` names a channel.
 */
export const ANALYTICS_EVENTS = {
  wizard_step: { step: ["usage", "budget", "resolution", "priority"] },
  config_generated: { builds: "count" },
  share_used: { channel: ["whatsapp", "copy", "native"] },
} as const;

/** One prop rule: a closed set of values, or a bounded count. */
type PropRule = readonly string[] | "count";

export type WizardStepName = "usage" | "budget" | "resolution" | "priority";
export type ShareChannel = "whatsapp" | "copy" | "native";

/** One sendable event. No member has a field for a value the user typed. */
export type AnalyticsEvent =
  | { name: "wizard_step"; props: { step: WizardStepName } }
  | { name: "config_generated"; props: { builds: number } }
  | { name: "share_used"; props: { channel: ShareChannel } };

export type AnalyticsEnv = Record<string, string | undefined>;

/**
 * The server's answer, from its environment. `null` is OFF — the default — and
 * an unset or blank `ANALYTICS_PROVIDER` means it.
 *
 * A MALFORMED configuration THROWS instead of silently disabling analytics: a
 * misspelt provider name that quietly sends nothing is the failure that goes
 * unnoticed for a release. The route turns the throw into a logged 500, which
 * is visible in server logs, and the loader treats a non-2xx as "no analytics".
 */
export function resolveAnalyticsConfig(env: AnalyticsEnv): AnalyticsConfig | null {
  const raw = (env.ANALYTICS_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "" || raw === "off") return null;
  if (raw !== "plausible" && raw !== "umami") {
    throw new Error(`ANALYTICS_PROVIDER must be "plausible", "umami" or "off", not ${JSON.stringify(raw)}`);
  }
  const provider: AnalyticsProvider = raw;

  const domainVar = provider === "plausible" ? "ANALYTICS_DOMAIN" : "ANALYTICS_WEBSITE_ID";
  const domain = (env[domainVar] ?? "").trim();
  if (domain === "") throw new Error(`${domainVar} is required when ANALYTICS_PROVIDER is "${provider}"`);

  const override = (env.ANALYTICS_SCRIPT_URL ?? "").trim();
  let scriptSrc = DEFAULT_SCRIPT[provider];
  if (override !== "") {
    // A self-hosted Plausible or Umami lives at an origin the deployment knows.
    // Anything that is not an absolute http(s) URL would be resolved against the
    // page and inject the wrong document as a script, so it is refused here.
    let parsed: URL;
    try {
      parsed = new URL(override);
    } catch {
      throw new Error(`ANALYTICS_SCRIPT_URL is not an absolute URL: ${JSON.stringify(override)}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`ANALYTICS_SCRIPT_URL must be http or https, not ${parsed.protocol}`);
    }
    scriptSrc = parsed.href;
  }

  return { provider, domain, scriptSrc };
}

/**
 * The runtime half of the payload rule (see the header). Returns the event as
 * sent, or null to drop it: an unknown event name, an unknown prop, a value
 * outside its declared set, a missing prop, or a count that is not a small
 * non-negative integer never leaves the page.
 *
 * Every branch returns null rather than a repaired event, because a repaired
 * event would be a fact nobody asserted.
 */
export function sanitizeEvent(event: AnalyticsEvent): AnalyticsEvent | null {
  // A type is a compile-time promise, and this is the runtime boundary: a call
  // written loosely enough to omit `props` must be DROPPED, not throw. The
  // caller is a click handler or a submit, where a throw is the page's problem.
  if (
    event === null ||
    typeof event !== "object" ||
    event.props === null ||
    typeof event.props !== "object"
  ) {
    return null;
  }

  const schema = ANALYTICS_EVENTS[event.name] as Record<string, PropRule> | undefined;
  if (schema === undefined) return null;

  const given: Record<string, unknown> = event.props;
  const props: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(given)) {
    const rule = schema[key];
    if (rule === undefined) return null;
    if (rule === "count") {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1000) {
        return null;
      }
      props[key] = value;
      continue;
    }
    if (typeof value !== "string" || !(rule as readonly string[]).includes(value)) return null;
    props[key] = value;
  }

  // Every declared prop must be present: an event sent half-shaped would be a
  // name with a meaning the receiver has to guess.
  for (const key of Object.keys(schema)) {
    if (!(key in props)) return null;
  }

  return { name: event.name, props } as AnalyticsEvent;
}

declare global {
  interface Window {
    /** Plausible's script defines this. */
    plausible?: (name: string, options?: { props?: Record<string, string | number> }) => void;
    /** Umami's script defines this. */
    umami?: { track: (name: string, data?: Record<string, string | number>) => void };
  }
}

/** The provider that actually loaded; null until its script's `load` fires. */
let loaded: AnalyticsProvider | null = null;
let started = false;
const queue: AnalyticsEvent[] = [];
const MAX_QUEUE = 20;

/**
 * Run `run` after the window's `load` event. `document.readyState === "complete"`
 * covers the case this module is mounted late (a client navigation to a page
 * that was already loaded), where the event has been and gone.
 */
function afterLoad(run: () => void): void {
  if (document.readyState === "complete") {
    run();
    return;
  }
  window.addEventListener("load", run, { once: true });
}

/**
 * Wait until the page is genuinely QUIET, not merely loaded.
 *
 * The first version of this module started at `load`, and S22's own measurement
 * caught it: LCP on the preset and result pages moved 2 408 ms -> 2 585 ms (+7 %)
 * with a provider enabled, over the sprint's 5 % tolerance and over the 2 500 ms
 * budget. The cause was not a render-blocking tag — it was bandwidth. `load` fires
 * while the page's web font is still arriving, and a script request (plus its
 * cross-origin connection) opened at that moment slows the font down; the text
 * then repaints later, and a later repaint IS a later Largest Contentful Paint.
 *
 * So the loader waits for the two things that stand between it and that repaint:
 *
 *   1. `document.fonts.ready`, which resolves when the fonts this document asked
 *      for have finished — the very transfer the measurement caught competing;
 *   2. an idle callback (with a timeout, because a busy page must not defer
 *      analytics forever).
 *
 * Both numbers are in `docs/design/STATES.md`, measured with the harness that
 * enforces the budget rather than a stopwatch.
 */
function afterQuiet(run: () => void): void {
  const idle = (callback: () => void): void => {
    const schedule = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => void;
      }
    ).requestIdleCallback;
    if (schedule === undefined) {
      window.setTimeout(callback, 200);
      return;
    }
    schedule(callback, { timeout: 3000 });
  };

  afterLoad(() => {
    const fonts = document.fonts;
    if (fonts === undefined || typeof fonts.ready?.then !== "function") {
      idle(run);
      return;
    }
    // `fonts.ready` does not reject; both handlers run the same thing so a
    // browser that resolves it oddly still gets analytics.
    void fonts.ready.then(() => idle(run), () => idle(run));
  });
}

function send(event: AnalyticsEvent): void {
  const { name, props } = event;
  // This runs inside click, submit and navigation handlers, and the provider is
  // third-party code: a global that throws would otherwise cancel the action
  // that produced the event. An event is disposable; the action is not. Nothing
  // is logged — noise on every event would be its own defect — and nothing is
  // retried, because a provider that throws will throw again.
  try {
    if (loaded === "plausible") {
      window.plausible?.(name, { props });
      return;
    }
    if (loaded === "umami") {
      window.umami?.track(name, props);
    }
  } catch {
    // The event is lost deliberately; the caller's navigation or request is not.
  }
}

function flush(): void {
  while (queue.length > 0) {
    const event = queue.shift();
    if (event === undefined) return;
    send(event);
  }
}

/**
 * The injected element. Exported (not hidden inside `bootstrapAnalytics`) so the
 * one place that decides WHICH attributes a vendor sees is a named function with
 * its own comments — and so a test can inject the same tag against a stub
 * script, which is the only way to observe a third-party script's own requests
 * without a network call to the vendor.
 *
 * `data-exclude-search` / `data-exclude-hash` are the reason a budget in the
 * address bar does not become a pageview path: both providers honour these
 * attributes, and neither is left to a default.
 */
export function buildAnalyticsScript(
  config: AnalyticsConfig,
  onLoad: () => void,
): HTMLScriptElement {
  const script = document.createElement("script");
  script.async = true;
  script.defer = true;
  script.src = config.scriptSrc;
  script.dataset.analytics = config.provider;
  if (config.provider === "plausible") {
    script.dataset.domain = config.domain;
  } else {
    script.dataset.websiteId = config.domain;
  }
  script.dataset.excludeSearch = "true";
  script.dataset.excludeHash = "true";
  script.addEventListener("load", onLoad, { once: true });
  return script;
}

function isConfig(value: unknown): value is AnalyticsConfig {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.provider === "plausible" || candidate.provider === "umami") &&
    typeof candidate.domain === "string" &&
    candidate.domain !== "" &&
    typeof candidate.scriptSrc === "string" &&
    candidate.scriptSrc !== ""
  );
}

async function start(): Promise<void> {
  let config: AnalyticsConfig | null = null;
  try {
    const response = await fetch(ANALYTICS_ENDPOINT, {
      // No cookies: the request may not carry a session because there is none to
      // give, and `omit` keeps that true if one ever exists.
      credentials: "omit",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    const body: unknown = await response.json();
    config = isConfig(body) ? body : null;
  } catch {
    // An analytics config that cannot be fetched is not the page's problem:
    // nothing is retried, nothing is announced, and no script is injected.
    return;
  }
  if (config === null) return;

  const script = buildAnalyticsScript(config, () => {
    loaded = config.provider;
    flush();
  });
  document.head.append(script);
}

/**
 * Called once, from the client island the layout mounts. Idempotent, and a no-op
 * on the server — the loader must never run during a prerender, where there is
 * no `window` and no vendor to talk to.
 */
export function bootstrapAnalytics(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  afterQuiet(() => {
    void start();
  });
}

/**
 * Record one allowlisted event. Safe to call anywhere in a client component: it
 * does nothing on the server, and nothing leaves the page until a provider has
 * actually loaded (see the header's queue note).
 */
export function trackEvent(event: AnalyticsEvent): void {
  if (typeof window === "undefined") return;
  const clean = sanitizeEvent(event);
  if (clean === null) return;
  if (loaded === null) {
    if (queue.length < MAX_QUEUE) queue.push(clean);
    return;
  }
  send(clean);
}
