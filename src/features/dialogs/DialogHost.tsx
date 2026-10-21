import { CommandPalette, QuickSearch } from '@/features/palette/CommandPalette';
import { useEditorStore } from '@/stores/editorStore';
import { useDocumentStore } from '@/stores/documentStore';
import { AboutDialog, GettingStartedDialog, SettingsDialog, ShortcutsDialog } from './AppDialogs';
import {
  DeleteDiagramDialog,
  DeleteFromModelDialog,
  NewDiagramDialog,
  RenameDiagramDialog,
} from './DiagramDialogs';
import { CodegenDialog, ExportDialog, TextExportDialog } from './ExportDialogs';
import {
  LoadErrorDialog,
  MdjImportDialog,
  NewProjectDialog,
  RecoveryDialog,
  TemplatesDialog,
  UnsavedDialog,
} from './ProjectDialogs';

/** Renders the single active dialog (dialogs are ephemeral editor state). */
export function DialogHost() {
  const dialog = useEditorStore((s) => s.dialog);
  const hasDoc = useDocumentStore((s) => !!s.doc);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'newProject':
      return <NewProjectDialog />;
    case 'templates':
      return <TemplatesDialog />;
    case 'unsaved':
      return <UnsavedDialog projectName={dialog.projectName} onDecision={dialog.onDecision} />;
    case 'recovery':
      return <RecoveryDialog snapshots={dialog.snapshots} />;
    case 'loadError':
      return <LoadErrorDialog fileName={dialog.fileName} error={dialog.error} />;
    case 'mdjImport':
      return <MdjImportDialog fileName={dialog.fileName} result={dialog.result} />;
    case 'settings':
      return <SettingsDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'about':
      return <AboutDialog />;
    case 'gettingStarted':
      return <GettingStartedDialog />;
    case 'commandPalette':
      return <CommandPalette />;
    default:
      break;
  }
  if (!hasDoc) return null;
  switch (dialog.type) {
    case 'newDiagram':
      return <NewDiagramDialog ownerId={dialog.ownerId} kind={dialog.kind} />;
    case 'deleteFromModel':
      return <DeleteFromModelDialog elementIds={dialog.elementIds} context={dialog.context} />;
    case 'deleteDiagram':
      return <DeleteDiagramDialog diagramId={dialog.diagramId} />;
    case 'renameDiagram':
      return <RenameDiagramDialog diagramId={dialog.diagramId} />;
    case 'export':
      return <ExportDialog diagramId={dialog.diagramId} />;
    case 'codegen':
      return <CodegenDialog />;
    case 'textExport':
      return <TextExportDialog diagramId={dialog.diagramId} />;
    case 'quickSearch':
      return <QuickSearch />;
    default:
      return null;
  }
}
