import { Component, type ErrorInfo, type ReactNode } from 'react';
import { serializeProject } from '@/domain/serialization/projectFile';
import { downloadBlob } from '@/services/persistence/browserRepository';
import { useDocumentStore } from '@/stores/documentStore';
import { t } from '@/i18n';

interface State {
  error: Error | null;
}

/** Last-resort UI error handler: the document stays in memory and can be downloaded. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UML Studio UI error', error, info.componentStack);
  }

  private download = () => {
    const doc = useDocumentStore.getState().doc;
    if (!doc) return;
    try {
      downloadBlob(
        new Blob([serializeProject(doc)], { type: 'application/json' }),
        `${doc.name || 'project'}-recovered.umls`,
      );
    } catch (error) {
      console.error(error);
    }
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const hasDoc = !!useDocumentStore.getState().doc;
    return (
      <div className="flex h-full items-center justify-center bg-bg p-6">
        <div
          className="max-w-lg rounded-lg border border-border-strong bg-surface-1 p-5 shadow-panel"
          role="alert"
        >
          <h1 className="text-[15px] font-semibold">{t('error.boundaryTitle')}</h1>
          <p className="mt-2 text-[13px] text-muted">{t('error.boundaryBody')}</p>
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] text-danger">
            {error.message}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="h-8 rounded-md bg-accent px-3 text-[13px] text-accent-text"
              onClick={() => this.setState({ error: null })}
            >
              {t('error.tryAgain')}
            </button>
            {hasDoc && (
              <button
                type="button"
                className="h-8 rounded-md border border-border-strong px-3 text-[13px]"
                onClick={this.download}
              >
                {t('error.saveFirst')}
              </button>
            )}
            <button
              type="button"
              className="h-8 rounded-md border border-border-strong px-3 text-[13px]"
              onClick={() => window.location.reload()}
            >
              {t('error.reload')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
