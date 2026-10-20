# UML Studio — Coding-agent ground rules

The canonical product specification is `UML_STUDIO_CAHIER_DES_CHARGES.md`. Read it before any architectural decision and record truthful feature status in `docs/DIAGRAM_CAPABILITIES.md`.

## Architectural invariants

- Model semantics and diagram views are separate, with stable, globally unique model/view IDs.
- Project document is versioned and Zod validated; imported files are untrusted.
- UI must only modify semantic/presentation document via typed commands and undoable transactions.
- Pure domain modules never depend on React, DOM, Tauri, React Flow or browser storage.
- Sequence interactions use a timeline-specific coordinate engine; don't fake them with ordinary graph edges.
- Native filesystem capability is scoped and sits behind an adapter. Browser fallback works without native APIs.
- Export SVG independent of canvas screenshot so diagrams preserve vectors and full bounds.

## Delivery discipline

- No dead buttons, fake persistence, placeholder dialogs or claims of unverified `.mdj` compatibility.
- Build/test frequently; never skip failing tests or blanket-disable type checking.
- One request may be completed through multiple *internal* coding checkpoints. Fully validate the core editors before extending breadth.
- Keep `docs/IMPLEMENTATION_REPORT.md`, `docs/TEST_REPORT.md` and `docs/KNOWN_LIMITATIONS.md` current and factual.
- Prefer clean, composable tested code over number of generated files.
