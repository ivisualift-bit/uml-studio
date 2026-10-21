import { serializeProject } from '@/domain/serialization/projectFile';
import { useDocumentStore } from '@/stores/documentStore';

/**
 * Read-only inspection hook used by the end-to-end tests to compare the in-app document with saved
 * files. It exposes a serialized copy only (never a mutable reference) and cannot modify state.
 */
export function exposeTestHooks(): void {
  (window as unknown as { umlStudio?: unknown }).umlStudio = {
    snapshot: (): string | null => {
      const doc = useDocumentStore.getState().doc;
      return doc ? serializeProject(doc) : null;
    },
    historyDepth: (): number => useDocumentStore.getState().history.past.length,
  };
}
