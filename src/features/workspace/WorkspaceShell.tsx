import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Tooltip } from 'radix-ui';
import { ProjectExplorer } from '@/features/explorer/ProjectExplorer';
import { Inspector } from '@/features/inspector/Inspector';
import { BottomPanel, useValidationIssues } from '@/features/problems/ProblemsPanel';
import { Toolbox } from '@/features/toolbox/Toolbox';
import { UmlGlyph } from '@/diagrams/registry/glyphs';
import { useT } from '@/i18n';
import { selectIsDirty, useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { DiagramHost } from './DiagramHost';
import { DiagramTabs } from './DiagramTabs';
import { MenuBar } from './MenuBar';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

const LAYOUT_KEY = 'uml-studio.layout.v1';

interface PanelSizes {
  sidebar: number;
  inspector: number;
  bottom: number;
  toolbox: number;
}

function loadSizes(): PanelSizes {
  const defaults = { sidebar: 264, inspector: 312, bottom: 170, toolbox: 0.48 };
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<PanelSizes>) } : defaults;
  } catch {
    return defaults;
  }
}

/** Drag handle resizing an adjacent panel. */
function Splitter({
  orientation,
  onDrag,
  onEnd,
  label,
}: {
  orientation: 'vertical' | 'horizontal';
  onDrag: (delta: number) => void;
  onEnd: () => void;
  label: string;
}) {
  const start = useRef<number | null>(null);
  const down = (e: ReactPointerEvent) => {
    start.current = orientation === 'vertical' ? e.clientX : e.clientY;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    if (start.current === null) return;
    const pos = orientation === 'vertical' ? e.clientX : e.clientY;
    onDrag(pos - start.current);
    start.current = pos;
  };
  const up = () => {
    start.current = null;
    onEnd();
  };
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      className={
        orientation === 'vertical'
          ? 'w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent'
          : 'h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-accent'
      }
    />
  );
}

export function WorkspaceShell({ children }: { children?: ReactNode }) {
  const t = useT();
  const sidebarVisible = useEditorStore((s) => s.sidebarVisible);
  const inspectorVisible = useEditorStore((s) => s.inspectorVisible);
  const bottomVisible = useEditorStore((s) => s.bottomVisible);
  const projectName = useDocumentStore((s) => s.doc?.name);
  const dirty = useDocumentStore(selectIsDirty);
  const issues = useValidationIssues();
  const [sizes, setSizes] = useState<PanelSizes>(loadSizes);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const persist = useCallback(() => {
    setSizes((current) => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(current));
      } catch {
        // per-viewer convenience only
      }
      return current;
    });
  }, []);
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="flex h-full flex-col" data-testid="workspace">
        <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-2">
          <span className="flex items-center gap-1.5 pr-1 text-[12.5px] font-semibold text-fg">
            <UmlGlyph name="class" size={16} className="text-accent" />
            {t('app.name')}
          </span>
          <MenuBar />
          <span className="flex-1" />
          <span className="truncate text-[12px] text-muted" data-testid="title-project-name">
            {projectName}
            {dirty && <span title={t('project.dirtyMarker')}> •</span>}
          </span>
        </header>
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          {sidebarVisible && (
            <>
              <aside
                ref={sidebarRef}
                className="flex min-h-0 shrink-0 flex-col bg-surface-1"
                style={{ width: sizes.sidebar }}
                aria-label={t('explorer.title')}
              >
                <div className="flex min-h-0 flex-col" style={{ flex: `${1 - sizes.toolbox} 1 0` }}>
                  <ProjectExplorer />
                </div>
                <Splitter
                  orientation="horizontal"
                  label={t('toolbox.title')}
                  onDrag={(d) => {
                    const h = sidebarRef.current?.clientHeight ?? 600;
                    setSizes((s) => ({ ...s, toolbox: clamp(s.toolbox - d / h, 0.15, 0.85) }));
                  }}
                  onEnd={persist}
                />
                <div className="flex min-h-0 flex-col" style={{ flex: `${sizes.toolbox} 1 0` }}>
                  <div className="flex h-8 shrink-0 items-center px-3">
                    <h2 className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                      {t('toolbox.title')}
                    </h2>
                  </div>
                  <Toolbox />
                </div>
              </aside>
              <Splitter
                orientation="vertical"
                label={t('explorer.title')}
                onDrag={(d) => setSizes((s) => ({ ...s, sidebar: clamp(s.sidebar + d, 180, 520) }))}
                onEnd={persist}
              />
            </>
          )}
          <main className="flex min-w-0 flex-1 flex-col">
            <DiagramTabs />
            <div className="relative min-h-0 flex-1">
              <DiagramHost />
            </div>
            {bottomVisible && (
              <>
                <Splitter
                  orientation="horizontal"
                  label={t('problems.title')}
                  onDrag={(d) => setSizes((s) => ({ ...s, bottom: clamp(s.bottom - d, 80, 480) }))}
                  onEnd={persist}
                />
                <div className="shrink-0" style={{ height: sizes.bottom }}>
                  <BottomPanel issues={issues} />
                </div>
              </>
            )}
          </main>
          {inspectorVisible && (
            <>
              <Splitter
                orientation="vertical"
                label={t('inspector.title')}
                onDrag={(d) => setSizes((s) => ({ ...s, inspector: clamp(s.inspector - d, 240, 560) }))}
                onEnd={persist}
              />
              <div className="min-h-0 shrink-0 border-l border-border" style={{ width: sizes.inspector }}>
                <Inspector />
              </div>
            </>
          )}
        </div>
        <StatusBar problemCount={issues.length} />
        {children}
      </div>
    </Tooltip.Provider>
  );
}
