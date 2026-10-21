import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { Search } from 'lucide-react';
import { revealElement } from '@/app/actions';
import { COMMANDS, isEnabled, primaryShortcut } from '@/app/commands';
import { Kbd } from '@/components/ui/controls';
import { isRelationship } from '@/domain/schemas/elements';
import { qualifiedName } from '@/domain/services/queries';
import { glyphForDiagram, glyphForElement, UmlGlyph } from '@/diagrams/registry/glyphs';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';

interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

const close = () => useEditorStore.getState().closeDialog();

/** Fuzzy-ish match: every query token must appear in the haystack. */
function matches(query: string, haystack: string): boolean {
  const text = haystack.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => text.includes(token));
}

function PaletteShell({ placeholder, items, testId }: { placeholder: string; items: (query: string) => PaletteItem[]; testId: string }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => items(query).slice(0, 80), [items, query]);
  const choose = (item: PaletteItem | undefined) => {
    if (!item || item.disabled) return;
    close();
    // Run after the dialog unmounts so focus returns to the workspace first.
    setTimeout(item.run, 0);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(shown[active]);
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content className="fixed top-[14vh] left-1/2 z-50 w-[min(620px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-border-strong bg-surface-1 shadow-panel" data-testid={testId}>
          <Dialog.Title className="sr-only">{placeholder}</Dialog.Title>
          <Dialog.Description className="sr-only">{placeholder}</Dialog.Description>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={15} className="text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="h-11 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint"
              aria-label={placeholder}
              role="combobox"
              aria-expanded
              aria-controls={`${testId}-list`}
              data-testid={`${testId}-input`}
            />
          </div>
          <ul ref={list} id={`${testId}-list`} role="listbox" className="max-h-[50vh] overflow-y-auto p-1">
            {shown.length === 0 && <li className="px-3 py-2 text-[12.5px] text-faint">{t('palette.noResults')}</li>}
            {shown.map((item, i) => (
              <li key={item.id} role="option" aria-selected={i === active} aria-disabled={item.disabled}>
                <button
                  type="button"
                  className={cn('flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px]', i === active ? 'bg-accent text-accent-text' : 'text-fg', item.disabled && 'opacity-45')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                  data-testid="palette-item"
                >
                  <span className="flex w-5 justify-center">{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.detail && <span className={cn('truncate text-[11.5px]', i === active ? 'opacity-80' : 'text-faint')}>{item.detail}</span>}
                  {item.disabled && <span className="text-[11px]">{t('palette.disabled')}</span>}
                  {item.shortcut && <Kbd className={i === active ? 'border-white/40 bg-transparent text-accent-text' : undefined}>{item.shortcut}</Kbd>}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CommandPalette() {
  const t = useT();
  const items = useMemo(
    () => (query: string) =>
      COMMANDS.filter((c) => c.id !== 'view.palette')
        .map<PaletteItem>((c) => ({ id: c.id, label: t(c.labelKey), shortcut: primaryShortcut(c.id), disabled: !isEnabled(c), run: () => void c.run() }))
        .filter((item) => !query || matches(query, item.label))
        .sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled)),
    [t],
  );
  return <PaletteShell placeholder={t('palette.placeholder')} items={items} testId="command-palette" />;
}

export function QuickSearch() {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const items = useMemo(
    () => (query: string) => {
      const diagrams = Object.values(doc.diagrams)
        .filter((d) => !query || matches(query, `${d.name} ${t(`diagramKind.${d.kind}`)}`))
        .map<PaletteItem>((d) => ({
          id: d.id,
          label: d.name,
          detail: t(`diagramKind.${d.kind}`),
          icon: <UmlGlyph name={glyphForDiagram(d.kind)} size={15} />,
          run: () => useEditorStore.getState().openDiagram(d.id),
        }));
      const elements = Object.values(doc.modelElements)
        .filter((e) => e.id !== doc.rootModelId && !isRelationship(e) && (e.name || e.stereotype))
        .filter((e) => !query || matches(query, `${e.name} ${t(`elementKind.${e.kind}`)} ${e.stereotype} ${e.documentation}`))
        .map<PaletteItem>((e) => ({
          id: e.id,
          label: e.name || t('common.unnamed'),
          detail: `${t(`elementKind.${e.kind}`)} · ${qualifiedName(doc, e.id)}`,
          icon: <UmlGlyph name={glyphForElement(e.kind)} size={15} />,
          run: () => {
            if (!revealElement(e.id)) useEditorStore.getState().selectInExplorer(e.id);
          },
        }));
      return [...diagrams, ...elements];
    },
    [doc, t],
  );
  return <PaletteShell placeholder={t('palette.searchPlaceholder')} items={items} testId="quick-search" />;
}
