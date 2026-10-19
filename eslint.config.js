import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { gateWorkspaces } from './gate-workspaces.js';
import agentRules from './scripts/agent-lint-rules.mjs';

const draftOrderRules = [
  {
    selector: "AssignmentPattern[left.name='draftType'][right.value='snake']",
    message: 'No default draft type. Use createSlotSequence with a required DraftFormat from @fantasy-draft/shared/draft, implemented in shared/src/draft-order.ts.',
  },
  {
    selector: "LogicalExpression[operator=/^(\\?\\?|\\|\\|)$/][right.value='snake']",
    message: 'No snake fallback. Use createSlotSequence with a required DraftFormat from @fantasy-draft/shared/draft, implemented in shared/src/draft-order.ts.',
  },
];

const environments = {
  node: globals.node,
  browser: globals.browser,
  extension: { ...globals.browser, ...globals.webextensions },
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'artifacts/**'] },
  ...gateWorkspaces.map(({ directory, globals: environment }) => ({
    files: [`${directory}/src/**/*.{ts,tsx}`],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: environments[environment],
      parserOptions: { project: [`./${directory}/tsconfig.json`], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-restricted-syntax': ['error', ...draftOrderRules],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  })),
  {
    files: gateWorkspaces.map(({ directory }) => `${directory}/**/*.{ts,tsx,js,mjs,cjs}`),
    languageOptions: { parser: tseslint.parser },
    plugins: { agent: agentRules },
    rules: { 'agent/no-closed-root-import': 'error' },
  },
  {
    files: ['web-app/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['{cli,scripts,server,shared}/src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: gateWorkspaces.map(({ directory }) => `${directory}/src/**/*.{ts,tsx}`),
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: { agent: agentRules },
    rules: {
      'agent/no-json-cast': 'error',
      'agent/no-bare-fetch': 'error',
      'agent/no-cross-package-import': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
);
