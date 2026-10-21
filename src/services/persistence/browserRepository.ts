import {
  MAX_PROJECT_BYTES,
  PROJECT_FILE_EXTENSION,
  PROJECT_MIME_TYPE,
} from '@/domain/serialization/projectFile';
import { database } from './db';
import {
  MAX_RECENTS,
  UserCancelled,
  type ExportFilter,
  type FileRef,
  type OpenedFile,
  type ProjectRepository,
  type RecentEntry,
} from './types';

/* Minimal typings for the File System Access API (not yet in lib.dom). */
interface FilePickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}
interface FsAccessWindow {
  showOpenFilePicker?: (options: {
    types?: FilePickerAcceptType[];
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
  }) => Promise<FileSystemFileHandle>;
}
interface PermissionedHandle extends FileSystemFileHandle {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

const PROJECT_TYPES: FilePickerAcceptType[] = [
  {
    description: 'UML Studio project',
    accept: { [PROJECT_MIME_TYPE]: [`.${PROJECT_FILE_EXTENSION}`], 'application/json': ['.json'] },
  },
];

export function supportsFileSystemAccess(): boolean {
  const w = window as unknown as FsAccessWindow;
  return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function';
}

const isAbort = (error: unknown) =>
  error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError');

function ensureExtension(name: string, ext: string): string {
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

/** Strip characters that are invalid in file names on common platforms. */
export function safeFileName(name: string, fallback = 'project'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function downloadBlob(data: Blob, fileName: string): void {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function pickFileWithInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

async function writeHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const h = handle as PermissionedHandle;
  if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if (!h.requestPermission || (await h.requestPermission({ mode: 'readwrite' })) !== 'granted')
      throw new UserCancelled();
  }
  // createWritable writes to a swap file that replaces the target only on close() — atomic from the
  // user's perspective; an aborted write leaves the original untouched.
  const writable = await handle.createWritable();
  try {
    await writable.write(new Blob([text], { type: PROJECT_MIME_TYPE }));
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

async function storeHandle(handle: FileSystemFileHandle): Promise<string> {
  const db = database();
  // Reuse an existing key for the same file entry when possible.
  for (const stored of await db.handles.toArray()) {
    try {
      if (await stored.handle.isSameEntry(handle)) return stored.key;
    } catch {
      // ignore stale handles
    }
  }
  const key = crypto.randomUUID();
  await db.handles.put({ key, handle });
  return key;
}

/**
 * Browser adapter. With the File System Access API (Chromium) Save overwrites the opened file;
 * otherwise files are read through <input type=file> and saved as downloads — the UI says so.
 */
export class BrowserProjectRepository implements ProjectRepository {
  readonly platform = 'browser' as const;
  readonly canOverwrite = supportsFileSystemAccess();

  async open(): Promise<OpenedFile | null> {
    if (this.canOverwrite) {
      const w = window as unknown as FsAccessWindow;
      try {
        const [handle] = await w.showOpenFilePicker!({ types: PROJECT_TYPES, multiple: false });
        if (!handle) return null;
        const file = await handle.getFile();
        const text = await file.text();
        const handleKey = await storeHandle(handle);
        return { text, file: { kind: 'fsAccess', name: file.name, handleKey } };
      } catch (error) {
        if (isAbort(error)) return null;
        throw error;
      }
    }
    const file = await pickFileWithInput(`.${PROJECT_FILE_EXTENSION},.json,application/json`);
    if (!file) return null;
    return { text: await file.text(), file: { kind: 'download', name: file.name } };
  }

  async importFile(filter: ExportFilter): Promise<{ name: string; text: string } | null> {
    const file = await pickFileWithInput(filter.extensions.map((ext) => `.${ext}`).join(','));
    if (!file) return null;
    if (file.size > MAX_PROJECT_BYTES) throw new Error(`${file.name} is larger than 25 MB`);
    return { name: file.name, text: await file.text() };
  }

  async save(text: string, file: FileRef | null, suggestedName: string): Promise<FileRef | null> {
    if (file?.kind === 'fsAccess' && file.handleKey) {
      const stored = await database().handles.get(file.handleKey);
      if (stored) {
        try {
          await writeHandle(stored.handle, text);
          return file;
        } catch (error) {
          if (error instanceof UserCancelled || isAbort(error)) return null;
          throw error;
        }
      }
    }
    return this.saveAs(text, file?.name ?? suggestedName);
  }

  async saveAs(text: string, suggestedName: string): Promise<FileRef | null> {
    const name = ensureExtension(
      safeFileName(suggestedName.replace(/\.(umls|json)$/i, '')),
      PROJECT_FILE_EXTENSION,
    );
    if (this.canOverwrite) {
      const w = window as unknown as FsAccessWindow;
      try {
        const handle = await w.showSaveFilePicker!({ suggestedName: name, types: PROJECT_TYPES });
        await writeHandle(handle, text);
        const handleKey = await storeHandle(handle);
        return { kind: 'fsAccess', name: handle.name, handleKey };
      } catch (error) {
        if (error instanceof UserCancelled || isAbort(error)) return null;
        throw error;
      }
    }
    downloadBlob(new Blob([text], { type: PROJECT_MIME_TYPE }), name);
    return { kind: 'download', name };
  }

  async listRecent(): Promise<RecentEntry[]> {
    return database().recents.orderBy('lastOpenedAt').reverse().limit(MAX_RECENTS).toArray();
  }

  async openRecent(entry: RecentEntry): Promise<OpenedFile | null> {
    const db = database();
    if (entry.kind === 'fsAccess') {
      const stored = await db.handles.get(entry.id);
      if (!stored) throw new Error('The file handle is no longer available. Open the file again.');
      const h = stored.handle as PermissionedHandle;
      if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') {
        if (!h.requestPermission || (await h.requestPermission({ mode: 'read' })) !== 'granted') return null;
      }
      const file = await stored.handle.getFile();
      return { text: await file.text(), file: { kind: 'fsAccess', name: file.name, handleKey: entry.id } };
    }
    const copy = await db.copies.get(entry.id);
    if (!copy) throw new Error('No stored copy of this project exists in this browser.');
    return { text: copy.text, file: { kind: 'browserCopy', name: entry.fileName } };
  }

  async removeRecent(id: string): Promise<void> {
    const db = database();
    await db.recents.delete(id);
    await db.copies.delete(id);
  }

  async recordRecent(
    file: FileRef,
    info: { projectId: string; projectName: string },
    text?: string,
  ): Promise<void> {
    const db = database();
    const id = file.kind === 'fsAccess' && file.handleKey ? file.handleKey : `copy:${info.projectId}`;
    if (id.startsWith('copy:') && text !== undefined) await db.copies.put({ id, text, savedAt: Date.now() });
    await db.recents.put({
      id,
      name: info.projectName,
      fileName: file.name,
      kind: id.startsWith('copy:') ? 'browserCopy' : 'fsAccess',
      lastOpenedAt: Date.now(),
      projectId: info.projectId,
    });
    const all = await db.recents.orderBy('lastOpenedAt').reverse().toArray();
    for (const stale of all.slice(MAX_RECENTS)) await this.removeRecent(stale.id);
  }

  async exportFile(data: Blob, suggestedName: string, filter: ExportFilter): Promise<string | null> {
    const name = ensureExtension(safeFileName(suggestedName, 'diagram'), filter.extensions[0] ?? 'bin');
    const w = window as unknown as FsAccessWindow;
    if (this.canOverwrite) {
      try {
        const handle = await w.showSaveFilePicker!({
          suggestedName: name,
          types: [
            { description: filter.name, accept: { [filter.mime]: filter.extensions.map((e) => `.${e}`) } },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return handle.name;
      } catch (error) {
        if (isAbort(error)) return null;
        throw error;
      }
    }
    downloadBlob(data, name);
    return name;
  }
}
