# Recipe: add a seed

Seeds are DML-only and **idempotent** (`COALESCE`-based updates; re-running is safe).

1. `git status` first. Decide the filename: next `NNN_name.sql` in `database/seeds/`.
2. Write the seed (CRLF). Rules from precedent (seeds 002/003):
   - cite source URLs in header comments (provenance currently lives in comments — U12);
   - never invent data: real research only, NULL with a stated reason when unknown (D4/D5 style);
   - `COALESCE` existing values; `INSERT ... ON CONFLICT DO UPDATE` where a key exists;
   - note forward-looking data explicitly ("seeded but NOT consumed by any engine code").
3. **Trigger check:** if the seed touches cooler/RAM/case/motherboard rows, Decision 26's
   binding trigger applies — re-run the four deferred-rule violation queries (OG-09…12)
   BEFORE merging, and likely implement the rules first.
4. Dry-run first: `node scripts/run-seeds.js --dry-run` (note: statement counting uses a
   naive `split(';')` — a semicolon in a comment inflates the count; harmless).
5. Apply against the shared DB only after the dry-run reads right; seeds must never be
   destructive.

Verify:

```bash
node scripts/run-seeds.js --dry-run
npm run seed            # apply; re-run to prove idempotency
npm run gen:schema      # DATA_STATE.md now reflects the new rows
npm run test:unit
```
