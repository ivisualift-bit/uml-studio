import type { MessageKey } from '@/i18n';
import { isMac } from '@/services/platform/platform';
import { selectIsDirty, useDocumentStore } from '@/stores/documentStore';
import { activeSelection, useEditorStore } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { DIAGRAM_KIND_INFO } from '@/domain/model/metadata';
import { isEditable } from '@/diagrams/registry/catalog';
import * as actions from './actions';

export interface Shortcut {
  key?: string;
  code?: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface AppCommand {
  id: string;
  labelKey: MessageKey;
  shortcuts?: Shortcut[];
  /** Run even while focus is in a text field (only for non-text-editing commands like Save). */
  allowInInput?: boolean;
  enabled?: () => boolean;
  checked?: () => boolean;
  run: () => unknown;
}

const hasDoc = () => !!useDocumentStore.getState().doc;
const activeDiagram = () => {
  const { doc } = useDocumentStore.getState();
  const id = useEditorStore.getState().activeDiagramId;
  return id ? doc?.diagrams[id] : undefined;
};
const hasDiagram = () => !!activeDiagram();
const editableDiagram = () => {
  const d = activeDiagram();
  return !!d && isEditable(d.kind);
};
const isGraph = () => {
  const d = activeDiagram();
  return !!d && DIAGRAM_KIND_INFO[d.kind].renderMode === 'graph';
};
const selectionCount = () => activeSelection(useEditorStore.getState()).length;
const hasSelection = () => selectionCount() > 0;
const hasClassifier = () => actions.selectedClassifierId() !== null;
const settings = () => useSettingsStore.getState();
const editor = () => useEditorStore.getState();

export const COMMANDS: AppCommand[] = [
  // File
  { id: 'file.new', labelKey: 'cmd.newProject', shortcuts: [{ key: 'n', mod: true }], run: () => editor().openDialog({ type: 'newProject' }) },
  { id: 'file.templates', labelKey: 'cmd.templates', run: () => editor().openDialog({ type: 'templates' }) },
  { id: 'file.open', labelKey: 'cmd.openProject', shortcuts: [{ key: 'o', mod: true }], allowInInput: true, run: actions.openProject },
  { id: 'file.save', labelKey: 'cmd.save', shortcuts: [{ key: 's', mod: true }], allowInInput: true, enabled: hasDoc, run: actions.saveProject },
  { id: 'file.saveAs', labelKey: 'cmd.saveAs', shortcuts: [{ key: 's', mod: true, shift: true }], allowInInput: true, enabled: hasDoc, run: actions.saveProjectAs },
  { id: 'file.export', labelKey: 'cmd.exportImage', shortcuts: [{ key: 'e', mod: true, shift: true }], enabled: editableDiagram, run: () => {
    const d = activeDiagram();
    if (d) editor().openDialog({ type: 'export', diagramId: d.id });
  } },
  { id: 'file.exportText', labelKey: 'cmd.exportText', enabled: editableDiagram, run: () => {
    const d = activeDiagram();
    if (d) editor().openDialog({ type: 'textExport', diagramId: d.id });
  } },
  { id: 'file.codegen', labelKey: 'cmd.generateCode', enabled: hasDoc, run: () => editor().openDialog({ type: 'codegen' }) },
  { id: 'file.close', labelKey: 'cmd.closeProject', enabled: hasDoc, run: actions.closeProject },
  // Edit
  { id: 'edit.undo', labelKey: 'cmd.undo', shortcuts: [{ key: 'z', mod: true }], enabled: () => useDocumentStore.getState().history.past.length > 0, run: actions.undo },
  {
    id: 'edit.redo',
    labelKey: 'cmd.redo',
    shortcuts: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }],
    enabled: () => useDocumentStore.getState().history.future.length > 0,
    run: actions.redo,
  },
  { id: 'edit.cut', labelKey: 'cmd.cut', shortcuts: [{ key: 'x', mod: true }], enabled: hasSelection, run: () => {
    if (actions.copySelectionToClipboard()) actions.requestDeleteFromModel();
  } },
  { id: 'edit.copy', labelKey: 'cmd.copy', shortcuts: [{ key: 'c', mod: true }], enabled: hasSelection, run: () => void actions.copySelectionToClipboard() },
  { id: 'edit.paste', labelKey: 'cmd.paste', shortcuts: [{ key: 'v', mod: true }], enabled: () => editableDiagram() && !!editor().clipboard, run: actions.pasteClipboard },
  { id: 'edit.duplicate', labelKey: 'cmd.duplicate', shortcuts: [{ key: 'd', mod: true }], enabled: hasSelection, run: actions.duplicateSelection },
  { id: 'edit.delete', labelKey: 'cmd.delete', shortcuts: [{ key: 'Delete' }, { key: 'Backspace' }], enabled: hasSelection, run: actions.removeSelectionFromDiagram },
  {
    id: 'edit.deleteFromModel',
    labelKey: 'cmd.deleteFromModel',
    shortcuts: [{ key: 'Delete', mod: true }, { key: 'Backspace', mod: true }],
    enabled: () => hasSelection() || (editor().inspectorSource === 'explorer' && !!editor().explorerSelection),
    run: () => actions.requestDeleteFromModel(),
  },
  { id: 'edit.selectAll', labelKey: 'cmd.selectAll', shortcuts: [{ key: 'a', mod: true }], enabled: hasDiagram, run: actions.selectAll },
  { id: 'edit.rename', labelKey: 'cmd.rename', shortcuts: [{ key: 'F2' }, { key: 'Enter' }], enabled: () => selectionCount() === 1, run: actions.renameSelection },
  // View
  { id: 'view.palette', labelKey: 'cmd.commandPalette', shortcuts: [{ key: 'k', mod: true }], allowInInput: true, run: () => editor().openDialog({ type: 'commandPalette' }) },
  { id: 'view.search', labelKey: 'cmd.searchModel', shortcuts: [{ key: 'p', mod: true }], allowInInput: true, enabled: hasDoc, run: () => editor().openDialog({ type: 'quickSearch' }) },
  { id: 'view.zoomIn', labelKey: 'cmd.zoomIn', shortcuts: [{ key: '=', mod: true }, { key: '+', mod: true }], enabled: hasDiagram, run: actions.zoomIn },
  { id: 'view.zoomOut', labelKey: 'cmd.zoomOut', shortcuts: [{ key: '-', mod: true }], enabled: hasDiagram, run: actions.zoomOut },
  { id: 'view.resetZoom', labelKey: 'cmd.resetZoom', shortcuts: [{ code: 'Digit0', mod: true }, { code: 'Numpad0', mod: true }], enabled: hasDiagram, run: actions.resetZoom },
  { id: 'view.fit', labelKey: 'cmd.fitDiagram', shortcuts: [{ code: 'Digit1', shift: true }], enabled: hasDiagram, run: actions.fitDiagram },
  { id: 'view.sidebar', labelKey: 'cmd.toggleSidebar', shortcuts: [{ key: 'b', mod: true }], checked: () => editor().sidebarVisible, run: () => editor().togglePanel('sidebar') },
  { id: 'view.inspector', labelKey: 'cmd.toggleInspector', shortcuts: [{ key: 'i', mod: true, alt: true }], checked: () => editor().inspectorVisible, run: () => editor().togglePanel('inspector') },
  { id: 'view.problems', labelKey: 'cmd.toggleProblems', shortcuts: [{ key: 'j', mod: true }], checked: () => editor().bottomVisible, run: () => editor().togglePanel('bottom') },
  { id: 'view.grid', labelKey: 'cmd.toggleGrid', checked: () => settings().showGrid, run: () => settings().update({ showGrid: !settings().showGrid }) },
  { id: 'view.snap', labelKey: 'cmd.toggleSnap', checked: () => settings().snapToGrid, run: () => settings().update({ snapToGrid: !settings().snapToGrid }) },
  { id: 'view.minimap', labelKey: 'cmd.toggleMinimap', checked: () => settings().showMinimap, run: () => settings().update({ showMinimap: !settings().showMinimap }) },
  { id: 'view.themeSystem', labelKey: 'cmd.themeSystem', checked: () => settings().theme === 'system', run: () => actions.toggleTheme('system') },
  { id: 'view.themeLight', labelKey: 'cmd.themeLight', checked: () => settings().theme === 'light', run: () => actions.toggleTheme('light') },
  { id: 'view.themeDark', labelKey: 'cmd.themeDark', checked: () => settings().theme === 'dark', run: () => actions.toggleTheme('dark') },
  // Tools
  { id: 'tool.select', labelKey: 'cmd.toolSelect', shortcuts: [{ key: 'v' }], enabled: hasDiagram, run: () => editor().setTool({ kind: 'select' }) },
  { id: 'tool.hand', labelKey: 'cmd.toolHand', shortcuts: [{ key: 'h' }], enabled: hasDiagram, run: () => editor().setTool({ kind: 'hand' }) },
  { id: 'tools.validate', labelKey: 'cmd.validate', enabled: hasDoc, run: actions.validateNow },
  { id: 'tools.settings', labelKey: 'cmd.settings', shortcuts: [{ key: ',', mod: true }], run: () => editor().openDialog({ type: 'settings' }) },
  // Diagram
  { id: 'diagram.new', labelKey: 'cmd.newDiagram', enabled: hasDoc, run: () => editor().openDialog({ type: 'newDiagram' }) },
  { id: 'diagram.rename', labelKey: 'cmd.renameDiagram', enabled: hasDiagram, run: () => {
    const d = activeDiagram();
    if (d) editor().openDialog({ type: 'renameDiagram', diagramId: d.id });
  } },
  { id: 'diagram.delete', labelKey: 'cmd.deleteDiagram', enabled: hasDiagram, run: () => {
    const d = activeDiagram();
    if (d) editor().openDialog({ type: 'deleteDiagram', diagramId: d.id });
  } },
  { id: 'arrange.alignLeft', labelKey: 'cmd.alignLeft', enabled: () => isGraph() && selectionCount() > 1, run: () => actions.alignSelection('left') },
  { id: 'arrange.alignCenter', labelKey: 'cmd.alignCenter', enabled: () => isGraph() && selectionCount() > 1, run: () => actions.alignSelection('center') },
  { id: 'arrange.alignRight', labelKey: 'cmd.alignRight', enabled: () => isGraph() && selectionCount() > 1, run: () => actions.alignSelection('right') },
  { id: 'arrange.alignTop', labelKey: 'cmd.alignTop', enabled: () => isGraph() && selectionCount() > 1, run: () => actions.alignSelection('top') },
  { id: 'arrange.alignMiddle', labelKey: 'cmd.alignMiddle', enabled: () => isGraph() && selectionCount() > 1, run: () => actions.alignSelection('middle') },
  { id: 'arrange.alignBottom', labelKey: 'cmd.alignBottom', enabled: () => isGraph() && selectionCount() > 1, run: () => actions.alignSelection('bottom') },
  { id: 'arrange.distributeH', labelKey: 'cmd.distributeHorizontally', enabled: () => isGraph() && selectionCount() > 2, run: () => actions.alignSelection('distributeH') },
  { id: 'arrange.distributeV', labelKey: 'cmd.distributeVertically', enabled: () => isGraph() && selectionCount() > 2, run: () => actions.alignSelection('distributeV') },
  { id: 'arrange.front', labelKey: 'cmd.bringToFront', enabled: () => isGraph() && hasSelection(), run: () => actions.reorderSelection('front') },
  { id: 'arrange.back', labelKey: 'cmd.sendToBack', enabled: () => isGraph() && hasSelection(), run: () => actions.reorderSelection('back') },
  { id: 'arrange.straight', labelKey: 'cmd.routingStraight', enabled: () => isGraph() && hasSelection(), run: () => actions.setRoutingForSelection('straight') },
  { id: 'arrange.orthogonal', labelKey: 'cmd.routingOrthogonal', enabled: () => isGraph() && hasSelection(), run: () => actions.setRoutingForSelection('orthogonal') },
  // Model
  { id: 'model.addAttribute', labelKey: 'cmd.addAttribute', enabled: hasClassifier, run: () => void actions.addMember('attributes') },
  { id: 'model.addOperation', labelKey: 'cmd.addOperation', enabled: hasClassifier, run: () => void actions.addMember('operations') },
  { id: 'model.addLiteral', labelKey: 'cmd.addLiteral', enabled: () => {
    const id = actions.selectedClassifierId();
    return !!id && useDocumentStore.getState().doc?.modelElements[id]?.kind === 'enumeration';
  }, run: () => void actions.addMember('literals') },
  // Window / Help
  { id: 'window.nextTab', labelKey: 'cmd.nextTab', shortcuts: [{ key: ']', mod: true, shift: true }], enabled: () => editor().tabs.length > 1, run: () => cycleTab(1) },
  { id: 'window.previousTab', labelKey: 'cmd.previousTab', shortcuts: [{ key: '[', mod: true, shift: true }], enabled: () => editor().tabs.length > 1, run: () => cycleTab(-1) },
  { id: 'window.closeTab', labelKey: 'cmd.closeTab', enabled: hasDiagram, run: () => {
    const id = editor().activeDiagramId;
    if (id) editor().closeTab(id);
  } },
  { id: 'help.shortcuts', labelKey: 'cmd.shortcuts', shortcuts: [{ key: '/', mod: true }], run: () => editor().openDialog({ type: 'shortcuts' }) },
  { id: 'help.gettingStarted', labelKey: 'cmd.gettingStarted', run: () => editor().openDialog({ type: 'gettingStarted' }) },
  { id: 'help.about', labelKey: 'cmd.about', run: () => editor().openDialog({ type: 'about' }) },
];

function cycleTab(delta: number): void {
  const { tabs, activeDiagramId, setActive } = editor();
  if (!tabs.length) return;
  const index = Math.max(0, tabs.indexOf(activeDiagramId ?? ''));
  setActive(tabs[(index + delta + tabs.length) % tabs.length]!);
}

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));
export function command(id: string): AppCommand {
  const cmd = BY_ID.get(id);
  if (!cmd) throw new Error(`Unknown command ${id}`);
  return cmd;
}

export function isEnabled(cmd: AppCommand): boolean {
  return cmd.enabled ? cmd.enabled() : true;
}

export function runCommand(id: string): void {
  const cmd = command(id);
  if (isEnabled(cmd)) void cmd.run();
}

export function formatShortcut(s: Shortcut): string {
  const mac = isMac();
  const parts: string[] = [];
  if (s.mod) parts.push(mac ? '⌘' : 'Ctrl');
  if (s.alt) parts.push(mac ? '⌥' : 'Alt');
  if (s.shift) parts.push(mac ? '⇧' : 'Shift');
  const keyName = s.code ? s.code.replace(/^Digit|^Numpad/, '') : s.key ?? '';
  const pretty: Record<string, string> = { Delete: mac ? '⌦' : 'Del', Backspace: mac ? '⌫' : 'Backspace', Enter: '↵', Escape: 'Esc', '=': '+' };
  parts.push(pretty[keyName] ?? (keyName.length === 1 ? keyName.toUpperCase() : keyName));
  return mac ? parts.join('') : parts.join('+');
}

export function primaryShortcut(id: string): string | undefined {
  const s = BY_ID.get(id)?.shortcuts?.[0];
  return s ? formatShortcut(s) : undefined;
}

function matches(s: Shortcut, e: KeyboardEvent): boolean {
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (!!s.mod !== mod) return false;
  if (!!s.alt !== e.altKey) return false;
  if (s.code) return e.code === s.code && !!s.shift === e.shiftKey;
  if (!s.key) return false;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key !== s.key) return false;
  // Shifted punctuation (e.g. "+") already implies shift.
  return s.key.length === 1 && !/[a-z0-9]/.test(s.key) ? true : !!s.shift === e.shiftKey;
}

/** True for any element where keystrokes belong to text editing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type);
  }
  return target.closest('[role="combobox"],[role="listbox"],[role="menu"],[role="menubar"]') !== null;
}

/** Global keyboard dispatcher. Returns true when the event was handled. */
export function handleGlobalKeyDown(e: KeyboardEvent): boolean {
  const typing = isTypingTarget(e.target);
  const state = editor();
  if (state.dialog) return false; // dialogs own the keyboard (focus trapped)
  if (e.key === 'Escape' && !typing) {
    if (state.editing) state.setEditing(null);
    else if (state.tool.kind !== 'select') state.setTool({ kind: 'select' });
    else if (state.activeDiagramId) state.setSelection(state.activeDiagramId, []);
    return true;
  }
  for (const cmd of COMMANDS) {
    if (!cmd.shortcuts?.some((s) => matches(s, e))) continue;
    if (typing && !cmd.allowInInput) return false;
    // Unmodified keys (letters, Enter, Delete…) belong to a focused control — a button, tab or tree
    // item — unless that control is inside the canvas. The explorer handles its own keys.
    const unmodified = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (unmodified && e.target instanceof HTMLElement && !e.target.closest('[data-canvas]')) {
      if (e.target.closest('button,a,[role="button"],[role="tab"],[role="treeitem"],[role="tree"],[role="option"],[role="menuitem"]')) return false;
    }
    if (e.target instanceof HTMLElement && e.target.closest('[role="tree"]') && (cmd.id === 'edit.delete' || cmd.id === 'edit.deleteFromModel')) return false;
    e.preventDefault();
    if (typing && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (isEnabled(cmd)) void cmd.run();
    return true;
  }
  return false;
}

export function dirtyGuard(e: BeforeUnloadEvent): void {
  if (selectIsDirty(useDocumentStore.getState())) {
    e.preventDefault();
    // Legacy browsers require returnValue to be set.
    e.returnValue = '';
  }
}
