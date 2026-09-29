# Recipe: add a migration

Schema change = **new sequential file**, never edit a committed one (`AGENTS.md` §8).

1. `git status` first — shared checkout.
2. Create `database/migrations/NNN_short_description.sql` (next free number; CRLF line endings).
3. Write SQL. Remember: `002_enums.sql` uses bare `CREATE TYPE`, so **never re-run the full
   runner on the live DB** — apply your file individually via a throwaway script.
4. Never add a migration *just* to make a test pass. Keep enums in sync; never drop or
   destructively alter one.
5. Update `docs/SCHEMA_REFERENCE.md` with `npm run gen:schema` (needs `DATABASE_URL`).
6. If the change touches Layer 4, re-check `database/LAYER4_RECONCILIATION_PLAN.md`'s ledger.

Verify:

```bash
node --check scripts/gen-schema-reference.js   # n/a — but run:
npm run gen:schema                              # regenerates both generated docs
npm run verify:docs                             # migrations-contiguous must stay PASS
npm run test:unit                               # 0 failures
```
