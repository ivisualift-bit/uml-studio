import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useToastStore } from '@/stores/toastStore';

const ICONS = {
  info: <Info size={15} className="text-accent" />,
  success: <CheckCircle2 size={15} className="text-success" />,
  warning: <AlertTriangle size={15} className="text-warning" />,
  error: <AlertCircle size={15} className="text-danger" />,
};

/** Non-modal notifications. Errors stay longer and expose technical details. */
export function Toaster() {
  const t = useT();
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 bottom-9 z-[80] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2" aria-live="polite" role="status">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          data-kind={toast.kind}
          className={cn(
            'animate-toast-in pointer-events-auto rounded-md border bg-surface-2 px-3 py-2 text-[12.5px] text-fg shadow-panel',
            toast.kind === 'error' ? 'border-danger/50' : toast.kind === 'warning' ? 'border-warning/50' : 'border-border-strong',
          )}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5">{ICONS[toast.kind]}</span>
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button type="button" className="rounded p-0.5 text-faint hover:text-fg" onClick={() => dismiss(toast.id)} aria-label={t('common.close')}>
              <X size={13} />
            </button>
          </div>
          {toast.details && toast.details.length > 0 && (
            <details className="mt-1 pl-6">
              <summary className="cursor-pointer text-[11.5px] text-muted">{t('common.details')}</summary>
              <pre className="mt-1 max-h-32 overflow-auto font-mono text-[10.5px] whitespace-pre-wrap text-muted">{toast.details.join('\n')}</pre>
            </details>
          )}
          {toast.action && (
            <div className="mt-1.5 pl-6">
              <button
                type="button"
                className="text-[12px] font-medium text-accent hover:underline"
                onClick={() => {
                  toast.action!.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
