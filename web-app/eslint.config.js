import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Numeric interpolation is idiomatic in this UI; retain strict checks for
      // unsafe objects while avoiding noise from display-only values.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Existing control-flow relies on generic table/roster values whose
      // nullability is not fully expressed by their upstream library types.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Response mocks intentionally expose `async json()` to mirror Fetch.
      '@typescript-eslint/require-await': 'off',
      'react-refresh/only-export-components': 'off',
    },
  }
);
