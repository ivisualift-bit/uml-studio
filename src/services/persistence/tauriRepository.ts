import { invoke } from '@tauri-apps/api/core';
import { safeFileName } from './browserRepository';
import type { ExportFilter, FileRef, OpenedFile, ProjectRepository, RecentEntry } from './types';

interface NativeOpened {
  path: string;
  name: string;
  contents: string;
}

interface NativeRecent {
  path: string;
  name: string;
  project_name: string;
  last_opened_at: number;
}

async function toBase64(data: Blob): Promise<string> {
  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/**
 * Desktop adapter. Native dialogs run in Rust, which records the user-chosen paths and only
 * reads/writes those (plus remembered recents). Writes are atomic (temp file + rename).
 */
export class TauriProjectRepository implements ProjectRepository {
  readonly platform = 'tauri' as const;
  readonly canOverwrite = true;

  async open(): Promise<OpenedFile | null> {
    const result = await invoke<NativeOpened | null>('pick_open_project');
    if (!result) return null;
    return { text: result.contents, file: { kind: 'tauri', name: result.name, path: result.path } };
  }

  async save(text: string, file: FileRef | null, suggestedName: string): Promise<FileRef | null> {
    if (file?.kind === 'tauri' && file.path) {
      await invoke('write_text_file', { path: file.path, contents: text });
      return file;
    }
    return this.saveAs(text, file?.name ?? suggestedName);
  }

  async saveAs(text: string, suggestedName: string): Promise<FileRef | null> {
    const path = await invoke<string | null>('pick_save_path', { suggestedName: safeFileName(suggestedName), kind: 'project' });
    if (!path) return null;
    await invoke('write_text_file', { path, contents: text });
    return { kind: 'tauri', name: path.split(/[\\/]/).pop() ?? path, path };
  }

  async listRecent(): Promise<RecentEntry[]> {
    const list = await invoke<NativeRecent[]>('list_recent');
    return list.map((r) => ({ id: r.path, name: r.project_name, fileName: r.name, kind: 'tauri', lastOpenedAt: r.last_opened_at }));
  }

  async openRecent(entry: RecentEntry): Promise<OpenedFile | null> {
    const contents = await invoke<string>('read_text_file', { path: entry.id });
    return { text: contents, file: { kind: 'tauri', name: entry.fileName, path: entry.id } };
  }

  async removeRecent(id: string): Promise<void> {
    await invoke('forget_recent', { path: id });
  }

  async recordRecent(file: FileRef, info: { projectId: string; projectName: string }): Promise<void> {
    if (file.kind !== 'tauri' || !file.path) return;
    await invoke('remember_recent', { path: file.path, projectName: info.projectName });
  }

  async exportFile(data: Blob, suggestedName: string, filter: ExportFilter): Promise<string | null> {
    const ext = filter.extensions[0] ?? 'bin';
    const path = await invoke<string | null>('pick_save_path', { suggestedName: `${safeFileName(suggestedName, 'diagram')}.${ext}`, kind: ext });
    if (!path) return null;
    await invoke('write_binary_file', { path, base64: await toBase64(data) });
    return path.split(/[\\/]/).pop() ?? path;
  }
}
