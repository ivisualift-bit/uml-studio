import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DIAGRAM_CATALOG, type ToolDef } from '@/diagrams/registry/catalog';
import { UmlGlyph } from '@/diagrams/registry/glyphs';
import { DRAG_TOOL_MIME } from '@/diagrams/graph/graphActions';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore, type Tool } from '@/stores/editorStore';

function toolMode(tool: ToolDef): 'place' | 'connect' {
  return tool.type === 'relationship' || tool.type === 'noteLink' || tool.type === 'message' ? 'connect' : 'place';
}

export function Toolbox() {
  const t = useT();
  const activeId = useEditorStore((s) => s.activeDiagramId);
  const kind = useDocumentStore((s) => (activeId ? s.doc?.diagrams[activeId]?.kind : undefined));
  const current = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (!kind) {
    return <p className="px-3 py-2 text-[12px] text-faint">{t('toolbox.noDiagram')}</p>;
  }
  const entry = DIAGRAM_CATALOG[kind];
  if (entry.status === 'planned') return <p className="px-3 py-2 text-[12px] text-faint">{t('toolbox.planned')}</p>;

  const isActive = (tool: ToolDef) => (current.kind === 'place' || current.kind === 'connect') && current.toolId === tool.id;
  const arm = (tool: ToolDef, sticky: boolean) => {
    const next: Tool = { kind: toolMode(tool), toolId: tool.id, sticky };
    setTool(isActive(tool) && !sticky ? { kind: 'select' } : next);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-2" role="toolbar" aria-orientation="vertical" aria-label={t('toolbox.title')} data-testid="toolbox">
      {entry.groups.map((group) => {
        const open = !collapsed.has(group.titleKey);
        return (
          <div key={group.titleKey} className="mb-1">
            <button
              type="button"
              className="flex h-6 w-full items-center gap-1 px-2 text-[10.5px] font-semibold tracking-wider text-faint uppercase hover:text-muted"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.titleKey)) next.delete(group.titleKey);
                  else next.add(group.titleKey);
                  return next;
                })
              }
              aria-expanded={open}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {t(group.titleKey)}
            </button>
            {open && (
              <div className="grid grid-cols-1 gap-px px-1.5">
                {group.tools.map((tool) => {
                  const label = t(tool.labelKey, tool.labelParams);
                  const active = isActive(tool);
                  const draggable = tool.type === 'node' || tool.type === 'note';
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      data-testid={`tool-${tool.id}`}
                      aria-pressed={active}
                      title={`${label} — ${toolMode(tool) === 'connect' ? t('toolbox.connectHint') : t('toolbox.clickToPlace')}`}
                      draggable={draggable}
                      onDragStart={(e) => {
                        if (!draggable) return;
                        e.dataTransfer.setData(DRAG_TOOL_MIME, tool.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => arm(tool, false)}
                      onDoubleClick={() => arm(tool, true)}
                      className={cn(
                        'flex h-7 items-center gap-2 rounded px-2 text-left text-[12.5px] text-fg hover:bg-surface-3',
                        active && 'bg-accent-muted text-accent ring-1 ring-accent-border hover:bg-accent-muted',
                      )}
                    >
                      <UmlGlyph name={tool.glyph} size={16} className={active ? 'text-accent' : 'text-muted'} />
                      <span className="truncate">{label}</span>
                      {active && 'sticky' in current && current.sticky && <span className="ml-auto text-[10px] text-accent">●</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
