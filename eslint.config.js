import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Modules that must stay framework/platform independent (see AGENTS.md). */
const PURE_MODULES = ['src/domain/**/*.ts', 'src/diagrams/render/**/*.ts', 'src/services/codegen/**/*.ts'];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'src-tauri/target',
      'src-tauri/gen',
      'playwright-report',
      'test-results',
      'coverage',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      // ID-keyed records (`modelElements`, `views`…) are the document's core data structure; removing
      // an entry from an Immer draft with `delete record[id]` is the intended idiom.
      '@typescript-eslint/no-dynamic-delete': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: PURE_MODULES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*', 'react-dom/*'], message: 'Pure modules must not depend on React.' },
            { group: ['@xyflow/*'], message: 'Pure modules must not depend on React Flow.' },
            { group: ['@tauri-apps/*'], message: 'Pure modules must not depend on Tauri.' },
            { group: ['dexie', 'zustand', 'zustand/*'], message: 'Pure modules must not depend on storage/state bindings.' },
            { group: ['@/features/*', '@/stores/*', '@/components/*', '@/services/persistence/*', '@/services/platform/*'], message: 'Pure modules must not import UI or platform layers.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'localStorage',
        'sessionStorage',
        'navigator',
        'indexedDB',
        'location',
        'fetch',
      ],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', '*.config.{ts,js}', 'scripts/**/*.{ts,js}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' },
  },
  {
    // Playwright fixtures receive a callback named `use`; these files contain no React code.
    files: ['tests/e2e/**/*.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
);
