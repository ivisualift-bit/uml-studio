import type { ReactNode } from 'react';
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Shared look for menubar, dropdown and context menu content. */
export const menuContentClass =
  'z-[60] min-w-[220px] rounded-md border border-border-strong bg-surface-2 p-1 text-[13px] text-fg shadow-panel data-[state=open]:animate-toast-in';
export const menuItemClass =
  'relative flex h-7 cursor-default items-center gap-2 rounded px-2 pr-3 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-text';
export const menuSeparatorClass = 'my-1 h-px bg-border';
export const menuLabelClass = 'px-2 py-1 text-[11px] font-semibold tracking-wide text-faint uppercase';

export function ItemContent({ label, shortcut, checked, icon }: { label: string; shortcut?: string; checked?: boolean; icon?: ReactNode }) {
  return (
    <>
      <span className="flex w-4 items-center justify-center">{checked ? <Check size={13} /> : icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut && <span className="ml-4 text-[11.5px] tracking-wide opacity-70">{shortcut}</span>}
    </>
  );
}

export function SubTriggerContent({ label }: { label: string }) {
  return (
    <>
      <span className="w-4" />
      <span className="flex-1">{label}</span>
      <ChevronRight size={13} className="opacity-70" />
    </>
  );
}

export interface MenuEntry {
  type?: 'item' | 'separator' | 'label' | 'submenu';
  label?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  onSelect?: () => void;
  children?: MenuEntry[];
  testId?: string;
}

/** Render menu entries for DropdownMenu or ContextMenu (they share the same primitive API). */
export function renderEntries(entries: MenuEntry[], kind: 'dropdown' | 'context'): ReactNode {
  const M = kind === 'dropdown' ? DropdownMenu : ContextMenu;
  return entries.map((entry, i) => {
    if (entry.type === 'separator') return <M.Separator key={i} className={menuSeparatorClass} />;
    if (entry.type === 'label') return <M.Label key={i} className={menuLabelClass}>{entry.label}</M.Label>;
    if (entry.type === 'submenu') {
      return (
        <M.Sub key={i}>
          <M.SubTrigger className={menuItemClass} disabled={entry.disabled}>
            <SubTriggerContent label={entry.label ?? ''} />
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className={menuContentClass} sideOffset={2}>
              {renderEntries(entry.children ?? [], kind)}
            </M.SubContent>
          </M.Portal>
        </M.Sub>
      );
    }
    return (
      <M.Item
        key={i}
        className={cn(menuItemClass, entry.danger && 'text-danger data-[highlighted]:bg-danger data-[highlighted]:text-white')}
        disabled={entry.disabled}
        onSelect={() => entry.onSelect?.()}
        data-testid={entry.testId}
      >
        <ItemContent label={entry.label ?? ''} shortcut={entry.shortcut} checked={entry.checked} icon={entry.icon} />
      </M.Item>
    );
  });
}
