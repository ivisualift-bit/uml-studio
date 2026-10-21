import Dexie, { type EntityTable } from 'dexie';
import type { RecentEntry, RecoverySnapshot } from './types';

interface StoredHandle {
  key: string;
  handle: FileSystemFileHandle;
}

interface StoredCopy {
  id: string;
  text: string;
  savedAt: number;
}

/** IndexedDB storage for recovery snapshots, recents and browser file handles/copies. */
class UmlStudioDatabase extends Dexie {
  recovery!: EntityTable<RecoverySnapshot, 'projectId'>;
  recents!: EntityTable<RecentEntry, 'id'>;
  handles!: EntityTable<StoredHandle, 'key'>;
  copies!: EntityTable<StoredCopy, 'id'>;

  constructor() {
    super('uml-studio');
    this.version(1).stores({
      recovery: 'projectId, savedAt',
      recents: 'id, lastOpenedAt',
      handles: 'key',
      copies: 'id',
    });
  }
}

let instance: UmlStudioDatabase | null = null;

export function database(): UmlStudioDatabase {
  instance ??= new UmlStudioDatabase();
  return instance;
}
