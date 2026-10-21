import { useEffect, useSyncExternalStore } from 'react';
import { DARK_THEME, LIGHT_THEME, type DiagramTheme } from '@/diagrams/render/theme';
import { useSettingsStore } from '@/stores/settingsStore';

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

const systemPrefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export function useResolvedTheme(): 'dark' | 'light' {
  const preference = useSettingsStore((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribe, systemPrefersDark, () => true);
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/** Applies the resolved theme to <html data-theme>. */
export function useApplyTheme(): void {
  const theme = useResolvedTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}

export function useDiagramTheme(): DiagramTheme {
  return useResolvedTheme() === 'dark' ? DARK_THEME : LIGHT_THEME;
}
