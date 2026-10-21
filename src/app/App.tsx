import { useEffect } from 'react';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { Toaster } from '@/components/Toaster';
import { DialogHost } from '@/features/dialogs/DialogHost';
import { StartScreen } from '@/features/projects/StartScreen';
import { WorkspaceShell } from '@/features/workspace/WorkspaceShell';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useDesktopCloseGuard, useGlobalInput, useRecoveryAutosave, useStartupRecovery } from './lifecycle';
import { useApplyTheme } from './theme';
import { exposeTestHooks } from './testHooks';

export function App() {
  useApplyTheme();
  useGlobalInput();
  useRecoveryAutosave();
  useStartupRecovery();
  useDesktopCloseGuard();
  const hasDoc = useDocumentStore((s) => !!s.doc);
  const language = useSettingsStore((s) => s.language);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(exposeTestHooks, []);
  return (
    <AppErrorBoundary>
      {hasDoc ? <WorkspaceShell /> : <StartScreen />}
      <DialogHost />
      <Toaster />
    </AppErrorBoundary>
  );
}
