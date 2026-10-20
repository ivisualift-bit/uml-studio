# UML Studio — Implementation Plan

Source of truth: `UML_STUDIO_CAHIER_DES_CHARGES.md` (the "spec"). This is the compact working checklist used
during the build. Status of each item is recorded in `docs/IMPLEMENTATION_REPORT.md` at the end.

## Toolchain (verified 2026-10-20)

| Concern | Choice | Note |
|---|---|---|
| Runtime | Node 22.13, pnpm 9.15 | pnpm installed into the user npm prefix |
| Language | TypeScript 5.9.3 (strict, `noUncheckedIndexedAccess`) | TS 7 exists but `typescript-eslint` 8.72 requires `<6.1` |
| Bundler | Vite 7.3 + `@vitejs/plugin-react` 5.2 | Vite 8 requires plugin-react 6 (new Rolldown pipeline) — not needed |
| UI | React 19.3, Tailwind 4.3, `radix-ui` 1.8, `lucide-react` 1.60 | shadcn-style primitives written in-repo |
| Graph canvas | `@xyflow/react` 12.12 | Floating edges with geometry computed by our own pure notation layer |
| Timeline canvas | Custom SVG (sequence) | No React Flow for sequence semantics |
| State | Zustand 5 + Immer 11 patches | Immer used inside the pure command engine |
| Schemas | Zod 4.6 | Single source for types (`z.infer`) and import validation |
| Recovery | Dexie 4 / IndexedDB | Same recovery store in browser and Tauri webview |
| PDF | jsPDF 4.2 + svg2pdf.js 2.8 | Vector for WinAnsi text, raster fallback otherwise (reported) |
| Zip (codegen) | fflate | |
| Tests | Vitest 4.1 + jsdom 28 + Testing Library, Playwright 1.64 | jsdom 30 needs Node ≥ 22.22 |
| Desktop | Tauri 2.12 CLI/API, dialog plugin | **Rust/Cargo not installed on this machine** |

## Architecture checklist

### Layers (enforced by ESLint `no-restricted-imports`/`no-restricted-globals`)

1. `src/domain/**` — pure TS: Zod schemas + inferred types, ID factory, element-kind metadata (reference
   fields, containment rules), command engine (Immer patches), history, ownership/reference/integrity
   services, delete cascade, clone & remap, notation parsers (multiplicity, member text, transition labels),
   validation rules, serialization + migrations, templates. No React/DOM/Tauri/storage.
2. `src/diagrams/render/**` — pure notation/geometry: text metrics, render primitives (a tiny SVG
   element tree), node shapes per element kind, edge routing + UML markers + end labels, sequence
   timeline layout, diagram bounds, SVG serializer. Used by **both** the canvas and the exporters → parity.
3. `src/diagrams/registry` — diagram catalog (status complete/partial/planned, palette tools, allowed
   element/relationship kinds, render mode) and relationship rules (allowed endpoints per kind).
4. `src/services/**` — persistence (`ProjectRepository` interface; browser FS-Access/download adapter,
   Tauri adapter; IndexedDB recovery), export (SVG/PNG/PDF/JSON), codegen (TS/Java/Python), platform detect.
5. `src/stores/**` — Zustand: `documentStore` (authoritative doc, history, revisions), `editorStore`
   (ephemeral tabs/selection/tool/viewport), `settingsStore` (theme/lang/grid, persisted in localStorage).
6. `src/features/**`, `src/components/**`, `src/diagrams/graph|sequence` — React UI.

### Data model decisions

- `ProjectDocument { format, schemaVersion, id, name, ..., rootModelId, modelElements, diagrams, settings }`.
- `modelElements: Record<ID, ModelElement>`; `ModelElement` is a Zod discriminated union on `kind`
  (dedicated schema per kind). Relationships are model elements with `sourceId/targetId`.
- Every element has exactly one `ownerId` (root model has `null`). Relationships are owned by their
  source element's owner package. Attributes/operations/parameters/literals are owned value objects with
  their own globally-unique IDs.
- `UMLDiagram.views: Record<ID, DiagramView>`; view union on `kind`: `node | edge | note | noteLink`
  (graph diagrams) and `lifeline | message | activation | fragment` (sequence timeline).
- Node views store absolute diagram coordinates plus `containerViewId` (visual nesting). The rendered
  size is `max(stored size, intrinsic min size)` computed by the notation layer.
- Visual containment has explicit semantic effects defined in one place: activity partition membership,
  state nesting (owner = composite state), package ownership (explicit move), deployment/component nesting.
  System boundary containment is visual only (spec 3.2).
- Sequence ordering = message views sorted by `sendY` (tie-break by id); lifeline X never affects order.
- Notes and note links are presentation-only views (allowed by spec §12 generic rules).

### Command engine

- `executeCommand(doc, command, ctx)` → `produceWithPatches` → integrity check → schema check of touched
  elements/views → `{ doc, patches, inversePatches, affected }` or structured `CommandError`.
- `dispatch(command | command[])` = one transaction = one history entry. IDs are created by command
  *creators* (before execution) so redo restores identical IDs.
- Non-history commands (viewport persistence) are explicit (`recordHistory: false`).
- Drag = one `MOVE_VIEWS` at drag stop. Inspector text = one command per field edit session (blur/Enter).

### Delete policy (spec §4.3, §6.4, §21.1)

- Canvas `Delete`/`Backspace` → remove selected *views*. A relationship/message/flow whose **last** view is
  explicitly deleted is deleted from the model too (no ghost relationships). Removing a node view hides its
  edge views but keeps relationships between still-existing elements; re-adding the element view
  re-displays them.
- `Mod+Delete`, context menu, explorer → "Delete from model…" confirmation dialog listing affected
  diagrams/views/relationships. Undoable.

### Persistence

- `.umls` = UTF-8 JSON, `format: "uml-studio-project"`, `schemaVersion: 1`, normalized key order.
- Load pipeline: size guard (25 MB) → duplicate-key/depth scan → `JSON.parse` → format/version check
  (newer → refuse, never overwrite) → migration chain → Zod parse → integrity (dangling refs, duplicate IDs,
  owner cycles, record key = id) → new document. Failure never touches the open project.
- Browser: File System Access API when present (real overwrite on Save), otherwise `<input type=file>` +
  download (UI states that overwrite is impossible). Recents + recovery snapshots in IndexedDB.
- Tauri: Rust commands own the native dialogs, remember user-picked paths (scope), atomic temp+rename write.
- Recovery: debounced 1.5 s snapshot after edits + `visibilitychange`/`pagehide`; startup chooser
  Restore/Discard; dirty flag survives recovery until an explicit save.

### Rendering/export

- Same primitives for canvas and SVG export; arrowheads/diamonds are explicit polygons (no `<marker>`
  collisions, robust in svg2pdf). Bounds from all primitives + margin. Text metrics from a Helvetica/Arial
  width table (deterministic sizing in canvas, SVG, PDF).
- PNG: SVG → `<img>` → canvas at 1x/2x/4x, size guard. PDF: jsPDF+svg2pdf, A4/A3/Letter/fit, orientation,
  optional title & page number.

## Checkpoints

| # | Scope | Exit gate |
|---|---|---|
| 0 | Plan, scaffold, configs | install/typecheck/build/dev succeed |
| 1 | Domain: schemas, factory, commands, history, services, serialization, validation | unit tests green |
| 2 | Shell, explorer, toolbox, inspector, tabs, palette, shortcuts, persistence, recovery | round-trip tests |
| 3 | Class editor end-to-end (+ render/export primitives) | E2E-001/002 |
| 4 | Use Case | E2E-003 |
| 5 | Sequence timeline editor | E2E-004 |
| 6 | Activity + State Machine | E2E-005/006 |
| 7 | PNG/PDF, validation UX, templates, i18n, themes, error paths | E2E-007..010 |
| 8 | Extended diagrams, codegen, text exporters | per-diagram smoke E2E |
| 9 | Audit, docs, Tauri attempt | full suite green |
