import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ContextMenu } from 'radix-ui';
import { ChevronDown, ChevronRight, FolderPlus, ListTree, Plus, Search } from 'lucide-react';
import { createDiagram, requestDeleteFromModel, revealElement, run } from '@/app/actions';
import { primaryShortcut } from '@/app/commands';
import { IconButton, Input } from '@/components/ui/controls';
import { menuContentClass, renderEntries, type MenuEntry } from '@/components/ui/menu';
import { DIAGRAM_KIND_INFO, PACKAGE_LIKE, canOwn } from '@/domain/model/metadata';
import { makeElement } from '@/domain/model/factory';
import { uuidGenerator } from '@/domain/ids';
import type { ID } from '@/domain/schemas/common';
import { isRelationship, type ModelElement } from '@/domain/schemas/elements';
import { ancestorIds, uniqueChildName } from '@/domain/services/queries';
import { CATALOG_ORDER, isEditable } from '@/diagrams/registry/catalog';
import { DRAG_ELEMENT_MIME } from '@/diagrams/graph/graphActions';
import { glyphForDiagram, glyphForElement, UmlGlyph } from '@/diagrams/registry/glyphs';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { buildTreeRows, type TreeRow } from './explorerTree';

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

export function ProjectExplorer() {
  const t = useT();
  const doc = useDocumentStore((s) => s.doc)!;
  const selected = useEditorStore((s) => s.explorerSelection);
  const activeDiagram = useEditorStore((s) => s.activeDiagramId);
  const [filter, setFilter] = useState('');
  const [showRelationships, setShowRelationships] = useState(false);
  const [expanded, setExpanded] = useState<Set<ID>>(() => new Set([doc.rootModelId]));
  const [renaming, setRenaming] = useState<ID | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);

  // Reveal the selection: expand its ancestors.
  useEffect(() => {
    if (!selected) return;
    const ownerChain = doc.modelElements[selected]
      ? ancestorIds(doc, selected)
      : doc.diagrams[selected]
        ? [doc.diagrams[selected]!.ownerId, ...ancestorIds(doc, doc.diagrams[selected]!.ownerId)]
        : [];
    if (ownerChain.some((id) => !expanded.has(id))) setExpanded((prev) => new Set([...prev, ...ownerChain]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () =>
      buildTreeRows(doc, {
        expanded,
        filter,
        showRelationships,
        kindLabel: (el) => t(`elementKind.${el.kind}`).toLowerCase(),
      }),
    [doc, expanded, filter, showRelationships, t],
  );

  const toggle = (id: ID, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const select = (row: TreeRow) => useEditorStore.getState().selectInExplorer(row.id);
  const activate = (row: TreeRow) => {
    if (row.kind === 'diagram') useEditorStore.getState().openDiagram(row.id);
    else if (row.element) revealElement(row.element.id);
  };

  const commitRename = (row: TreeRow, value: string) => {
    setRenaming(null);
    const name = value.trim();
    if (row.kind === 'diagram' && row.diagram && name && name !== row.diagram.name)
      run({ type: 'diagram/rename', diagramId: row.id, name }, { label: t('history.rename') });
    if (row.kind === 'element' && row.element && name !== row.element.name)
      run({ type: 'element/update', elementId: row.id, patch: { name } }, { label: t('history.rename') });
  };

  const addPackage = (ownerId: ID) => {
    const id = uuidGenerator.next();
    const name = uniqueChildName(doc, ownerId, 'package', t('defaultName.package'));
    if (
      run(
        { type: 'element/add', elements: [makeElement('package', { id, name, ownerId })] },
        { label: t('history.add', { name }) },
      )
    ) {
      setExpanded((prev) => new Set([...prev, ownerId]));
      useEditorStore.getState().selectInExplorer(id);
      setRenaming(id);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (renaming) return;
    const index = rows.findIndex((r) => r.id === selected);
    const row = rows[index];
    const move = (to: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (target) {
        select(target);
        const top = Math.max(0, Math.min(rows.length - 1, to)) * ROW_HEIGHT;
        const list = listRef.current;
        if (list && (top < list.scrollTop || top > list.scrollTop + list.clientHeight - ROW_HEIGHT))
          list.scrollTop = top - list.clientHeight / 2;
      }
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(index - 1);
        break;
      case 'ArrowRight':
        if (row?.hasChildren && !row.expanded) toggle(row.id, true);
        else move(index + 1);
        e.preventDefault();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (row?.expanded && row.hasChildren) toggle(row.id, false);
        else if (row?.element?.ownerId) useEditorStore.getState().selectInExplorer(row.element.ownerId);
        break;
      case 'Enter':
        if (row) activate(row);
        break;
      case 'F2':
        if (row && row.id !== doc.rootModelId) setRenaming(row.id);
        break;
      case 'Delete':
      case 'Backspace':
        if (row && row.id !== doc.rootModelId) requestDeleteFromModel([row.id]);
        break;
      default:
        break;
    }
  };

  const onDragStart = (e: DragEvent, row: TreeRow) => {
    if (row.kind !== 'element' || !row.element || isRelationship(row.element) || row.id === doc.rootModelId) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DRAG_ELEMENT_MIME, row.id);
    e.dataTransfer.setData('text/plain', row.element.name);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const onRowDrop = (e: DragEvent, row: TreeRow) => {
    const elementId = e.dataTransfer.getData(DRAG_ELEMENT_MIME);
    if (!elementId || !row.element || elementId === row.id) return;
    const moving = doc.modelElements[elementId];
    if (!moving || !canOwn(row.element.kind, moving.kind)) return;
    e.preventDefault();
    run({ type: 'element/move', elementId, newOwnerId: row.id }, { label: t('history.move') });
  };

  const menuFor = (row: TreeRow): MenuEntry[] => {
    if (row.kind === 'diagram' && row.diagram) {
      return [
        { label: t('explorer.open'), onSelect: () => useEditorStore.getState().openDiagram(row.id) },
        { label: t('cmd.rename'), shortcut: 'F2', onSelect: () => setRenaming(row.id) },
        { type: 'separator' },
        {
          label: t('cmd.exportImage'),
          onSelect: () => useEditorStore.getState().openDialog({ type: 'export', diagramId: row.id }),
        },
        { type: 'separator' },
        {
          label: t('cmd.deleteDiagram'),
          danger: true,
          onSelect: () => useEditorStore.getState().openDialog({ type: 'deleteDiagram', diagramId: row.id }),
        },
      ];
    }
    const el = row.element!;
    const isRoot = el.id === doc.rootModelId;
    const entries: MenuEntry[] = [];
    entries.push({ label: t('cmd.showInDiagram'), onSelect: () => revealElement(el.id) });
    const diagramKinds = CATALOG_ORDER.filter((k) => isEditable(k)).filter((k) => {
      const info = DIAGRAM_KIND_INFO[k];
      return (
        info.ownerKinds.includes(el.kind) ||
        (!!info.behaviorKind && PACKAGE_LIKE.includes(el.kind)) ||
        PACKAGE_LIKE.includes(el.kind)
      );
    });
    if (diagramKinds.length) {
      entries.push({
        type: 'submenu',
        label: t('explorer.addDiagram'),
        children: diagramKinds.map((k) => ({
          label: t(`diagramKind.${k}`),
          onSelect: () => void createDiagram(k, t(`diagramKind.${k}`), el.id),
        })),
      });
    }
    if (canOwn(el.kind, 'package'))
      entries.push({ label: t('explorer.addPackage'), onSelect: () => addPackage(el.id) });
    if (!isRoot) {
      entries.push(
        { type: 'separator' },
        { label: t('cmd.rename'), shortcut: 'F2', onSelect: () => setRenaming(el.id) },
      );
      entries.push(
        { type: 'separator' },
        {
          label: t('cmd.deleteFromModel'),
          shortcut: primaryShortcut('edit.deleteFromModel'),
          danger: true,
          onSelect: () => requestDeleteFromModel([el.id]),
        },
      );
    } else {
      entries.push(
        { type: 'separator' },
        { label: t('cmd.rename'), shortcut: 'F2', onSelect: () => setRenaming(el.id) },
      );
    }
    return entries;
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const [menuRow, setMenuRow] = useState<TreeRow | null>(null);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t('explorer.title')}>
      <div className="flex h-8 items-center justify-between pr-1.5 pl-3">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted uppercase">
          {t('explorer.title')}
        </h2>
        <div className="flex items-center">
          <IconButton
            label={t('explorer.showRelationships')}
            active={showRelationships}
            onClick={() => setShowRelationships((v) => !v)}
          >
            <ListTree size={14} />
          </IconButton>
          <IconButton
            label={t('explorer.addPackage')}
            onClick={() =>
              addPackage(
                selected &&
                  doc.modelElements[selected] &&
                  canOwn(doc.modelElements[selected]!.kind, 'package')
                  ? selected
                  : doc.rootModelId,
              )
            }
          >
            <FolderPlus size={14} />
          </IconButton>
          <IconButton
            label={t('explorer.addDiagram')}
            onClick={() =>
              useEditorStore.getState().openDialog({
                type: 'newDiagram',
                ownerId: selected && doc.modelElements[selected] ? selected : undefined,
              })
            }
            data-testid="explorer-add-diagram"
          >
            <Plus size={15} />
          </IconButton>
        </div>
      </div>
      <div className="relative px-2 pb-1.5">
        <Search
          size={13}
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
          style={{ marginTop: -3 }}
        />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('explorer.filter')}
          className="pl-7"
          aria-label={t('explorer.filter')}
          data-testid="explorer-filter"
        />
      </div>
      <ContextMenu.Root onOpenChange={(open) => !open && setMenuRow(null)}>
        <ContextMenu.Trigger asChild>
          <div
            ref={listRef}
            role="tree"
            aria-label={t('explorer.title')}
            tabIndex={0}
            className="relative min-h-0 flex-1 overflow-y-auto outline-none"
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onKeyDown={onKeyDown}
            data-testid="explorer-tree"
          >
            {rows.length === 0 && filter && (
              <div className="px-3 py-2 text-[12px] text-faint">
                {t('explorer.noMatch', { query: filter })}
              </div>
            )}
            <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
              {rows.slice(first, last).map((row, i) => {
                const index = first + i;
                const label =
                  row.kind === 'diagram'
                    ? row.diagram!.name
                    : row.element!.name || relationshipLabel(row.element!, doc, t);
                const isSelected = row.id === selected;
                const isActiveDiagram = row.kind === 'diagram' && row.id === activeDiagram;
                return (
                  <div
                    key={row.id}
                    role="treeitem"
                    aria-level={row.depth + 1}
                    aria-expanded={row.hasChildren ? row.expanded : undefined}
                    aria-selected={isSelected}
                    data-testid="explorer-item"
                    data-id={row.id}
                    data-kind={row.kind === 'diagram' ? `diagram:${row.diagram!.kind}` : row.element!.kind}
                    data-name={label}
                    draggable={row.kind === 'element' && renaming !== row.id}
                    onDragStart={(e) => onDragStart(e, row)}
                    onDragOver={(e) => {
                      if (
                        row.element &&
                        PACKAGE_LIKE.includes(row.element.kind) &&
                        e.dataTransfer.types.includes(DRAG_ELEMENT_MIME)
                      ) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }
                    }}
                    onDrop={(e) => onRowDrop(e, row)}
                    onClick={() => select(row)}
                    onDoubleClick={() => activate(row)}
                    onContextMenu={() => {
                      select(row);
                      setMenuRow(row);
                    }}
                    title={
                      row.kind === 'element'
                        ? `${t(`elementKind.${row.element!.kind}`)} — ${t('explorer.dragHint')}`
                        : t(`diagramKind.${row.diagram!.kind}`)
                    }
                    className={cn(
                      'absolute right-0 left-0 flex cursor-default items-center gap-1 pr-2 text-[12.5px]',
                      isSelected ? 'bg-accent-muted text-fg' : 'text-fg hover:bg-surface-3',
                      !row.match && 'opacity-60',
                    )}
                    style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: 8 + row.depth * 14 }}
                  >
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center text-faint"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (row.hasChildren) toggle(row.id);
                      }}
                    >
                      {row.hasChildren ? (
                        row.expanded ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )
                      ) : null}
                    </span>
                    <UmlGlyph
                      name={
                        row.kind === 'diagram'
                          ? glyphForDiagram(row.diagram!.kind)
                          : glyphForElement(row.element!.kind)
                      }
                      size={15}
                      className={cn('shrink-0', row.kind === 'diagram' ? 'text-accent' : 'text-muted')}
                    />
                    {renaming === row.id ? (
                      <RenameInput
                        initial={row.kind === 'diagram' ? row.diagram!.name : row.element!.name}
                        onDone={(v) => (v === null ? setRenaming(null) : commitRename(row, v))}
                      />
                    ) : (
                      <span
                        className={cn(
                          'truncate',
                          isActiveDiagram && 'font-semibold',
                          row.element && !row.element.name && 'text-faint italic',
                        )}
                      >
                        {label || t('common.unnamed')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuContentClass}>
            {menuRow ? renderEntries(menuFor(menuRow), 'context') : null}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {Object.keys(doc.diagrams).length === 0 && Object.keys(doc.modelElements).length <= 1 && (
        <p className="px-3 pb-3 text-[12px] text-faint">{t('explorer.empty')}</p>
      )}
      <DiagramCountFooter />
    </section>
  );
}

function relationshipLabel(
  el: ModelElement,
  doc: ReturnType<typeof useDocumentStore.getState>['doc'],
  t: ReturnType<typeof useT>,
): string {
  if (!doc || !isRelationship(el)) return '';
  const target = doc.modelElements[el.targetId];
  return `${t(`elementKind.${el.kind}`)} → ${target?.name ?? ''}`;
}

function DiagramCountFooter() {
  const t = useT();
  const count = useDocumentStore((s) => Object.keys(s.doc?.modelElements ?? {}).length);
  return (
    <div className="border-t border-border px-3 py-1 text-[11px] text-faint">
      {t('project.elements', { count: count - 1 })}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      className="h-5 min-w-0 flex-1 rounded-sm border border-accent bg-surface-1 px-1 text-[12.5px] text-fg outline-none"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone(value);
        if (e.key === 'Escape') onDone(null);
      }}
      onBlur={() => onDone(value)}
      aria-label="Rename"
    />
  );
}
