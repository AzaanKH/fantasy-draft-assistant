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

/** Paper's Tailwind theme: every token in order; each font size also takes its matching leading as a line height. */
function renderPaperTheme(tokens) {
  const lines = tokens.flatMap((token) => {
    const line = `  ${token.name}: ${formatValue(token)};`;
    if (token.name !== '--text-4xl') return [line];
    const lineHeights = tokens.filter(({ type }) => type === 'fontSize').map(({ name }) => {
      const leading = tokens.find((candidate) => candidate.name === name.replace('--text-', '--leading-'));
      if (!leading) throw new Error(`${tokenSource}: ${name} has no matching --leading token.`);
      return `  ${name}--line-height: ${formatValue(leading)};`;
    });
    return [line, ...lineHeights];
  });
  return `/* Tailwind v4 theme. Values match the tokens saved in Paper. */\n@theme {\n${lines.join('\n')}\n}\n`;
}

function renderWebThemes(json) {
  const paper = new Map(json.tokens.map((token) => [token.name, formatValue(token)]));
  const resolve = (value, name) => value.replace(/\{(--[a-z0-9-]+)\}/g, (_, reference) => {
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

/** Every file generated from the token source, keyed by repository path. */
export function renderTokenFiles(json) {
  return { [paperTheme]: renderPaperTheme(json.tokens), [json.web.output]: renderWebThemes(json) };
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
