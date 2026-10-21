import { Construction } from 'lucide-react';
import { DIAGRAM_KIND_INFO } from '@/domain/model/metadata';
import { GraphCanvas } from '@/diagrams/graph/GraphCanvas';
import { isEditable } from '@/diagrams/registry/catalog';
import { SequenceCanvas } from '@/diagrams/sequence/SequenceCanvas';
import { useT } from '@/i18n';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';

/** Mounts the editor for the active tab only (hidden tabs keep viewport/selection in the store). */
export function DiagramHost() {
  const t = useT();
  const activeId = useEditorStore((s) => s.activeDiagramId);
  const kind = useDocumentStore((s) => (activeId ? s.doc?.diagrams[activeId]?.kind : undefined));
  if (!activeId || !kind) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-[13px] text-faint" data-testid="no-diagram">
        <div className="max-w-sm text-center">
          <p>{t('toolbox.noDiagram')}</p>
          <button type="button" className="mt-3 rounded-md border border-border-strong px-3 py-1.5 text-[12.5px] text-fg hover:border-accent" onClick={() => useEditorStore.getState().openDialog({ type: 'newDiagram' })}>
            {t('cmd.newDiagram')}
          </button>
        </div>
      </div>
    );
  }
  if (!isEditable(kind)) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-6 text-center">
        <div className="max-w-md">
          <Construction className="mx-auto mb-2 text-warning" size={28} />
          <p className="text-[13px] text-fg">{t('canvas.planned')}</p>
          <p className="mt-1 text-[12px] text-muted">{t(`diagramDescription.${kind}`)}</p>
        </div>
      </div>
    );
  }
  return DIAGRAM_KIND_INFO[kind].renderMode === 'sequence' ? <SequenceCanvas key={activeId} diagramId={activeId} /> : <GraphCanvas key={activeId} diagramId={activeId} />;
}
