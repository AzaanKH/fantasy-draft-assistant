import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { gateWorkspaces, testPolicy } from './gate-workspaces.js';
import { sourceCondition } from './source-condition.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const contractTest = 'src/shared-package-contract.test.ts';

export default defineConfig({
  root,
  test: {
    ...testPolicy,
    projects: [
      ...gateWorkspaces.map(({ directory, environment, testGlobals = false }) => ({
        root: `${root}${directory}`,
        ...sourceCondition,
        resolve: {
          ...sourceCondition.resolve,
          alias: directory === 'web-app' || directory === 'cli'
            ? { '@': `${root}web-app/src` } : {},
        },
        test: {
          ...testPolicy,
          name: directory,
          environment,
          globals: testGlobals,
          include: ['src/**/*.test.{ts,tsx}', ...(directory === 'scripts' ? ['*.test.mjs'] : [])],
          exclude: [contractTest],
        },
      })),
      {
        root: `${root}scripts`,
        test: {
          ...testPolicy,
          name: 'scripts-contract',
          environment: 'node',
          include: [contractTest],
        },
      },
    ],
  },
});
