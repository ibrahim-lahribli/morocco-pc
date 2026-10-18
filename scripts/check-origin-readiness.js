'use strict';

/**
 * scripts/check-origin-readiness.js - self-verifying preflight for the
 * deployed origin (P2 Sprint 2 Step 4; docs/RECIPES/deploy-eu-colocation.md
 * §8.4).
 *
 *   node scripts/check-origin-readiness.js --app=morocco-pc-api
 *   node scripts/check-origin-readiness.js --app=<name> --origin=https://host
 *
 * The runbook pins TRUST_PROXY from evidence read off a live origin, so this
 * script asserts the two facts every later step assumes, BEFORE anything is
 * pinned:
 *
 *   1. `fly ips list` succeeds AND yields at least one address. Those addresses
 *      are the second half of the pin (Fly's rightmost X-Forwarded-For entry is
 *      an address assigned to the app), so an addressless app has nothing to
 *      pin and `*.fly.dev` cannot answer.
 *   2. `GET <origin>/v1/health?probe=preflight` answers 2xx with `status: "ok"`
 *      and `db: "ok"`. A 200 with `db: "down"` proves the process, not the
 *      deploy, and per-IP bucket counts taken against it would be worthless.
 *
 * READ-ONLY: one `fly ips list` and one GET. Nothing is deployed, written or
 * changed, and no credential is read or printed.
 *
 * Exit codes:
 *   0  both facts held; `PREFLIGHT OK - addresses:` and the address set print
 *   1  an assertion failed - fly itself failed, no address, no 2xx answer, a
 *      non-JSON body, or status/db not "ok"
 *   2  usage error (unknown flag, blank `--app`, non-http(s) `--origin`)
 *
 * The parsing and verdict live in scripts/lib/origin-readiness.js. This file is
 * the I/O half, and `main(argv, deps)` takes injectable `runFly`,
 * `fetchHealth`, `log` and `logError` so the exit codes and messages are pinned
 * with no network and no flyctl (scripts/lib/origin-readiness-cli.test.js).
 */

const { spawnSync } = require('node:child_process');

const { parseFlyIps, checkHealth, healthUrl } = require('./lib/origin-readiness');

const USAGE = 'usage: node scripts/check-origin-readiness.js [--app=<name>] [--origin=<url>] [--help]';
const DEFAULT_APP = 'morocco-pc-api';
const HEALTH_TIMEOUT_MS = 10000;
const FLY_TIMEOUT_MS = 30000;

/**
 * Parse argv. `--app` and `--origin` take the `=<value>` form only, matching
 * the repo's rule for flags whose value is easy to mis-pair with the next token
 * (checks-target-parity.js states the same rule).
 *
 * @param {string[]} argv
 * @returns {{help: boolean, app: string, origin: string|null}}
 */
function parseArgs(argv) {
  const parsed = { help: false, app: DEFAULT_APP, origin: null };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith('--app=')) {
      parsed.app = arg.slice('--app='.length).trim();
      continue;
    }
    if (arg.startsWith('--origin=')) {
      parsed.origin = arg.slice('--origin='.length).trim();
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }
  return parsed;
}

/**
 * An absolute http(s) origin, without a trailing slash. Anything else is a
 * usage error: a typo here would send the health probe somewhere unrelated, and
 * "it answered" is the claim this script exists to make.
 */
function normalizeOrigin(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    throw new Error('--origin must be an absolute http(s) URL, e.g. https://morocco-pc-api.fly.dev');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--origin must be an absolute http(s) URL, e.g. https://morocco-pc-api.fly.dev');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('--origin must not embed credentials');
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new Error('--origin must not carry a query string or fragment');
  }
  return raw.replace(/\/+$/, '');
}

/** `fly ips list` for one app. A spawn failure is reported, never thrown. */
function defaultRunFly(app) {
  const result = spawnSync('fly', ['ips', 'list', '--app', app], {
    encoding: 'utf8',
    timeout: FLY_TIMEOUT_MS,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
  };
}

/** One GET, bounded so an unresponsive origin cannot hang the deploy shell. */
async function defaultFetchHealth(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
  return { status: response.status, bodyText: await response.text() };
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}

async function main(argv, deps) {
  const options = deps || {};
  const runFly = options.runFly || defaultRunFly;
  const fetchHealth = options.fetchHealth || defaultFetchHealth;
  const log = options.log || ((line) => console.log(line));
  const logError = options.logError || ((line) => console.error(line));

  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    logError('ERROR: ' + error.message);
    logError(USAGE);
    return 2;
  }
  if (args.help) {
    log(USAGE);
    log('Read-only deployed-origin preflight: asserts `fly ips list` returns an address and');
    log('GET /v1/health answers 2xx with status "ok" and db "ok". Exit 0 pass, 1 fail, 2 usage.');
    return 0;
  }
  if (args.app === '') {
    logError('ERROR: --app must not be blank');
    logError(USAGE);
    return 2;
  }

  let origin;
  try {
    // The runbook's origin is the app's own host; a custom domain is passed
    // explicitly rather than guessed.
    origin = normalizeOrigin(args.origin === null ? 'https://' + args.app + '.fly.dev' : args.origin);
  } catch (error) {
    logError('ERROR: ' + error.message);
    logError(USAGE);
    return 2;
  }

  // Print the table first: on a failure it is the operator's evidence for what
  // fly actually said, not what this script thinks it said.
  let fly;
  try {
    fly = runFly(args.app);
  } catch (error) {
    fly = { status: null, stdout: '', stderr: '', error };
  }
  for (const line of String(fly.stdout || '').split(/\r?\n/)) {
    if (line.trim() !== '') {
      log(line);
    }
  }
  if (fly.error || fly.status !== 0) {
    logError("FAIL preflight: 'fly ips list' itself failed (auth, app name or network) - fix that first.");
    const detail = String(fly.stderr || '').trim();
    if (detail !== '') {
      logError(detail);
    }
    if (fly.error) {
      logError(messageOf(fly.error));
    }
    return 1;
  }

  const addresses = parseFlyIps(String(fly.stdout || ''));
  if (addresses.length === 0) {
    logError('FAIL preflight: fly ips list printed no address.');
    logError('Allocate one first: fly ips allocate-v6 --app ' + args.app);
    logError('(plus fly ips allocate-v4 --shared --app ' + args.app + ' for IPv4-only clients).');
    logError('Stop here: do not pin TRUST_PROXY against an app with no address.');
    return 1;
  }

  const url = healthUrl(origin);
  let response;
  try {
    response = await fetchHealth(url);
  } catch (error) {
    logError('FAIL preflight: GET ' + url + ' did not answer 2xx (' + messageOf(error) + ').');
    return 1;
  }

  const verdict = checkHealth(response && response.status, response && response.bodyText);
  if (!verdict.ok) {
    if (verdict.code === 'HTTP_STATUS') {
      logError('FAIL preflight: GET ' + url + ' did not answer 2xx (' + verdict.detail + ').');
      return 1;
    }
    if (verdict.code === 'NOT_OK') {
      logError('FAIL preflight: ' + verdict.detail + ' - fix the deploy, then re-run this check');
      return 1;
    }
    logError('FAIL preflight: ' + verdict.detail);
    return 1;
  }

  log('PREFLIGHT OK - addresses:');
  for (const address of addresses) {
    log(address);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error('ERROR: ' + messageOf(error));
      process.exitCode = 1;
    }
  );
}

module.exports = {
  parseArgs,
  normalizeOrigin,
  defaultRunFly,
  defaultFetchHealth,
  main,
  USAGE,
  DEFAULT_APP,
  HEALTH_TIMEOUT_MS,
};
