import path from 'node:path';
import { gateWorkspaces } from '../gate-workspaces.js';

const root = path.resolve(import.meta.dirname, '..');
const directories = new Set(gateWorkspaces.map(({ directory }) => directory));
const decoderMessage = 'Decode the unknown value with a decoder from @fantasy-draft/shared instead of casting JSON.parse() or response.json().';
export const baselineRuleIds = [
  'agent/no-json-cast',
  'agent/no-bare-fetch',
  'agent/no-cross-package-import',
  '@typescript-eslint/explicit-module-boundary-types',
];

export default {
  rules: {
    'no-json-cast': {
      meta: { type: 'problem', schema: [], messages: { decode: decoderMessage } },
      create(context) {
        return {
          TSAsExpression(node) {
            const expression = node.expression.type === 'AwaitExpression'
              ? node.expression.argument : node.expression;
            if (expression.type !== 'CallExpression' || expression.callee.type !== 'MemberExpression') return;
            const { object, property } = expression.callee;
            const name = property.type === 'Identifier' && !expression.callee.computed
              ? property.name : property.value;
            if (name === 'json' || (name === 'parse' && object.type === 'Identifier' && object.name === 'JSON')) {
              context.report({ node, messageId: 'decode' });
            }
          },
        };
      },
    },
    'no-bare-fetch': {
      meta: {
        type: 'problem', schema: [],
        messages: { runner: 'Use the shared HTTP runner (unit 8) or add to the baseline only with a reason. Bare fetch has no shared timeout, body cancel, or retry policy.' },
      },
      create(context) {
        return {
          "CallExpression[callee.type='Identifier'][callee.name='fetch']"(node) {
            context.report({ node, messageId: 'runner' });
          },
        };
      },
    },
    'no-cross-package-import': {
      meta: {
        type: 'problem', schema: [],
        messages: { boundary: 'Import the workspace package by name through its public exports. Move shared code into @fantasy-draft/shared; cli must not use the web-app @/ alias.' },
      },
      create(context) {
        const workspace = path.relative(root, context.filename).split(path.sep)[0];
        function check(node) {
          if (typeof node.value !== 'string') return;
          const target = path.relative(root, path.resolve(path.dirname(context.filename), node.value)).split(path.sep)[0];
          if ((workspace === 'cli' && node.value.startsWith('@/')) ||
              (node.value.startsWith('.') && directories.has(target) && target !== workspace)) {
            context.report({ node, messageId: 'boundary' });
          }
        }
        return {
          ImportDeclaration: (node) => check(node.source),
          ExportNamedDeclaration: (node) => { if (node.source) check(node.source); },
          ExportAllDeclaration: (node) => check(node.source),
          ImportExpression: (node) => check(node.source),
        };
      },
    },
  },
};
