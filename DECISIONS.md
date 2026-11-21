# Decisions

Extraction-programme decisions. The step 5 W1 rows were requested in the (unmerged) W1 RFC
decision request; this file records the answers, it does not implement them.

| ID | decision | reversible? |
|---|---|---|
| E1 | Direction is enforced, specifier form is not: core is depended on one-way (no outward edges), and `.dependency-cruiser.js` polices direction — a deep path is not itself a violation. | reversible |
| E2 | Module-alias scanner limitation accepted. | reversible |
| E3 | R-SHADOW-1 covers globals only; injected `db`/`client`/`pool` parameters are allowed. | reversible |
| A1–A5 | Report "files moved"; the manifest records moves; `offers/index.js` is in the moved set. | baseline SHA in a committed batch = irreversible |
| B1 | W1 = loaders only (W2 persistence, W3 orchestrator later). | reversible |
| C1 | `offers` → `packages/recommendation-runtime/src/offers/`. | reversible |
| C2–C4, D1–D5 | Deferred to the wave that needs them. | n/a |
