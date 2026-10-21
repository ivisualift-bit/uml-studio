import { useEffect, useState } from 'react';
import { FilePlus2, FolderOpen, LayoutTemplate, Trash2 } from 'lucide-react';
import { newProject, openProject, openRecent } from '@/app/actions';
import { primaryShortcut } from '@/app/commands';
import { Kbd } from '@/components/ui/controls';
import { UmlGlyph } from '@/diagrams/registry/glyphs';
import { useT } from '@/i18n';
import { supportsFileSystemAccess } from '@/services/persistence/browserRepository';
import { isDesktop, projectRepository } from '@/services/platform/platform';
import type { RecentEntry } from '@/services/persistence/types';
import { TEMPLATES } from '@/services/templates/templates';
import { useEditorStore } from '@/stores/editorStore';

function Action({ icon, title, hint, shortcut, onClick, testId }: { icon: React.ReactNode; title: string; hint: string; shortcut?: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className="flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-3 text-left hover:border-accent hover:bg-surface-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-muted text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-fg">{title}</span>
        <span className="block text-[12px] text-muted">{hint}</span>
      </span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}

/** Blank-workspace screen: New / Open / Recent / Templates (no fake dashboard). */
export function StartScreen() {
  const t = useT();
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const refresh = () =>
    void projectRepository()
      .listRecent()
      .then(setRecents)
      .catch(() => setRecents([]));
  useEffect(refresh, []);
  const desktop = isDesktop();
  return (
    <div className="h-full overflow-y-auto bg-bg" data-testid="start-screen">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
        <header className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-text">
            <UmlGlyph name="class" size={26} />
          </span>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{t('start.title')}</h1>
            <p className="text-[13px] text-muted">{t('start.subtitle')}</p>
          </div>
        </header>
        <div className="grid gap-3 sm:grid-cols-3">
          <Action icon={<FilePlus2 size={18} />} title={t('start.newBlank')} hint={t('start.newBlankHint')} shortcut={primaryShortcut('file.new')} onClick={() => useEditorStore.getState().openDialog({ type: 'newProject' })} testId="start-new" />
          <Action icon={<FolderOpen size={18} />} title={t('start.open')} hint={t('start.openHint')} shortcut={primaryShortcut('file.open')} onClick={() => void openProject()} testId="start-open" />
          <Action icon={<LayoutTemplate size={18} />} title={t('start.templates')} hint={t('templates.intro')} onClick={() => useEditorStore.getState().openDialog({ type: 'templates' })} testId="start-templates" />
        </div>
        {!desktop && (
          <div className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-[12.5px] text-muted">
            <span className="font-medium text-fg">{t('start.browserNoticeTitle')}: </span>
            {supportsFileSystemAccess() ? t('start.browserNoticeFsAccess') : t('start.browserNoticeFallback')}
          </div>
        )}
        <div className="grid gap-6 md:grid-cols-2">
          <section>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{t('start.recent')}</h2>
            {recents.length === 0 ? (
              <p className="text-[12.5px] text-faint">{t('start.noRecent')}</p>
            ) : (
              <ul className="flex flex-col gap-1" data-testid="recent-list">
                {recents.map((r) => (
                  <li key={r.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openRecent(r)} data-testid="recent-item">
                      <span className="block truncate text-[13px] text-fg">{r.name}</span>
                      <span className="block truncate text-[11.5px] text-faint">
                        {r.fileName} · {t('start.lastOpened', { date: new Date(r.lastOpenedAt).toLocaleString() })}
                        {r.kind === 'browserCopy' && ` · ${t('start.browserCopyNote')}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-faint opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
                      aria-label={t('start.removeRecent')}
                      title={t('start.removeRecent')}
                      onClick={() => void projectRepository().removeRecent(r.id).then(refresh)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{t('start.templates')}</h2>
            <ul className="flex flex-col gap-1">
              {TEMPLATES.map((tpl) => (
                <li key={tpl.id}>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => void newProject(undefined, tpl.id)} data-testid={`start-template-${tpl.id}`}>
                    <span className="block text-[13px] text-fg">{t(tpl.nameKey)}</span>
                    <span className="block truncate text-[11.5px] text-faint">{t(tpl.descriptionKey)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
