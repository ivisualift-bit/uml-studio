import { create } from 'zustand';
import { executeCommands, type CommandOutcome } from '@/domain/commands/engine';
import {
  createHistory,
  recordEntry,
  redo as redoStep,
  undo as undoStep,
  type HistoryEntry,
  type HistoryState,
} from '@/domain/commands/history';
import type { Command } from '@/domain/commands/types';
import type { ProjectDocument } from '@/domain/schemas/project';
import { measureView } from '@/diagrams/render/measure';

/** Where the open project lives on disk (if anywhere). */
export interface FileRef {
  kind: 'fsAccess' | 'download' | 'tauri' | 'browserCopy';
  name: string;
  /** Native path (Tauri) — chosen by the user through the OS dialog. */
  path?: string;
  /** Key of a stored FileSystemFileHandle (browser). */
  handleKey?: string;
}

export interface DispatchOptions {
  label: string;
  /** Consecutive dispatches with the same key within ~1 s collapse into one undo step. */
  mergeKey?: string;
  /** `false` = presentation bookkeeping (viewport): no undo entry, does not make the project dirty. */
  history?: boolean;
}

interface DocumentState {
  doc: ProjectDocument | null;
  history: HistoryState;
  /** Increments on every document change (drives autosave/validation). */
  revision: number;
  /** Id of the history entry on top when the project was last saved (-1 = never saved, 0 = clean empty history). */
  savedEntryId: number;
  file: FileRef | null;
  lastSavedAt: number | null;

  dispatch(commands: Command | Command[], options: DispatchOptions): CommandOutcome;
  undo(): HistoryEntry | null;
  redo(): HistoryEntry | null;
  load(doc: ProjectDocument, file: FileRef | null, options?: { dirty?: boolean }): void;
  close(): void;
  markSaved(file: FileRef | null): void;
}

const topEntryId = (history: HistoryState): number => history.past[history.past.length - 1]?.id ?? 0;

export const useDocumentStore = create<DocumentState>()((set, get) => ({
  doc: null,
  history: createHistory(),
  revision: 0,
  savedEntryId: 0,
  file: null,
  lastSavedAt: null,

  dispatch(commands, options) {
    const { doc, history, revision } = get();
    if (!doc) return { ok: false, code: 'notFound', message: 'No open project', details: [] };
    const list = Array.isArray(commands) ? commands : [commands];
    const outcome = executeCommands(doc, list, { measure: measureView });
    if (!outcome.ok || outcome.patches.length === 0) return outcome;
    if (options.history === false) {
      set({ doc: outcome.doc, revision: revision + 1 });
      return outcome;
    }
    const nextHistory = recordEntry(history, {
      label: options.label,
      patches: outcome.patches,
      inversePatches: outcome.inversePatches,
      timestamp: Date.now(),
      // Never merge into the entry that represents the saved state.
      mergeKey: topEntryId(history) === get().savedEntryId ? undefined : options.mergeKey,
      affectedDiagramIds: outcome.affectedDiagramIds,
    });
    set({ doc: outcome.doc, history: nextHistory, revision: revision + 1 });
    return outcome;
  },

  undo() {
    const { doc, history, revision } = get();
    if (!doc) return null;
    const step = undoStep(doc, history);
    if (!step) return null;
    set({ doc: step.doc, history: step.history, revision: revision + 1 });
    return step.entry;
  },

  redo() {
    const { doc, history, revision } = get();
    if (!doc) return null;
    const step = redoStep(doc, history);
    if (!step) return null;
    set({ doc: step.doc, history: step.history, revision: revision + 1 });
    return step.entry;
  },

  load(doc, file, options = {}) {
    set({
      doc,
      file,
      history: createHistory(),
      revision: get().revision + 1,
      savedEntryId: options.dirty ? -1 : 0,
      lastSavedAt: null,
    });
  },

  close() {
    set({
      doc: null,
      file: null,
      history: createHistory(),
      revision: get().revision + 1,
      savedEntryId: 0,
      lastSavedAt: null,
    });
  },

  markSaved(file) {
    const { history } = get();
    // Seal the top entry so later edits cannot merge into the saved state.
    const past = history.past.slice();
    const top = past[past.length - 1];
    if (top) past[past.length - 1] = { ...top, mergeKey: undefined };
    set({ file, savedEntryId: topEntryId(history), history: { ...history, past }, lastSavedAt: Date.now() });
  },
}));

export function selectIsDirty(state: Pick<DocumentState, 'doc' | 'history' | 'savedEntryId'>): boolean {
  if (!state.doc) return false;
  return topEntryId(state.history) !== state.savedEntryId;
}
