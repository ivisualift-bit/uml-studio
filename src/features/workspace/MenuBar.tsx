import { useState } from 'react';
import { Menubar } from 'radix-ui';
import { command, isEnabled, primaryShortcut } from '@/app/commands';
import { openRecent } from '@/app/actions';
import {
  ItemContent,
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
  SubTriggerContent,
} from '@/components/ui/menu';
import { useT, type MessageKey } from '@/i18n';
import { projectRepository } from '@/services/platform/platform';
import type { RecentEntry } from '@/services/persistence/types';
import { useSettingsStore } from '@/stores/settingsStore';

type Entry = string | '-' | { submenu: MessageKey; items: Entry[] } | { recent: true } | { language: true };

const MENUS: Array<{ label: MessageKey; items: Entry[] }> = [
  {
    label: 'menu.file',
    items: [
      'file.new',
      'file.templates',
      'file.open',
      { recent: true },
      'file.importMdj',
      '-',
      'file.save',
      'file.saveAs',
      '-',
      'file.export',
      'file.exportText',
      'file.codegen',
      '-',
      'file.close',
    ],
  },
  {
    label: 'menu.edit',
    items: [
      'edit.undo',
      'edit.redo',
      '-',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.duplicate',
      '-',
      'edit.rename',
      'edit.delete',
      'edit.deleteFromModel',
      '-',
      'edit.selectAll',
    ],
  },
  {
    label: 'menu.view',
    items: [
      'view.palette',
      'view.search',
      '-',
      'view.zoomIn',
      'view.zoomOut',
      'view.resetZoom',
      'view.fit',
      '-',
      'view.sidebar',
      'view.inspector',
      'view.problems',
      '-',
      'view.grid',
      'view.snap',
      'view.minimap',
      '-',
      { submenu: 'menu.theme', items: ['view.themeSystem', 'view.themeLight', 'view.themeDark'] },
      { language: true },
    ],
  },
  {
    label: 'menu.diagram',
    items: [
      'diagram.new',
      'diagram.rename',
      'diagram.delete',
      '-',
      {
        submenu: 'menu.align',
        items: [
          'arrange.alignLeft',
          'arrange.alignCenter',
          'arrange.alignRight',
          '-',
          'arrange.alignTop',
          'arrange.alignMiddle',
          'arrange.alignBottom',
          '-',
          'arrange.distributeH',
          'arrange.distributeV',
        ],
      },
      { submenu: 'menu.arrange', items: ['arrange.front', 'arrange.back'] },
      { submenu: 'menu.routing', items: ['arrange.straight', 'arrange.orthogonal'] },
    ],
  },
  {
    label: 'menu.model',
    items: ['model.addAttribute', 'model.addOperation', 'model.addLiteral', '-', 'tools.validate'],
  },
  {
    label: 'menu.tools',
    items: [
      'tool.select',
      'tool.hand',
      '-',
      'tools.validate',
      'file.codegen',
      'file.exportText',
      '-',
      'tools.settings',
    ],
  },
  {
    label: 'menu.window',
    items: [
      'window.nextTab',
      'window.previousTab',
      'window.closeTab',
      '-',
      'view.sidebar',
      'view.inspector',
      'view.problems',
    ],
  },
  { label: 'menu.help', items: ['help.gettingStarted', 'help.shortcuts', '-', 'help.about'] },
];

function CommandItem({ id }: { id: string }) {
  const t = useT();
  const cmd = command(id);
  const checked = cmd.checked?.();
  return (
    <Menubar.Item
      className={menuItemClass}
      disabled={!isEnabled(cmd)}
      onSelect={() => void cmd.run()}
      data-testid={`menu-${id}`}
    >
      <ItemContent label={t(cmd.labelKey)} shortcut={primaryShortcut(id)} checked={checked} />
    </Menubar.Item>
  );
}

function RecentSubmenu() {
  const t = useT();
  const [recents, setRecents] = useState<RecentEntry[] | null>(null);
  return (
    <Menubar.Sub
      onOpenChange={(open) => {
        if (open)
          void projectRepository()
            .listRecent()
            .then(setRecents)
            .catch(() => setRecents([]));
      }}
    >
      <Menubar.SubTrigger className={menuItemClass}>
        <SubTriggerContent label={t('menu.openRecent')} />
      </Menubar.SubTrigger>
      <Menubar.Portal>
        <Menubar.SubContent className={menuContentClass} sideOffset={2}>
          {!recents ? (
            <div className="px-2 py-1 text-faint">{t('common.loading')}</div>
          ) : recents.length === 0 ? (
            <Menubar.Item className={menuItemClass} disabled>
              <ItemContent label={t('menu.noRecent')} />
            </Menubar.Item>
          ) : (
            recents.map((r) => (
              <Menubar.Item key={r.id} className={menuItemClass} onSelect={() => void openRecent(r)}>
                <ItemContent label={`${r.name} — ${r.fileName}`} />
              </Menubar.Item>
            ))
          )}
        </Menubar.SubContent>
      </Menubar.Portal>
    </Menubar.Sub>
  );
}

function LanguageSubmenu() {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const update = useSettingsStore((s) => s.update);
  return (
    <Menubar.Sub>
      <Menubar.SubTrigger className={menuItemClass}>
        <SubTriggerContent label={t('menu.language')} />
      </Menubar.SubTrigger>
      <Menubar.Portal>
        <Menubar.SubContent className={menuContentClass} sideOffset={2}>
          <Menubar.Item className={menuItemClass} onSelect={() => update({ language: 'en' })}>
            <ItemContent label="English" checked={language === 'en'} />
          </Menubar.Item>
          <Menubar.Item className={menuItemClass} onSelect={() => update({ language: 'fr' })}>
            <ItemContent label="Français" checked={language === 'fr'} />
          </Menubar.Item>
        </Menubar.SubContent>
      </Menubar.Portal>
    </Menubar.Sub>
  );
}

function renderItems(items: Entry[]) {
  return items.map((item, i) => {
    if (item === '-') return <Menubar.Separator key={i} className={menuSeparatorClass} />;
    if (typeof item === 'string') return <CommandItem key={item} id={item} />;
    if ('recent' in item) return <RecentSubmenu key="recent" />;
    if ('language' in item) return <LanguageSubmenu key="language" />;
    return <SubMenu key={i} label={item.submenu} items={item.items} />;
  });
}

function SubMenu({ label, items }: { label: MessageKey; items: Entry[] }) {
  const t = useT();
  return (
    <Menubar.Sub>
      <Menubar.SubTrigger className={menuItemClass}>
        <SubTriggerContent label={t(label)} />
      </Menubar.SubTrigger>
      <Menubar.Portal>
        <Menubar.SubContent className={menuContentClass} sideOffset={2}>
          {renderItems(items)}
        </Menubar.SubContent>
      </Menubar.Portal>
    </Menubar.Sub>
  );
}

export function MenuBar() {
  const t = useT();
  return (
    <Menubar.Root className="flex h-full items-center gap-0.5" aria-label="Application menu">
      {MENUS.map((menu) => (
        <Menubar.Menu key={menu.label}>
          <Menubar.Trigger
            className="h-6 rounded px-2 text-[12.5px] text-muted outline-none select-none hover:bg-surface-3 hover:text-fg data-[state=open]:bg-surface-3 data-[state=open]:text-fg"
            data-testid={`menubar-${menu.label.split('.')[1]}`}
          >
            {t(menu.label)}
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
              {renderItems(menu.items)}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      ))}
    </Menubar.Root>
  );
}
