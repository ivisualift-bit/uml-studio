# OPUS 5.5 — ONE-RUN AUTONOMOUS BUILD PROMPT

> **Usage:** In a new empty repository, place `UML_STUDIO_CAHIER_DES_CHARGES.md` at the repository root. Open this repository in your agent-enabled coding IDE. Paste **everything below the divider** into a new Opus 5.5 coding-agent session. Enable file editing and terminal/test commands. Use a long-running agent mode that can execute multiple implementation steps without further user messages. This prompt is an instruction to build, not a promise that a one-run implementation will achieve full StarUML parity.

---

You are a principal software architect, expert TypeScript engineer, UML modeling systems engineer, UX designer, and quality-assurance lead. You are responsible for building **UML Studio**, a real, usable, professional-grade UML desktop modeling application from scratch in this repository.

## 1. Source of truth and objective

1. First read the entire repository and then read `UML_STUDIO_CAHIER_DES_CHARGES.md` in full. This file is the **binding product specification**. Do not merely summarize it; implement its requirements with the prioritization it defines.
2. Build a **real semantic UML modeler**, not a generic draggable canvas, showcase site, or static frontend demo.
3. The application targets an Apple Silicon macOS user but must support the browser and be designed for Windows/Linux packaging as well.
4. No backend, API, database server, auth, AI provider, external cloud, telemetry, subscriptions or paid library is needed. **Everything essential must work offline.**
5. Use TypeScript, React, Vite, Tailwind CSS, shadcn/ui/Radix, Lucide, Zustand + Immer, Zod, React Flow (`@xyflow/react`) for suitable graph diagrams, custom timeline SVG editors for Sequence, IndexedDB browser recovery, Tauri 2 for native desktop Open/Save, and Vitest/Playwright tests. Use stable compatible dependencies; verify installed versions rather than assuming exact APIs.
6. Use an original design. Do not copy StarUML logos, artwork, proprietary code or assets.

## 2. Mission-critical product requirements

Implement, in this order, a **fully working end-to-end vertical slice** for:

A. Project creation, semantic model tree, diagrams, file save/open, autosave/recovery, tabs, keyboard shortcuts, themes and inspector.

B. **Class diagrams:** editable classes/interfaces/enums, attributes, methods, visibility/abstract/static notation, generalization, realization, dependency, association, aggregation and composition with proper UML arrowheads and cardinality at BOTH ends. Fully working editor, manipulation, multi-view data sync, undo/redo and exports.

C. **Use Case diagrams:** actors, use cases, boundaries, association, include/extend and generalization, correct arrow direction and labels.

D. **Sequence diagrams:** lifelines, activations, synchronous/asynchronous/return/self/create/destroy messages, frame guards and alt/opt/loop combined fragments. The timeline must preserve meaningful event order when editing and reopening; do not try to force all sequence behavior into generic React Flow node connections.

E. **Activity diagrams:** initial/final, actions, decisions/merges, forks/joins, guarded flows and swimlanes.

F. **State Machine diagrams:** states (including basic composite nesting), initial/final, transitions with `trigger [guard] / effect`, proper state machine properties.

G. Cross-cutting: PNG/SVG/PDF export, project save/reopen, validation issues panel, reliable deletion, copy/paste/duplicate, undo/redo, quick search/command palette, templates, EN/FR UI.

The full specification also describes Package, Object, Component, Deployment, Composite Structure, Profile, Communication, Timing, Interaction Overview, Information Flow, optional ERD/C4/Flowchart, codegen and `.mdj` import. **Aim to implement as much as possible after the CORE is verified, but do not sacrifice CORE functionality to superficially claim 15 editors.** Advanced capabilities may be explicitly marked partial/planned in registry/documentation. They must not silently appear functional if not implemented.

## 3. Critical domain architecture (mandatory)

**Never conflate the UML model with the diagram view.**

Use a normalized, versioned project document and stable IDs:

- Semantic `ModelElement`s: packages, classes, attributes/operations, actors, use cases, states, interactions, relationships, etc. with typed fields.
- `UMLDiagram`s: type, name, settings, and separate presentation views.
- Node/edge/timeline views: independent stable IDs, positions, sizes, bendpoints, label positions, and references back to semantic model IDs.
- A semantic class may occur in any number of diagrams. Renaming it updates every diagram. Removing one view must not delete the semantic element; deleting the element must handle/remove affected relationships/views transactionally.
- Own child elements in explicit container trees; relationships form a separate directed graph.
- Type domain entities and schemas with discriminated unions + Zod. Validate ALL imported project documents, avoid `any` and unchecked user-provided JSON.
- Use command pattern/transactions: every mutation goes through command bus, validates, commits atomically and becomes undoable. Distinguish persisted document history from ephemeral hover/selection/zoom UI state.
- Keep the domain independent from React, React Flow, Tauri, filesystem, DOM and state management bindings.
- Separate diagram plugins/adapters, project repository interfaces, exporters, codegen and validation.

A model rename must update all views; a save/reopen must preserve model IDs and diagram geometry; undo/redo must restore consistent semantic state. These three properties are **non-negotiable acceptance conditions**.

## 4. Professional interface requirements

Build a serious original desktop IDE-style UI (high quality, not a generic SaaS dashboard):

- Header/menu bar File/Edit/View/Diagram/Model/Tools/Window/Help with working accelerators.
- Toolbar: new/open/save, undo/redo, select/hand/connector, zoom/fit, validate, export.
- Left collapsible semantic model explorer with project tree, right-click context menus, search, nested ownership and diagram creation.
- Contextual diagram toolbox with correct UML glyphs and relation tools; drag and click-to-place.
- Central diagram editor with multiple closeable tabs, accurate pan/zoom, grid/guides, node resize, multi-select, marquee, alignment, connection previews, labels, robust edge routing and diagram context menu.
- Right inspector for semantic Properties / visual Style / Documentation; editing class attributes and operations must be genuinely usable with reorder, add, edit, remove.
- Bottom Problems panel with validation severity and click-to-focus navigation.
- Status bar: zoom, dirty/saved, selected count, diagram kind; error toasts and accessible dialogs.
- Dark/light/system themes, complete English/French localization, crisp text and usable density at 1024x768+.
- Full keyboard shortcuts specified in the cahier des charges. Do not steal shortcuts from active text fields.

Every visible clickable control must have a real handler. If a scoped feature isn't ready, make it clearly disabled with a reason. **Never leave dead buttons, placeholder modals or fake saves.**

## 5. File lifecycle and interoperability

1. Define `.umls` versioned UTF-8 JSON native format with schema migrations.
2. Implement browser persistence via IndexedDB and web file chooser/download fallback; Tauri desktop uses OS native file open/save dialogs and narrowly scoped filesystem access. Avoid unsafe unrestricted permissions.
3. Explicit Save/Save As, unsaved marker, open recent, debounced recovery snapshots, startup recovery chooser, errors for corrupt/unsupported files, and protection against data loss.
4. Implement real SVG serializer and derive PNG/PDF from stable geometric output. Respect full content bounds, UML markers/arrowheads, accents and escaped text, white/transparent backgrounds, scale and PDF page sizing.
5. Code generation: TypeScript, Java and Python class/interface skeletons after CORE. Document that output is stubs, not executable business logic.
6. `.mdj`: StarUML files are version-sensitive JSON with special relationships. If you implement import, use strict mapping + fixture tests + import report. Never claim full `.mdj` interoperability without tests. Do not produce renamed JSON and call it `.mdj`.

## 6. Implementation algorithm and checkpoints (work AUTONOMOUSLY)

**DO NOT try to dump the whole application in one giant file or one untested batch.** This is ONE user request, but you must self-execute a sequence of internally validated implementation steps:

**Checkpoint 0 — Inspection and setup**
- Inspect repo, read complete spec, write a compact architecture checklist to `docs/IMPLEMENTATION_PLAN.md`.
- Scaffold React/Vite/TS/Tailwind/Tauri, lint/build/test scripts, core UI primitives.
- Confirm `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm build` work.

**Checkpoint 1 — Domain foundation**
- Implement validated semantic model/view schemas, UUID factories, document migrations, model ownership, relationship references, command bus, undo/redo, immutable mutations.
- Implement unit tests **before** relying on these APIs from complex UI.

**Checkpoint 2 — Editor shell and project lifecycle**
- Build IDE-style workspace, diagram tabs, explorer/toolbox/inspector, command palette and keyboard registry.
- Implement new project, browser/Tauri adapters, file save/open, dirty detection, autosave recovery and errors.
- Test round-trip immediately.

**Checkpoint 3 — Class editor end-to-end**
- Implement real class nodes and proper edges, attributes/operations, multiplicity, role and navigability, label controls, inspector, editing and export.
- Test relationships, semantic reuse in 2 diagrams, save/reopen, undo/redo and export. Do not proceed until passing.

**Checkpoint 4 — Use Case editor**
- Implement actor/use case/boundary, associated edge types, include/extend directions and labels, inspector and tests.

**Checkpoint 5 — Sequence editor**
- Implement specialized lifeline/timeline surface with temporal message positions, activations, combined fragments, message drag/edit, persistence and export; test thoroughly.

**Checkpoint 6 — Activity + State**
- Implement structured activity/swimlane and state machine editing with transitions, guards, validators, SVG exports and E2E tests.

**Checkpoint 7 — Integration and usability**
- Solidify PDF/PNG/SVG outputs, validation panel, shortcuts, templates, EN/FR translations, themes, corruption/error paths, recovery and UI responsiveness. Run full tests.

**Checkpoint 8 — Expansion**
- Expand toward Package, Object, Component, Deployment, Composite Structure, Profile, Communication, Information Flow; Timeline and Interaction Overview need actual specialized semantics, not superficial icons. Add code generators, interop subsets and optional notations if CORE still passes.

**Checkpoint 9 — Audit and release**
- Run clean install/build/typecheck/lint/tests/e2e, inspect screenshots, fix regressions, check all visible buttons, save/reopen and exported artifacts.
- Try `pnpm tauri dev` and `pnpm tauri build` if platform toolchain available. If native build blocked by Rust/Xcode setup, state exact missing prerequisite; do not claim it succeeded.
- Write `docs/ARCHITECTURE.md`, `DATA_MODEL.md`, `DIAGRAM_CAPABILITIES.md`, `TEST_REPORT.md`, `KNOWN_LIMITATIONS.md`, `IMPLEMENTATION_REPORT.md` and comprehensive `README.md`.

**IMPORTANT:** Finish each checkpoint and run its tests before declaring it complete. If context/computation budget gets tight, prioritize correct, tested CORE over untested extended features. Reassess remaining requirements at every checkpoint; do not stop at a good-looking UI.

## 7. Tests you must write and execute

At minimum implement the E2E scenarios in sections 18.2 of the specification:

- Class diagram: `Person`, `Student`, `Course`, attributes/operations, inheritance, association multiplicity, save/reload/export, undo/redo.
- One semantic `Customer` reused across two separate class diagrams; rename syncs and deleting only one view doesn't delete model.
- Actor + system boundary + include/extend correct syntax and directions.
- Sequence lifelines + messages + activation + alt fragment; reposition, save, reopen, SVG export.
- Activity with guarded decisions and swimlanes; moving actions preserves flow.
- State machine transitions/guards/labels survive reopen.
- Recovery from unsaved changes.
- Malformed JSON/newer schema/dangling references fail gracefully without overwriting current state.
- Keyboard shortcuts work while focused text editing behaves normally.
- SVG parses as XML, PNG decodes, PDF signature/readability confirmed for unicode and marker cases.

Add unit tests for history, transactions, serializers, exporters, validators, ownership cycles and duplicate IDs. Test that native/graph adapters don't change IDs on ordinary rerenders.

## 8. Code quality policy

- Use strict TS. No `any` except isolated, justified foreign inputs before validation.
- Components should be small; preserve dependency boundaries, no business logic buried in JSX.
- No direct document mutations outside command bus.
- No randomly recreated model IDs on every render.
- Save document semantics, not only React Flow's transient node/edge structure.
- No fake services, placeholder export files, TODO implementations presented as functional, disabled lint/build/test validation, or deliberately skipped assertions.
- Avoid overpromising UML conformance: tested supported subset only, correct notation and arrow direction.
- Add useful error messages and never hide errors from users.
- Version/pin dependencies with lockfile and avoid CDN at runtime.
- Sanitize imported text and file paths, never execute user-provided code/HTML/JSON.
- Re-run tests after changes that touch shared infrastructure.

## 9. Detailed success demonstration you must produce

When done, the application must be demonstrably able to:

1. Launch into an empty project dashboard and create a project.
2. Create Class diagram with 3 classes, fill properties, connect generalization/association/composition, adjust multiplicities, drag/edit/resize.
3. Drag an existing model class onto a second diagram and rename it; both diagrams update.
4. Undo, redo, save `.umls`, close and reopen; identical model IDs, class members, edge labels and node geometry remain.
5. Create Use Case, Sequence, Activity and State Machine diagrams from real palettes, edit their actual notation and save them.
6. Export SVG, PNG and PDF for selected diagrams and verify exported output visually/structurally.
7. Run validation and navigate from a problem to an element.
8. Run without internet or backend, on web, and native desktop where toolchain permits.
9. Pass automated validation and show executed test results.
10. Show actual feature coverage with explicit partial/planned markings for remaining UML types.

## 10. How to communicate and finish

Work proactively and autonomously. Do not ask for confirmation after each stage. If you encounter a missing dependency or a failed test, fix it. If toolchain/environment makes one specific test impossible, document the exact blocker and proceed with unrelated tasks. Do not erase existing user files without inspection.

**Final report must contain:**

- Concise overview of what actually works, with status by major editor feature.
- Architecture summary and important design choices.
- Exact local run/build commands.
- Tests **actually run**, with pass/fail summary; no invented pass claims.
- Whether native macOS app build was really produced and where.
- Known limitations, missing advanced semantics, import/export caveats and prioritized next steps.

Remember: this project succeeds when a student can perform real UML coursework without StarUML, not when the screenshot resembles an IDE. Build the modeler, not the mockup.

**Begin now: inspect the repo and the specification, write the implementation plan, then code and self-test through the checkpoints without asking me to send another message.**
