# SCREENS.md — every Stitch screen, mapped

Source: `apps/web/design/stitch/` — 22 screen directories (`code.html` + `screen.png`) plus
`DESIGN.md`. The exports are reference material: no code path imports them, `code.html` markup is
not copied (the kit and tokens own the implementation), and `DESIGN.md` is the token source for
Phase 1.

"Kind" separates a **route** (a URL someone can navigate to) from a **state** (a rendering of a route
that already exists). Phase 4 is ordered by route; a state is a task inside its route's task.

| Screen directory | v1 route | Kind | Note |
|---|---|---|---|
| `accueil_morocco_pc` | `/{locale}` | route | home: hero, presets, trust strip, guides |
| `morocco_pc_1` | `/{locale}` | state | home variant — merge into the one home task |
| `morocco_pc_2` | `/{locale}` | state | home variant — merge into the one home task |
| `configurateur_morocco_pc` | `/{locale}/configurer` | route | wizard shell |
| `configurateur_1` | `/{locale}/configurer?step=…` | state | budget step variant |
| `configurateur_2` | `/{locale}/configurer?step=…` | state | budget step variant |
| `configurateur_tape_1_usage` | `/{locale}/configurer?step=…` | state | usage step |
| `configurateur_tape_3_cran` | `/{locale}/configurer?step=…` | state | resolution step |
| `configurateur_tape_4_priorit` | `/{locale}/configurer?step=…` | state | priority step |
| `configurateur_transition_chargement` | `/{locale}/configurer` | state | submit / loading |
| `vos_configurations` | `/{locale}/config/{id}` | route | results list |
| `d_tail_configuration_quilibr` | `/{locale}/config/{id}/{rank}` | route | **new** (D4): build detail |
| `remplacer_la_carte_graphique_quilibr` | `/{locale}/config/{id}/{rank}` | state | swap sheet inside the detail route |
| `mes_enregistrements_morocco_pc` | `/{locale}/enregistrements` | route | saved builds |
| `mes_enregistrements_tat_vide` | `/{locale}/enregistrements` | state | saved builds, empty |
| `composants_pc_morocco_pc` | `/{locale}/composants` | route | catalogue root |
| `cartes_graphiques_morocco_pc` | `/{locale}/composants?…` | state | category filter |
| `filtre_marque_cartes_graphiques` | `/{locale}/composants` | state | brand filter sheet |
| `nvidia_geforce_rtx_4060_d_tail_composant` | `/{locale}/composants/{slug}` | route | component detail |
| `comparer_morocco_pc` | `/{locale}/composants/comparer` | route | compare view |
| `guides_morocco_pc` | `/{locale}/guides` | route | guides index |
| `quel_budget_pour_un_pc_gamer_guide_morocco_pc` | `/{locale}/guides/{slug}` | route | one guide (MDX body) |

Two notes on the set itself:

- **`configurateur_tape_2` was never drawn.** The wizard's second step has no Stitch reference; it
  inherits the kit from steps 1/3/4 and is recorded as a deviation at G2, not filled in by guesswork.
- **The detail screen exists in Stitch** (`d_tail_configuration_quilibr`), which is what justifies
  decision D4's new route rather than folding build detail into the results page.

## Routes Stitch did NOT draw

These inherit the new kit and tokens with no pixel reference, so they are judged against the kit's
own proof sheets (`/kit`, `/tokens`) instead:

- `/{locale}/{presetSlug}` — preset landing page
- `/{locale}/format` — formatting proof sheet (French-only, `noindex`)
- `/{locale}/kit` — kit proof sheet (French-only, `noindex`)
- `/{locale}/tokens` — token proof sheet (French-only, `noindex`)
- `/{locale}/contact`
- `/{locale}/confidentialite`
- `/{locale}/mentions-legales`
- the 404 surface (`app/[locale]/not-found.tsx`) and the locale catch-all

## Routes that must never be indexed

`/{locale}/config/{id}` and `/{locale}/config/{id}/{rank}` are permanently `noindex`; the detail route
inherits that and must not appear in `sitemap.ts`. The proof sheets above are `noindex` by design.
