# UML STUDIO — CAHIER DES CHARGES & TECHNICAL ARCHITECTURE

**Document status:** Implementation specification (v1.0)  
**Product name:** UML Studio (working name; do not use StarUML name, branding or icons)  
**Product type:** Free, local-first UML desktop modeling application with a web-compatible frontend  
**Primary platform:** macOS Apple Silicon (M2 Pro), also macOS Intel, Windows and Linux where toolchain supports them  
**Delivery mode:** One comprehensive autonomous coding-agent run, implemented as internal checkpoints and tested before declaring completion  
**Languages:** English and French user interface  
**Core constraint:** No server, database service, authentication, cloud dependency, telemetry, account requirement or paid third-party API for core use.

## 0. Product philosophy, reality checks, and non-negotiable rules

1. This is a **semantic UML modeler**, not a generic flowchart editor. A model element (e.g. `Customer`) is an entity with stable identity and UML properties; its diagram views are independent renderings. The same `Customer` can appear in many diagrams; editing its semantics updates all views.
2. Every visible menu item/button/tool must either **work** or be clearly **disabled with an honest reason**. No fake controls, mock-only editor, lorem ipsum projects or silent no-ops.
3. Offline-first is mandatory. The editor must run offline after installation. Desktop project files use a proprietary, documented, versioned `.umls` JSON format, **not** `.mdj` masquerading as a StarUML file.
4. Keep semantic document state separate from UI and render state. All user edits are transactions through a typed command engine. Undo/redo, validation, autosave and exports all operate on a single authoritative document state.
5. Favor a smaller correct subset of UML over incorrect diagrams: **first fully implement Class, Use Case, Sequence, Activity, and State Machine**. The product roadmap includes all UML diagram families; advanced implementations must be clearly designated in a capability manifest and only declared complete after automated and manual acceptance tests.
6. Never assert that exported files are StarUML-compatible until interoperability is proven against actual `.mdj` fixtures with round-trip testing. The `.mdj` format is JSON-based but relies on StarUML-specific model schemas and references; best-effort importing is not complete interoperability.
7. Do not clone proprietary UI assets, logos, documentation or source code. Use original interface design, original icons and compliant open-source dependencies.
8. Preserve user data. Use atomic native saves where possible, crash-recovery snapshots, explicit dirty-state indication, schema migrations, and reject malformed input safely.
9. The app ships with a working clean install: reproducible dependency install, dev server, production build, tests, and Tauri build instructions (desktop build runs wherever Rust/system prerequisites are installed).
10. Prioritize end-to-end behavior over screenshots. The agent is allowed to build iteratively **within the one autonomous run**, fix its own bugs, and report precisely what is completed versus partial.

## 1. Goals and measurable success criteria

### 1.1 Primary user journeys

- University student creates a project containing a domain model and Class, Use Case, Sequence, Activity and State Machine diagrams, exports PDF or PNG, closes and reopens the project without data loss.
- Instructor checks the diagrams' notations, associations, guards, cardinalities, visibility and message types.
- Developer builds a system model, reuses a class across several diagrams, runs validations, and exports TypeScript/Java/Python class skeletons.
- User uses macOS keyboard shortcuts, native Open/Save dialogs, dark/light theme, offline operation, pan/zoom, snapping and exports without online services.

### 1.2 Minimum definition of done (DoD)

- Development: `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` and `pnpm build` pass or provide a specifically documented, environment-limited reason for any unavailable command.
- Native: `pnpm tauri dev` and `pnpm tauri build` are configured; at least a dev launch and native save/open can be tested on macOS if Rust dependencies exist. No claim that `.dmg` was built if not built.
- Student journey: create project -> add 3 classes -> add methods/attributes -> create generalization, association with end multiplicities, composition -> add actor and use case diagram -> add lifelines and messages in sequence -> create activity and state diagrams -> save -> reopen -> export.
- Editing correctness: moving nodes, editing labels, undo/redo, copy/paste, delete, duplicate, saving and reloading preserve model semantics and diagram geometry.
- Data integrity: no ghost relationships, dangling references, duplicate IDs, invalid schema mutations or disappearing elements after reopening.
- Each supported diagram type must have at least one automated smoke E2E that creates, edits, persists and exports an instance.

## 2. Scope and delivery categories

Use statuses **CORE**, **EXTENDED**, **ADVANCED**. CORE means required and tested for the first usable delivery. EXTENDED means part of full product scope to implement if time allows during the same run; incomplete extended features must be disabled and reported. ADVANCED means future-ready interfaces and documented contracts, not fake claims.

| Area | CORE | EXTENDED | ADVANCED |
|---|---|---|---|
| Project lifecycle | Create/open/save/save as/recent/autosave/recovery | Project templates, duplicate and merge project | Version control integration |
| Class diagrams | Full essential notation and editing | Generics, association classes, qualifiers | Complete UML 2 metamodel and OCL |
| Use Case | Actor, use case, boundary, include/extend/generalization | Extension points, notes, constraints | Elaborate use-case scenario authoring |
| Sequence | Lifeline, synchronous/asynchronous/return/self/create/destroy, activations, alt/opt/loop | par/break/critical/ref, structured auto-layout | Comprehensive timing semantics |
| Activity | Initial/final/action/decision/merge/fork/join, flows/guards/swimlanes | Object flows, signal, flow final, pins | Complete token semantics simulation |
| State Machine | Initial/final/state/composite state/transitions/guards | Choice/junction/history, entry/exit, multiple regions | Exhaustive UML semantics simulation |
| Package/Object | Basic nodes and links | Full notation | — |
| Component/Deployment | Basic components/nodes/artifacts/interfaces/paths | Detailed contract and nesting | — |
| Composite Structure/Profile | Capability-specific editors | Detailed notation | Full profile application/validation |
| Communication | Numbered message links | Mapping to interactions | Round-trip sequence communication |
| Timing/Interaction Overview | Specialized editor shells when functional | Timelines/interaction uses | Standards-level coverage |
| Information Flow | Information items and flow links | Information conveyance labels | Complete UML semantics |
| Editor | Pan/zoom/drag/connect/resize/selection/shortcuts/undo | Reroute, auto-layout, rulers and minimap | Very large graph optimizations |
| Documents | `.umls`, PNG, SVG, PDF, JSON | Mermaid/PlantUML selective exporters | UML XMI, `.mdj` import/export compatibility |
| Code engineering | TS/Java/Python class skeleton export | TypeScript class/interface parser import | Java/Python reverse-engineering |
| Quality | Validation rules, errors panel, tests | More UML lint rules, auto-fix | Profiles/OCL engine |
| Language/theme | EN/FR, light/dark/system | High contrast and theme customization | Plugin themes |
| Desktop | Tauri macOS, Windows/Linux config | Signed installers and auto-update | App-store publishing |
| Extras | — | ERD, Flowchart, C4 optional standalone modules | BPMN/SysML, collaboration, plugins |

**Product boundary:** No cloud collaboration, team accounts, backend, database hosting, AI diagram generation, marketplace or billing in v1. Do not sacrifice local data fidelity for these features.

## 3. Complete UML diagram catalog and notation contracts

UML Studio must expose a diagram creation catalog and metadata registry. Show unimplemented diagrams with a clear `Planned` description; do not open a broken blank canvas. The 15 UML families below cover the broad current professional modeling set (some tools distinguish profile, flow, interaction and timing differently).

### 3.1 Class Diagram — CORE, highest quality bar

**Nodes:** Class, abstract class, interface, enumeration, enumeration literal, data type, primitive type, signal, package/subsystem, note, constraint, association class (extended), template parameter (extended).

**Class compartments:** Name + stereotypes, attributes, operations; visibility markers `+`, `-`, `#`, `~`; static underlining; abstract italics; optional show/hide compartments; optional show signatures only; full UTF-8 including French names. Attribute fields: name, type reference or text, visibility, static, readOnly, default, multiplicity, derived, ordered/unique (extended). Operation fields: name, return type, visibility, abstract/static, parameter list with direction `in|out|inout|return`, defaults, stereotypes.

**Edges:** Directed/undirected association, navigability, aggregation (white diamond), composition (filled diamond), generalization (hollow triangle solid), interface realization (hollow triangle dashed), dependency (dashed arrow), usage, trace; associations may carry roles and multiplicities **at both ends** (`1`, `0..1`, `*`, `0..*`, `1..*`, ranges); association names; attributes like ownership/navigability where supported.

**Interaction:** Inline rename (double click/F2), add attribute/operation (toolbar, keyboard, properties), reorder members, toggle compartments, self-associations, reconnect endpoints, edge label drag, choose cardinality from quick dropdown or type custom, orthogonal/straight path selection, edge waypoint editing, automatic edge endpoint anchoring, type-safe edge marker geometry.

**Validation:** Missing type warnings are optional; disallow class inheriting from itself, duplicate inheritance edges if configured, composition cycle errors in simplified validation, malformed multiplicity syntax, nonexisting semantic references, and invalid ownership. A class can be represented multiple times without cloning the semantic entity.

### 3.2 Use Case Diagram — CORE

Actors (stick figure/rectangle stereotype variant), use cases (ovals), system boundaries (named frames), packages, annotations. Relations: actor-use-case association, actor generalization, use-case generalization, `<<include>>` and `<<extend>>` with correct arrow direction, extension points (extended), optional association role labels. Support many actors around one system boundary and nested use cases. System boundary is a **diagram container**, not a semantic parent required for every model element.

### 3.3 Sequence Diagram — CORE; specialized timeline engine

Lifelines with head boxes (actor/object/class name and instance notation `instance:Class`), dashed vertical lifeline, activation rectangles, time axis increasing downward. Messages: synchronous call, asynchronous signal, reply/return (dashed), self-call, create, destroy (`X`), found/lost endpoint (extended). Optional message sequence numbering; named operations and arguments. Combined fragments: `alt`, `opt`, `loop`; operands with guard text (`[condition]`), drag/resize fragment boundaries, vertical ordering, send/receive anchoring. Extension: `par`, `break`, `critical`, `neg`, `assert`, `ref`/interaction use, continuation.

**Must not** model sequence solely as arbitrary React Flow edges between boxes: message endpoint Y positions, activation starts/ends, and fragments all have temporal constraints. Use an independent time-coordinate interaction document: lifeline references, ordered events, message `sendY`/`receiveY` and fragment ranges; visual renderer positions follow the model. Dragging a message vertically updates time; moving lifeline horizontally preserves message order; deleting a lifeline warns about affected messages. Message ordering must be deterministic.

### 3.4 Activity Diagram — CORE

Initial circle, action/activity nodes, decision/merge diamond, fork/join bars (both orientations), activity final, flow final (extended), object node, pins (extended), send-signal/accept-event actions (extended), swimlane/activity partition containers. Control flows, object flows (extended), guards, optional action notes. Swimlanes must behave as containers with reparenting when elements move between lanes, without losing their flows. Render crossing connectors reliably.

### 3.5 State Machine Diagram — CORE

Initial, final, simple state, composite state with regions, transition, entry/do/exit behaviors, trigger/guard/effect syntax: `trigger [guard] / effect`. Extended: choice, junction, fork, join, shallow/deep history, terminate, entry/exit points, nested state regions. Transitions connect semantic vertex IDs and may be edited through property inspector. Visually distinguish pseudo-states correctly.

### 3.6 Package Diagram — EXTENDED

Package folder-tab nodes, models/subsystems, import (`<<import>>`), merge (`<<merge>>`), dependencies, package containment; live project explorer synchronization. Drag model elements into packages with explicit semantic `move` transaction.

### 3.7 Object Diagram — EXTENDED

Instance specifications named `instance:Class`, underlined names, slots with values, links, optional stereotype and classifiers. Association links refer to instances, not classes; preserve associated classifier reference if present.

### 3.8 Component Diagram — EXTENDED

Components with correct component glyph, artifacts, interfaces (provided/required lollipop/socket), ports, dependencies, realizations, assembly connectors, packages. Must store port/interface data semantically rather than only drawing circles.

### 3.9 Deployment Diagram — EXTENDED

Device nodes, execution environments, deployment targets, artifacts, components, deployments and communication paths; nested nodes, item lists and stereotypes; meaningful containment.

### 3.10 Composite Structure Diagram — EXTENDED

Structured classifier, parts, ports, connectors, collaborations, roles, part multiplicity, role binding. Requires nested-port edge routing and semantic ownership.

### 3.11 Communication Diagram — EXTENDED

Participants and links with ordered/numbered messages (`1`, `1.1`, `2` etc.), arrows and labeled calls. Should optionally reference the same semantic interaction as a sequence diagram, without claiming automatic lossless conversion unless tested.

### 3.12 Timing Diagram — ADVANCED

Lifelines with state/value timelines, duration observations, timing constraints, transitions, message arrows between timelines. **Requires custom timeline editor**, not generic graph canvas.

### 3.13 Interaction Overview Diagram — ADVANCED

Activity-style control flow with interaction uses, inline interaction fragments, decision/fork/join, initial/final, references to interaction models.

### 3.14 Profile Diagram — EXTENDED

Profile packages, stereotypes, tagged values and metaclass extensions; define stereotype and tagged-value definitions, store applications to model elements, and render stereotype adornments. Complete metamodel validation remains advanced.

### 3.15 Information Flow Diagram — EXTENDED

Information flows, conveyed classifiers/information items, information flow labels, realizations and flow direction.

### 3.16 Optional non-UML notations — explicit separate modules, not mixed into UML core

- ERD: entities, fields, PK/FK, relationships, crow's-foot cardinality; schema is separately typed. SQLite/PostgreSQL SQL export only after a verified SQL generator is implemented.
- Flowchart: process/decision/start/end/document/input/output shapes, connector labels.
- C4: person/software system/container/component and relationship views, distinct from UML component model.
- BPMN, SysML and wireframe support: future modules only. Never advertise as complete merely because generic shapes exist.

## 4. Editor UX/UI — mandatory desktop-grade behavior

### 4.1 Visual language

Original professional desktop IDE visual style, not an imitation of proprietary assets. Dark-first graphite/slate interface with restrained blue accent; crisp typography, neutral surface layering, very subtle borders, 8 px grid, clear hover/selection/focus states, density appropriate for engineering tools. Full light and system themes. No gradients behind diagrams; diagrams export with adjustable white/transparent backgrounds even in dark UI. Desktop first, usable down to ~1024x768.

### 4.2 Window regions

1. **Top application menu:** File, Edit, View, Diagram, Model, Tools, Window, Help. Native-style accelerator hints and usable nested menus.
2. **Primary toolbar:** New, Open, Save, Undo, Redo, Select, Hand, Add/Connect, Zoom controls, Fit, Auto Layout (where implemented), Validate, Export.
3. **Left project explorer:** Search/filter, collapse/expand, context menu, project root, nested UML models/packages, actual semantic elements, diagrams. Drag existing model element to diagram creates a *view* only. Rename/delete dialogs distinguish delete view vs model.
4. **Left diagram toolbox:** Context-specific categorized symbols with icon, tooltip and optional shortcut. Click-to-place and drag-to-place. Relation creation is a two-stage connector tool with preview, cancel via Esc, valid-target highlighting and error feedback.
5. **Center workspace:** Tabbed documents (multiple diagram tabs), infinite canvas, pan/zoom, select multi-select, rubber-band, grid, guides, smooth zoom, connector previews, shapes and labels. Tabs remember viewport and selection.
6. **Right inspector:** Selection-sensitive tabs: Properties, Style, Documentation. Edit semantic entity fields separately from visual-view properties. Multiselect supports common style changes only.
7. **Bottom panel:** Problems/Validation, Outline/Elements, optional Export messages. Click problem to navigate to diagram and select target.
8. **Status bar:** Project name, dirty state, selection count, zoom, current diagram type, save status, offline status.

### 4.3 Canvas mechanics

- Pointer: select, double-click edit, drag move, shift multiselect, marquee, resize handles, right-click context menu, pan middle mouse/space+drag, zoom pointer-centered wheel/trackpad, fit to content.
- Snapping: 10px configurable grid, align/distribute, guidelines, snap toggle; node positions persisted as diagram coordinates.
- Geometry: straight/orthogonal/curved edges when semantically appropriate; endpoint docking, draggable edge handles and editable bendpoints; markers must not overlap source/target shapes.
- Selection: multi-node and multi-edge selection, click blank clears, Esc cancels transient tools, Delete/Backspace removes selected representation with confirmation when semantics would be deleted.
- Clipboard: copy/cut/paste/duplicate with new unique IDs, remap internal edges/references, preserve references to reused model entities where intended; offset pasted views; browser clipboard fallback if native clipboard unavailable.
- Undo/redo: one logical history entry per user operation, drag coalescing, keyboard shortcuts for macOS/Windows, persistence safety (undo does not corrupt imported IDs).
- Accessibility: all commands available through keyboard/menu, accessible labels/tooltips, distinguishable color/non-color selection, sufficient contrast, focus management and dialogs that trap/release focus.
- UI behavior: unsaved-change prompts on close/switch/replace, error toasts with actionable explanation, busy indicators for import/export, cancellable long tasks when feasible.

### 4.4 Keybindings (Cmd on macOS, Ctrl on Windows/Linux)

| Action | Shortcut |
|---|---|
| New Project | Mod+N |
| Open | Mod+O |
| Save | Mod+S |
| Save As | Mod+Shift+S |
| Undo / Redo | Mod+Z / Mod+Shift+Z |
| Copy / Cut / Paste | Mod+C / Mod+X / Mod+V |
| Duplicate | Mod+D |
| Delete Selection | Delete or Backspace (not while typing) |
| Select All | Mod+A (within canvas context) |
| Command Palette | Mod+K |
| Search Model | Mod+P |
| Fit Diagram | Shift+1 |
| Zoom In / Out | Mod++ / Mod+- |
| Reset Zoom | Mod+0 |
| Rename Selected | F2 or Enter |
| Cancel Tool / Modal | Esc |
| Hand Tool | Space held |
| Toggle Sidebar | Mod+B |
| Toggle Problems | Mod+J |

Key commands must not hijack keyboard input in textboxes, comboboxes or contenteditable editors.

## 5. Projects, file system, saving and recovery

### 5.1 Project structure and file format

- File suffix `.umls` containing human-readable, compact/versioned UTF-8 JSON. MIME suggestion `application/vnd.umlstudio.project+json`; app-specific association optional.
- Define `schemaVersion`, stable UUIDs, project metadata, semantic model objects, diagrams/views, app settings relevant to project, and creation/modification timestamps.
- Store **no ephemeral selection state** in semantic model. Persist viewport per diagram as optional view configuration.
- Format should round-trip with `stableStringify -> parse -> schemaValidate -> normalize -> stableStringify` without loss of recognized fields. Preserve unknown extension namespaced fields if safe.
- Each model element must have exactly one owner, except the single project root. Reference fields must point to existing IDs or a sentinel specified in schema. No duplicate IDs.
- Use `zod` (or equivalent) and explicit version migrations (`v1->v2`, etc.). Detect newer unsupported versions and offer read-only/error rather than silently destroying fields.

### 5.2 Persistence abstraction

`ProjectRepository` interface: `create`, `listRecent`, `open`, `save`, `saveAs`, `removeRecent`, `saveRecovery`, `listRecoveries`. Implement adapters:

- Browser: File System Access API when supported; otherwise file input/download and IndexedDB recovery snapshots. Never claim direct OS file writes when not possible.
- Desktop Tauri: native Open/Save dialogs, narrowly scoped filesystem permissions, safe read/write, optional native File -> Open from OS association. Use atomic temp-file write + rename where supported; maintain a backup or recovery copy before risky replace.
- Autosave: debounced recovery snapshot after semantic or diagram editing (~1000-2000ms idle), plus page visibility/close best effort; **do not** silently replace an external file if permissions are unavailable.
- Dirty state: based on document revision since last explicit save. Autosave of recovery does not clear dirty marker.
- Recents: last ~12 project paths in desktop, project IDs in browser; gracefully handle moved/deleted files.
- Recovery: on crash/reopen compare snapshot revision/timestamp to last explicit save and offer Restore / Discard / Inspect.

### 5.3 Import/export matrix

| Format | Import | Export | Notes |
|---|---:|---:|---|
| `.umls` native | CORE | CORE | Lossless, versioned |
| JSON snapshot | CORE | CORE | Equivalent schema, no fake format distinction |
| PNG | — | CORE | Full diagram bounds, HiDPI 1x/2x/4x, transparent/white |
| SVG | — | CORE | Vector, valid viewBox and markers, correct fonts |
| PDF | — | CORE | True diagram bounds/pages, landscape/A4/fit, not browser screenshot |
| JPEG | — | EXTENDED | Configurable quality, solid background |
| Mermaid | Subset (EXTENDED) | Subset (EXTENDED) | Diagram-specific, document limits |
| PlantUML | Subset (EXTENDED) | Subset (EXTENDED) | Generate textual UML safely; no Java server required |
| XMI 2.x | ADVANCED | ADVANCED | Only after reference/schema interop testing |
| StarUML `.mdj` | Best-effort ADVANCED | Experimental ADVANCED | **Never imply compatibility** unless tested |
| HTML documentation | — | EXTENDED | Index of diagrams, model objects and docs |
| TypeScript / Java / Python | AST or subset import (EXTENDED) | CORE skeleton codegen | Generated code clearly labeled skeletons |

### 5.4 `.mdj` import policy

Treat `.mdj` as **an external, version-sensitive interoperability module**. For import: read external JSON into untrusted adapter types, validate `$type`, `_id`, `_parent`, `ownedElements`, diagram/view references, known UML fields, translate to native schema, build a detailed import report with counts, warnings and unsupported constructs. Unknown model/view types should not crash; preserve raw source in sidecar only if safe, and do not pretend to render them. Validate using representative fixtures generated by the correct StarUML version. Export should be disabled until verified bi-directional fixtures open correctly in target StarUML version. Do not access or bundle proprietary software without user licensing.

## 6. Semantic domain model (single source of truth)

### 6.1 Principles

- IDs are opaque stable UUIDs, not labels and not React Flow node IDs generated ad hoc.
- Domain entities and relationships are typed discriminated unions. Use Zod schemas and inferred TypeScript types. Avoid unbounded `any`, loose field bags or ad hoc JSON access in the domain layer.
- A `ModelElement` may have **zero or many `DiagramView` references** across diagrams. A single diagram may show the same model element more than once if allowed by diagram rules, with unique view IDs.
- `Relationship` is a semantic model element with endpoint model IDs; `EdgeView` refers to the relationship and to the two local node-view IDs, preserving mapping across multiple diagrams.
- A containment tree and a reference graph coexist: owning a class in a package differs from a dependency between classes.
- The renderer converts an immutable model snapshot into a view graph; it must never mutate the semantic model directly.

### 6.2 Core interfaces (representative; extend per diagram)

```ts
type ID = string;
type UMLVisibility = 'public' | 'private' | 'protected' | 'package';
type DiagramKind =
  | 'class' | 'useCase' | 'sequence' | 'activity' | 'stateMachine'
  | 'package' | 'object' | 'component' | 'deployment'
  | 'compositeStructure' | 'communication' | 'timing'
  | 'interactionOverview' | 'profile' | 'informationFlow';

interface ProjectDocument {
  schemaVersion: number;
  id: ID;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  rootModelId: ID;
  modelElements: Record<ID, ModelElement>;
  diagrams: Record<ID, UMLDiagram>;
  settings: ProjectSettings;
}

interface UMLBase {
  id: ID;
  kind: string;                       // narrowed by discriminated union
  name: string;
  ownerId: ID | null;
  documentation?: string;
  stereotypeIds?: ID[];
  taggedValues?: Record<string, string | number | boolean>;
}

interface UMLClass extends UMLBase {
  kind: 'umlClass';
  isAbstract: boolean;
  isFinal?: boolean;
  attributes: UMLAttribute[];
  operations: UMLOperation[];
}

interface UMLAttribute {
  id: ID;
  name: string;
  type: string;
  typeElementId?: ID;
  visibility: UMLVisibility;
  multiplicity?: string;
  defaultValue?: string;
  isStatic?: boolean;
  isReadOnly?: boolean;
}

interface UMLOperation {
  id: ID;
  name: string;
  visibility: UMLVisibility;
  returnType: string;
  isStatic?: boolean;
  isAbstract?: boolean;
  parameters: UMLParameter[];
}

interface UMLParameter {
  id: ID;
  name: string;
  type: string;
  direction: 'in' | 'out' | 'inout' | 'return';
  defaultValue?: string;
}

interface UMLRelationship extends UMLBase {
  kind: 'association' | 'aggregation' | 'composition' | 'generalization'
      | 'realization' | 'dependency' | 'include' | 'extend' | 'transition'
      | 'controlFlow' | 'objectFlow' | 'message' | 'otherTypedRelationship';
  sourceElementId: ID;
  targetElementId: ID;
  sourceEnd?: UMLRelationEnd;
  targetEnd?: UMLRelationEnd;
  label?: string;
}

interface UMLRelationEnd {
  roleName?: string;
  multiplicity?: string;
  navigability?: 'unspecified' | 'navigable' | 'notNavigable';
  aggregation?: 'none' | 'shared' | 'composite';
}

interface UMLDiagram {
  id: ID;
  kind: DiagramKind;
  name: string;
  ownerId: ID;
  documentation?: string;
  views: Record<ID, DiagramView>;
  viewport?: { x: number; y: number; zoom: number };
  options: DiagramOptions;
}

interface NodeView {
  kind: 'nodeView';
  id: ID;
  modelElementId: ID;
  x: number; y: number; width: number; height: number;
  style: ViewStyle;
  collapsedCompartments?: string[];
}

interface EdgeView {
  kind: 'edgeView';
  id: ID;
  relationshipId: ID;
  sourceViewId: ID;
  targetViewId: ID;
  points?: Array<{ x: number; y: number }>;
  labels?: Record<string, { x: number; y: number }>;
  style: ViewStyle;
}

type DiagramView = NodeView | EdgeView | SequenceSpecializedView
  | ActivityPartitionView | StateRegionView;
```

This is a **reference shape**, not a license to store all UML elements as only generic `UMLBase`. Define dedicated, validated discriminated schemas for each shipped semantic kind, including sequence events and nested containers.

### 6.3 Sequence-specific model (independent from graph coordinates)

```ts
interface SequenceInteractionModel {
  id: ID;
  lifelineIds: ID[];
  messageIds: ID[];
  fragmentIds: ID[];
}
interface SequenceMessage {
  id: ID;
  sourceLifelineId: ID | null;
  targetLifelineId: ID | null;
  type: 'synchronous' | 'asynchronous' | 'reply'
      | 'create' | 'destroy' | 'self';
  label: string;
  sendY: number;
  receiveY: number;
  activationId?: ID;
}
interface SequenceFragment {
  id: ID;
  operator: 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'critical' | 'ref';
  x: number; y: number; width: number; height: number;
  operands: Array<{ id: ID; guard?: string; topY: number; bottomY: number }>;
}
```

Sequence messages are not arbitrary associations; maintain their own invariant checks and editor. Display geometry is computed via adapters; not all sequence concepts belong in the generic UMLRelationship union.

### 6.4 Ownership/reference operations

Required: `createElement`, `renameElement`, `updateProperties`, `moveElementToOwner`, `deleteViewOnly`, `deleteModelElementWithDependentCleanup`, `createRelationship`, `reconnectRelationship`, `attachExistingElementView`, `duplicateSubtree`, `addDiagram`, `deleteDiagram`, `renameDiagram`. Commands must be undoable and have validation/rollback. Deleting a model element must list affected diagrams/relationships and request confirmation. Deleting a view must leave the model intact.

## 7. Transactional command engine and history

Commands are structured objects with payload validation. Typical types:

- Project: `CREATE_PROJECT`, `ADD_DIAGRAM`, `RENAME_DIAGRAM`, `DELETE_DIAGRAM`, `CHANGE_PROJECT_SETTINGS`.
- Model: `ADD_ELEMENT`, `UPDATE_ELEMENT`, `RENAME_ELEMENT`, `MOVE_ELEMENT`, `DELETE_ELEMENT`, `ADD_ATTRIBUTE`, `EDIT_ATTRIBUTE`, `REORDER_MEMBERS`, `ADD_OPERATION`, `ADD_RELATIONSHIP`, `EDIT_RELATIONSHIP`, `DELETE_RELATIONSHIP`.
- View: `ADD_VIEW`, `REMOVE_VIEW`, `MOVE_VIEWS`, `RESIZE_VIEW`, `UPDATE_VIEW_STYLE`, `ADD_EDGE_VIEW`, `CHANGE_EDGE_ROUTE`, `GROUP_VIEWS`, `ALIGN_VIEWS`.
- Sequence: `ADD_LIFELINE`, `ADD_MESSAGE`, `MOVE_MESSAGE_TIME`, `ADD_ACTIVATION`, `ADD_FRAGMENT`, `REORDER_INTERACTION_EVENTS`.

Command contract:

```ts
interface EditorCommand<TPayload = unknown> {
  id: ID;
  type: string;
  payload: TPayload;
  timestamp: number;
  label: string;
}
interface CommandResult {
  nextDocument: ProjectDocument;
  affectedModelIds: ID[];
  affectedDiagramIds: ID[];
  warnings?: ValidationIssue[];
}
```

Run through `dispatch(command)` -> input validation -> compute immutable draft/patch -> semantic integrity checks -> commit once -> history transaction -> persistence schedule -> derived view update. Implement history with reversible patches (`immer` patches or explicit undo commands) capped by configurable count, batching multiple pointer-move updates into one completed drag command. Never put rapid hover, selection or zoom changes in model undo history unless specifically intended. Failure returns a structured error and keeps current document intact.

## 8. Modeling engine boundaries

- **Semantic core**: `project`, `elements`, `relationships`, `ownership`, `validation`, `commands`, `serialization`, `migrations`; no React imports.
- **Diagram adapters**: `project model + diagram -> render primitives`, hit testing, coordinate transforms, notation-specific geometry, bridge events back into semantic commands.
- **Graph editor**: React Flow for node/edge-based diagrams; custom SVG rendering and custom edges/handles; never use React Flow's `toObject()` as the only saved project format.
- **Sequence/timing editors**: dedicated SVG/React interaction timeline surface with deterministic Y ordering; shared viewport, select, property inspector, toolbox and command bus with graph editor.
- **Services**: imports/exports, code generation, layout, validation, project persistence.
- **UI shell**: Electron-like IDE layout without Electron; menu/toolbar/sidebar/panels/dialogs, keyboard shortcuts and settings.

## 9. Recommended technology stack and engineering rationale

| Concern | Technology | Decision |
|---|---|---|
| UI framework | React + TypeScript (strict) | Stable ecosystem, reusable typed components |
| Bundler | Vite | Desktop-friendly static frontend, fast HMR/build |
| Desktop packaging | Tauri v2 + Rust shell | Native dialogs/files, small application footprint; macOS first |
| Graph diagrams | `@xyflow/react` (React Flow) | Node/edge canvas, custom nodes/edges, zoom/pan/selection |
| Timeline diagrams | Custom SVG/React interaction editor | Sequence and timing require coordinate/time semantics |
| Styling | Tailwind CSS + CSS variables | Dense IDE theme, consistent spacing, dark/light |
| Components | shadcn/ui + Radix UI primitives + Lucide | Accessible panels, menus, dialogs, inspector controls |
| State management | Zustand with slices/selectors + Immer | Predictable project state and minimal rerenders |
| Data schemas | Zod | Runtime import validation and typed models |
| Browser persistence | Dexie + IndexedDB | Indexed durable autosave and recovery |
| Desktop files | Tauri dialog and fs plugins | Native Open/Save with restricted capabilities |
| Auto layout | ELK.js (and optional Dagre for simple graphs) | Deterministic orthogonal/graph layout where applicable |
| I18n | i18next / react-i18next | Complete English/French UI dictionaries |
| SVG/PNG | Custom SVG exporter + robust SVG rasterization | Independent, consistent vector output and embedded font fallback |
| PDF | jsPDF + svg2pdf.js (or equivalent proven vector pipeline) | Diagram bounds/page sizing and print-ready PDF |
| TS codegen | TS AST or structured printer | Escape names safely, generate syntactically valid stubs |
| Test runner | Vitest + Testing Library | Pure-model and component tests |
| End-to-end tests | Playwright | Real browser editor workflows, screenshots, export tests |
| Static QA | ESLint + Prettier + `tsc --noEmit` | Strict correctness gates |
| Package manager | pnpm + pinned lockfile | Deterministic development |

Use modern stable compatible package versions resolved at implementation time; do not blindly install incompatible major releases. Avoid React Flow Pro/commercial components, proprietary widgets, and paid icon assets. Do not add NestJS, Prisma, PostgreSQL, Redis, Next.js SSR or an API backend: no need for any of them in this product. Native desktop permission scoping is mandatory, not an optional polish item.

## 10. Physical project architecture

Prefer **one repository and one main frontend app** for the first autonomous run, rather than an overengineered microservice/monorepo. Module boundaries are still enforceable through folders and imports. Extract reusable packages later only if there is an actual consumer.

```text
uml-studio/
├── README.md
├── LICENSE                         # project-specific license decision
├── AGENTS.md                        # coding-agent architecture and quality rules
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml              # optional, not necessary for one frontend
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
├── playwright.config.ts
├── vitest.config.ts
├── index.html
├── .gitignore
├── .github/workflows/ci.yml
├── public/
│   ├── icons/
│   ├── templates/
│   └── fonts/                       # only redistributable fonts if bundled
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   ├── AppProviders.tsx
│   │   ├── AppErrorBoundary.tsx
│   │   ├── i18n.ts
│   │   ├── routes.tsx                # landing/workspace/preferences, no SSR
│   │   └── keyboardShortcuts.ts
│   ├── domain/                      # PURE TS: no React or browser APIs
│   │   ├── ids.ts
│   │   ├── constants.ts
│   │   ├── types/
│   │   │   ├── common.ts
│   │   │   ├── project.ts
│   │   │   ├── uml-elements.ts
│   │   │   ├── uml-relationships.ts
│   │   │   ├── uml-diagrams.ts
│   │   │   ├── views.ts
│   │   │   ├── interactions.ts
│   │   │   ├── activity.ts
│   │   │   └── states.ts
│   │   ├── schemas/
│   │   │   ├── project.schema.ts
│   │   │   ├── elements.schema.ts
│   │   │   ├── relationships.schema.ts
│   │   │   ├── diagrams.schema.ts
│   │   │   └── migrations/
│   │   ├── commands/
│   │   │   ├── command.types.ts
│   │   │   ├── commandBus.ts
│   │   │   ├── history.ts
│   │   │   ├── project.commands.ts
│   │   │   ├── model.commands.ts
│   │   │   ├── relationship.commands.ts
│   │   │   ├── view.commands.ts
│   │   │   └── sequence.commands.ts
│   │   ├── services/
│   │   │   ├── ownership.ts
│   │   │   ├── references.ts
│   │   │   ├── modelQueries.ts
│   │   │   ├── projectFactory.ts
│   │   │   ├── cloneAndRemap.ts
│   │   │   └── integrity.ts
│   │   └── validation/
│   │       ├── issue.ts
│   │       ├── validationEngine.ts
│   │       ├── genericRules.ts
│   │       ├── classRules.ts
│   │       ├── useCaseRules.ts
│   │       ├── sequenceRules.ts
│   │       ├── activityRules.ts
│   │       └── stateRules.ts
│   ├── diagrams/
│   │   ├── registry/
│   │   │   ├── diagramRegistry.ts
│   │   │   ├── elementRegistry.ts
│   │   │   ├── relationshipRegistry.ts
│   │   │   └── capabilities.ts
│   │   ├── shared/
│   │   │   ├── geometry.ts
│   │   │   ├── routing.ts
│   │   │   ├── svgPrimitives.ts
│   │   │   ├── coordinateTransform.ts
│   │   │   ├── selection.ts
│   │   │   └── viewModelAdapters.ts
│   │   ├── graph/
│   │   │   ├── GraphDiagramCanvas.tsx
│   │   │   ├── GraphInteractionController.tsx
│   │   │   ├── nodeTypes.ts
│   │   │   ├── edgeTypes.ts
│   │   │   ├── nodes/
│   │   │   │   ├── UMLClassNode.tsx
│   │   │   │   ├── UMLActorNode.tsx
│   │   │   │   ├── UMLUseCaseNode.tsx
│   │   │   │   ├── UMLActivityNode.tsx
│   │   │   │   ├── UMLStateNode.tsx
│   │   │   │   ├── UMLPackageNode.tsx
│   │   │   │   ├── UMLComponentNode.tsx
│   │   │   │   └── ...
│   │   │   └── edges/
│   │   │       ├── AssociationEdge.tsx
│   │   │       ├── GeneralizationEdge.tsx
│   │   │       ├── UMLFlowEdge.tsx
│   │   │       ├── UMLDependencyEdge.tsx
│   │   │       └── ...
│   │   ├── sequence/
│   │   │   ├── SequenceCanvas.tsx
│   │   │   ├── SequenceInteractionController.ts
│   │   │   ├── LifelineView.tsx
│   │   │   ├── MessageView.tsx
│   │   │   ├── ActivationView.tsx
│   │   │   ├── CombinedFragmentView.tsx
│   │   │   └── sequenceGeometry.ts
│   │   ├── class/
│   │   ├── use-case/
│   │   ├── activity/
│   │   ├── state-machine/
│   │   ├── package/
│   │   ├── object/
│   │   ├── component/
│   │   ├── deployment/
│   │   ├── profile/
│   │   ├── communication/
│   │   ├── timing/
│   │   └── interaction-overview/
│   ├── features/
│   │   ├── workspace/
│   │   │   ├── WorkspaceShell.tsx
│   │   │   ├── DiagramTabs.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   └── WorkspaceStore.ts
│   │   ├── project-explorer/
│   │   │   ├── ProjectExplorer.tsx
│   │   │   ├── ExplorerTreeNode.tsx
│   │   │   └── ExplorerContextMenu.tsx
│   │   ├── toolbox/
│   │   │   ├── DiagramToolbox.tsx
│   │   │   └── ToolPaletteSection.tsx
│   │   ├── inspector/
│   │   │   ├── PropertiesInspector.tsx
│   │   │   ├── ElementProperties.tsx
│   │   │   ├── RelationshipProperties.tsx
│   │   │   ├── AttributeEditor.tsx
│   │   │   ├── OperationEditor.tsx
│   │   │   └── StyleInspector.tsx
│   │   ├── problems/
│   │   │   ├── ProblemsPanel.tsx
│   │   │   └── ProblemItem.tsx
│   │   ├── commands/
│   │   │   ├── CommandPalette.tsx
│   │   │   └── commandRegistry.ts
│   │   ├── projects/
│   │   │   ├── ProjectManager.tsx
│   │   │   ├── CreateProjectDialog.tsx
│   │   │   ├── RecoveryDialog.tsx
│   │   │   ├── TemplatesGallery.tsx
│   │   │   └── UnsavedChangesDialog.tsx
│   │   ├── exports/
│   │   │   ├── ExportDialog.tsx
│   │   │   └── ExportProgress.tsx
│   │   ├── settings/
│   │   │   └── SettingsDialog.tsx
│   │   └── help/
│   │       ├── ShortcutsDialog.tsx
│   │       └── GettingStarted.tsx
│   ├── services/
│   │   ├── persistence/
│   │   │   ├── ProjectRepository.ts
│   │   │   ├── BrowserProjectRepository.ts
│   │   │   ├── TauriProjectRepository.ts
│   │   │   ├── RecoveryRepository.ts
│   │   │   └── migrations.ts
│   │   ├── export/
│   │   │   ├── ExportService.ts
│   │   │   ├── svgRenderer.ts
│   │   │   ├── pngExporter.ts
│   │   │   ├── pdfExporter.ts
│   │   │   ├── htmlExporter.ts
│   │   │   └── text/
│   │   ├── import/
│   │   │   ├── NativeImporter.ts
│   │   │   ├── StarUMLMdjImporter.ts
│   │   │   ├── MermaidImporter.ts
│   │   │   └── ImportReport.ts
│   │   ├── codegen/
│   │   │   ├── CodegenService.ts
│   │   │   ├── typescript.ts
│   │   │   ├── java.ts
│   │   │   └── python.ts
│   │   ├── layout/
│   │   │   ├── LayoutService.ts
│   │   │   └── elkAdapter.ts
│   │   └── platform/
│   │       ├── PlatformAdapter.ts
│   │       ├── browser.ts
│   │       ├── tauri.ts
│   │       └── detectPlatform.ts
│   ├── stores/
│   │   ├── documentStore.ts          # authoritative document + revision
│   │   ├── editorStore.ts            # ephemeral selection, mode, tabs
│   │   ├── settingsStore.ts
│   │   └── selectors.ts
│   ├── components/
│   │   ├── ui/                       # accessible shared UI primitives
│   │   ├── ErrorState.tsx
│   │   ├── EmptyState.tsx
│   │   └── ConfirmDialog.tsx
│   ├── hooks/
│   ├── lib/
│   ├── styles/
│   │   ├── globals.css
│   │   ├── tokens.css
│   │   └── diagram.css
│   └── locales/
│       ├── en.json
│       └── fr.json
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/
│   └── src/
│       ├── main.rs
│       └── lib.rs
├── tests/
│   ├── fixtures/
│   │   ├── native/
│   │   ├── mdj/                      # user-created/legal test fixtures
│   │   └── broken/
│   ├── domain/
│   ├── diagrams/
│   ├── exporters/
│   ├── migrations/
│   └── e2e/
│       ├── project-lifecycle.spec.ts
│       ├── class-diagram.spec.ts
│       ├── use-case.spec.ts
│       ├── sequence.spec.ts
│       ├── activity.spec.ts
│       ├── state-machine.spec.ts
│       ├── cross-diagram-reuse.spec.ts
│       ├── export.spec.ts
│       └── shortcuts.spec.ts
└── docs/
    ├── ARCHITECTURE.md
    ├── DATA_MODEL.md
    ├── COMMANDS.md
    ├── DIAGRAM_CAPABILITIES.md
    ├── IMPORT_EXPORT.md
    ├── USER_GUIDE.md
    ├── TEST_REPORT.md
    ├── KNOWN_LIMITATIONS.md
    └── IMPLEMENTATION_REPORT.md
```

Files in `...` are illustrative per-diagram expansion. Agent should make directories and files as needed, but **must not generate hundreds of empty placeholder files**. Prefer a smaller maintained structure with real behavior over literal replication of this complete aspirational tree.

### 10.1 Dependency direction (enforced)

```text
          UI Shell / Feature Panels / Editor Surfaces
                      |         |
                      v         v
             Application Services / Stores
                 |        |        |
                 v        v        v
           Diagram Adapters  Command Bus  Import/Export
                 |        |        |
                 +--------+--------+
                          v
                PURE DOMAIN / SCHEMAS
                          ^
                          |
             Persisted Project Document

Tauri/BROWSER ADAPTERS ---> SERVICES (interfaces) ---> DOMAIN
```

Rules:

- `src/domain/**` cannot import from React, DOM, Tauri, React Flow, localStorage, `window`, CSS or UI components.
- All native filesystem access resides in `services/platform` and `services/persistence` adapters.
- Canvas components may dispatch semantic commands; they cannot rewrite `document.modelElements` directly.
- UI tabs/selection/hover may live in an ephemeral state slice; semantics and persisted diagram views live in the project document.
- Diagram plugins register palette nodes, valid edges, renderer, inspector metadata, export support and validation rules with the registry. No 15-way switch spaghetti inside the root `App.tsx`.
- Use clear imports and avoid circular dependencies; a module dependency cycle check in CI is a bonus.

## 11. Diagram registry/capability-driven design

```ts
interface DiagramPlugin {
  kind: DiagramKind;
  displayNameKey: string;
  category: 'structural' | 'behavioral' | 'interaction';
  status: 'complete' | 'partial' | 'planned';
  supportedElements: string[];
  supportedRelationships: string[];
  createDefaultDiagram(): UMLDiagram;
  validate(doc: ProjectDocument, diagramId: ID): ValidationIssue[];
  renderMode: 'graph' | 'sequenceTimeline' | 'timingTimeline';
  // palette, inspector forms, render adapters, export and context rules
}
```

Registration validates uniqueness and compatibility. New Diagram dialog groups by structural/behavioral/interaction and shows true capability statuses. Only mark a diagram `complete` if create/edit/save/load/export E2E passes. Add `supports` capabilities (`autoLayout`, `customEdgeRouting`, `semantics`, `exportSvg`, `codegen`, etc.) to disable irrelevant toolbar actions. Export must use the same notation adapter as canvas where practical; verify visual parity with screenshot tests.

## 12. Validation, modeling correctness and diagnostics

All validation issues have stable `code`, `severity: error|warning|info`, `messageKey`, `elementId`, optional `diagramId`, and an optional `quickFixCommand`. Run cheap incremental validation after commands and full validation on demand/export.

**Required generic rules:**

- Root element exists; one owner per model element; no owner cycles; names not blank for UML elements requiring names.
- Every relationship endpoint references an extant compatible element kind.
- Every edge view references existing relationship and matching node views in same diagram.
- Every diagram view references a model element, or is explicitly typed as a presentation-only annotation.
- Unique IDs across document; valid geometry finite and non-NaN; width/height positive and reasonable.
- Unknown schema version and malformed files never mutate current open project.

**Class rules:** valid multiplicity grammar, no self-generalization, no inheritance cycle (graph traversal), no duplicate attribute IDs or parameter IDs, abstract operation warnings in concrete class when relevant, invalid relationship endpoint kind diagnostics.

**Use-case rules:** include/extend endpoints are use cases, actors cannot be targets of include/extend, generalization compatible end kinds.

**Sequence rules:** message lifelines exist, `sendY` and `receiveY` numeric/nonnegative, arrows oriented per message type, fragments nonnegative bounds, fragment operand ranges ordered/nonoverlapping where required, destroy semantics must not silently allow subsequent messages after destruction without new creation.

**Activity rules:** decision/merge flows valid shape, fork/join degree warnings, missing initial/final state informational warnings, transition guards valid as arbitrary text (do not pretend OCL parser exists).

**State machine rules:** transition endpoints exist, state containment no cycle, initial pseudo-state has appropriate outgoing transition, impossible multiple initial outgoing warnings, reachable state analysis where possible.

**UX:** clicking a problem selects the element/view, opens relevant diagram, centers/fits the element, and gives a useful explanation. Export can proceed with nonfatal warnings; offer a validation report.

## 13. Code engineering and text-based diagram interchange

### 13.1 Source generation — CORE for class skeletons

Given the semantic Class model, generate one code file per class/interface/enum for:

- **TypeScript:** `export class`, `interface`, `enum`, typed fields, access modifiers (where legal), constructor stubs (optional), methods with parameter names/types and throwing `new Error('Not implemented')` or explicit safe placeholders; avoid falsely assuming composition implies owning constructors.
- **Java:** package statements mapped from UML package tree, class/interface/enum, visibility, `extends`, `implements`, method signatures, types mapped using configuration. Never emit syntactically invalid code for reserved identifiers; sanitize with warnings.
- **Python 3:** classes, inheritance, `Enum`, dataclass option, type annotations, methods with `raise NotImplementedError`, sensible instance attributes, optional packages. Preserve documentation with docstrings where safe.

Generate class skeletons, not a working backend. Code must compile/parse for supported fixtures. Show preview and destination select, collision policy (rename/overwrite/cancel), generation report. Deterministic output and no execution of generated code.

### 13.2 Reverse engineering — EXTENDED

Parse selected TypeScript files using TypeScript compiler AST, extracting classes/interfaces/enums, modifiers, attributes, methods, constructors, imports, `extends`/`implements`. Support import project preview with conflict resolution and explicit mapping; cannot execute arbitrary user source. Java/Python import is future unless a robust parser and tests exist.

### 13.3 Text diagram formats — EXTENDED

- Mermaid exporter: class diagram, sequence diagram, state machine and flow-like activity subset with escape rules. Import via a constrained verified parser only; do not use `eval`.
- PlantUML exporter: class, use case, sequence, activity and state subsets. Do not promise perfect rendering of all stereotypes, guards or nested constructs.
- Export textual diagram into copy/download UI, label unsupported features and lost information.

## 14. Asset generation, rendering and export correctness

- Build an **SVG serializer** from semantic diagram views and shared render primitives, not a screenshot-only exporter. Represent actors/stick figures, UML arrows/diamonds, component glyphs, dashed lifelines, class compartments and text labels with actual vector primitives.
- Prevent CSS leakage: vector export should include explicit colors/fonts/line widths; preserve white or transparent background; convert icon glyphs to SVG paths or safely embedded vector assets, not external network fonts.
- Determine diagram content bounds from nodes, labels, annotations and edge waypoints plus margin. Prevent clipping at extremities.
- Handle text wrapping, escaping (`&`, `<`, `>`), multiline documentation labels and non-ASCII characters; test accented French names and Arabic labels at least for preservation (font availability dependent).
- PNG: rasterize SVG at requested scale with image dimension safeguards, preserve aspect ratio, file readable by Preview.
- PDF: choose A4/A3/Letter/custom, orientation, fit-to-page or tiled pages, vector where practical, include optional heading and page number. Distinguish vector export from raster fallback where unsupported.
- HTML docs: optional static index + one SVG per diagram + model element metadata, cross-link names using IDs; sanitize HTML.
- No external URLs, service dependencies, CDN or calls to render UML.

## 15. Templates, examples and student onboarding

Ship **real editable model/diagram fixtures**, not screenshots:

1. Blank UML Project.
2. Library Management (Class): Book, Author, Member, Loan, Librarian with attributes, operations and cardinalities.
3. E-Commerce Domain (Class): Customer, Order, OrderItem, Product, Payment with composition/generalization.
4. University Enrollment (Use Case): Student, Instructor, Administrator, course registration and include/extend.
5. Login Authentication (Sequence): User, UI, AuthService, Database with sync calls, return, alt valid/invalid.
6. Order Checkout (Sequence): User, Cart, PaymentGateway, OrderService with `alt` success/failure and activation.
7. Loan Request (Activity): decision, approval, rejection, partitions and guards.
8. Ticket Lifecycle (State Machine): new, assigned, in progress, resolved, closed with transition labels.
9. Microservices Architecture (Component) when extended editor is complete.
10. Cloud Deployment (Deployment) when extended editor is complete.

Template gallery shows concise explanations and previews; selecting one deep-clones all IDs to prevent collisions. Provide in-product quick start, shortcut cheatsheet, contextual empty states. Translation strings exist for all exposed buttons/errors.

## 16. Performance, reliability and non-functional requirements

| Category | Target / acceptance |
|---|---|
| Offline | Entire CORE editor works with network disabled; no internet resources required |
| Load time | Aim under ~3 seconds startup on a modern laptop for an empty project after install, subject to actual measurements |
| Interaction | Target responsive dragging/zooming around 100 nodes / 200 edges, profile large diagrams, keep rerenders minimal |
| Scale | Target opening/saving a 500-element project without crashes or data loss; optimize viewport rendering if needed |
| Autosave | Recovery snapshot within 2 seconds of idle editing; no corruption on abrupt kill in tested scenarios |
| Persistence | Native file round-trip preserves model IDs, relationship IDs, diagram views, geometry, docs and styles |
| Data migration | Old schema sample loads and migrates; unsupported future schema does not overwrite user file |
| Memory | Unmount hidden tab editors when appropriate while preserving their state; clean event listeners and observers |
| Errors | Error boundary with recovery controls; no swallowed exceptions, infinite loops or unhandled rejection storms |
| A11y | Keyboard accessible major actions, labeled form inputs, usable contrast, descriptive icon buttons |
| Local privacy | No analytics, cookies, background telemetry, upload or auth |
| Security | Treat project files, code imports and labels as untrusted input; no HTML injection/eval/unsafe path traversal |
| Portability | Browser version works without native APIs; desktop adds enhanced file dialogs/paths |
| Upgrade | Persisted schema version and migration chain; known incompatible versions surfaced clearly |
| Languages | Complete EN/FR UI for shipped features; no partial machine-translated dummy strings |

Performance figures are **targets to benchmark**, not a license to claim verified timings without measurement. Virtualize tree lists and use Zustand selectors rather than rerendering every node on each input change.

## 17. Security and permissions

- Tauri capability file uses least privilege: native dialogs and read/write only to explicitly user-selected files or app data/recovery directories, with relevant permission scopes. No whole disk/home recursive access by default.
- No shell execution, subprocess bridge, dynamically fetched JavaScript, unrestricted HTTP calls, embedded terminal or arbitrary script evaluation.
- SVG import/export and HTML documentation escape untrusted model labels; no `dangerouslySetInnerHTML` for user content.
- Import max-file-size guard (configurable e.g. 25MB), JSON parse errors handled, duplicate IDs rejected, referential integrity checked, recursive depth/graph cycle checks guarded against denial of service.
- Export file paths are OS picker outputs only; resolve path inside native adapter, no string-interpolated shell commands.
- Files saved with temp-write/rename where feasible; if not feasible provide backup and explicit error handling.
- Document every third-party dependency license and provide a list in `THIRD_PARTY_NOTICES.md` as appropriate.

## 18. Tests, CI and exact acceptance scenarios

### 18.1 Test pyramid

- **Domain unit tests:** factories, ID uniqueness, ownership, view/model distinction, relationship endpoint types, multiplicity parser, serialization, migrations, commands, undo/redo, cross-diagram synchronization, deletion cleanup, cloning and remapping.
- **Diagram adapter tests:** class compartments, relationship markers and directions, use-case arrow labels, sequence event Y ordering, fragment geometry, activity lane containment, state transitions.
- **Service tests:** JSON import/export, malformed documents, SVG XML validity, PNG/PDF file signatures, type generator snapshots, browser save recovery, simulated file failures.
- **Component tests:** class editor forms, attribute/operation editors, inspector updates, keyboard handling during text editing, confirmation modals, menu disabled state.
- **E2E Playwright:** create project, add/edit/connect, save, reload, undo/redo, multi-view rename, delete view vs model, export, switch diagrams, palette drag/drop, screenshots.
- **Manual macOS Tauri checklist:** native dialogs, shortcuts, open file, Save/Save As, missing file behavior, unsigned build instructions, window close and recovery.

### 18.2 Critical E2E tests (must exist)

**E2E-001 Full class round trip**
1. Start blank project, create class diagram.
2. Add `Person`, `Student`, `Course` classes via palette.
3. Add `Person.name: string`, `Student.studentId: string`; add `Student.enroll(course: Course): void`.
4. Connect `Student -> Person` generalization, `Student - Course` association with multiplicity `0..*` and `1..*`.
5. Export SVG and check classes/labels/arrow marker; Save project as `.umls`, reopen it, compare semantic and view model snapshot.
6. Undo two steps, redo two, verify restored identifiers/geometry.

**E2E-002 Shared semantic entity**
1. Create one `Customer` semantic class and two class diagrams.
2. Drag `Customer` from explorer into each diagram (creates two views of one semantic ID).
3. Rename in inspector; assert both diagrams update.
4. Delete a view from diagram A; assert diagram B and explorer class still exist.
5. Delete model from explorer with confirmation; assert all views and relationships cleaned.

**E2E-003 Use case relationships**
1. Place Actor `Student`, Use Cases `Enroll`, `Authenticate`, system boundary `University`.
2. Create association Student/Enroll; `Enroll <<include>> Authenticate` and confirm label plus arrow target.
3. Save/reopen and export PNG.

**E2E-004 Sequence lifecycle**
1. Add `User`, `Frontend`, `API` lifelines.
2. Add sync request Frontend->API, reply API->Frontend, self-call API->API, alt fragment with guards.
3. Drag one message down, assert updated event Y and ordering, resize fragment, save/reopen.
4. SVG and PNG preserve lifeline heads, dashed vertical lines, arrows and fragment bounds.

**E2E-005 Activity**
1. Add initial, action, decision, two actions, merge, final and two swimlanes.
2. Connect guarded outgoing flows, move one action between lanes.
3. Assert flow endpoints follow shape, lane assignment persists, save/reopen/export.

**E2E-006 State machine**
1. Add initial -> Draft -> Published -> Archived -> final.
2. Set `publish [approved] / notifySubscribers` on transition.
3. Rename state; validate no dead references, reopen and export.

**E2E-007 Recovery**
1. Edit document, trigger debounced recovery without explicit file save.
2. Simulate relaunch, assert Restore prompt, restore and compare semantic snapshot.
3. Confirm dirty marker remains until file save.

**E2E-008 Malformed input**
1. Attempt to open corrupted JSON, wrong schemaVersion, duplicate IDs and dangling references.
2. App displays actionable error/report and leaves current project intact.

**E2E-009 Keyboard**
1. Keyboard-shortcut create/edit/delete/undo/redo and menus work.
2. Type text in field containing `a`, `+`, `-`, `Delete`, `Ctrl+A` without canvas stealing keystrokes.

**E2E-010 export robustness**
1. Export diagram containing accents, `<`, `&`, long labels, dashed edge and diamond marker.
2. Assert SVG parses and renders, PNG has nonzero dimensions and PDF begins `%PDF-` and is readable.

### 18.3 CI gates

GitHub Actions (Ubuntu) executes install, format check, typecheck, lint, unit tests, e2e (with Playwright browsers) and frontend build. Add macOS Tauri build smoke workflow if budget/toolchain permit. Fail CI on genuine error; don't disable rules or skip tests to fake a pass.

## 19. Incremental implementation plan — for ONE AUTONOMOUS AGENT RUN

**Checkpoint 0 — Plan and skeleton:** Confirm stack, create Vite/Tauri project, UI tokens, routes, sample shell, foundational project types, scripts, CI scaffold. `pnpm dev`, `pnpm typecheck` pass.

**Checkpoint 1 — Domain invariants:** Model/schema discriminated unions; commands; history; model/view distinction; JSON serialization and migrations; unit tests. Do this before advanced canvas editing.

**Checkpoint 2 — Desktop workspace and file lifecycle:** Shell, tabs, explorer, inspector, toolbar, palette, keyboard commands, new project, browser/Tauri save-open, dirty states, autosave and recovery. Do not postpone saving to the end.

**Checkpoint 3 — Class diagram production slice:** Real class rendering, attributes/methods, semantic relation edges, multiplicities, endpoint arrows/diamonds, reparenting and multi-view, geometry editing. Implement end-to-end test and close all regressions.

**Checkpoint 4 — Use Case production slice:** Actor/use case/boundary, include/extend, relationship validation and export; tests.

**Checkpoint 5 — Sequence production slice:** Independent timeline renderer with lifelines, message Y positions, fragments and activations; verify move, edit, persistence and export; tests.

**Checkpoint 6 — Activity + State Machine slices:** Containers/swimlanes/flows; states/transition labels; tests.

**Checkpoint 7 — Cross-cutting production quality:** SVG/PNG/PDF exporters, validation problems panel, language/theme support, templates, keyboard, robust errors; run whole suite.

**Checkpoint 8 — Expanded UML types:** Package/Object/Component/Deployment and other families **only after first five editors pass acceptance**. For remaining types, implement honestly or mark planned. No generic-shape superficial checkboxing.

**Checkpoint 9 — Code engineering and interop:** TS/Java/Python skeleton generation, Mermaid/PlantUML subsets, `.mdj` importer proof-of-concept with fixture tests. These must never destabilize project saving.

**Checkpoint 10 — Release audit:** Reinstall from clean repo, run checks, capture screenshots, test actual projects, verify no dead controls, document capability status, compile Tauri if environment allows. Produce implementation report (what was tested vs not tested), known limitations, and runnable commands.

### 19.1 Agent priority and token-budget rule

- If long-run budget or context prevents full scope: **deliver and fully test Checkpoints 0–7 first**, then extend coverage. Never replace advanced semantic features with cosmetic diagrams silently.
- Do not stop because code has compiled once; inspect UX flows and run E2E. Fix failures yourself.
- Do not over-scope a single component to thousands of lines; separate model logic, renderers and controls.
- At each checkpoint, emit a short status in agent's own running log and commit if git available; avoid asking the user to continue between checkpoints.
- Before final answer, write `docs/IMPLEMENTATION_REPORT.md` with a strict matrix of complete/partial/planned by diagram/feature, evidence/test references, local instructions, current limitations and unresolved blockers.

## 20. Definition of complete versus partial — no fake features

A diagram type is **complete (for its documented scope)** only if its semantic elements exist, canvas tools create/edit/resize/move/delete valid nodes/edges, inspector edits properties, relationships render correct UML arrows/labels, undo/redo works, native save/load retains all information, SVG/PNG export works and E2E passes. A diagram that merely contains a shape palette or empty canvas is **partial/planned**. A format is supported only after a tested importer/exporter with round-trip fixtures; file extension alone isn't compatibility.

All advertised tools must provide error states for invalid selections or unsupported operations, not silent no-ops. All tests must be real; no skipped broken assertions or runtime bypass. Acceptance evidence is more valuable than claims.

## 21. UX-specific details and edge cases

### 21.1 Model Explorer consistency

- Explorer shows semantic ownership tree, sorted by user order or name, diagrams under owning model/package. An element can exist in tree even if not currently shown in any diagram.
- Rename semantics updates every view and search index. Drag existing element onto active diagram must not clone semantics.
- Delete dialog specifically offers `Remove from this diagram` versus `Delete from model (affects N diagrams and M relationships)`; default safest action.
- Support recursive package delete with explicit affected-object count and undo, no orphaned children.
- Breadcrumb shows current project/model/diagram. Search finds name, type, description and stereotype; highlight result/target.

### 21.2 Properties Inspector

- Semantics tab fields with inline schema validation and clear save/commit-on-blur rules. Edits commit as one undoable transaction per field editing session, not keystroke-by-keystroke spam.
- View tab geometry: X/Y, width/height, fill, stroke, font size, text alignment, style variants, compartment visibility.
- Relationship inspector endpoints, end roles, multiplicities, navigability, aggregation/composition; edge styling separate.
- Class attributes/operations editable in grid with add/remove/reorder actions; return type and method visibility explicitly shown.
- Invalid edits do not partially update model; show field error and preserve previous valid model until corrected.

### 21.3 Editor states and recovery

- On blank workspace, show New/Open/Recent/Templates rather than a fake dashboard.
- Loading: progress and cancellation where possible; corrupt project error with Retry/Close, not a blank UI.
- Empty diagram: ghost hints for palette drag, not decorative demo objects.
- Dirty tabs marked subtly; Save status displayed; recovery notice only when recoverable snapshot exists.
- If browser lacks File System Access API, use upload/download and explain that OS overwrite isn't supported.
- Tauri app detects platform at runtime using supported APIs, not user-agent-based guesswork for native methods.

### 21.4 Geometry and notation edge cases

- Selection and edge connection to self supported for semantic relation types where legal.
- Resize class node clamps minimum width to title/member text, preserving compartment layout.
- Multiplicity and role labels at *both ends* never overlay arrow tips at default position; labels drag and persist.
- On node rename/attribute edit changing measured bounds, adjacent edges reroute without disappearing.
- On view deletion, diagram-only edges may disappear; semantic relation may remain if represented elsewhere, according to explicit policy.
- Multiple open tabs for diagrams from same model receive updates immediately via reactive selectors.
- Exported SVG includes a unique marker definition namespace to avoid collision between multiple diagrams.
- Import unknown diagram types gives actionable report, not invalid fake replacement.

## 22. Output package expected from coding agent

The agent must deliver:

1. Working source code, not a screenshot-only site.
2. `README.md`: requirements, installation, dev/test/build/native packaging, keyboard shortcuts and troubleshooting macOS.
3. `docs/ARCHITECTURE.md`: module boundaries, flow of command -> domain -> adapters -> persistence, ADR for graph vs timeline editors.
4. `docs/DATA_MODEL.md`: complete schema and format versions, import/export guarantees, data migration design.
5. `docs/DIAGRAM_CAPABILITIES.md`: per-diagram verified elements, relationships, editor features, status.
6. `docs/USER_GUIDE.md`: class, use case, sequence, activity and state student tutorials with screenshots/steps.
7. `docs/TEST_REPORT.md`: commands executed, passing/failing totals, any environment limitations.
8. `docs/KNOWN_LIMITATIONS.md`: honest missing advanced features and compatibility caveats.
9. `docs/IMPLEMENTATION_REPORT.md`: checkpoint completion and prioritized follow-up backlog.
10. Automated unit/component/E2E tests and at least five real editable example projects.

### 22.1 Runnable commands

```bash
pnpm install
pnpm dev             # web-first app on localhost
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm tauri dev       # desktop development, Rust + native prerequisites required
pnpm tauri build     # macOS app/DMG with correct Tauri target prerequisites
```

Any custom scripts differing from these names must be explained in README. App remains usable in browser without Rust; native features show capability-aware fallbacks.

## 23. Go/No-Go criteria

**GO for university use** only if native/native-like project save and reopen, correct Class / Use Case / Sequence / Activity / State diagrams, PDF/PNG exports, no crashes during normal editing, and at least the ten critical E2E acceptance flows work for implemented cases. An all-green UI without preservation or proper UML semantics is a **NO-GO**.

**GO for public release** requires broader testing, responsible licensing, security review, signed/distributed installers where applicable, UX polish, accessibility and clear interoperability limits. A working student tool is not the same claim as a complete StarUML replacement.

## 24. Verified references / architectural inspiration (do not copy proprietary assets)

- Official StarUML feature overview (diagram families): https://staruml.io/
- StarUML model vs. diagram concept: https://docs.staruml.io/v6/user-guide/basic-concepts
- Historical StarUML modeling element catalog: https://staruml.readthedocs.io/en/latest/modeling-with-uml/modeling-with-uml.html
- React Flow custom nodes and APIs: https://reactflow.dev/learn/customization/custom-nodes
- Tauri v2 frontend recommendation and static hosting limitations: https://v2.tauri.app/start/frontend/
- Tauri native dialogs and filesystem capabilities: https://v2.tauri.app/plugin/dialog/ and https://v2.tauri.app/plugin/file-system/
- Eclipse GLSP architectural separation (conceptual reference only; do not install a server): https://eclipse.dev/glsp/documentation/overview/

**End of implementation specification.**
