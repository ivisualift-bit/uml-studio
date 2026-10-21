import type { ID } from '@/domain/schemas/common';
import type { FileRef } from '@/stores/documentStore';

export type { FileRef };

export interface OpenedFile {
  /** Raw, untrusted file text — validated by the domain loader. */
  text: string;
  file: FileRef;
}

export interface RecentEntry {
  /** Stable key: native path, handle key or browser copy id. */
  id: string;
  name: string;
  fileName: string;
  kind: FileRef['kind'];
  lastOpenedAt: number;
  projectId?: ID;
}

export interface ExportFilter {
  name: string;
  extensions: string[];
  mime: string;
}

/**
 * Platform-neutral project storage. The UI never touches files directly; browser and Tauri
 * implementations live behind this interface (spec §5.2).
 */
export interface ProjectRepository {
  readonly platform: 'browser' | 'tauri';
  /** True when Save can overwrite the opened file in place. */
  readonly canOverwrite: boolean;
  open(): Promise<OpenedFile | null>;
  /** Overwrite `file` when possible, otherwise behave like Save As. Returns null if cancelled. */
  save(text: string, file: FileRef | null, suggestedName: string): Promise<FileRef | null>;
  saveAs(text: string, suggestedName: string): Promise<FileRef | null>;
  listRecent(): Promise<RecentEntry[]>;
  openRecent(entry: RecentEntry): Promise<OpenedFile | null>;
  removeRecent(id: string): Promise<void>;
  recordRecent(file: FileRef, info: { projectId: ID; projectName: string }, text?: string): Promise<void>;
  /** Save an exported artifact. Returns the saved file name, or null when cancelled. */
  exportFile(data: Blob, suggestedName: string, filter: ExportFilter): Promise<string | null>;
}

export interface RecoverySnapshot {
  projectId: ID;
  projectName: string;
  savedAt: number;
  text: string;
  file: FileRef | null;
  elementCount: number;
  diagramCount: number;
}

export interface RecoveryRepository {
  saveRecovery(snapshot: RecoverySnapshot): Promise<void>;
  listRecoveries(): Promise<RecoverySnapshot[]>;
  getRecovery(projectId: ID): Promise<RecoverySnapshot | undefined>;
  deleteRecovery(projectId: ID): Promise<void>;
  clearRecoveries(): Promise<void>;
}

export class UserCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'UserCancelled';
  }
}

export const MAX_RECENTS = 12;
