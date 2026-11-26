# docs/RECIPES — deployment, release and documentation governance

This directory holds the recipes that cross project boundaries. Layer-specific procedures live with
their owner:

| Recipe | Purpose |
|---|---|
| [`deploy-eu-colocation.md`](deploy-eu-colocation.md) | co-locate in the EU: Neon Frankfurt plus a deployed API (P1 Sprint 1 Steps 4–9) |
| [`deploy-free-host.md`](deploy-free-host.md) | deploy the API to a free host (options checked 2026-10-28) |
| [`first-eu-launch.md`](first-eu-launch.md) | the owner checklist for the first EU launch, in runnable order |
| [`release-in-two-stages.md`](release-in-two-stages.md) | release the code first, then the scoring model |
| [`add-an-agent-visible-status-claim.md`](add-an-agent-visible-status-claim.md) | how to add or change a status claim an agent reads |

Elsewhere:

| Area | Recipes |
|---|---|
| Engine | [`../engine/recipes/`](../engine/recipes/) |
| Database (migrations, seeds, role) | [`../database/recipes/`](../database/recipes/) |
| Offer ingestion | [`../ingestion/recipes/`](../ingestion/recipes/) |

Deployment recipes describe operator actions. They do not authorize a deployment, a database write or
a credential use: those need the owner's explicit go-ahead and, for a real database write, a recorded
restore point.
