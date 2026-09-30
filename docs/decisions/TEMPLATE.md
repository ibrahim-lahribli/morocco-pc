# Decision Entry Template (audit A10)

Skeleton for a new entry in `docs/RECOMMENDATION_ENGINE_DECISIONS.md`. The
decision log is the repository's behavioural contract and its entries are
machine-parsed (`npm run gen:decisions`, `scripts/verify-docs.js` check 2), so
two things are **hard requirements**, not style:

1. The `Status:` line is the **first content line** of the entry — the
   generator hard-fails without it, and `grep -n "^Status:"` must keep
   enumerating every decision.
2. Entries are appended in sequence; the next number is the highest existing
   global number + 1 (see `docs/DECISION_INDEX.md`). Decisions 4–5 are nested
   under "Engine 3 contract decisions" and double as global 4/5 — do not reuse
   their numbers.

Copy everything below the rule into the log and delete what does not apply.
CRLF line endings (the file is CRLF; a stray-LF paste reads as a whole-file diff).

---

```markdown
## Decision N — <one-line verdict, not a topic label>

Status: <RESOLVED | DEFERRED | PROVISIONAL> <YYYY-MM-DD>[; <secondary fact, e.g.
IMPLEMENTED <date> or O1 applied <date>] — <what was adopted, in one sentence;
qualifiers like "binding for Engine 1" or "unenforced" belong here>.

Date: <YYYY-MM-DD>. <Scope paragraph: what prompted this, what it closes or
amends (audit finding, earlier decision, review weakness), and what it is NOT
("documentation only", "no migration", "no seed").>

### Current situation

<The facts as the code/schema/DB have them today, with file:line or
table.column evidence. State what exists, not what is wrong with it.>

### Problem

<What breaks, blocks, or drifts if nothing is decided. One or two paragraphs;
name the objective or contract that is violated.>

### Decision

<The numbered contract: each item a single testable statement. Prefer items
that can be pinned by a test or a verify-docs check — that is what makes the
decision enforceable rather than decorative. State where each item lives
(module, table, doc section).>

### Rejected alternatives

<Each alternative with the concrete reason it lost — evidence, not taste.
"Too complex" is not a reason; "requires a materialization lifecycle that does
not exist and is premature until X lands" is.>

### Verdict for this pass

<What measurably changed: tests added, gates run, before/after figures.
PASS / FAIL / BLOCKED per item; say explicitly when an environment limitation
prevented a run. Never claim a result that was not run.>

### Supersedes / superseded by   (include only when applicable)

<Name the exact wording or decision replaced, and — critically — whether the
superseded doc was edited in place or the supersession is recorded only here.
If the superseded doc was NOT edited, say so in one line: an unmarked
supersession is how this repo lost its way before (Decision 18 item 7,
audit D4).>
```

## Placement notes

- **Where the entry goes:** appended at the end of
  `docs/RECOMMENDATION_ENGINE_DECISIONS.md`, above the final-status footer if
  one exists. Engine-3-local contracts (numbered separately) are the exception —
  they live inside the "Engine 3 contract decisions" section and must not
  collide with global numbers.
- **Amending an existing decision:** do not rewrite history — append a
  `### UPDATE <date> — <what>` block inside the old entry (Decision 22's
  implementation record is the precedent) and update its `Status:` line in
  place.
- **After writing the entry, in the same session:**
  1. `npm run gen:decisions` (regenerates `docs/DECISION_INDEX.md`; `--check`
     fails in CI if forgotten)
  2. Update `CONTEXT.md`'s decision-pointers line and any status section the
     decision changes (`AGENTS.md` §8: stale status causes re-implementation)
  3. If the decision closes an audit finding or gap-register row, banner it
     there too (`docs/OPEN_GAPS.md`, the audit doc)
  4. `npm run verify:docs` — `decisions-parse` and `agents-decision-range`
     must stay green (the range check fails until `AGENTS.md` cites the new
     highest decision number)
  5. `npm run test:unit` — 0 failures

## Status vocabulary

| Value | Meaning |
|---|---|
| `RESOLVED <date>` | Adopted and binding. Add `; IMPLEMENTED <date>` once code lands, if not immediate. |
| `DEFERRED <date>` | Explicitly not built now, with a binding re-check trigger (Decision 26 item B is the precedent). Never leave a HARD rule deferred without the trigger. |
| `PROVISIONAL <date>` | Adopted for now, expected to be revisited (Decision 19's interim state). Must name what would re-open it. |
