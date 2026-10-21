import { useEffect, useState } from 'react';
import { Circle, CircleCheck, WifiOff } from 'lucide-react';
import { useT } from '@/i18n';
import { isDesktop } from '@/services/platform/platform';
import { selectIsDirty, useDocumentStore } from '@/stores/documentStore';
import { activeSelection, useEditorStore } from '@/stores/editorStore';

/** Zoom of the active diagram as last reported by its canvas (updated at the end of every move). */
function useZoom(): number {
  return useEditorStore((s) => (s.activeDiagramId ? (s.viewports[s.activeDiagramId]?.zoom ?? 1) : 1));
}

export function StatusBar({ problemCount }: { problemCount: number }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc);
  const dirty = useDocumentStore(selectIsDirty);
  const file = useDocumentStore((s) => s.file);
  const selection = useEditorStore((s) => activeSelection(s).length);
  const activeId = useEditorStore((s) => s.activeDiagramId);
  const lastRecovery = useEditorStore((s) => s.lastRecoveryAt);
  const zoom = useZoom();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const diagram = activeId ? doc?.diagrams[activeId] : undefined;
  return (
    <footer
      className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-surface-2 px-3 text-[11.5px] text-muted"
      data-testid="status-bar"
    >
      <span className="truncate font-medium text-fg">{doc?.name}</span>
      <span
        className="flex items-center gap-1"
        data-testid="dirty-indicator"
        data-dirty={dirty ? 'true' : 'false'}
      >
        {dirty ? (
          <Circle size={9} className="fill-warning text-warning" />
        ) : (
          <CircleCheck size={11} className="text-success" />
        )}
        {dirty ? t('status.unsaved') : file ? t('status.saved') : t('project.neverSaved')}
      </span>
      {file && <span className="truncate text-faint">{file.name}</span>}
      {lastRecovery && dirty && (
        <span className="text-faint">
          {t('status.recoverySaved', { time: new Date(lastRecovery).toLocaleTimeString() })}
        </span>
      )}
      <span className="flex-1" />
      <span>{t('status.problems', { count: problemCount })}</span>
      <span>{selection ? t('status.selection', { count: selection }) : ''}</span>
      <span>{diagram ? t(`diagramKind.${diagram.kind}`) : t('status.noDiagram')}</span>
      <span data-testid="zoom-indicator">{t('status.zoom', { value: Math.round(zoom * 100) })}</span>
      <span className="flex items-center gap-1">
        {!online && <WifiOff size={11} />}
        {isDesktop() ? t('app.desktopMode') : t('app.browserMode')}
        {!online && ` · ${t('app.offline')}`}
      </span>
    </footer>
  );
}
