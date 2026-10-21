import { useCallback } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { en, type Dictionary, type MessageKey } from './en';
import { fr } from './fr';

export type Language = 'en' | 'fr';
export type { MessageKey };

const DICTIONARIES: Record<Language, Dictionary> = { en, fr };

export type TranslateParams = Record<string, string | number>;

function lookup(dictionary: Dictionary, key: string): string | undefined {
  let node: unknown = dictionary;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function translate(language: Language, key: MessageKey, params?: TranslateParams): string {
  const template = lookup(DICTIONARIES[language], key) ?? lookup(en, key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** Runtime check for dynamic keys built from data (e.g. `problems.${code}`). */
export function hasMessage(key: string): key is MessageKey {
  return lookup(en, key) !== undefined;
}

export type Translate = (key: MessageKey, params?: TranslateParams) => string;

export function useT(): Translate {
  const language = useSettingsStore((s) => s.language);
  return useCallback((key: MessageKey, params?: TranslateParams) => translate(language, key, params), [language]);
}

/** Non-React access (actions, services) using the current language. */
export function t(key: MessageKey, params?: TranslateParams): string {
  return translate(useSettingsStore.getState().language, key, params);
}

export function detectLanguage(): Language {
  const preferred = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return preferred.startsWith('fr') ? 'fr' : 'en';
}
