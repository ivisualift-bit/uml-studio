import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  /** Prevent closing by clicking outside (destructive confirmations). */
  modal?: boolean;
  testId?: string;
}

const widths = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[760px]', xl: 'max-w-[960px]' };

/** Accessible modal (focus trap, Esc closes, focus restored on close) built on Radix Dialog. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
  testId,
}: ModalProps) {
  const t = useT();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content
          data-testid={testId}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-strong bg-surface-1 shadow-panel focus:outline-none',
            widths[width],
          )}
          onEscapeKeyDown={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 pt-3.5 pb-3">
            <div className="min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-fg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-[12.5px] text-muted">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                className="rounded p-1 text-muted hover:bg-surface-3 hover:text-fg"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
