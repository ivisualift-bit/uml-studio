import { useEffect } from 'react';
import { serializeProject } from '@/domain/serialization/projectFile';
import { isDesktop, recoveryRepository } from '@/services/platform/platform';
import { selectIsDirty, useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { dirtyGuard, handleGlobalKeyDown, isTypingTarget } from './commands';
import { confirmDiscardIfDirty } from './actions';

export const RECOVERY_DEBOUNCE_MS = 1500;

async function writeSnapshot(): Promise<void> {
  const state = useDocumentStore.getState();
  const doc = state.doc;
  if (!doc || !selectIsDirty(state)) return;
  try {
    await recoveryRepository().saveRecovery({
      projectId: doc.id,
      projectName: doc.name,
      savedAt: Date.now(),
      text: serializeProject(doc),
      file: state.file,
      elementCount: Object.keys(doc.modelElements).length - 1,
      diagramCount: Object.keys(doc.diagrams).length,
    });
    useEditorStore.getState().setLastRecoveryAt(Date.now());
  } catch (error) {
    console.error('Recovery snapshot failed', error);
  }
}

/**
 * Debounced crash-recovery snapshots (~1.5 s after the last edit) plus a best-effort flush when the
 * page is hidden. Snapshots never clear the dirty marker; an explicit save deletes them.
 */
export function useRecoveryAutosave(): void {
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = useDocumentStore.subscribe((state, previous) => {
      if (state.revision === previous.revision) return;
      window.clearTimeout(timer);
      if (!state.doc || !selectIsDirty(state)) return;
      timer = window.setTimeout(() => void writeSnapshot(), RECOVERY_DEBOUNCE_MS);
    });
    const flush = () => {
      if (document.visibilityState === 'hidden') void writeSnapshot();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', () => void writeSnapshot());
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);
}

/** Offer recovery of snapshots left by a previous session (spec §5.2). */
export function useStartupRecovery(): void {
  useEffect(() => {
    let cancelled = false;
    void recoveryRepository()
      .listRecoveries()
      .then((snapshots) => {
        if (cancelled || snapshots.length === 0 || useDocumentStore.getState().doc) return;
        useEditorStore.getState().openDialog({
          type: 'recovery',
          snapshots: snapshots.map((s) => ({
            projectId: s.projectId,
            projectName: s.projectName,
            savedAt: s.savedAt,
            elementCount: s.elementCount,
            diagramCount: s.diagramCount,
          })),
        });
      })
      .catch((error) => console.error('Recovery listing failed', error));
    return () => {
      cancelled = true;
    };
  }, []);
}

/** Global shortcuts, Space-to-pan and unsaved-change protection on close. */
export function useGlobalInput(): void {
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target) && !useEditorStore.getState().dialog && !e.repeat) {
        const inCanvas =
          e.target instanceof HTMLElement &&
          (e.target.closest('[data-canvas]') || e.target === document.body);
        if (inCanvas) {
          e.preventDefault();
          useEditorStore.getState().setSpaceHeld(true);
        }
        return;
      }
      handleGlobalKeyDown(e);
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'Space') useEditorStore.getState().setSpaceHeld(false);
    };
    const blur = () => useEditorStore.getState().setSpaceHeld(false);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('beforeunload', dirtyGuard);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('beforeunload', dirtyGuard);
    };
  }, []);
}

/** Desktop: intercept the native window close to protect unsaved work. */
export function useDesktopCloseGuard(): void {
  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const off = await win.onCloseRequested(async (event) => {
        if (!selectIsDirty(useDocumentStore.getState())) return;
        event.preventDefault();
        if (await confirmDiscardIfDirty()) {
          off();
          await win.close();
        }
      });
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
