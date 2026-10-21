import { create } from 'zustand';
import type { ID } from '@/domain/schemas/common';
import type { DiagramKind, Viewport } from '@/domain/schemas/project';
import type { ClipboardPayload } from '@/domain/services/cloneAndRemap';
import type { LoadError } from '@/domain/serialization/projectFile';
import type { MemberCollectionKey } from '@/diagrams/render/nodeShapes';
import type { EdgeLabelKey } from '@/domain/schemas/views';

/** Ephemeral editor state — never persisted in the project document. */

export type Tool =
  | { kind: 'select' }
  | { kind: 'hand' }
  | { kind: 'place'; toolId: string; sticky?: boolean }
  | { kind: 'connect'; toolId: string; sticky?: boolean };

export type EditTarget =
  | { type: 'name' }
  | { type: 'member'; collection: MemberCollectionKey | 'operands'; memberId: ID }
  | { type: 'label'; key: EdgeLabelKey };

export interface InlineEdit {
  diagramId: ID;
  viewId: ID;
  target: EditTarget;
}

export interface RecoverySnapshotInfo {
  projectId: ID;
  projectName: string;
  savedAt: number;
  elementCount: number;
  diagramCount: number;
}

export type DialogState =
  | { type: 'newProject' }
  | { type: 'templates' }
  | { type: 'newDiagram'; ownerId?: ID; kind?: DiagramKind }
  | { type: 'deleteFromModel'; elementIds: ID[]; context?: { diagramId: ID; viewIds: ID[] } }
  | { type: 'deleteDiagram'; diagramId: ID }
  | { type: 'renameDiagram'; diagramId: ID }
  | { type: 'export'; diagramId: ID }
  | { type: 'codegen' }
  | { type: 'textExport'; diagramId: ID }
  | { type: 'settings' }
  | { type: 'shortcuts' }
  | { type: 'about' }
  | { type: 'gettingStarted' }
  | { type: 'loadError'; fileName: string; error: LoadError }
  | { type: 'unsaved'; projectName: string; onDecision: (decision: 'save' | 'discard' | 'cancel') => void }
  | { type: 'recovery'; snapshots: RecoverySnapshotInfo[] }
  | { type: 'commandPalette' }
  | { type: 'quickSearch' }
  | { type: 'mdjImport' };

export interface FocusRequest {
  diagramId: ID;
  viewIds: ID[];
  nonce: number;
}

interface EditorState {
  tabs: ID[];
  activeDiagramId: ID | null;
  viewports: Record<ID, Viewport>;
  /** Selected view IDs per diagram (tabs remember their selection). */
  selections: Record<ID, ID[]>;
  /** Element or diagram selected in the explorer. */
  explorerSelection: ID | null;
  /** Which selection the inspector follows (last interaction wins). */
  inspectorSource: 'canvas' | 'explorer';
  tool: Tool;
  spaceHeld: boolean;
  editing: InlineEdit | null;
  clipboard: ClipboardPayload | null;
  dialog: DialogState | null;
  focusRequest: FocusRequest | null;
  sidebarVisible: boolean;
  inspectorVisible: boolean;
  bottomVisible: boolean;
  bottomTab: 'problems' | 'outline';
  lastRecoveryAt: number | null;

  openDiagram(diagramId: ID): void;
  closeTab(diagramId: ID): void;
  setActive(diagramId: ID | null): void;
  pruneTabs(existing: ReadonlySet<ID>): void;
  setViewport(diagramId: ID, viewport: Viewport): void;
  setSelection(diagramId: ID, viewIds: ID[]): void;
  selectInExplorer(id: ID | null): void;
  setTool(tool: Tool): void;
  setEditing(edit: InlineEdit | null): void;
  setClipboard(payload: ClipboardPayload | null): void;
  openDialog(dialog: DialogState): void;
  closeDialog(): void;
  requestFocus(diagramId: ID, viewIds: ID[]): void;
  togglePanel(panel: 'sidebar' | 'inspector' | 'bottom', visible?: boolean): void;
  setBottomTab(tab: 'problems' | 'outline'): void;
  setSpaceHeld(held: boolean): void;
  setLastRecoveryAt(at: number | null): void;
  reset(): void;
}

const INITIAL = {
  tabs: [] as ID[],
  activeDiagramId: null as ID | null,
  viewports: {} as Record<ID, Viewport>,
  selections: {} as Record<ID, ID[]>,
  explorerSelection: null as ID | null,
  inspectorSource: 'canvas' as const,
  tool: { kind: 'select' } as Tool,
  spaceHeld: false,
  editing: null as InlineEdit | null,
  dialog: null as DialogState | null,
  focusRequest: null as FocusRequest | null,
  lastRecoveryAt: null as number | null,
};

let focusNonce = 0;

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...INITIAL,
  clipboard: null,
  sidebarVisible: true,
  inspectorVisible: true,
  bottomVisible: true,
  bottomTab: 'problems',

  openDiagram(diagramId) {
    const { tabs } = get();
    set({ tabs: tabs.includes(diagramId) ? tabs : [...tabs, diagramId], activeDiagramId: diagramId, tool: { kind: 'select' }, editing: null });
  },
  closeTab(diagramId) {
    const { tabs, activeDiagramId } = get();
    const index = tabs.indexOf(diagramId);
    const next = tabs.filter((id) => id !== diagramId);
    const active = activeDiagramId === diagramId ? (next[Math.min(index, next.length - 1)] ?? null) : activeDiagramId;
    set({ tabs: next, activeDiagramId: active, editing: null });
  },
  setActive(diagramId) {
    set({ activeDiagramId: diagramId, tool: { kind: 'select' }, editing: null });
  },
  pruneTabs(existing) {
    const { tabs, activeDiagramId, selections } = get();
    const next = tabs.filter((id) => existing.has(id));
    if (next.length === tabs.length && (!activeDiagramId || existing.has(activeDiagramId))) return;
    const prunedSelections = Object.fromEntries(Object.entries(selections).filter(([id]) => existing.has(id)));
    set({ tabs: next, activeDiagramId: activeDiagramId && existing.has(activeDiagramId) ? activeDiagramId : (next[0] ?? null), selections: prunedSelections });
  },
  setViewport(diagramId, viewport) {
    set({ viewports: { ...get().viewports, [diagramId]: viewport } });
  },
  setSelection(diagramId, viewIds) {
    const current = get().selections[diagramId] ?? [];
    if (current.length === viewIds.length && current.every((id, i) => id === viewIds[i])) {
      if (get().inspectorSource !== 'canvas' && viewIds.length) set({ inspectorSource: 'canvas' });
      return;
    }
    set({ selections: { ...get().selections, [diagramId]: viewIds }, inspectorSource: viewIds.length ? 'canvas' : get().inspectorSource });
  },
  selectInExplorer(id) {
    set({ explorerSelection: id, inspectorSource: 'explorer' });
  },
  setTool(tool) {
    set({ tool, editing: null });
  },
  setEditing(editing) {
    set({ editing });
  },
  setClipboard(clipboard) {
    set({ clipboard });
  },
  openDialog(dialog) {
    set({ dialog });
  },
  closeDialog() {
    set({ dialog: null });
  },
  requestFocus(diagramId, viewIds) {
    focusNonce += 1;
    set({ focusRequest: { diagramId, viewIds, nonce: focusNonce } });
  },
  togglePanel(panel, visible) {
    if (panel === 'sidebar') set({ sidebarVisible: visible ?? !get().sidebarVisible });
    if (panel === 'inspector') set({ inspectorVisible: visible ?? !get().inspectorVisible });
    if (panel === 'bottom') set({ bottomVisible: visible ?? !get().bottomVisible });
  },
  setBottomTab(bottomTab) {
    set({ bottomTab, bottomVisible: true });
  },
  setSpaceHeld(spaceHeld) {
    if (get().spaceHeld !== spaceHeld) set({ spaceHeld });
  },
  setLastRecoveryAt(lastRecoveryAt) {
    set({ lastRecoveryAt });
  },
  reset() {
    set({ ...INITIAL });
  },
}));

export function activeSelection(state: Pick<EditorState, 'activeDiagramId' | 'selections'>): ID[] {
  return state.activeDiagramId ? (state.selections[state.activeDiagramId] ?? []) : [];
}
