import { useEffect, useMemo, useState } from 'react';
import { discardRecovery, newProject, openImportedProject, restoreRecovery } from '@/app/actions';
import { Button, Field, Input, Select } from '@/components/ui/controls';
import { Modal } from '@/components/ui/dialog';
import type { LoadError } from '@/domain/serialization/projectFile';
import { renderDiagramSvg } from '@/diagrams/render/diagramSvg';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import type { MdjImportResult } from '@/services/import/mdjImport';
import { recoveryRepository } from '@/services/platform/platform';
import { TEMPLATES } from '@/services/templates/templates';
import { useEditorStore, type RecoverySnapshotInfo } from '@/stores/editorStore';

const close = () => useEditorStore.getState().closeDialog();

export function NewProjectDialog() {
  const t = useT();
  const [name, setName] = useState(t('project.defaultName'));
  const [template, setTemplate] = useState('blank');
  const create = () => {
    close();
    void newProject(name.trim() || t('project.defaultName'), template);
  };
  return (
    <Modal
      open
      onClose={close}
      title={t('project.newTitle')}
      width="sm"
      testId="new-project-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={create} data-testid="create-project">
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <Field label={t('project.nameLabel')} htmlFor="project-name">
          <Input
            id="project-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="project-name-input"
          />
        </Field>
        <Field label={t('project.templateLabel')} htmlFor="project-template">
          <Select id="project-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="blank">{t('project.blank')}</option>
            {TEMPLATES.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {t(tpl.nameKey)}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

function TemplatePreview({ id }: { id: string }) {
  const url = useMemo(() => {
    const template = TEMPLATES.find((tpl) => tpl.id === id);
    if (!template) return null;
    const doc = template.build();
    const diagram = Object.values(doc.diagrams)[0];
    if (!diagram) return null;
    const { svg } = renderDiagramSvg(doc, diagram.id, { background: '#ffffff', margin: 12 });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [id]);
  if (!url) return <div className="h-28 rounded bg-white" />;
  return (
    <img
      src={url}
      alt=""
      className="h-28 w-full rounded border border-border bg-white object-contain p-1"
      draggable={false}
    />
  );
}

export function TemplatesDialog() {
  const t = useT();
  const [selected, setSelected] = useState(TEMPLATES[0]?.id ?? 'blank');
  const use = (id: string) => {
    close();
    void newProject(undefined, id);
  };
  return (
    <Modal
      open
      onClose={close}
      title={t('templates.title')}
      description={t('templates.intro')}
      width="xl"
      testId="templates-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => use(selected)} data-testid="use-template">
            {t('templates.use')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            data-testid={`template-${tpl.id}`}
            onClick={() => setSelected(tpl.id)}
            onDoubleClick={() => use(tpl.id)}
            className={cn(
              'flex flex-col gap-2 rounded-lg border p-2 text-left hover:border-accent',
              selected === tpl.id ? 'border-accent bg-accent-muted' : 'border-border bg-surface-2',
            )}
          >
            <TemplatePreview id={tpl.id} />
            <div>
              <div className="text-[13px] font-medium text-fg">{t(tpl.nameKey)}</div>
              <div className="text-[11.5px] text-muted">{t(tpl.descriptionKey)}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function UnsavedDialog({
  projectName,
  onDecision,
}: {
  projectName: string;
  onDecision: (d: 'save' | 'discard' | 'cancel') => void;
}) {
  const t = useT();
  return (
    <Modal
      open
      onClose={() => onDecision('cancel')}
      title={t('project.unsavedTitle')}
      width="sm"
      testId="unsaved-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={() => onDecision('discard')} data-testid="unsaved-discard">
            {t('project.dontSave')}
          </Button>
          <Button onClick={() => onDecision('cancel')}>{t('common.cancel')}</Button>
          <Button variant="primary" autoFocus onClick={() => onDecision('save')} data-testid="unsaved-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="text-[13px]">{t('project.unsavedBody', { name: projectName })}</p>
    </Modal>
  );
}

export function RecoveryDialog({ snapshots }: { snapshots: RecoverySnapshotInfo[] }) {
  const t = useT();
  const [list, setList] = useState(snapshots);
  useEffect(() => {
    if (list.length === 0) close();
  }, [list.length]);
  return (
    <Modal
      open
      onClose={close}
      title={t('recovery.title')}
      description={t('recovery.body')}
      testId="recovery-dialog"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={async () => {
              await recoveryRepository().clearRecoveries();
              close();
            }}
          >
            {t('recovery.discardAll')}
          </Button>
          <Button onClick={close}>{t('common.close')}</Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2">
        {list.map((s) => (
          <li
            key={s.projectId}
            className="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-2.5"
            data-testid="recovery-item"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">
                {t('recovery.project', { name: s.projectName })}
              </div>
              <div className="text-[11.5px] text-muted">
                {t('recovery.savedAt', { date: new Date(s.savedAt).toLocaleString() })} ·{' '}
                {t('recovery.details', { elements: s.elementCount, diagrams: s.diagramCount })}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              data-testid="recovery-discard"
              onClick={async () => {
                await discardRecovery(s.projectId);
                setList((prev) => prev.filter((x) => x.projectId !== s.projectId));
              }}
            >
              {t('recovery.discard')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              data-testid="recovery-restore"
              onClick={() => {
                close();
                void restoreRecovery(s.projectId);
              }}
            >
              {t('recovery.restore')}
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function LoadErrorDialog({ fileName, error }: { fileName: string; error: LoadError }) {
  const t = useT();
  return (
    <Modal
      open
      onClose={close}
      title={t('loadError.title', { name: fileName })}
      description={t('loadError.intro')}
      testId="load-error-dialog"
      footer={<Button onClick={close}>{t('common.close')}</Button>}
    >
      <p className="mb-3 text-[13px] text-danger" data-testid="load-error-message" data-code={error.code}>
        {t(`loadError.${error.code}`, { version: error.version ?? '?' })}
      </p>
      {error.details.length > 0 && (
        <details open={error.details.length < 4}>
          <summary className="cursor-pointer text-[12px] text-muted">{t('loadError.technical')}</summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted">
            {error.details.join('\n')}
          </pre>
        </details>
      )}
    </Modal>
  );
}

function CountList({ counts, testId }: { counts: Record<string, number>; testId: string }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return (
    <ul
      className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11.5px] text-muted"
      data-testid={testId}
    >
      {rows.map(([type, count]) => (
        <li key={type} className="flex justify-between gap-2" data-type={type}>
          <span className="truncate">{type}</span>
          <span className="text-fg">{count}</span>
        </li>
      ))}
    </ul>
  );
}

export function MdjImportDialog({ fileName, result }: { fileName: string; result: MdjImportResult }) {
  const t = useT();
  if (!result.ok) {
    return (
      <Modal
        open
        onClose={close}
        title={t('mdj.failed', { name: fileName })}
        description={t('mdj.intro')}
        testId="mdj-import-dialog"
        footer={<Button onClick={close}>{t('common.close')}</Button>}
      >
        <p
          className="mb-3 text-[13px] text-danger"
          data-testid="mdj-import-error"
          data-code={result.error.code}
        >
          {t(`mdj.error.${result.error.code}`)}
        </p>
        {result.error.details.length > 0 && (
          <details open={result.error.details.length < 4}>
            <summary className="cursor-pointer text-[12px] text-muted">{t('loadError.technical')}</summary>
            <pre className="mt-2 max-h-56 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted">
              {result.error.details.join('\n')}
            </pre>
          </details>
        )}
      </Modal>
    );
  }
  const { doc, report } = result;
  const skipped = Object.keys(report.unsupported).length > 0;
  const warningCount = report.warnings.length + report.moreWarnings;
  return (
    <Modal
      open
      onClose={close}
      title={t('mdj.title')}
      description={t('mdj.intro')}
      testId="mdj-import-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            data-testid="mdj-open"
            onClick={() => {
              close();
              void openImportedProject(doc);
            }}
          >
            {t('mdj.open')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px]">
        <p className="text-fg" data-testid="mdj-import-summary">
          {t('mdj.summary', {
            elements: report.elements,
            diagrams: report.diagrams,
            views: report.views,
            name: fileName,
          })}
        </p>
        <section>
          <h3 className="mb-1 text-[12px] font-semibold text-fg">{t('mdj.translated')}</h3>
          <CountList counts={report.imported} testId="mdj-imported" />
        </section>
        <section>
          <h3 className="mb-1 text-[12px] font-semibold text-fg">{t('mdj.skipped')}</h3>
          {skipped ? (
            <CountList counts={report.unsupported} testId="mdj-unsupported" />
          ) : (
            <p className="text-muted">{t('mdj.nothingSkipped')}</p>
          )}
        </section>
        {warningCount > 0 && (
          <details>
            <summary className="cursor-pointer text-[12px] text-muted">
              {t('mdj.warnings', { count: warningCount })}
            </summary>
            <ul
              className="mt-2 max-h-48 list-disc overflow-auto pl-5 text-[11.5px] text-muted"
              data-testid="mdj-warnings"
            >
              {report.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
              {report.moreWarnings > 0 && <li>{t('mdj.moreWarnings', { count: report.moreWarnings })}</li>}
            </ul>
          </details>
        )}
        <p className="rounded border border-border bg-surface-2 px-2.5 py-2 text-[12px] text-muted">
          {t('mdj.newProject')}
        </p>
      </div>
    </Modal>
  );
}
