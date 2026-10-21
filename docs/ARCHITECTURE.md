# Architecture

UML Studio is a React 19 + TypeScript (strict) single-page app built with Vite. The same bundle runs in
a browser and inside a Tauri 2 webview. Roughly 29 k lines of source and 4 k lines of tests.

## Layers

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ UI  src/features/*  src/components/*  src/diagrams/{graph,sequence,shared}          │
│     React components. Read state through Zustand selectors and never mutate it.    │
└──────────────┬─────────────────────────────────────────────────────────────────────┘
               │ calls
┌──────────────▼─────────────────────────────────────────────────────────────────────┐
│ App  src/app/*  (actions, command registry, lifecycle hooks, canvas API)           │
│      Turns user intent into typed domain Commands; owns project lifecycle.          │
└──────────────┬──────────────────────────────┬──────────────────────────────────────┘
               │ dispatch(commands)           │ open/save/export/import
┌──────────────▼───────────────┐   ┌──────────▼──────────────────────────────────────┐
│ Stores  src/stores/*         │   │ Services  src/services/*                        │
│ documentStore: document,     │   │ persistence (browser / Tauri adapters, IndexedDB │
│ history, dirty tracking      │   │ recovery), export (SVG/PNG/PDF/JSON), codegen,   │
│ editorStore: tabs, selection,│   │ textExport, import (.mdj), templates, platform  │
│ tool, dialogs (ephemeral)    │   └──────────┬──────────────────────────────────────┘
└──────────────┬───────────────┘              │
               │ executeCommands              │ uses
┌──────────────▼──────────────────────────────▼──────────────────────────────────────┐
│ Pure core (no React, DOM, Tauri, React Flow or storage; enforced by ESLint)         │
│  src/domain/*            schemas, commands, history, integrity, validation,         │
│                          serialization/migrations, notation, model services         │
│  src/diagrams/render/*   layout + notation → primitive scene graph → SVG            │
│  src/services/codegen/*, src/services/import/*                                      │
└────────────────────────────────────────────────────────────────────────────────────┘
               ▲
               │ Tauri IPC (desktop only)
┌──────────────┴─────────────────────────────────────────────────────────────────────┐
│ src-tauri/src/lib.rs  native dialogs, path allow-list, atomic writes, recent files  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

`eslint.config.js` lists the pure modules in `PURE_MODULES`. Inside them, importing React, React
Flow, Tauri, Dexie, Radix or the stores is a lint error, and so is using `window`, `document`,
`localStorage` or `indexedDB`.

## Module map

| Path | Responsibility |
| --- | --- |
| `domain/schemas` | Zod schemas. They are the single source of the TypeScript types: 36 element kinds, 18 relationship kinds, 8 view kinds, diagrams, and the project envelope. |
| `domain/model` | Static UML rules (ownership, relationship endpoints, diagram kinds, containment effects), reference collection, factories that return canonical (fully defaulted) objects. |
| `domain/commands` | `Command` union, handlers, `executeCommands` engine, history with merge keys, high-level creators (create node, connect, paste, sequence messages, rename…). |
| `domain/services` | Queries with per-document indexes, integrity check, deletion planning, containment, ID remapping for copy/paste and templates. |
| `domain/notation` | Parsing and formatting of UML text: `- name: Type [0..1] = x`, operation signatures, multiplicities, `trigger [guard] / effect`, message labels. |
| `domain/serialization` | `.umls` serialization, the untrusted-input load pipeline, migrations. |
| `domain/validation` | Model rules shown in the Problems panel (37 rule codes, see `validation/types.ts`). |
| `diagrams/render` | Deterministic text metrics, node shapes, edge routing and markers, graph and sequence layout, SVG serializer. Shared by the canvas and every export. |
| `diagrams/registry` | Diagram catalog: status, toolbox tools, default sizes. |
| `diagrams/graph` | React Flow canvas for every graph diagram. It is controlled: React Flow never owns the document. |
| `diagrams/sequence` | Custom SVG timeline editor for sequence diagrams. |
| `features/*` | Workspace shell, explorer, toolbox, inspector, problems panel, dialogs, palette, start screen. |
| `services/persistence` | `ProjectRepository` interface with browser and Tauri adapters, plus `RecoveryRepository` on IndexedDB. |

## Edit flow: command → domain → store → view

1. A gesture or menu item calls an action (`src/app/actions.ts`) or a creator in
   `domain/commands/creators.ts`. The result is a list of typed `Command`s, such as `element/add`,
   `view/move` or `member/update`. IDs come from an injected `IdGenerator`, so a replay never makes new
   IDs.
2. `documentStore.dispatch(commands, { label, mergeKey })` calls `executeCommands(doc, commands)`:
   - all handlers run inside one Immer `produceWithPatches` draft, so the transaction is atomic;
   - every touched element, view and diagram is re-parsed with its Zod schema and must be unchanged
     by the parse, which catches non-finite numbers, wrong enums and attempts to change immutable
     fields;
   - the full integrity check runs (ownership legality and cycles, dangling references, edge and
     relationship end agreement, timeline references, duplicate IDs);
   - any failure rejects the whole transaction and the document is untouched.
3. On success, the patches and inverse patches go into history. Commands sharing a merge key within
   1.2 s are combined into one entry, so a typing or nudging session undoes as one step. History keeps
   200 entries. The project is dirty when the top history entry differs from the entry that was saved.
4. Components re-render through selectors. Canvases compute layout with the pure render layer.
   During a drag, positions are transient overrides. The single `view/move` command is dispatched on
   release.

Model and view are separate. A diagram stores views (`node`, `edge`, `lifeline`, `message`…), and each
view references a model element by `elementId`. Renaming changes the element, so every view updates.
Removing a view (`Delete`) keeps the element. "Delete from model" (`Mod+Delete`) runs
`planElementDeletion`. That cascades to owned elements, attached relationships, owned diagrams and all
their views, and it clears optional references such as attribute types. The confirmation dialog shows
the counts first.

## Rendering and export

`diagrams/render` turns a diagram into a scene of primitives (`rect`, `path`, `text`, `polygon`,
`ellipse`…). Arrowheads, diamonds and balls are explicit polygons rather than `<marker>`s, so every
renderer draws them the same way. The scene is used in three places:

- **Canvas**: `PrimitiveSvg` draws each node or edge inside React Flow, or the whole scene in the
  sequence editor;
- **SVG export**: `svgSerializer` writes standalone, well-formed SVG with escaped text, a viewBox
  covering all content, and IDs namespaced per export;
- **PNG/PDF**: PNG rasterizes that SVG. PDF draws it as vectors with svg2pdf.js, and falls back to an
  embedded image when the text needs glyphs outside WinAnsi (the dialog says so).

Text is measured with Helvetica-compatible width tables (`textMetrics.ts`), so node sizes are identical
on screen, in SVG and in PDF, and never depend on the DOM.

## Persistence adapters

`services/platform/platform.ts` picks an adapter at runtime with Tauri's `isTauri()`, never the
user-agent string.

| | Browser (`browserRepository.ts`) | Desktop (`tauriRepository.ts` + `src-tauri`) |
| --- | --- | --- |
| Open | File System Access picker in Chromium, otherwise `<input type=file>` | Rust `pick_open_project` (native dialog) |
| Save | Overwrites through the stored handle. Without File System Access, a download. | `write_text_file`, only for allow-listed paths, atomic |
| Recent files | IndexedDB (handles, or a stored copy in fallback mode) | `recent-projects.json` in the app data dir |
| Export | Save picker or download | `pick_save_path` + `write_binary_file` |
| Import (.mdj) | `<input type=file>`, read-only | `pick_import_file`, read-only |

Recovery snapshots use IndexedDB (Dexie) in both environments.

## ADR-001: two editors, graph and timeline

**Context.** Most UML diagrams are graphs: boxes connected by edges. In a sequence diagram, vertical
position *is* time order. Messages attach to lifelines at a Y coordinate, activations span Y ranges,
and combined fragments cover message ranges with operand dividers.

**Decision.** Graph diagrams use React Flow as a controlled view over `node`/`edge` views. Sequence
diagrams use a dedicated SVG editor (`diagrams/sequence/SequenceCanvas.tsx`) and a timeline layout
engine (`render/sequenceLayout.ts`). There, `message` views store `sendY`/`receiveY`, `activation`
views store `startY`/`endY`, and `fragment` views store `operandYs`. Message order is derived from
`sendY` (ties broken by ID). Messages are never React Flow edges.

**Consequences.** Dragging a message reorders it in time. Moving a lifeline sideways never changes
the order. Create/destroy, found/lost and self messages, plus activation nesting, are modeled
explicitly. The integrity check ensures every message view references the lifeline views of its
message's lifelines. The cost is a second editor to maintain. Both share the render layer, the
command engine, the inspector and export.

## ADR-002: native file access lives in Rust

The webview gets no general file-system plugin. Dialogs run in Rust, which records the user-chosen
paths and refuses reads or writes to any other path. Recent files are re-allowed at startup. Imported
`.mdj` files are read once and not allow-listed. Project reads are capped at 25 MB, writes are atomic,
and the window CSP allows only `self` and IPC.

## ADR-003: Zod schemas are the type source and the file contract

Every persisted shape is a Zod schema, and its TypeScript type is inferred from it. Factories return
schema-parsed objects, so the in-memory document equals what a save → load round trip produces (a
test asserts this). The same schemas validate untrusted files, so the load path and the edit path
cannot disagree.

## ADR-004: imports get fresh IDs

Importers (`.mdj`) and templates create new native IDs instead of reusing foreign ones. Foreign IDs
may contain characters the ID schema rejects, and fresh IDs keep projects globally unique. The import
result must pass the same schema and integrity checks as a `.umls` file before it can be opened.
