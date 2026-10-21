import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
  language: 'en' | 'fr';
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  showMinimap: boolean;
}

interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
}

const STORAGE_KEY = 'uml-studio.settings.v1';

function detectLanguage(): 'en' | 'fr' {
  try {
    return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

const DEFAULTS: Settings = {
  theme: 'system',
  language: detectLanguage(),
  showGrid: true,
  snapToGrid: true,
  gridSize: 10,
  showMinimap: false,
};

/** UI preferences only (never project data). Storage failures fall back to defaults. */
function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      theme:
        parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
          ? parsed.theme
          : DEFAULTS.theme,
      language: parsed.language === 'fr' || parsed.language === 'en' ? parsed.language : DEFAULTS.language,
      showGrid: typeof parsed.showGrid === 'boolean' ? parsed.showGrid : DEFAULTS.showGrid,
      snapToGrid: typeof parsed.snapToGrid === 'boolean' ? parsed.snapToGrid : DEFAULTS.snapToGrid,
      gridSize:
        typeof parsed.gridSize === 'number' && parsed.gridSize >= 2 && parsed.gridSize <= 100
          ? parsed.gridSize
          : DEFAULTS.gridSize,
      showMinimap: typeof parsed.showMinimap === 'boolean' ? parsed.showMinimap : DEFAULTS.showMinimap,
    };
  } catch {
    return DEFAULTS;
  }
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...load(),
  update(patch) {
    set(patch);
    const { update: _update, ...settings } = { ...get() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Private mode or blocked storage: keep in-memory preferences only.
    }
  },
}));
