# Data model and `.umls` file format

The Zod schemas in `src/domain/schemas/` are the authoritative definition. This document summarizes
them. If the two disagree, the code wins, so please file the mismatch as a documentation bug.

## File envelope

A project is one UTF-8 JSON document. The usual extension is `.umls` and the MIME type is
`application/vnd.umlstudio.project+json`.

```jsonc
{
  "format": "uml-studio-project",      // fixed marker; anything else is rejected as "not a project"
  "schemaVersion": 1,                  // integer; see "Versions and migrations"
  "id": "…",                           // project ID
  "name": "Library Management",
  "description": "",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "rootModelId": "…",                  // the single element of kind "model" with ownerId null
  "modelElements": { "<id>": { "kind": "class", "id": "<id>", … } },
  "diagrams": { "<id>": { "kind": "class", "id": "<id>", "ownerId": "…", "views": { … } } },
  "settings": { "defaultAttributeVisibility": "private", "defaultOperationVisibility": "public", "gridSize": 10 },
  "extensions": { "vendor.tool:key": <any JSON> }
}
```

- **Identifiers** are 1–128 characters from `[A-Za-z0-9_-]`. The app generates UUIDs, and templates use
  readable deterministic IDs. Element, view, diagram and member (attribute, operation, parameter,
  literal…) IDs are unique across the whole document. Record keys must equal the object's `id`.
- **Serialization is canonical.** The document is normalized through the schema (stable key order,
  every default written out) and printed as 2-space JSON with a trailing newline. Saving the same
  document twice gives identical bytes, which keeps diffs and version control clean.
- **Unknown fields are dropped** on load. Only `extensions` is kept verbatim. Its keys must look like
  `namespace:key` (`^[a-z0-9.-]+:[A-Za-z0-9._-]+$`) and its values can be any JSON. A unit test covers
  both behaviours.
- **Diagram view order is z-order**: later entries in `views` draw on top.

## Semantic elements (`modelElements`)

Every element has `id`, `kind`, `name`, `ownerId` (null only for the root model), `documentation`,
`stereotype` (free-text keyword), `appliedStereotypes` (profile stereotypes with tagged values) and
`taggedValues`.

| Family | Kinds and notable fields |
| --- | --- |
| Packaging | `model`, `package` (visibility), `profile` |
| Classifiers | `class` (isActive), `interface`, `enumeration` (`literals`), `dataType`, `primitiveType`, `signal`, `component`. All share `isAbstract`, `isLeaf`, `visibility`, `attributes[]`, `operations[]`. |
| Structure | `instanceSpecification` (`classifierId`, `slots[]`), `artifact` (fileName), `port`, `part` (aggregation), `collaboration`, `node` (`nodeKind`: node / device / executionEnvironment) |
| Profiles and flows | `stereotype` (`tagDefinitions[]`), `metaclass`, `informationItem` |
| Use cases | `actor`, `useCase` (`extensionPoints[]`), `subject` |
| Activities | `activity`, `action` (`actionKind`, `partitionId`), `controlNode` (`nodeKind`: initial, activityFinal, flowFinal, decision, merge, fork, join), `objectNode` (type, `partitionId`), `activityPartition` |
| State machines | `stateMachine`, `state` (entry / doActivity / exit), `pseudostate` (`pseudoKind`), `finalState` |
| Interactions | `interaction`, `lifeline` (type, headStyle), `message` (`sourceLifelineId` / `targetLifelineId`, either may be null for found or lost messages, `sort`, `arguments`, `guard`), `combinedFragment` (`operator`, `operands[]`), `activation` (`lifelineId`) |

**Relationships** (18 kinds) add `sourceId` and `targetId`. `association`, `link` and
`communicationPath` also carry `sourceEnd` / `targetEnd` with name, multiplicity, navigability,
aggregation, visibility, isOrdered and isUnique. The diamond of an aggregation or composition sits on
the end whose `aggregation` is set, which the UML Studio creators always make the source (the whole).

| Kind | Allowed endpoints (source → target) |
| --- | --- |
| `association` | classifiers, actor, use case, node, artifact (self allowed) |
| `generalization` | same-kind pairs of classifiers, actors, use cases, nodes, stereotypes, artifacts |
| `realization` | class / component / enumeration / data type / node / artifact → interface / class / component |
| `dependency` | any packageable element, port or part |
| `include`, `extend` | use case → use case (`extend` has `condition` and `extensionPointIds` of the target) |
| `packageImport`, `packageMerge` | model / package / profile pairs |
| `controlFlow`, `objectFlow` | action / control node / object node (never into an initial node or out of a final) |
| `transition` | state or pseudostate → state, pseudostate or final state (`trigger`, `guard`, `effect`, never into an initial pseudostate) |
| `link` | instance specification pairs (optional `associationId`) |
| `connector` | part, port, lifeline, component, class, interface (`connectorKind`: basic / assembly / delegation, numbered `messages[]` for communication diagrams) |
| `deployment` | artifact / component → node |
| `manifestation` | artifact → classifier or artifact |
| `communicationPath` | node → node |
| `extension` | stereotype → metaclass (`isRequired`) |
| `informationFlow` | classifiers, actor, node, artifact, use case, part, information item (`conveyedIds`) |

**Ownership** (`ownerId`) forms a tree rooted at the model. Packages own packageable elements.
Classes own ports and parts. Components own ports, parts, nested components, classes, interfaces and
artifacts. Nodes own nodes and artifacts. Behaviors own their own elements (interaction → lifelines,
messages, fragments, activations; activity → actions, control and object nodes, partitions; state
machine and composite state → states and pseudostates). A relationship is owned by its source element.
The full table is `OWNERSHIP` in `src/domain/model/metadata.ts`.

## Diagrams and views

A diagram has `kind` (one of 15), `name`, `ownerId` (a package-like element, or its behavior for
sequence / activity / state machine diagrams), `documentation`, `views`, a saved `viewport` and
`options` (showVisibility, showAttributeTypes, showOperationSignatures, showMessageNumbers,
defaultRouting).

| View kind | Used in | Geometry | References |
| --- | --- | --- | --- |
| `node` | graph diagrams | x, y, width, height (absolute) | `elementId`, `containerViewId`, `hiddenCompartments`, `variant` (e.g. lollipop interface, boxed actor), `style` |
| `edge` | graph diagrams | `waypoints[]`, `routing` (straight / orthogonal), `labelOffsets` | `elementId` (a relationship) and `sourceViewId` / `targetViewId`, which must show that relationship's ends |
| `note` | all diagrams | x, y, width, height | `text` (presentation only, not semantic) |
| `noteLink` | graph diagrams | `waypoints[]` | from a note to any view |
| `lifeline` | sequence | x (centre), y, width, headHeight | `elementId` |
| `message` | sequence | `sendY`, `receiveY`, `labelOffset` | `elementId`, `sourceViewId` / `targetViewId` (lifeline views; null for found or lost) |
| `activation` | sequence | `startY`, `endY` | `elementId`, `lifelineViewId` |
| `fragment` | sequence | x, y, width, height, `operandYs` (divider per operand after the first) | `elementId` |

**Containment** (`containerViewId`) is visual, but it has explicit semantic effects that depend on the
container (`containmentEffect` in `metadata.ts`). Dropping a class into a package view moves its
ownership. Dropping an action into a swimlane sets `partitionId`. A state inside a composite state
becomes its substate. Use-case boundaries (`subject`) are visual only.

Numeric limits: coordinates within ±1,000,000, sizes within 1–100,000, names and short texts at most
1,000 characters, documentation at most 100,000 characters. Colors are `#rrggbb`.

## Load pipeline (all files are untrusted)

`parseProjectText` in `src/domain/serialization/projectFile.ts` never throws and never touches the
open project:

1. **Size**: at most 25 MB (UTF-8 bytes).
2. **Structure scan** before `JSON.parse`: rejects duplicate keys in any object (they could hide
   duplicate IDs) and nesting deeper than 128.
3. **JSON.parse**, then the `format` marker check.
4. **Version**: a `schemaVersion` above the current one is rejected with "saved by a newer version".
   Older versions run through the migration chain.
5. **Zod** validation of the whole document. Errors are reported with their path, e.g.
   `modelElements.x.attributes.0.visibility`.
6. **Integrity**: one root, legal owners and no ownership cycles, no dangling references, edge views
   agree with their relationship, timeline views reference the right lifelines, IDs are unique across
   all records.

Each failure has its own code and message (`loadError.*` in the i18n files). The current project is
left untouched.

## Versions and migrations

- `CURRENT_SCHEMA_VERSION = 1`. No migrations exist yet.
- A migration is `{ from: n, to: n + 1, migrate(raw) }` and works on raw JSON *before* schema
  validation. `migrateToCurrent` applies the chain in order and reports which steps ran. Gaps or
  versions newer than the app are refused. Unit tests cover chains, gaps and newer versions with
  injected migrations.
- When the schema changes, bump the version, add a migration, and add a fixture of the old format to
  the tests.

## Recovery snapshots

While a project has unsaved changes, the serialized document is written to IndexedDB
(`uml-studio` database) 1.5 s after the last edit, keyed by project ID. On startup, snapshots are
offered for restore. A restored snapshot goes through the full load pipeline and stays dirty. Saving,
closing or discarding deletes the snapshot.

## Import and export guarantees

| Operation | Guarantee | Evidence |
| --- | --- | --- |
| Save → open `.umls` | Lossless: IDs, geometry, waypoints, label offsets, viewports, options, extensions | unit round-trip tests; E2E-001…006 compare snapshots after reopen |
| JSON snapshot export | Same canonical document as `.umls` | shares `serializeProject` |
| SVG / PNG / PDF | Presentation only, not re-importable | E2E-010 / 010b |
| Mermaid / PlantUML | Lossy subset. The dialog lists what was left out. | unit + E2E |
| StarUML `.mdj` import | **Experimental, lossy, unverified against real StarUML files.** It produces a new project that passes the same schema and integrity checks. | `tests/services/mdjImport.test.ts`, `tests/e2e/mdj-import.spec.ts` (hand-written fixtures) |

Format-specific limits are listed in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
