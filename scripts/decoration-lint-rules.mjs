/**
 * Banned decorations, from repeated design corrections: pill shapes on information and controls, and accent
 * stripes (a coloured or thick side border, a one-sided shadow, or a thin bar pinned to one side). Selection and
 * state use a tint plus a text label. The rules read Tailwind class strings in TS/TSX, and declarations and
 * `@apply` lines in CSS (through cssParser).
 *
 * Known limits: inline `style` objects and Tailwind arbitrary properties such as `[border-left:4px_solid_red]`
 * are not read, and a `size-*` in a conditional of the same cn() call counts as making the element a circle.
 */

const pillMessage = 'No pill shapes. Badges, chips and controls use the design-system radii (rounded-xs to rounded-lg, var(--radius-xs) to var(--radius-lg)). A circle needs equal sides: add size-* or aspect-square.';
const stripeMessage = 'No accent stripes. Show state with a tint plus a text label, not a coloured or thick side border, a one-sided shadow or a side bar. Neutral 1px dividers (border-l border-border, var(--color-border)) are fine.';

/** Colours that only draw a neutral divider. */
const NEUTRAL_COLOR_NAME = /^(border|input|muted|transparent|current|inherit)(\/\d+)?$/;
const THEME_COLOR = /^(primary|secondary|accent|destructive|foreground|success|warning|danger|ring|on-clock|keeper|paused|position-[a-z]+|[a-z]+-\d{2,3})(\/\d+)?$/;
const NARROW_WIDTH = /^w-(px|0\.5|1|1\.5|2|\[[1-8]px\])$/;
const PILL_RADIUS = /^rounded(-[setblr]{1,2})?-(full|pill|\(--radius-pill\)|\[(var\()?--radius-pill\)?\])$/;
const CIRCLE = /^(size-(\d+(\.\d+)?|px|\[[^\]]+\])|aspect-square)$/;

/** A CSS length in pixels, or null when it is not a fixed length. */
function lengthPx(value) {
  const keyword = { thin: 1, medium: 3, thick: 5 }[value];
  if (keyword !== undefined) return keyword;
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value);
  if (!match) return null;
  if (!match[2] && Number(match[1]) !== 0) return null;
  return Math.abs(Number(match[1])) * (match[2] === 'rem' || match[2] === 'em' ? 16 : 1);
}

function isPillRadius(value) {
  return /var\(--radius-pill\)|vmax|calc\(infinity/.test(value) ||
    value.split(/[\s/]+/).some((part) => (lengthPx(part) ?? 0) >= 99);
}

/** The utility without variants such as `hover:` or `lg:` or an important `!`; brackets keep their colons. */
function utility(token) {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] === '[' || token[index] === '(') depth += 1;
    else if (token[index] === ']' || token[index] === ')') depth -= 1;
    else if (token[index] === ':' && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!|!$/g, '');
}

function variant(token) {
  return token.slice(0, token.lastIndexOf(utility(token)));
}

function isPillUtility(name) {
  if (PILL_RADIUS.test(name)) return true;
  const arbitrary = /^rounded(-[setblr]{1,2})?-\[(.+)\]$/.exec(name);
  return arbitrary !== null && isPillRadius(arbitrary[2].replaceAll('_', ' '));
}

/** A side border that is thick or coloured, or a one-sided shadow. */
function isStripeUtility(name) {
  const side = /^border-([lrse])-(.+)$/.exec(name);
  if (side) {
    const value = side[2];
    const width = /^(\d+)$/.exec(value) ?? /^\[(\d+)px\]$/.exec(value);
    if (width) return Number(width[1]) >= 2;
    if (/^\[(length:|var\(--color-(border|input)\))/.test(value)) return false;
    return !NEUTRAL_COLOR_NAME.test(value);
  }
  const shadow = /^(?:inset-)?shadow-\[(.+)\]$/.exec(name);
  return shadow !== null && splitTopLevel(shadow[1].replaceAll('_', ' ')).some((entry) => isOneSidedShadow(entry, name.startsWith('inset-')));
}

/** A neutral 1px side border coloured by a separate `border-<colour>` utility, as in `border-l border-primary`. */
function hasColouredSide(names) {
  const side = names.some((name) => /^border-[lrse]$/.test(name));
  const allSides = names.some((name) => /^border(-[xy])?(-\d+)?$/.test(name));
  const colour = names.some((name) => name.startsWith('border-') && THEME_COLOR.test(name.slice('border-'.length)));
  return side && colour && !allSides;
}

/** A thin bar pinned to one side, drawn by an element or one of its pseudo-elements. */
function hasSideBar(tokens) {
  const byVariant = new Map();
  for (const token of tokens) {
    const key = variant(token);
    if (!byVariant.has(key)) byVariant.set(key, []);
    byVariant.get(key).push(utility(token));
  }
  return [...byVariant.values()].some((names) => {
    const fullHeight = names.includes('inset-y-0') || names.includes('h-full') || (names.includes('top-0') && names.includes('bottom-0'));
    return fullHeight && names.some((name) => /^(left|right|start|end)-0$/.test(name)) && names.some((name) => NARROW_WIDTH.test(name));
  });
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

/** Space-separated words. Spaces outside parentheses become commas, so var() and color-mix() stay whole. */
function words(value) {
  return splitTopLevel(value.replace(/\s+(?![^(]*\))/g, ',')).filter(Boolean);
}

/** Neutral colours: the border tokens, the page background that grid shadows paint, and no colour at all. */
function isNeutralColor(value) {
  return /^(var\(--color-(border|input|background)[,)]|transparent|currentcolor|inherit|initial|unset|none)/.test(value) ||
    (/^color-mix\(/.test(value) && /var\(--color-(border|input|background)\)/.test(value) && !/var\(--color-(?!border|input|background)/.test(value));
}

/** One shadow that offsets along x only, by 2px or more, without blur: a stripe on one side. */
function isOneSidedShadow(shadow, insetByUtility = false) {
  const parts = words(shadow);
  const inset = insetByUtility || parts.includes('inset');
  const [x, y, blur = 0] = parts.filter((part) => part !== 'inset').map(lengthPx).filter((length) => length !== null);
  if (x === undefined || y !== 0 || blur !== 0 || Math.abs(x) < 2) return false;
  const colour = parts.find((part) => part !== 'inset' && lengthPx(part) === null);
  return inset || colour === undefined || !isNeutralColor(colour);
}

function isCssStripe({ property, value }) {
  if (property === 'box-shadow') return splitTopLevel(value).some((shadow) => isOneSidedShadow(shadow));
  if (!/^border-(left|right|inline-start|inline-end)/.test(property) || property.endsWith('-style') || property.endsWith('radius')) return false;
  const parts = words(value);
  if (parts.some((part) => part === 'none' || part === 'hidden' || lengthPx(part) === 0)) return false;
  if (parts.some((part) => (lengthPx(part) ?? 0) >= 2)) return true;
  if (property.endsWith('-width')) return false;
  return parts.some((part) => lengthPx(part) === null && !/^(solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(part) && !isNeutralColor(part));
}

function isCssPill({ property, value }) {
  return property.endsWith('radius') && isPillRadius(value);
}

function staticStrings(node, strings = []) {
  if (!node || typeof node !== 'object') return strings;
  if (node.type === 'Literal' && typeof node.value === 'string') strings.push(node.value);
  else if (node.type === 'TemplateElement') strings.push(node.value.cooked ?? '');
  for (const [key, value] of Object.entries(node)) {
    // Variant objects, as in cva(base, { variants }), style other states, not this element's base.
    if (key === 'parent' || key === 'loc' || key === 'range' || value?.type === 'ObjectExpression') continue;
    if (Array.isArray(value)) value.forEach((child) => staticStrings(child, strings));
    else if (value && typeof value.type === 'string') staticStrings(value, strings);
  }
  return strings;
}

/** The strings that style one element: its className attribute, or the outermost cn()/cva() call around the string. */
function classExpression(node) {
  let owner = node;
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'JSXAttribute') return current;
    if (current.type === 'CallExpression') owner = current;
    // A variant value inside cva's options object styles its own state, so it stands alone.
    if (current.type.endsWith('Statement') || current.type === 'VariableDeclarator' || current.type === 'Property') break;
  }
  return owner;
}

/** Equal sides draw a circle: size-*, aspect-square, or matching h-* and w-*. */
function isCircle(names) {
  if (names.some((name) => CIRCLE.test(name))) return true;
  const heights = new Set(names.filter((name) => /^h-(\d|\[)/.test(name)).map((name) => name.slice(2)));
  return names.some((name) => /^w-(\d|\[)/.test(name) && heights.has(name.slice(2)));
}

function checkPill(report, tokens, siblings) {
  if (tokens.some((token) => isPillUtility(utility(token))) && !isCircle(siblings.map(utility))) report('pill');
}

function checkStripe(report, tokens) {
  const names = tokens.map(utility);
  if (names.some(isStripeUtility) || hasColouredSide(names) || hasSideBar(tokens)) report('stripe');
}

function classStringRule(check) {
  return (context) => {
    const visit = (node, text) => {
      if (typeof text !== 'string' || !/(rounded|border|shadow|inset|top|h)-/.test(text)) return;
      check((messageId) => { context.report({ node, messageId }); }, text.split(/\s+/).filter(Boolean), node);
    };
    return {
      Literal: (node) => visit(node, node.value),
      TemplateElement: (node) => visit(node, node.value.cooked),
    };
  };
}

// CSS: comments become spaces, so offsets still map to the source.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
}

function declarations(source) {
  return [...source.matchAll(/(?<![-\w])((?:border|box-shadow)[-a-z]*)\s*:\s*([^;}]+)/gi)].map((match) => ({
    property: match[1].toLowerCase(),
    value: match[2].trim().toLowerCase().replace(/\s*!important$/, ''),
    index: match.index,
    length: match[1].length,
  }));
}

/** A ::before or ::after rule that draws a thin full-height bar against one side. */
function pseudoBars(source) {
  return [...source.matchAll(/([^{}]*::?(?:before|after)[^{}]*)\{([^{}]*)\}/gi)].filter(([, , body]) => {
    const style = Object.fromEntries([...body.matchAll(/([-a-z]+)\s*:\s*([^;]+)/gi)].map(([, name, value]) => [name.toLowerCase(), value.trim().toLowerCase()]));
    const pinned = [style.left, style.right, style['inset-inline-start'], style['inset-inline-end']].some((value) => lengthPx(value ?? '') === 0) ||
      /^0(px)? auto 0(px)? 0(px)?$|^0(px)? 0(px)? 0(px)? auto$/.test(style.inset ?? '');
    const fullHeight = (lengthPx(style.top ?? '') === 0 && lengthPx(style.bottom ?? '') === 0) || style.height === '100%' ||
      lengthPx(style['inset-block'] ?? '') === 0 || /^0(px)? /.test(style.inset ?? '');
    const width = lengthPx(style.width ?? style['inline-size'] ?? '');
    return pinned && fullHeight && width !== null && width > 0 && width <= 8;
  }).map((match) => ({ index: match.index + match[1].search(/\S/), length: match[1].trim().length }));
}

function cssRule(kind) {
  return (context) => ({
    Program() {
      const source = stripComments(context.sourceCode.text);
      const report = (index, length) => {
        const start = context.sourceCode.getLocFromIndex(index);
        context.report({ loc: { start, end: { line: start.line, column: start.column + length } }, messageId: kind });
      };
      for (const declaration of declarations(source)) {
        if (kind === 'pill' ? isCssPill(declaration) : isCssStripe(declaration)) report(declaration.index, declaration.length);
      }
      if (kind === 'stripe') for (const bar of pseudoBars(source)) report(bar.index, bar.length);
      for (const apply of source.matchAll(/@apply\s+([^;]+);/g)) {
        const tokens = apply[1].split(/\s+/).filter(Boolean);
        const onReport = () => { report(apply.index, '@apply'.length); };
        if (kind === 'pill') checkPill(onReport, tokens, tokens);
        else checkStripe(onReport, tokens);
      }
    },
  });
}

/**
 * Parses CSS as an empty program; the rules read the source text. With no comment tokens, eslint-disable
 * comments have no effect in CSS, so accepted exceptions go in eslint-baseline.json.
 */
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

/** Each rule reads CSS in .css files and Tailwind class strings everywhere else. */
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
    create: byLanguage(cssRule('pill'), classStringRule((report, tokens, node) => {
      if (!tokens.some((token) => isPillUtility(utility(token)))) return;
      const siblings = staticStrings(classExpression(node)).flatMap((value) => value.split(/\s+/)).filter(Boolean);
      checkPill(report, tokens, siblings);
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
    create: byLanguage(cssRule('stripe'), classStringRule((report, tokens) => { checkStripe(report, tokens); })),
  },
};
