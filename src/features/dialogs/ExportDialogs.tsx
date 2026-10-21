import { useMemo, useState } from 'react';
import { zipSync, strToU8 } from 'fflate';
import { Button, Checkbox, Field, Select, Textarea } from '@/components/ui/controls';
import { Modal } from '@/components/ui/dialog';
import type { ID } from '@/domain/schemas/common';
import { validateProject } from '@/domain/validation/rules';
import { renderDiagramSvg } from '@/diagrams/render/diagramSvg';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { generateCode, type CodegenLanguage } from '@/services/codegen';
import {
  ExportTooLargeError,
  exportJson,
  exportPdf,
  exportPng,
  exportSvg,
  isWinAnsiEncodable,
  type ExportResult,
  type PageSize,
} from '@/services/export/exportService';
import { projectRepository } from '@/services/platform/platform';
import { exportDiagramText, type TextFormat } from '@/services/textExport/textExport';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { toast } from '@/stores/toastStore';

const close = () => useEditorStore.getState().closeDialog();

type Format = 'svg' | 'png' | 'pdf' | 'json';

export function ExportDialog({ diagramId }: { diagramId: ID }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const diagram = doc.diagrams[diagramId];
  const [format, setFormat] = useState<Format>('svg');
  const [scale, setScale] = useState<1 | 2 | 4>(2);
  const [background, setBackground] = useState<'white' | 'transparent'>('white');
  const [includeTitle, setIncludeTitle] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>('a4');
  const [orientation, setOrientation] = useState<'auto' | 'landscape' | 'portrait'>('auto');
  const [pageNumbers, setPageNumbers] = useState(false);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    if (!diagram) return null;
    const { svg, width, height } = renderDiagramSvg(doc, diagramId, {
      background: '#ffffff',
      heading: includeTitle ? diagram.name : undefined,
    });
    return {
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      width,
      height,
      vectorText: isWinAnsiEncodable(svg.replace(/<[^>]+>/g, '')),
    };
  }, [doc, diagramId, diagram, includeTitle]);
  const errors = useMemo(() => validateProject(doc).filter((i) => i.severity === 'error').length, [doc]);
  if (!diagram || !preview) return null;

  const run = async () => {
    setBusy(true);
    try {
      let result: ExportResult;
      if (format === 'svg') result = exportSvg(doc, diagramId, { background, includeTitle });
      else if (format === 'png')
        result = await exportPng(doc, diagramId, { background, scale, includeTitle });
      else if (format === 'pdf')
        result = await exportPdf(doc, diagramId, { pageSize, orientation, includeTitle, pageNumbers });
      else result = exportJson(doc);
      const base = format === 'json' ? doc.name : `${doc.name} - ${diagram.name}`;
      const saved = await projectRepository().exportFile(result.blob, base, {
        name: format.toUpperCase(),
        extensions: [result.extension],
        mime: result.mime,
      });
      if (saved) {
        toast.success(t('exportDialog.done', { file: saved }));
        if (result.notes.includes('rasterFallback')) toast.warning(t('exportDialog.rasterFallback'));
        close();
      }
    } catch (error) {
      if (error instanceof ExportTooLargeError)
        toast.error(t('exportDialog.tooLarge', { width: error.width, height: error.height }));
      else
        toast.error(
          t('exportDialog.failed', { reason: error instanceof Error ? error.message : String(error) }),
        );
    } finally {
      setBusy(false);
    }
  };

  const formats: Format[] = ['svg', 'png', 'pdf', 'json'];
  return (
    <Modal
      open
      onClose={close}
      title={t('exportDialog.title')}
      description={diagram.name}
      width="lg"
      testId="export-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void run()} data-testid="export-run">
            {busy ? t('exportDialog.exporting') : t('cmd.exportImage').replace('…', '')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[220px_1fr] gap-4">
        <div className="flex flex-col gap-3">
          <Field label={t('exportDialog.format')}>
            <div className="grid grid-cols-4 gap-1" role="radiogroup">
              {formats.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  data-testid={`export-format-${f}`}
                  onClick={() => setFormat(f)}
                  className={cn(
                    'h-7 rounded border text-[12px] font-medium uppercase',
                    format === f
                      ? 'border-accent bg-accent-muted text-accent'
                      : 'border-border-strong text-muted hover:text-fg',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </Field>
          {(format === 'svg' || format === 'png') && (
            <Field label={t('exportDialog.background')}>
              <Select
                value={background}
                onChange={(e) => setBackground(e.target.value as 'white' | 'transparent')}
                data-testid="export-background"
              >
                <option value="white">{t('exportDialog.white')}</option>
                <option value="transparent">{t('exportDialog.transparent')}</option>
              </Select>
            </Field>
          )}
          {format === 'png' && (
            <Field label={t('exportDialog.scale')}>
              <Select
                value={scale}
                onChange={(e) => setScale(Number(e.target.value) as 1 | 2 | 4)}
                data-testid="export-scale"
              >
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </Select>
              <span className="text-[11.5px] text-faint">
                {t('exportDialog.pixels', { width: preview.width * scale, height: preview.height * scale })}
              </span>
            </Field>
          )}
          {format === 'pdf' && (
            <>
              <Field label={t('exportDialog.pageSize')}>
                <Select
                  value={pageSize}
                  onChange={(e) => setPageSize(e.target.value as PageSize)}
                  data-testid="export-page-size"
                >
                  <option value="a4">A4</option>
                  <option value="a3">A3</option>
                  <option value="letter">Letter</option>
                  <option value="fit">{t('exportDialog.fitContent')}</option>
                </Select>
              </Field>
              {pageSize !== 'fit' && (
                <Field label={t('exportDialog.orientation')}>
                  <Select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as 'auto' | 'landscape' | 'portrait')}
                  >
                    <option value="auto">{t('exportDialog.auto')}</option>
                    <option value="landscape">{t('exportDialog.landscape')}</option>
                    <option value="portrait">{t('exportDialog.portrait')}</option>
                  </Select>
                </Field>
              )}
              <Checkbox
                label={t('exportDialog.pageNumbers')}
                checked={pageNumbers}
                onChange={setPageNumbers}
              />
              <p className={cn('text-[11.5px]', preview.vectorText ? 'text-faint' : 'text-warning')}>
                {preview.vectorText ? t('exportDialog.vectorNote') : t('exportDialog.rasterFallback')}
              </p>
            </>
          )}
          {format !== 'json' && (
            <Checkbox
              label={t('exportDialog.includeTitle')}
              checked={includeTitle}
              onChange={setIncludeTitle}
            />
          )}
          {format === 'json' && <p className="text-[12px] text-muted">{t('exportDialog.json')}</p>}
          {errors > 0 && (
            <p className="text-[11.5px] text-warning">
              {t('exportDialog.validationWarnings', { count: errors })}
            </p>
          )}
        </div>
        <div className="flex min-h-[260px] flex-col gap-1">
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
            {t('exportDialog.preview')}
          </span>
          <div className="flex flex-1 items-center justify-center rounded border border-border bg-[repeating-conic-gradient(var(--surface-3)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-2">
            <img
              src={preview.url}
              alt={t('exportDialog.preview')}
              className="max-h-[360px] max-w-full bg-white shadow"
              data-testid="export-preview"
            />
          </div>
          <span className="text-[11px] text-faint">
            {t('exportDialog.pixels', { width: preview.width, height: preview.height })}
          </span>
        </div>
      </div>
    </Modal>
  );
}

export function CodegenDialog() {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const [language, setLanguage] = useState<CodegenLanguage>('typescript');
  const [dataclasses, setDataclasses] = useState(true);
  const result = useMemo(() => generateCode(doc, language, { dataclasses }), [doc, language, dataclasses]);
  const [selected, setSelected] = useState(0);
  const file = result.files[Math.min(selected, result.files.length - 1)];
  const download = async () => {
    const entries: Record<string, Uint8Array> = {};
    for (const f of result.files) entries[f.path] = strToU8(f.content);
    entries['README-GENERATED.txt'] = strToU8(`${t('codegen.intro')}\n`);
    const zip = zipSync(entries, { level: 6 });
    const saved = await projectRepository().exportFile(
      new Blob([zip as BlobPart], { type: 'application/zip' }),
      `${doc.name}-${language}`,
      { name: 'ZIP', extensions: ['zip'], mime: 'application/zip' },
    );
    if (saved) {
      toast.success(t('codegen.generated', { count: result.files.length }));
      close();
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title={t('codegen.title')}
      description={t('codegen.intro')}
      width="xl"
      testId="codegen-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!result.files.length}
            onClick={() => void download()}
            data-testid="codegen-download"
          >
            {t('codegen.downloadZip')}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-end gap-3">
        <Field label={t('codegen.language')} className="w-48">
          <Select
            value={language}
            onChange={(e) => setLanguage(e.target.value as CodegenLanguage)}
            data-testid="codegen-language"
          >
            <option value="typescript">TypeScript</option>
            <option value="java">Java</option>
            <option value="python">Python 3</option>
          </Select>
        </Field>
        {language === 'python' && (
          <Checkbox label={t('codegen.pythonDataclass')} checked={dataclasses} onChange={setDataclasses} />
        )}
        <span className="ml-auto text-[12px] text-muted">
          {t('codegen.files', { count: result.files.length })}
        </span>
      </div>
      {result.files.length === 0 ? (
        <p className="text-[13px] text-muted">{t('codegen.noClassifiers')}</p>
      ) : (
        <div className="grid h-[380px] grid-cols-[200px_1fr] gap-3">
          <ul className="overflow-y-auto rounded border border-border bg-surface-2 p-1" role="listbox">
            {result.files.map((f, i) => (
              <li key={f.path}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === selected}
                  onClick={() => setSelected(i)}
                  className={cn(
                    'w-full truncate rounded px-2 py-1 text-left font-mono text-[11.5px]',
                    i === selected ? 'bg-accent-muted text-accent' : 'text-fg hover:bg-surface-3',
                  )}
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
          <pre
            className="overflow-auto rounded border border-border bg-surface-2 p-2 font-mono text-[11.5px] leading-snug text-fg select-text"
            data-testid="codegen-preview"
          >
            {file?.content}
          </pre>
        </div>
      )}
      {result.warnings.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] text-warning">
            {t('codegen.warnings')} ({result.warnings.length})
          </summary>
          <ul className="mt-1 max-h-28 overflow-y-auto text-[11.5px] text-muted">
            {result.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </details>
      )}
    </Modal>
  );
}

export function TextExportDialog({ diagramId }: { diagramId: ID }) {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const [format, setFormat] = useState<TextFormat>('plantuml');
  const result = useMemo(() => exportDiagramText(doc, diagramId, format), [doc, diagramId, format]);
  const diagram = doc.diagrams[diagramId];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.text);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('exportDialog.failed', { reason: 'clipboard' }));
    }
  };
  const download = async () => {
    const ext = format === 'mermaid' ? 'mmd' : 'puml';
    const saved = await projectRepository().exportFile(
      new Blob([result.text], { type: 'text/plain' }),
      `${doc.name} - ${diagram?.name ?? ''}`,
      { name: format, extensions: [ext], mime: 'text/plain' },
    );
    if (saved) toast.success(t('exportDialog.done', { file: saved }));
  };
  return (
    <Modal
      open
      onClose={close}
      title={t('textExport.title')}
      description={diagram?.name}
      width="lg"
      testId="text-export-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.close')}
          </Button>
          <Button disabled={!result.supported} onClick={() => void copy()}>
            {t('common.copyToClipboard')}
          </Button>
          <Button
            variant="primary"
            disabled={!result.supported}
            onClick={() => void download()}
            data-testid="text-export-download"
          >
            {t('common.download')}
          </Button>
        </>
      }
    >
      <Field label={t('textExport.format')} className="mb-3 w-48">
        <Select
          value={format}
          onChange={(e) => setFormat(e.target.value as TextFormat)}
          data-testid="text-export-format"
        >
          <option value="plantuml">{t('textExport.plantuml')}</option>
          <option value="mermaid">{t('textExport.mermaid')}</option>
        </Select>
      </Field>
      {result.supported ? (
        <Textarea
          readOnly
          value={result.text}
          rows={16}
          className="font-mono text-[11.5px]"
          data-testid="text-export-output"
        />
      ) : (
        <p className="text-[13px] text-muted">{t('textExport.unsupported')}</p>
      )}
      {result.lost.length > 0 && (
        <div className="mt-2 text-[12px] text-warning">
          {t('textExport.lost')}: {result.lost.join('; ')}
        </div>
      )}
    </Modal>
  );
}
