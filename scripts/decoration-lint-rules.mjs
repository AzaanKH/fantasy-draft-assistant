/**
 * Banned decorations, from repeated design corrections: pill shapes on information and controls, and accent
 * stripes (a coloured or thick side border, or a thin side bar). Selection and state use a tint plus a text label.
 * The rules read Tailwind class strings in TS/TSX and declarations in CSS (through cssParser).
 */

const pillMessage = 'No pill shapes. Badges, chips and controls use the design-system radii (rounded-xs to rounded-lg, var(--radius-xs) to var(--radius-lg)). A circle needs equal sides: add size-* or aspect-square.';
const stripeMessage = 'No accent stripes. Show state with a tint plus a text label, not a coloured or thick side border or a side bar. Neutral 1px dividers (border-l border-border, var(--color-border)) are fine.';

/** Side borders that only draw a neutral divider or remove the border. */
const NEUTRAL_SIDE_COLOR = /^(border|input|transparent|current|inherit)(\/\d+)?$/;
const NARROW_WIDTH = /^w-(px|0\.5|1|1\.5|2|\[[1-8]px\])$/;
const PILL_RADIUS = /^rounded(-[setblr]{1,2})?-(full|\[(999|9999)px\]|\[(var\()?--radius-pill\)?\])$/;

/** The utility without variants such as `hover:` or `lg:`; arbitrary values in brackets keep their colons. */
function utility(token) {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] === '[') depth += 1;
    else if (token[index] === ']') depth -= 1;
    else if (token[index] === ':' && depth === 0) start = index + 1;
  }
  return token.slice(start);
}

function variant(token) {
  return token.slice(0, token.length - utility(token).length);
}

function isStripeUtility(name) {
  const side = /^border-([lrse])-(.+)$/.exec(name);
  if (side) {
    const value = side[2];
    const width = /^(\d+)$/.exec(value) ?? /^\[(\d+)px\]$/.exec(value);
    if (width) return Number(width[1]) >= 2;
    return !NEUTRAL_SIDE_COLOR.test(value);
  }
  const inset = /^shadow-\[inset_(-?\d+)px_0(px)?_/.exec(name);
  return inset !== null && Math.abs(Number(inset[1])) >= 2;
}

/** A thin bar pinned to one side, drawn by an element or one of its pseudo-elements. */
function hasSideBar(tokens) {
  const byVariant = new Map();
  for (const token of tokens) {
    const key = variant(token);
    if (!byVariant.has(key)) byVariant.set(key, []);
    byVariant.get(key).push(utility(token));
  }
  return [...byVariant.values()].some((names) => names.includes('inset-y-0') &&
    names.some((name) => /^(left|right|start|end)-0$/.test(name)) && names.some((name) => NARROW_WIDTH.test(name)));
}

function staticStrings(node, strings = []) {
  if (!node || typeof node !== 'object') return strings;
  if (node.type === 'Literal' && typeof node.value === 'string') strings.push(node.value);
  else if (node.type === 'TemplateElement') strings.push(node.value.cooked ?? '');
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    if (Array.isArray(value)) value.forEach((child) => staticStrings(child, strings));
    else if (value && typeof value.type === 'string') staticStrings(value, strings);
  }
  return strings;
}

/** All class strings that style the same element: the className attribute or the outermost cn()/cva() call. */
function classExpression(node) {
  let owner = node;
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'JSXAttribute') return current;
    if (current.type === 'CallExpression') owner = current;
    if (current.type.endsWith('Statement') || current.type === 'VariableDeclarator' || current.type === 'Property') break;
  }
  return owner;
}

function classStringRule(check) {
  return (context) => {
    const visit = (node, text) => {
      if (typeof text !== 'string' || !/\b(rounded|border|shadow|inset)-/.test(text)) return;
      check(context, node, text.split(/\s+/).filter(Boolean));
    };
    return {
      Literal: (node) => visit(node, node.value),
      TemplateElement: (node) => visit(node, node.value.cooked),
    };
  };
}

// CSS: comments become spaces so offsets still map to the source.
function declarations(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
  return [...source.matchAll(/(?<![-\w])(border-radius|border-(?:left|right|inline-start|inline-end)(?:-width|-color)?|box-shadow)\s*:\s*([^;}]+)/g)]
    .map((match) => ({ property: match[1], value: match[2].trim().toLowerCase(), index: match.index }));
}

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    else if (value[index] === ')') depth -= 1;
    else if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  return [...parts, value.slice(start).trim()];
}

function isNeutralColor(value) {
  return /^(var\(--color-(border|input)\)|transparent|currentcolor|inherit|initial|none|0)$/.test(value);
}

function isCssStripe({ property, value }) {
  if (property === 'border-radius') return false;
  if (property === 'box-shadow') {
    return splitTopLevel(value).some((shadow) => {
      const inset = /^inset\s+(-?\d+(?:\.\d+)?)px\s+0(?:px)?\b/.exec(shadow);
      return inset !== null && Math.abs(Number(inset[1])) >= 2;
    });
  }
  if (property.endsWith('-width')) return /(\d+(?:\.\d+)?)px/.test(value) && Number(/(\d+(?:\.\d+)?)px/.exec(value)[1]) >= 2;
  const words = splitTopLevel(value.replace(/\s+(?![^(]*\))/g, ',')).filter(Boolean);
  if (words.some((word) => word === 'none' || word === '0')) return false;
  const width = words.map((word) => /^(\d+(?:\.\d+)?)px$/.exec(word)).find(Boolean);
  if (width && Number(width[1]) >= 2) return true;
  const colors = words.filter((word) => !/^\d/.test(word) && !/^(solid|dashed|dotted|double|thin|medium|thick)$/.test(word));
  return colors.some((color) => !isNeutralColor(color));
}

function isCssPill({ property, value }) {
  return property === 'border-radius' && /(^|\s)(999|9999)px\b|var\(--radius-pill\)|100vmax/.test(value);
}

function cssRule(matches, messageId) {
  return (context) => ({
    Program() {
      const text = context.sourceCode.text;
      for (const declaration of declarations(text)) {
        if (!matches(declaration)) continue;
        const start = context.sourceCode.getLocFromIndex(declaration.index);
        context.report({ loc: { start, end: { line: start.line, column: start.column + declaration.property.length } }, messageId });
      }
    },
  });
}

/** Parses CSS as an empty program; the rules read declarations from the source text. */
export const cssParser = {
  meta: { name: 'agent-css-text' },
  parseForESLint(text) {
    const lines = text.split('\n');
    return {
      ast: {
        type: 'Program', body: [], sourceType: 'module', comments: [], tokens: [], range: [0, text.length],
        loc: { start: { line: 1, column: 0 }, end: { line: lines.length, column: lines.at(-1).length } },
      },
      visitorKeys: { Program: [] },
    };
  },
};

/** Each rule reads CSS declarations in .css files and Tailwind class strings everywhere else. */
function byLanguage(css, classes) {
  return (context) => (context.filename.endsWith('.css') ? css : classes)(context);
}

export const decorationRules = {
  'no-pill-shape': {
    meta: {
      type: 'problem', schema: [], messages: { pill: pillMessage },
      docs: {
        description: 'Rejects pill-shaped radii on UI elements that are not circles.',
        hint: 'Use rounded-xs to rounded-lg; give a circle equal sides with size-* or aspect-square.',
      },
    },
    create: byLanguage(cssRule(isCssPill, 'pill'), classStringRule((context, node, tokens) => {
      if (!tokens.some((token) => PILL_RADIUS.test(utility(token)))) return;
      const siblings = staticStrings(classExpression(node)).flatMap((text) => text.split(/\s+/)).map(utility);
      if (siblings.some((name) => /^size-/.test(name) || name === 'aspect-square')) return;
      context.report({ node, messageId: 'pill' });
    })),
  },
  'no-accent-stripe': {
    meta: {
      type: 'problem', schema: [], messages: { stripe: stripeMessage },
      docs: {
        description: 'Rejects coloured or thick side borders, one-sided shadows and thin side bars.',
        hint: 'Show state with a tint plus a text label; keep side borders to neutral 1px dividers.',
      },
    },
    create: byLanguage(cssRule(isCssStripe, 'stripe'), classStringRule((context, node, tokens) => {
      if (tokens.some((token) => isStripeUtility(utility(token))) || hasSideBar(tokens)) context.report({ node, messageId: 'stripe' });
    })),
  },
};
