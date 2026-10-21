import { Button, Checkbox, Field, Kbd, Select } from '@/components/ui/controls';
import { Modal } from '@/components/ui/dialog';
import { COMMANDS, formatShortcut } from '@/app/commands';
import { useT } from '@/i18n';
import { recoveryRepository } from '@/services/platform/platform';
import { useEditorStore } from '@/stores/editorStore';
import { useSettingsStore, type ThemePreference } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';

const close = () => useEditorStore.getState().closeDialog();

export function SettingsDialog() {
  const t = useT();
  const settings = useSettingsStore();
  return (
    <Modal
      open
      onClose={close}
      title={t('settings.title')}
      width="sm"
      testId="settings-dialog"
      footer={<Button onClick={close}>{t('common.close')}</Button>}
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold tracking-wider text-muted uppercase">
            {t('settings.appearance')}
          </h3>
          <Field label={t('settings.theme')} htmlFor="settings-theme">
            <Select
              id="settings-theme"
              value={settings.theme}
              onChange={(e) => settings.update({ theme: e.target.value as ThemePreference })}
              data-testid="settings-theme"
            >
              <option value="system">{t('cmd.themeSystem')}</option>
              <option value="light">{t('cmd.themeLight')}</option>
              <option value="dark">{t('cmd.themeDark')}</option>
            </Select>
          </Field>
          <Field label={t('settings.language')} htmlFor="settings-language">
            <Select
              id="settings-language"
              value={settings.language}
              onChange={(e) => settings.update({ language: e.target.value as 'en' | 'fr' })}
              data-testid="settings-language"
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
            </Select>
          </Field>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold tracking-wider text-muted uppercase">
            {t('settings.canvas')}
          </h3>
          <Field label={t('settings.gridSize')} htmlFor="settings-grid">
            <Select
              id="settings-grid"
              value={settings.gridSize}
              onChange={(e) => settings.update({ gridSize: Number(e.target.value) })}
            >
              {[5, 10, 16, 20].map((n) => (
                <option key={n} value={n}>
                  {n} px
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            label={t('settings.showGrid')}
            checked={settings.showGrid}
            onChange={(v) => settings.update({ showGrid: v })}
          />
          <Checkbox
            label={t('settings.snapToGrid')}
            checked={settings.snapToGrid}
            onChange={(v) => settings.update({ snapToGrid: v })}
          />
          <Checkbox
            label={t('settings.showMinimap')}
            checked={settings.showMinimap}
            onChange={(v) => settings.update({ showMinimap: v })}
          />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold tracking-wider text-muted uppercase">
            {t('settings.data')}
          </h3>
          <p className="text-[12px] text-muted">{t('settings.recoveryInfo')}</p>
          <Button
            size="sm"
            variant="subtle"
            className="self-start"
            onClick={async () => {
              await recoveryRepository().clearRecoveries();
              toast.success(t('settings.cleared'));
            }}
          >
            {t('settings.clearRecovery')}
          </Button>
        </section>
      </div>
    </Modal>
  );
}

export function ShortcutsDialog() {
  const t = useT();
  const rows = COMMANDS.filter((c) => c.shortcuts?.length);
  return (
    <Modal
      open
      onClose={close}
      title={t('shortcuts.title')}
      description={t('shortcuts.note')}
      width="md"
      testId="shortcuts-dialog"
      footer={<Button onClick={close}>{t('common.close')}</Button>}
    >
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
            <th className="pb-1 font-medium">{t('shortcuts.action')}</th>
            <th className="pb-1 font-medium">{t('shortcuts.keys')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="py-1">{t(c.labelKey)}</td>
              <td className="py-1">
                <span className="flex flex-wrap gap-1">
                  {c.shortcuts!.map((s, i) => (
                    <Kbd key={i}>{formatShortcut(s)}</Kbd>
                  ))}
                </span>
              </td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="py-1">{t('cmd.toolHand')}</td>
            <td className="py-1">
              <Kbd>Space</Kbd> <span className="text-faint">{t('shortcuts.holdSpace')}</span>
            </td>
          </tr>
          <tr className="border-t border-border">
            <td className="py-1">Esc</td>
            <td className="py-1">
              <Kbd>Esc</Kbd>
            </td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}

export function AboutDialog() {
  const t = useT();
  return (
    <Modal
      open
      onClose={close}
      title={t('help.aboutTitle')}
      width="sm"
      footer={<Button onClick={close}>{t('common.close')}</Button>}
    >
      <p className="text-[13px]">{t('help.aboutBody')}</p>
      <p className="mt-2 text-[12px] text-muted">{t('help.version', { version: __APP_VERSION__ })}</p>
    </Modal>
  );
}

export function GettingStartedDialog() {
  const t = useT();
  return (
    <Modal
      open
      onClose={close}
      title={t('help.gettingStartedTitle')}
      width="md"
      footer={<Button onClick={close}>{t('common.close')}</Button>}
    >
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px]">
        {(['gs1', 'gs2', 'gs3', 'gs4', 'gs5', 'gs6'] as const).map((k) => (
          <li key={k}>{t(`help.${k}`)}</li>
        ))}
      </ol>
    </Modal>
  );
}
