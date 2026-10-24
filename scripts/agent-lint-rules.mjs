import path from 'node:path';
import { gateWorkspaces } from '../gate-workspaces.js';

const root = path.resolve(import.meta.dirname, '..');
const directories = new Set(gateWorkspaces.map(({ directory }) => directory));
const draftRosterExports = Object.fromEntries(['DEFAULT_ROSTER_REQUIREMENTS', 'createEmptyRoster', 'Roster', 'RosterRequirements'].map(name => [name, '@fantasy-draft/shared/league']));
const closedModules = { '@fantasy-draft/shared/draft': draftRosterExports };
const decoderMessage = 'Decode the unknown value with a decoder from @fantasy-draft/shared/catalog, @fantasy-draft/shared/league or @fantasy-draft/shared/sync instead of casting JSON.parse() or response.json().';
const leaguePositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
// A quoted, comma-separated position list inside a string or SQL template, such as `in ('QB', 'RB')`.
const quotedPositionList = /'(?:QB|RB|WR|TE|K|DEF)'(?:\s*,\s*'(?:QB|RB|WR|TE|K|DEF)')+/g;
export const baselineRuleIds = [
  'agent/no-json-cast',
  'agent/no-cross-package-import',
  '@typescript-eslint/explicit-module-boundary-types',
  'agent/no-position-array',
  'agent/no-inline-season',
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
    'no-bare-child-process': {
      meta: { type: 'problem', schema: [], messages: {
        runner: 'For process lifecycle, use Processes from @fantasy-draft/shared/node.',
      } },
      create(context) {
        function check(node, source) {
          if (['child_process', 'node:child_process'].includes(staticModuleName(source))) context.report({ node, messageId: 'runner' });
        }
        function definition(node) {
          if (node?.type !== 'Identifier') return undefined;
          let scope = context.sourceCode.getScope(node);
          while (scope) {
            const variable = scope.set.get(node.name);
            if (variable) return variable.defs[0];
            scope = scope.upper;
          }
        }
        function isCreateRequire(node) {
          if (node?.type !== 'Identifier') return false;
          const bound = definition(node);
          return bound?.type === 'ImportBinding' && bound.node.type === 'ImportSpecifier' &&
            bound.node.imported.name === 'createRequire' && ['module', 'node:module'].includes(bound.parent.source.value);
        }
        function isLoader(node, seen = new Set()) {
          if (!node || seen.has(node)) return false;
          seen.add(node);
          if (node.type === 'Identifier') {
            if (node.name === 'require') return true;
            const bound = definition(node);
            return bound?.type === 'Variable' && isLoader(bound.node.init, seen);
          }
          if (node.type === 'CallExpression') return isCreateRequire(node.callee);
          if (node.type === 'MemberExpression' && node.object.name === 'process') {
            return (node.computed ? staticModuleName(node.property) : node.property.name) === 'getBuiltinModule';
          }
          return false;
        }
        return {
          ImportDeclaration: node => check(node, node.source),
          ExportNamedDeclaration: node => check(node, node.source),
          ExportAllDeclaration: node => check(node, node.source),
          ImportExpression: node => check(node, node.source),
          CallExpression: node => { if (isLoader(node.callee)) check(node, node.arguments[0]); },
          TSExternalModuleReference: node => check(node, node.expression),
          TSImportType: node => check(node, node.source),
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
    'no-position-array': {
      meta: {
        type: 'problem', schema: [],
        messages: { league: 'Name the position group from @fantasy-draft/shared/league instead of listing positions: POSITIONS, OFFENSIVE_POSITIONS, KICKER_DEFENSE_POSITIONS or FLEX_GROUPS, and isFlexEligible for the league-configured FLEX. Add a new group in shared/src/league/positions.ts; build SQL lists with sqlPositionList.' },
      },
      create(context) {
        return {
          ArrayExpression(node) {
            const positions = node.elements.map(staticModuleName).filter((value) => leaguePositions.has(value));
            // A sequence that repeats a position is fixture data, not a position group.
            if (positions.length >= 2 && new Set(positions).size === positions.length) {
              context.report({ node, messageId: 'league' });
            }
          },
          'Literal, TemplateElement'(node) {
            const text = node.type === 'Literal' ? node.value : node.value.cooked;
            if (typeof text !== 'string') return;
            for (const [list] of text.matchAll(quotedPositionList)) {
              const positions = list.match(/[A-Z]+/g);
              if (new Set(positions).size === positions.length) context.report({ node, messageId: 'league' });
            }
          },
        };
      },
    },
    'no-inline-season': {
      meta: {
        type: 'problem', schema: [],
        messages: { season: 'Do not derive the season from a Date year. Use calendarSeason from @fantasy-draft/shared/league, which owns the season rule.' },
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type !== 'MemberExpression') return;
            const name = callee.computed ? staticModuleName(callee.property) : callee.property.name;
            if (name === 'getFullYear' || name === 'getUTCFullYear') context.report({ node, messageId: 'season' });
          },
        };
      },
    },
    'no-unit-cast': {
      meta: {
        type: 'problem', schema: [],
        messages: { constructor: 'Do not cast to {{name}}. Create units with asProbability, asPercent, asRank or asVor from @fantasy-draft/shared/units where external data becomes domain data.' },
      },
      create(context) {
        // Finds a unit anywhere in the cast type, such as Rank | undefined or Record<string, Probability>.
        function unitIn(type) {
          if (!type || typeof type !== 'object') return undefined;
          if (type.type === 'TSTypeReference' && type.typeName.type === 'Identifier' &&
              ['Probability', 'Percent', 'Rank', 'Vor'].includes(type.typeName.name)) return type.typeName.name;
          for (const [key, value] of Object.entries(type)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue;
            const found = Array.isArray(value) ? value.map(unitIn).find(Boolean) : unitIn(value);
            if (found) return found;
          }
          return undefined;
        }
        function check(node) {
          const name = unitIn(node.typeAnnotation);
          if (name) context.report({ node, messageId: 'constructor', data: { name } });
        }
        return { TSAsExpression: check, TSTypeAssertion: check };
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
