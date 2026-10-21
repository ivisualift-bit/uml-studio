# Commands and shortcuts

Menus, the toolbar, the command palette (`Mod+K`) and keyboard shortcuts all run the same commands.
They are defined once in `src/app/commands.ts`, and the table below was generated from that registry.
`Mod` is ⌘ on macOS and Ctrl on Windows and Linux. A command that does not apply right now (e.g.
*Export Diagram* with no diagram open) is shown disabled, not hidden. While you type in a text field,
only Open, Save, Save As, the command palette and model search react to their shortcuts. Everything else
leaves your keystrokes alone.

| Group | Command | Shortcut | ID |
| --- | --- | --- | --- |
| file | New Project | `Mod+N` | `file.new` |
| file | New from Template |  | `file.templates` |
| file | Open | `Mod+O` | `file.open` |
| file | Import StarUML .mdj (experimental) |  | `file.importMdj` |
| file | Save | `Mod+S` | `file.save` |
| file | Save As | `Mod+Shift+S` | `file.saveAs` |
| file | Export Diagram | `Mod+Shift+E` | `file.export` |
| file | Export as Mermaid / PlantUML |  | `file.exportText` |
| file | Generate Code |  | `file.codegen` |
| file | Close Project |  | `file.close` |
| edit | Undo | `Mod+Z` | `edit.undo` |
| edit | Redo | `Mod+Shift+Z`, `Mod+Y` | `edit.redo` |
| edit | Cut | `Mod+X` | `edit.cut` |
| edit | Copy | `Mod+C` | `edit.copy` |
| edit | Paste | `Mod+V` | `edit.paste` |
| edit | Duplicate | `Mod+D` | `edit.duplicate` |
| edit | Remove from Diagram | `Delete`, `Backspace` | `edit.delete` |
| edit | Delete from Model | `Mod+Delete`, `Mod+Backspace` | `edit.deleteFromModel` |
| edit | Select All | `Mod+A` | `edit.selectAll` |
| edit | Rename | `F2`, `Enter` | `edit.rename` |
| view | Command Palette | `Mod+K` | `view.palette` |
| view | Search Model | `Mod+P` | `view.search` |
| view | Zoom In | `Mod+=`, `Mod++` | `view.zoomIn` |
| view | Zoom Out | `Mod+-` | `view.zoomOut` |
| view | Actual Size | `Mod+0` (main row or numpad) | `view.resetZoom` |
| view | Fit Diagram | `Shift+1` | `view.fit` |
| view | Toggle Sidebar | `Mod+B` | `view.sidebar` |
| view | Toggle Inspector | `Mod+Alt+I` | `view.inspector` |
| view | Toggle Problems Panel | `Mod+J` | `view.problems` |
| view | Show Grid |  | `view.grid` |
| view | Snap to Grid |  | `view.snap` |
| view | Show Minimap |  | `view.minimap` |
| view | Theme: System |  | `view.themeSystem` |
| view | Theme: Light |  | `view.themeLight` |
| view | Theme: Dark |  | `view.themeDark` |
| tool | Select Tool | `V` | `tool.select` |
| tool | Hand Tool | `H` | `tool.hand` |
| tools | Validate Model |  | `tools.validate` |
| tools | Settings | `Mod+,` | `tools.settings` |
| diagram | New Diagram |  | `diagram.new` |
| diagram | Rename Diagram |  | `diagram.rename` |
| diagram | Delete Diagram |  | `diagram.delete` |
| arrange | Align Left |  | `arrange.alignLeft` |
| arrange | Align Centers |  | `arrange.alignCenter` |
| arrange | Align Right |  | `arrange.alignRight` |
| arrange | Align Top |  | `arrange.alignTop` |
| arrange | Align Middles |  | `arrange.alignMiddle` |
| arrange | Align Bottom |  | `arrange.alignBottom` |
| arrange | Distribute Horizontally |  | `arrange.distributeH` |
| arrange | Distribute Vertically |  | `arrange.distributeV` |
| arrange | Bring to Front |  | `arrange.front` |
| arrange | Send to Back |  | `arrange.back` |
| arrange | Edge routing: Straight |  | `arrange.straight` |
| arrange | Edge routing: Orthogonal |  | `arrange.orthogonal` |
| model | Add Attribute |  | `model.addAttribute` |
| model | Add Operation |  | `model.addOperation` |
| model | Add Literal |  | `model.addLiteral` |
| window | Next Tab | `Mod+Shift+]` | `window.nextTab` |
| window | Previous Tab | `Mod+Shift+[` | `window.previousTab` |
| window | Close Tab |  | `window.closeTab` |
| help | Keyboard Shortcuts | `Mod+/` | `help.shortcuts` |
| help | Getting Started |  | `help.gettingStarted` |
| help | About UML Studio |  | `help.about` |

## Canvas interactions

| Gesture | Graph diagrams (class, use case, activity, state…) | Sequence diagrams |
| --- | --- | --- |
| Create an element | Pick a toolbox tool, then click the canvas, or drag the tool onto the canvas. The name editor opens straight away. | Lifeline tools: click where the lifeline should go. |
| Create a relationship | Pick a relationship tool, click the source, then the target. Illegal pairs are refused with a message. `Esc` cancels. | Message tools: press on the sender lifeline and drag to the receiver, or click the sender then the receiver. Self, found and lost messages take a single click on the lifeline that sends or receives them. |
| Fragments / activations | — | Pick a fragment tool (alt, opt, loop, par, break, critical, neg, ref) and drag a rectangle. The activation tool is dragged along a lifeline. |
| Rename | Double-click, `F2` or `Enter`. `Enter` commits, `Esc` cancels. In notes, `Mod+Enter` commits and `Enter` adds a line. | Same |
| Members | Select a class and use **+ attr** / **+ op()** under it, or the Inspector. Text syntax: `- name: Type [0..1] = default`, `+ op(p: T): R`. | — |
| Move | Drag. Arrow keys nudge 1 px, `Shift`+arrow nudges one grid step. A nudging session undoes as one step. | Drag messages up or down to change their order in time. Drag lifelines sideways. |
| Edges | Drag the midpoint handle to add a bend, drag a bend to move it, double-click a bend to remove it. Drag end labels (roles, multiplicities). Drag an endpoint to reconnect. | Drag operand dividers. Drag the fragment corner to resize. |
| Reuse an element | Drag it from the Model Explorer onto a diagram. This adds a view of the same element, not a copy. | Same |
| Pan / zoom | Hold `Space` and drag, use the Hand tool (`H`) or drag with the middle button. The wheel zooms. | Hold `Space` or use the Hand tool. The wheel scrolls, and `Mod`+wheel zooms. |
| Context menu | Right-click a node, edge or the canvas. | Right-click |
