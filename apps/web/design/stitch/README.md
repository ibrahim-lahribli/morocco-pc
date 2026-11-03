# Stitch design source (reference only)

The Mobile-first Stitch exports for the redesign: 22 screen directories, each with `code.html` and
`screen.png`, plus `DESIGN.md` (the token source for Phase 1) and the handoff `.docx`.

**No code path imports anything here.** `next build` does not read this directory, and it is outside
the scope of `check:tokens` (which scans `app/`, `components/`, `lib/`).

Rules for using it:

- `code.html` is a VISUAL reference. Do not copy its markup, its inline styles or its hex values —
  the kit in `components/ui/` and the tokens in `app/globals.css` own the implementation.
- `screen.png` is the fidelity target, at ~390 px. The 360 px base viewport is the one that ships.
- `DESIGN.md` is the authoritative token list (colour roles, type scale, radii, spacing, elevation).
- The route and state each screen maps to is `docs/web-v2/SCREENS.md`, not a filename guess.
