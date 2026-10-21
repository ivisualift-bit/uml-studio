import { X } from 'lucide-react';
import { glyphForDiagram, UmlGlyph } from '@/diagrams/registry/glyphs';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';

export function DiagramTabs() {
  const t = useT();
  const tabs = useEditorStore((s) => s.tabs);
  const active = useEditorStore((s) => s.activeDiagramId);
  const setActive = useEditorStore((s) => s.setActive);
  const closeTab = useEditorStore((s) => s.closeTab);
  const diagrams = useDocumentStore((s) => s.doc?.diagrams);
  if (!tabs.length) return null;
  return (
    <div
      className="flex h-8 shrink-0 items-end gap-px overflow-x-auto border-b border-border bg-surface-2 px-1"
      role="tablist"
      aria-label={t('explorer.diagrams')}
    >
      {tabs.map((id) => {
        const diagram = diagrams?.[id];
        if (!diagram) return null;
        const selected = id === active;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            data-testid="diagram-tab"
            data-diagram-id={id}
            className={cn(
              'group flex h-7 max-w-[220px] min-w-0 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[12.5px]',
              selected
                ? 'border-border bg-surface-1 text-fg'
                : 'border-transparent text-muted hover:bg-surface-3 hover:text-fg',
            )}
            onClick={() => setActive(id)}
            onAuxClick={(e) => e.button === 1 && closeTab(id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setActive(id);
            }}
            title={`${diagram.name} — ${t(`diagramKind.${diagram.kind}`)}`}
          >
            <UmlGlyph name={glyphForDiagram(diagram.kind)} size={14} className="shrink-0 opacity-80" />
            <span className="truncate">{diagram.name}</span>
            <button
              type="button"
              aria-label={`${t('cmd.closeTab')} ${diagram.name}`}
              className="ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-surface-4 focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
