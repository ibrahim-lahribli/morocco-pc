# Requests — Engine → Platform agent / integrator

One file for cross-agent requests. **The Engine agent does NOT edit `apps/api/` or
`database/migrations/`**; anything below that lives in those areas is a request for the owner, not a
change Engine has made. Add new requests at the top of the list, dated, with an explicit acceptance.

Owner key: **Platform** owns `apps/api/` and schema migrations. **Integrator** owns the seed-number
series and cross-cutting coordination.

---

## 2026-10-08 — Wire `listUseCases` into `apps/api/src/meta.js` (Decision 37 / OG-38)

**Owner:** Platform. **Requested by:** Engine (E1b).

Today `apps/api/src/meta.js` derives the accepted use-case vocabulary from
`configuration.gpu_required_use_cases` — the SAME list that makes the GPU mandatory — so OFFICE is
rejected 422 and only GAMING / WORKSTATION are reachable (OG-38). Decision 37 decouples vocabulary
from the GPU mandate: the scoring barrel now exports

```js
const { listUseCases } = require('<scoring barrel>'); // src/recommendation/scoring/index.js
listUseCases(configuration); // -> frozen string[] of the model's use cases
```

`listUseCases(configuration)` returns the `use_case_profiles` keys when the model declares them, and
falls back to `gpu_required_use_cases` for a legacy model that declares none (the retained
`seed-minimal-v1`). So this is a one-line SOURCE swap with identical behaviour until seed 013 is active.

**Acceptance**
- `meta.js`'s accepted-use-case vocabulary comes from `listUseCases(activeModel.configuration)`, not
  from `gpu_required_use_cases`.
- With a profiles-declaring model active (`launch-v2`, seed 013), the meta vocabulary is
  `{GAMING, OFFICE, WORKSTATION}` and a valid-but-previously-rejected OFFICE request no longer 422s at
  the vocabulary gate. (Its downstream behaviour is still E6 — the request is about the vocabulary, not
  about OFFICE producing iGPU builds yet.)
- With `seed-minimal-v1` active (no profiles), the vocabulary is unchanged
  `{GAMING, WORKSTATION}` — the fallback preserves today's behaviour byte-for-byte.
- A unit/DB test pins both cases.

**Note:** the decoupling is only OBSERVABLE end-to-end once seed 013 is active on the database the API
serves; see `docs/OG-39_ACTIVATION_PLAN.md`. Engine does not edit `apps/api/`; this request is the
interface.

## 2026-10-08 — Seed number 013 is taken by Engine; reserve 014+ for Platform

**Owner:** Integrator. **Requested by:** Engine (E1b).

Engine has authored **`database/seeds/013_scoring_model_launch_v2.sql`** (Decision 37). Seed number
**013 is therefore taken**, and Platform should not use it.

Please reserve **seed numbers 014 and up** for Platform's seeds going forward (Engine's next seed, if
any, will claim the next free number explicitly). The migration series is separate — `014` is already
used by `database/migrations/014_build_rejection.sql` — so this reservation is about the SEED series
(`database/seeds/`) only, not migrations.
