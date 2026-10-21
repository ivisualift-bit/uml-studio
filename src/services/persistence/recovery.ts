import type { ID } from '@/domain/schemas/common';
import { database } from './db';
import type { RecoveryRepository, RecoverySnapshot } from './types';

/** Crash-recovery snapshots in IndexedDB (works in the browser and in the Tauri webview). */
export const indexedDbRecovery: RecoveryRepository = {
  async saveRecovery(snapshot: RecoverySnapshot) {
    await database().recovery.put(snapshot);
  },
  async listRecoveries() {
    return (await database().recovery.orderBy('savedAt').reverse().toArray()).filter((s) => typeof s.text === 'string');
  },
  async getRecovery(projectId: ID) {
    return database().recovery.get(projectId);
  },
  async deleteRecovery(projectId: ID) {
    await database().recovery.delete(projectId);
  },
  async clearRecoveries() {
    await database().recovery.clear();
  },
};
