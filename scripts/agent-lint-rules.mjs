import path from 'node:path';
import { gateWorkspaces } from '../gate-workspaces.js';

const root = path.resolve(import.meta.dirname, '..');
const directories = new Set(gateWorkspaces.map(({ directory }) => directory));
const draftRosterExports = Object.fromEntries(['DEFAULT_ROSTER_REQUIREMENTS', 'createEmptyRoster', 'Roster', 'RosterRequirements'].map(name => [name, '@fantasy-draft/shared/league']));
const closedModules = { '@fantasy-draft/shared/draft': draftRosterExports };
const decoderMessage = 'Decode the unknown value with a decoder from @fantasy-draft/shared/catalog, @fantasy-draft/shared/league or @fantasy-draft/shared/sync instead of casting JSON.parse() or response.json().';
export const baselineRuleIds = [
  'agent/no-json-cast',
  'agent/no-cross-package-import',
  '@typescript-eslint/explicit-module-boundary-types',
];

function staticModuleName(node) {
  return node?.type === 'TemplateLiteral' && node.expressions.length === 0
    ? node.quasis[0].value.cooked : node?.value;
}

export default {
  rules: {
    'no-closed-root-import': {
      meta: {
        type: 'problem', schema: [],
        messages: {
          draftUrl: 'The temporary draft URL subpath is closed. Import draft URL contracts from @fantasy-draft/shared/sync.',
          closed: '{{name}} is closed on {{source}}. Import it from {{subpath}}.',
          root: 'The shared root is closed. Choose @fantasy-draft/shared/league for players, positions, scoring and rosters; /draft for draft order and recommendations; /catalog for data and readiness; /sync for providers and draft URLs; /units for limits; /node for local process configuration; /http for HTTP requests.',
        },
      },
      create(context) {
        function check(node) {
          const source = staticModuleName(node.source);
          if (source === '@fantasy-draft/shared') {
            context.report({ node, messageId: 'root' });
            return;
          }
          if (source === '@fantasy-draft/shared/draft-url') {
            context.report({ node, messageId: 'draftUrl' });
            return;
          }
          if (!Object.hasOwn(closedModules, source)) return;
          const closed = closedModules[source];
          if (node.type === 'ImportExpression' || node.type === 'ExportAllDeclaration' ||
              node.specifiers.some((specifier) => specifier.type !== 'ImportSpecifier' && specifier.type !== 'ExportSpecifier')) {
            return;
          }
          for (const specifier of node.specifiers) {
            const imported = specifier.type === 'ImportSpecifier' ? specifier.imported : specifier.local;
            const name = imported.name ?? imported.value;
            if (Object.hasOwn(closed, name)) {
              context.report({ node: specifier, messageId: 'closed', data: { name, source, subpath: closed[name] } });
            }
          }
        }
        return {
          ImportDeclaration: check,
          ExportNamedDeclaration: check,
          ExportAllDeclaration: check,
          ImportExpression: check,
          CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'require' && staticModuleName(node.arguments[0]) === '@fantasy-draft/shared') {
              context.report({ node, messageId: 'root' });
            }
          },
          TSExternalModuleReference(node) {
            if (node.expression.value === '@fantasy-draft/shared') context.report({ node, messageId: 'root' });
          },
          TSImportType(node) {
            if (node.source.value === '@fantasy-draft/shared') {
              context.report({ node, messageId: 'root' });
              return;
            }
            if (node.source.value === '@fantasy-draft/shared/draft-url') {
              context.report({ node, messageId: 'draftUrl' });
              return;
            }
            if (!Object.hasOwn(closedModules, node.source.value)) return;
            const closed = closedModules[node.source.value];
            if (node.source.value === '@fantasy-draft/shared/draft') {
              if (node.qualifier?.type === 'Identifier' && Object.hasOwn(closed, node.qualifier.name)) {
                const name = node.qualifier.name;
                context.report({ node, messageId: 'closed', data: { name, source: node.source.value, subpath: closed[name] } });
              }
            }
          },
        };
      },
    },
    'no-node-in-browser': {
      meta: { type: 'problem', schema: [], messages: {
        browser: 'Browser source must use browser-safe shared subpaths. Import localDevPorts from @fantasy-draft/shared/sync; keep Processes in Node entry points.',
      } },
      create(context) {
        function check(node, source) {
          if (staticModuleName(source) === '@fantasy-draft/shared/node') context.report({ node, messageId: 'browser' });
        }
        return {
          ImportDeclaration: node => check(node, node.source),
          ExportNamedDeclaration: node => check(node, node.source),
          ExportAllDeclaration: node => check(node, node.source),
          ImportExpression: node => check(node, node.source),
          CallExpression: node => { if (node.callee.name === 'require') check(node, node.arguments[0]); },
          TSExternalModuleReference: node => check(node, node.expression),
          TSImportType: node => check(node, node.source),
        };
      },
    },
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
        messages: { runner: 'For HTTP requests, use @fantasy-draft/shared/http. Native fetch references are restricted to shared/src/http for shared timeout, body cancel, and retry policy.' },
      },
      create(context) {
        if (path.relative(root, context.filename).replaceAll('\\', '/').startsWith('shared/src/http/')) return {};
        const sourceCode = context.sourceCode;
        function isGlobal(node, names) {
          if (node?.type !== 'Identifier' || !names.includes(node.name)) return false;
          let scope = sourceCode.getScope(node);
          while (scope) {
            const variable = scope.set.get(node.name);
            if (variable) return variable.defs.length === 0;
            scope = scope.upper;
          }
          return true;
        }
        function isGlobalObject(node) {
          return isGlobal(node, ['globalThis', 'window', 'self', 'global']) ||
            node?.type === 'MemberExpression' && isGlobalObject(node.object) &&
            ['globalThis', 'window', 'self', 'global'].includes(propertyName(node));
        }
        function propertyName(node) {
          return !node.computed && node.key?.type === 'Identifier' ? node.key.name
            : !node.computed && node.property?.type === 'Identifier' ? node.property.name
              : staticModuleName(node.key ?? node.property);
        }
        return {
          Identifier(node) {
            if (node.parent.type === 'TSTypeQuery' || !isGlobal(node, ['fetch'])) return;
            const reference = sourceCode.getScope(node).references.find(reference => reference.identifier === node);
            if (reference?.isValueReference) context.report({ node, messageId: 'runner' });
          },
          MemberExpression(node) {
            if (isGlobalObject(node.object) && propertyName(node) === 'fetch') {
              context.report({ node, messageId: 'runner' });
            }
          },
          Property(node) {
            if (node.parent.type !== 'ObjectPattern' || propertyName(node) !== 'fetch') return;
            const owner = node.parent.parent;
            const source = owner.type === 'VariableDeclarator' ? owner.init
              : owner.type === 'AssignmentExpression' ? owner.right : undefined;
            if (isGlobalObject(source)) context.report({ node, messageId: 'runner' });
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
