import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { revealElement } from '@/app/actions';
import type { ValidationIssue } from '@/domain/validation/types';
import { validateProject } from '@/domain/validation/rules';
import { glyphForElement, UmlGlyph } from '@/diagrams/registry/glyphs';
import { hasMessage, useT, type Translate } from '@/i18n';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';

/** Stable empty selection (Zustand selectors must not return fresh arrays). */
const NO_SELECTION: string[] = [];

/** Debounced full validation (cheap for student-sized models; see TEST_REPORT for timings). */
export function useValidationIssues(): ValidationIssue[] {
  const doc = useDocumentStore((s) => s.doc);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  useEffect(() => {
    if (!doc) {
      setIssues([]);
      return;
    }
    const handle = window.setTimeout(() => setIssues(validateProject(doc)), 250);
    return () => window.clearTimeout(handle);
  }, [doc]);
  return issues;
}

export function issueMessage(t: Translate, issue: ValidationIssue): string {
  const params: Record<string, string | number> = { ...issue.params };
  if (typeof params.kind === 'string' && hasMessage(`elementKind.${params.kind}`)) params.kind = t(`elementKind.${params.kind}` as never);
  const key = `problems.${issue.code}`;
  return hasMessage(key) ? t(key, params) : issue.code;
}

const ICONS = {
  error: <AlertCircle size={13} className="text-danger" />,
  warning: <AlertTriangle size={13} className="text-warning" />,
  info: <Info size={13} className="text-accent" />,
};

export function BottomPanel({ issues }: { issues: ValidationIssue[] }) {
  const t = useT();
  const tab = useEditorStore((s) => s.bottomTab);
  const setTab = useEditorStore((s) => s.setBottomTab);
  const toggle = useEditorStore((s) => s.togglePanel);
  const counts = useMemo(
    () => ({
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
    }),
    [issues],
  );
  return (
    <section className="flex h-full min-h-0 flex-col border-t border-border bg-surface-1" aria-label={t('problems.title')} data-testid="bottom-panel">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2">
        {(['problems', 'outline'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn('h-6 rounded px-2 text-[12px]', tab === value ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg')}
            onClick={() => setTab(value)}
            data-testid={`bottom-tab-${value}`}
          >
            {t(value === 'problems' ? 'problems.title' : 'problems.outline')}
            {value === 'problems' && issues.length > 0 && <span className="ml-1.5 rounded bg-surface-4 px-1 text-[10.5px]">{issues.length}</span>}
          </button>
        ))}
        <span className="ml-2 text-[11.5px] text-faint">{tab === 'problems' ? t('problems.counts', counts) : ''}</span>
        <button type="button" className="ml-auto rounded p-1 text-muted hover:bg-surface-3 hover:text-fg" aria-label={t('common.close')} onClick={() => toggle('bottom', false)}>
          <X size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'problems' ? <ProblemList issues={issues} /> : <Outline />}</div>
    </section>
  );
}

function ProblemList({ issues }: { issues: ValidationIssue[] }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc);
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const shown = filter === 'all' ? issues : issues.filter((i) => i.severity === filter);
  if (!issues.length) return <p className="px-3 py-2 text-[12px] text-faint" data-testid="no-problems">{t('problems.none')}</p>;
  return (
    <div>
      <div className="flex gap-1 px-2 py-1">
        {(['all', 'error', 'warning', 'info'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={cn('rounded px-1.5 py-0.5 text-[11px]', filter === f ? 'bg-accent-muted text-accent' : 'text-muted hover:text-fg')}
            onClick={() => setFilter(f)}
          >
            {t(f === 'all' ? 'problems.filterAll' : f === 'error' ? 'problems.filterErrors' : f === 'warning' ? 'problems.filterWarnings' : 'problems.filterInfo')}
          </button>
        ))}
      </div>
      <ul role="list">
        {shown.map((issue) => {
          const el = issue.elementId ? doc?.modelElements[issue.elementId] : undefined;
          return (
            <li key={issue.id}>
              <button
                type="button"
                data-testid="problem-item"
                data-code={issue.code}
                data-severity={issue.severity}
                className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12.5px] hover:bg-surface-3"
                onClick={() => {
                  if (!issue.elementId) return;
                  if (!revealElement(issue.elementId, issue.diagramId)) useEditorStore.getState().selectInExplorer(issue.elementId);
                }}
                title={t(`problems.${issue.severity}`)}
              >
                {ICONS[issue.severity]}
                <span className="flex-1 truncate">{issueMessage(t, issue)}</span>
                {el && (
                  <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-faint">
                    <UmlGlyph name={glyphForElement(el.kind)} size={13} />
                    {el.name || t(`elementKind.${el.kind}`)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Outline() {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc);
  const diagramId = useEditorStore((s) => s.activeDiagramId);
  const selection = useEditorStore((s) => (diagramId ? (s.selections[diagramId] ?? NO_SELECTION) : NO_SELECTION));
  const diagram = diagramId ? doc?.diagrams[diagramId] : undefined;
  if (!doc || !diagram) return <p className="px-3 py-2 text-[12px] text-faint">{t('status.noDiagram')}</p>;
  const rows = Object.values(diagram.views).map((v) => {
    const el = 'elementId' in v ? doc.modelElements[v.elementId] : undefined;
    return { view: v, el, label: el ? el.name || t(`elementKind.${el.kind}`) : v.kind === 'note' ? v.text.slice(0, 40) || t('elementKind.note') : t('elementKind.noteLink') };
  });
  return (
    <ul role="list" data-testid="outline">
      {rows.map(({ view, el, label }) => (
        <li key={view.id}>
          <button
            type="button"
            className={cn('flex w-full items-center gap-2 px-3 py-0.5 text-left text-[12.5px] hover:bg-surface-3', selection.includes(view.id) && 'bg-accent-muted')}
            onClick={() => {
              const editor = useEditorStore.getState();
              editor.setSelection(diagram.id, [view.id]);
              editor.requestFocus(diagram.id, [view.id]);
            }}
          >
            <UmlGlyph name={el ? glyphForElement(el.kind) : 'note'} size={13} className="text-muted" />
            <span className="truncate">{label}</span>
            <span className="ml-auto text-[11px] text-faint">{el ? t(`elementKind.${el.kind}`) : t('elementKind.note')}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
