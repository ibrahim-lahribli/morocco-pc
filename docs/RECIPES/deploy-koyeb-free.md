# Recipe: deploy the API to Koyeb's free instance

An alternative host to Fly for `apps/api`, for a zero-cost trial. Read section 2 first:
the free instance is not suitable for production or for latency measurement.

Read `deploy-eu-colocation.md` §1 before setting any database variable. The pool-target
rule there applies unchanged: on this host `DATABASE_URL` is the real target, so set
`API_ALLOW_SHARED=1` and do not set `TEST_DATABASE_URL`.

---

## 1. What the repository already provides

| Need | Where it is | Koyeb setting |
|---|---|---|
| Image build from the repo root | `apps/api/Dockerfile` (context = repository root) | Builder: Dockerfile, path `apps/api/Dockerfile`, root `/` |
| Port | `EXPOSE 3000`; the server reads `PORT` (default 3000) | Port `3000`, HTTP |
| Bind address | `HOST=0.0.0.0` | Set as an env var |
| Health check | `GET /v1/health` (`apps/api/src/routes/health.js`) | HTTP health check, path `/v1/health`, port `3000` |

No application code changes are needed for Koyeb.

## 2. Free-instance limits (verify on the Koyeb pricing page at checkout)

- The free instance is documented by Koyeb as not for production use.
- It scales to zero after about one hour idle. The first request after that waits for a cold start, so **every latency number taken on it is invalid**. `measure-api-pass-phases.js` and `measure-db-roundtrip.js` results must not be recorded from it.
- Free instances are limited to a subset of regions. Check that Frankfurt is offered; if it is, choose it to sit beside the Neon Frankfurt branch.
- Free instances have smaller CPU and memory allowances than the `shared-cpu-1x` 256 MB class in `fly.toml`. Check the current figures on the pricing page.

Because of the scale-to-zero behaviour, the `fly.toml` settings `auto_stop_machines = false` and `min_machines_running = 1` (documented as "always-on") have no free-tier equivalent. Do not treat a Koyeb free deployment as meeting that requirement.

## 3. Deploy

1. Create a Koyeb service from the GitHub repository (`master`) or from the Koyeb CLI.
2. Builder: **Dockerfile**. Dockerfile path: `apps/api/Dockerfile`. Build context: repository root.
3. Instance: **Free**. Region: **Frankfurt** (`fra`).
4. Port: `3000`, protocol HTTP.
5. Health check: HTTP, path `/v1/health`, port `3000`.
6. Environment variables (secrets as Koyeb secrets, not plain values):

   | Name | Value | Secret? |
   |---|---|---|
   | `DATABASE_URL` | the Neon Frankfurt connection string | yes |
   | `API_ALLOW_SHARED` | `1` | no |
   | `PORT` | `3000` | no |
   | `HOST` | `0.0.0.0` | no |
   | `LOG_LEVEL` | `info` | no |
   | `LOG_PRETTY` | `0` | no |

   Do not set `TEST_DATABASE_URL` on this host.
7. Deploy, then check the service's public URL (shown in the Koyeb dashboard, form `https://<service>-<org>.koyeb.app`).

## 4. Verify the deployed origin

Run the origin preflight. The Koyeb mode needs the explicit URL because Koyeb assigns the hostname:

```
node scripts/check-origin-readiness.js --platform=koyeb --origin=https://<your-koyeb-url>
```

Expected: `PREFLIGHT OK - origin: <url>` and exit 0. This checks `GET /v1/health?probe=preflight` answers 2xx with `status: "ok"` and `db: "ok"`. It does not check an IP allocation (Koyeb has none to assert), and it does not pin `TRUST_PROXY`. Rate limiting by client IP behind Koyeb's proxy is therefore **not** verified by this recipe; that pin is a Fly-specific step in `deploy-eu-colocation.md` §8.4.

Also confirm `GET /v1/docs/json` returns the OpenAPI document (`apps/api/src/routes/docs.js`).

## 5. Not covered

- `TRUST_PROXY` for Koyeb's proxy chain is not pinned. Confirm the header behaviour on the live origin before relying on per-IP limits.
- `check-deployed-role.js` and the role/smoke scripts read `pg_stat_activity` and are not run as part of this recipe.
- The latency measurement chain (`measure-db-roundtrip.js`, `measure-api-pass-phases.js`) belongs on a paid, always-on host, not on the free instance.
