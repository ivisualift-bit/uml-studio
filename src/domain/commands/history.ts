import { applyPatches, type Patch } from 'immer';
import type { ID } from '../schemas/common';
import type { ProjectDocument } from '../schemas/project';

export interface HistoryEntry {
  id: number;
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  timestamp: number;
  /** Consecutive entries with the same key (within the merge window) collapse into one undo step. */
  mergeKey?: string;
  affectedDiagramIds: ID[];
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  limit: number;
  nextId: number;
}

export const DEFAULT_HISTORY_LIMIT = 200;
export const MERGE_WINDOW_MS = 1200;

export function createHistory(limit = DEFAULT_HISTORY_LIMIT): HistoryState {
  return { past: [], future: [], limit, nextId: 1 };
}

export interface NewEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  timestamp: number;
  mergeKey?: string;
  affectedDiagramIds: ID[];
}

/** Record a committed transaction. Clears the redo stack. */
export function recordEntry(history: HistoryState, entry: NewEntry): HistoryState {
  if (entry.patches.length === 0) return history;
  const last = history.past[history.past.length - 1];
  if (
    last &&
    entry.mergeKey &&
    last.mergeKey === entry.mergeKey &&
    entry.timestamp - last.timestamp <= MERGE_WINDOW_MS
  ) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...entry.patches],
      inversePatches: [...entry.inversePatches, ...last.inversePatches],
      timestamp: entry.timestamp,
      affectedDiagramIds: [...new Set([...last.affectedDiagramIds, ...entry.affectedDiagramIds])],
    };
    return { ...history, past: [...history.past.slice(0, -1), merged], future: [] };
  }
  const past = [...history.past, { ...entry, id: history.nextId }];
  const overflow = Math.max(0, past.length - history.limit);
  return { ...history, past: overflow ? past.slice(overflow) : past, future: [], nextId: history.nextId + 1 };
}

export interface HistoryStep {
  doc: ProjectDocument;
  history: HistoryState;
  entry: HistoryEntry;
}

export function undo(doc: ProjectDocument, history: HistoryState): HistoryStep | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    doc: applyPatches(doc, entry.inversePatches),
    history: { ...history, past: history.past.slice(0, -1), future: [entry, ...history.future] },
    entry,
  };
}

export function redo(doc: ProjectDocument, history: HistoryState): HistoryStep | null {
  const entry = history.future[0];
  if (!entry) return null;
  return {
    doc: applyPatches(doc, entry.patches),
    history: { ...history, past: [...history.past, entry], future: history.future.slice(1) },
    entry,
  };
}

export const canUndo = (history: HistoryState): boolean => history.past.length > 0;
export const canRedo = (history: HistoryState): boolean => history.future.length > 0;
