import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
export const tokenSource = 'docs/design-system/tokens.json';
const paperTheme = 'docs/design-system/tokens.css';
const header = (output) => `/* Generated from ${tokenSource} by \`pnpm tokens:write\`. Edit tokens.json, then regenerate ${output}. */\n`;

function formatValue(token) {
  return token.type === 'fontFamily' ? `"${token.value}", sans-serif` : String(token.value);
}

/** Paper's Tailwind theme: every token in order, with each font size's matching leading as a line height after the last size. */
function renderPaperTheme(tokens) {
  const sizes = tokens.filter(({ type }) => type === 'fontSize');
  const lines = tokens.flatMap((token) => {
    const line = `  ${token.name}: ${formatValue(token)};`;
    if (token !== sizes.at(-1)) return [line];
    const lineHeights = sizes.map(({ name }) => {
      const leading = tokens.find((candidate) => candidate.name === name.replace('--text-', '--leading-'));
      if (!leading) throw new Error(`${tokenSource}: ${name} has no matching --leading token.`);
      return `  ${name}--line-height: ${formatValue(leading)};`;
    });
    return [line, ...lineHeights];
  });
  return `${header(paperTheme)}/* Tailwind v4 theme. Values match the tokens saved in Paper. */\n@theme {\n${lines.join('\n')}\n}\n`;
}

function renderWebThemes(json) {
  const paper = new Map(json.tokens.map((token) => [token.name, formatValue(token)]));
  const resolve = (value, name) => String(value).replace(/\{([^}]*)\}/g, (_, reference) => {
    if (!paper.has(reference)) throw new Error(`${tokenSource}: ${name} refers to unknown Paper token ${reference}.`);
    return paper.get(reference);
  });
  const blocks = json.web.blocks.map(({ selector, groups }) => {
    const body = groups.map(({ comment, values }) => [
      ...(comment ? [`  /* ${comment} */`] : []),
      ...Object.entries(values).map(([name, value]) => `  ${name}: ${resolve(value, name)};`),
    ].join('\n'));
    return `${selector} {\n${body.join('\n\n')}\n}\n`;
  });
  return header(json.web.output) + blocks.join('\n');
}

/**
 * The extension's side-panel shell is plain CSS (no Tailwind), so it gets the named web tokens as custom
 * properties: light values from the light block, dark values (night palette references resolved). The shell
 * follows the app's chosen theme, which the embedded app reports and the shell sets as data-theme; until it is
 * known, prefers-color-scheme decides.
 */
function renderExtensionTokens(json) {
  const { output, light, dark, names } = json.extension;
  const paper = new Map(json.tokens.map((token) => [token.name, formatValue(token)]));
  const block = (selector) => {
    const found = json.web.blocks.find((candidate) => candidate.selector === selector);
    if (!found) throw new Error(`${tokenSource}: extension block ${selector} is not a web block.`);
    return new Map(found.groups.flatMap(({ values }) => Object.entries(values)));
  };
  const root = block(':root');
  const resolve = (value, name) => String(value)
    .replace(/\{([^}]*)\}/g, (_, reference) => {
      if (!paper.has(reference)) throw new Error(`${tokenSource}: ${name} refers to unknown Paper token ${reference}.`);
      return paper.get(reference);
    })
    .replace(/var\((--[\w-]+)\)/g, (match, reference) => root.has(reference) ? resolve(root.get(reference), reference) : match);
  const lightValues = block(light);
  const darkValues = block(dark);
  const lines = (values, fallback) => names.map((name) => {
    // A name the web block does not restate (Tailwind's own type scale) comes straight from the Paper token.
    const value = values.get(name) ?? fallback?.get(name) ?? (paper.has(name) ? `{${name}}` : undefined);
    if (value === undefined) throw new Error(`${tokenSource}: extension token ${name} has no value in ${light}.`);
    return `  ${name}: ${resolve(value, name)};`;
  });
  const darkLines = names.filter((name) => darkValues.has(name)).map((name) => `    ${name}: ${resolve(darkValues.get(name), name)};`);
  const darkRoot = darkLines.map((line) => line.slice(2)).join('\n');
  return `${header(output)}:root {\n${lines(lightValues).join('\n')}\n}\n\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${darkLines.join('\n')}\n  }\n}\n\n:root[data-theme="dark"] {\n${darkRoot}\n}\n`;
}

/** Every file generated from the token source, keyed by repository path. */
export function renderTokenFiles(json) {
  return {
    [paperTheme]: renderPaperTheme(json.tokens),
    [json.web.output]: renderWebThemes(json),
    ...(json.extension ? { [json.extension.output]: renderExtensionTokens(json) } : {}),
  };
}

/** Lists each generated file whose committed text differs from the token source. */
export async function checkTokenFiles(read = (file) => readFile(path.join(root, file), 'utf8')) {
  const files = renderTokenFiles(JSON.parse(await read(tokenSource)));
  const failures = [];
  for (const [file, expected] of Object.entries(files)) {
    const actual = await read(file).catch(() => null);
    if (actual !== expected) failures.push(`${file} does not match ${tokenSource}. Edit the token source, then run pnpm tokens:write.`);
  }
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--write')) {
    const files = renderTokenFiles(JSON.parse(await readFile(path.join(root, tokenSource), 'utf8')));
    for (const [file, text] of Object.entries(files)) await writeFile(path.join(root, file), text);
    console.log(`Wrote ${Object.keys(files).join(', ')} from ${tokenSource}.`);
  } else {
    const failures = await checkTokenFiles();
    for (const failure of failures) console.error(failure);
    if (failures.length) process.exitCode = 1;
    else console.log(`Design tokens match ${tokenSource}.`);
  }
}
