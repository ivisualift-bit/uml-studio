import { FilePlus2, FolderOpen, Hand, Maximize, MousePointer2, Redo2, Save, ShieldCheck, Undo2, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { command, isEnabled, primaryShortcut } from '@/app/commands';
import { IconButton } from '@/components/ui/controls';
import { useT, type MessageKey } from '@/i18n';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';

function ToolbarCommand({ id, icon, labelKey }: { id: string; icon: React.ReactNode; labelKey?: MessageKey }) {
  const t = useT();
  // Subscribe to the stores so enabled states refresh.
  useDocumentStore((s) => s.revision);
  useEditorStore((s) => s.selections);
  useEditorStore((s) => s.activeDiagramId);
  const cmd = command(id);
  return (
    <IconButton label={t(labelKey ?? cmd.labelKey)} shortcut={primaryShortcut(id)} disabled={!isEnabled(cmd)} onClick={() => void cmd.run()} data-testid={`toolbar-${id}`}>
      {icon}
    </IconButton>
  );
}

const Divider = () => <div className="mx-1 h-5 w-px bg-border" />;

export function Toolbar() {
  const t = useT();
  const tool = useEditorStore((s) => s.tool);
  const hasDiagram = useEditorStore((s) => !!s.activeDiagramId);
  const setTool = useEditorStore((s) => s.setTool);
  return (
    <div className="flex h-9 items-center gap-0.5 border-b border-border bg-surface-1 px-2" role="toolbar" aria-label="Main toolbar">
      <ToolbarCommand id="file.new" icon={<FilePlus2 size={16} />} />
      <ToolbarCommand id="file.open" icon={<FolderOpen size={16} />} />
      <ToolbarCommand id="file.save" icon={<Save size={16} />} />
      <Divider />
      <ToolbarCommand id="edit.undo" icon={<Undo2 size={16} />} />
      <ToolbarCommand id="edit.redo" icon={<Redo2 size={16} />} />
      <Divider />
      <IconButton label={t('toolbar.select')} active={tool.kind === 'select'} disabled={!hasDiagram} onClick={() => setTool({ kind: 'select' })} data-testid="toolbar-select">
        <MousePointer2 size={16} />
      </IconButton>
      <IconButton label={t('toolbar.hand')} active={tool.kind === 'hand'} disabled={!hasDiagram} onClick={() => setTool({ kind: 'hand' })} data-testid="toolbar-hand">
        <Hand size={16} />
      </IconButton>
      <Divider />
      <ToolbarCommand id="view.zoomOut" icon={<ZoomOut size={16} />} />
      <ToolbarCommand id="view.zoomIn" icon={<ZoomIn size={16} />} />
      <ToolbarCommand id="view.fit" icon={<Maximize size={15} />} />
      <Divider />
      <ToolbarCommand id="tools.validate" icon={<ShieldCheck size={16} />} labelKey="toolbar.validate" />
      <ToolbarCommand id="file.export" icon={<Upload size={16} />} labelKey="toolbar.export" />
    </div>
  );
}
