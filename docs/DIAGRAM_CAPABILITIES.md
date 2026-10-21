# Diagram capabilities

Each diagram's status comes from `DIAGRAM_CATALOG` in `src/diagrams/registry/catalog.ts` and has to
match the evidence listed here.

- **Complete**: semantic elements, toolbox tools that create, move, resize, rename and delete, an
  inspector, correct UML notation, undo/redo, lossless save/reopen, SVG/PNG/PDF export, validation
  rules, and a dedicated E2E acceptance test.
- **Partial**: creating, editing, save/reopen and export all work, and one E2E smoke test covers
  them. The notation is a subset and there are few or no diagram-specific validation rules.
- **Planned**: listed in New Diagram but cannot be created (the button is disabled).

Features shared by every graph diagram: notes and note links, bend points, draggable labels,
endpoint reconnection, straight or orthogonal routing, align/distribute, z-order, copy/paste,
dragging elements in from the explorer (same element, new view), view vs model delete, styles
(fill, stroke, text color, font size, line width), and generic validation (names, duplicates,
illegal endpoints).

## Complete

| Diagram | Elements | Relationships | Specific features | Evidence |
| --- | --- | --- | --- | --- |
| Class | class, abstract class, interface, enumeration, data type, primitive type, signal, package | association, directed association, aggregation, composition, generalization, realization, dependency, «use» | Attributes and operations edited inline or in a grid, with UML text syntax, typed references, multiplicities, role names, navigability, hidden compartments, display options. Rules: inheritance and composition cycles, invalid multiplicity, abstract operation in a concrete class, duplicate attributes. Codegen in TS/Java/Python. Mermaid and PlantUML export. | E2E-001, E2E-002; `commands`, `render`, `validation`, `codegen` unit tests |
| Use Case | actor, use case (extension points), system boundary, package | association, include, extend (condition, extension points), generalization, dependency | Boundary is a visual container only. Rules: use case without actor, actor–actor association, include cycle. PlantUML export. | E2E-003 |
| Sequence | lifeline, actor lifeline, activation, 8 combined-fragment operators with operands and guards | synchronous, asynchronous, reply, self, create, destroy, found, lost messages | Timeline engine (not graph edges): ordered by Y, drag to reorder, activations, create/destroy semantics, resizable fragments, draggable operand dividers, optional message numbers. Rules: message after destroy, create after messages, operand order, activation range. Mermaid and PlantUML export. | E2E-004; `containment-sequence`, `render` unit tests |
| Activity | action, call behavior, send signal, accept event, accept time event, object node, swimlane, initial, activity final, flow final, decision, merge, fork, join | control flow, object flow (guards) | Swimlanes set partition membership on drop or move. Rules: missing initial or final node, decision guards, fork/join/merge degree, unconnected nodes. Mermaid and PlantUML export. | E2E-005 |
| State Machine | state, composite state, initial, final, choice, junction, fork, join, shallow and deep history, entry and exit points, terminate | transition (`trigger [guard] / effect`) | Nesting moves ownership into composite states. entry/do/exit. Rules: initial state, unreachable states, trigger on an initial transition. Mermaid and PlantUML export. | E2E-006 |

## Partial

| Diagram | What works | What's missing | Evidence |
| --- | --- | --- | --- |
| Package | packages, classes, interfaces, components. Dropping into a package changes ownership. «import» / «merge», dependency, generalization. | No merge semantics. No package-specific rules. | E2E smoke `package diagram` |
| Object | instance specifications typed by a class, slots from that class's attributes, links | Slot values are free text. A single rule (link vs classifier). | E2E smoke `object diagram` |
| Component | components, interfaces (box or lollipop), ports owned by their component, artifacts. Assembly (ball-and-socket), delegation, connector, realization, «use». | A required interface is shown as «use», not as a standalone socket. No component rules. | E2E smoke `component diagram` |
| Deployment | node, device, execution environment (nested), artifact, component, communication path, «deploy», «manifest» | No deployment specifications. No rules. | E2E smoke `deployment diagram` |
| Composite Structure | structured class with parts and ports, collaboration, connectors | No multiplicity on parts or collaboration-use bindings | E2E smoke `composite structure` |
| Communication | lifelines, links (connectors) carrying numbered messages | Numbers are entered by hand. Not linked to a sequence diagram. | E2E smoke `communication diagram` |
| Profile | profile, stereotype (tag definitions), metaclass, extension. Applied stereotypes render on elements. | Tagged-value editing is basic. No profile import/export. | E2E smoke `profile diagram` |
| Information Flow | information items, «flow» with conveyed items between classifiers | Only the basics | E2E smoke `information flow diagram` |

## Planned

**Timing** and **Interaction Overview** diagrams are listed but disabled in New Diagram. No editor
exists for them.
