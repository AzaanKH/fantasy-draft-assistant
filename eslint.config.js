import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { gateWorkspaces } from './gate-workspaces.js';
import agentRules from './scripts/agent-lint-rules.mjs';
import { cssParser } from './scripts/decoration-lint-rules.mjs';

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

const effectBoundaryMessage = 'Decode at the boundary: put Effect Schema in shared/src/catalog; leaf modules use plain predicates. List new I/O owners in effectOwners in eslint.config.js.';
const effectOwners = [
  'shared/src/catalog/**',
  'scripts/src/{contract-source-schema,script-file-schemas}.ts',
  '**/*.test.{ts,tsx,mjs}',
  'cli/src/{archive,client,connections,data,errors,files,run}.ts',
  'extension/src/background/{background-controller,sync-snapshot-client}.ts',
  'extension/src/shared/boundary-decoders.ts',
  'extension/config/manifest-decoder.ts',
  'server/src/{draft-data-refresh,fantasy-football-calculator,http-security,shadow-logger,sleeper-adapter,sync-adapter,sync-server,yahoo-adapter}.ts',
  'scripts/src/{browser-gate,build-demo-data,build-historical-snapshots,build-prediction-dataset,check-data-quality,check-demo-data,effect-runtime,fantasypros-api,fetch-sleeper-adp,generate-team-env,import-league-draft-history,install-demo-data,measure-effect-adoption,playwright-browser,primary-league-release-gate,refresh-contracts,refresh-fantasypros-snapshot,scrape-contracts,scrape-ecr,recommendation-evaluation}.ts',
  'scripts/src/model/{duckdb,init-duckdb,profile-model-sources}.ts',
];

const processExceptions = [
  '**/*.test.{ts,tsx,mjs}',
  'scripts/{probe-source-condition,probe-workspace-gates,probe-agent-gates,audit-unused-exports,tracked-files,check-pr-size}.mjs',
];

/** Workspaces that render UI: the decoration rules cover their class strings and stylesheets. */
const uiDirectories = gateWorkspaces.filter(({ globals }) => globals !== 'node').map(({ directory }) => directory);

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
    rules: { 'agent/no-closed-root-import': 'error', 'agent/reasoned-disable': 'error' },
  },
  {
    files: gateWorkspaces.map(({ directory }) => `${directory}/**/*.{ts,tsx,js,mjs,cjs}`),
    ignores: ['**/*.test.{ts,tsx,mjs}'],
    rules: { 'agent/no-bare-fetch': 'error' },
  },
  {
    files: gateWorkspaces.map(({ directory }) => `${directory}/**/*.{ts,tsx,js,mjs,cjs}`),
    ignores: ['shared/src/node/**', ...processExceptions],
    rules: { 'agent/no-bare-child-process': 'error' },
  },
  {
    files: gateWorkspaces.map(({ directory }) => `${directory}/**/*.{ts,tsx,js,mjs,cjs}`),
    ignores: effectOwners,
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['effect', 'effect/*'], message: effectBoundaryMessage }] }],
      'no-restricted-syntax': ['error', ...draftOrderRules,
        { selector: "ImportExpression[source.value=/^effect($|\\x2f)/]", message: effectBoundaryMessage },
        { selector: "ImportExpression[source.expressions.length=0][source.quasis.0.value.cooked=/^effect($|\\x2f)/]", message: effectBoundaryMessage },
        { selector: "CallExpression[callee.name='require'][arguments.0.value=/^effect($|\\x2f)/]", message: effectBoundaryMessage },
        { selector: "CallExpression[callee.name='require'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=/^effect($|\\x2f)/]", message: effectBoundaryMessage },
      ],
    },
  },
  {
    files: ['{web-app,extension}/src/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: { 'agent/no-node-in-browser': 'error' },
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
      'agent/no-cross-package-import': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  {
    // shared/src/league owns positions and the season rule; shared/src/http parses HTTP dates, not seasons.
    files: gateWorkspaces.map(({ directory }) => `${directory}/src/**/*.{ts,tsx}`),
    ignores: ['**/*.test.{ts,tsx}', 'shared/src/league/**', 'shared/src/http/**'],
    plugins: { agent: agentRules },
    rules: {
      'agent/no-position-array': 'error',
    },
  },
  {
    files: gateWorkspaces.map(({ directory }) => `${directory}/**/*.{ts,tsx,js,mjs,cjs}`),
    ignores: ['**/*.test.{ts,tsx,js,mjs,cjs}', 'shared/src/league/season.ts', 'shared/src/http/**'],
    plugins: { agent: agentRules },
    rules: { 'agent/no-inline-season': 'error' },
  },
  {
    files: gateWorkspaces.map(({ directory }) => `${directory}/src/**/*.{ts,tsx}`),
    ignores: ['shared/src/units/**'],
    plugins: { agent: agentRules },
    rules: { 'agent/no-unit-cast': 'error' },
  },
  {
    // The clock owns the system time; the HTTP and process runners time I/O, not domain state.
    files: ['shared/src/**/*.ts'],
    ignores: ['**/*.test.ts', 'shared/src/units/clock.ts', 'shared/src/http/**', 'shared/src/node/**'],
    plugins: { agent: agentRules },
    rules: { 'agent/no-domain-clock': 'error' },
  },
  {
    // Banned decorations (pills, accent stripes) in UI class strings and stylesheets; see docs/design-system/README.md.
    files: uiDirectories.map((directory) => `${directory}/src/**/*.{ts,tsx}`),
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: { agent: agentRules },
    rules: { 'agent/no-pill-shape': 'error', 'agent/no-accent-stripe': 'error' },
  },
  {
    files: uiDirectories.map((directory) => `${directory}/src/**/*.css`),
    languageOptions: { parser: cssParser },
    plugins: { agent: agentRules },
    rules: { 'agent/no-pill-shape': 'error', 'agent/no-accent-stripe': 'error' },
  },
);
