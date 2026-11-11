import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/**
 * Model terms the interface replaced with plain words (R10-2, round 11): the chance a player is still there at your
 * next pick, points over a fill-in starter. Only string and JSX text is checked; comments may still use them.
 */
const BANNED = /Return Probability|\bVOR\b|policy points|(?:above|versus|over) replacement|[Vv]alue over replacement|Provider Truth|[Rr]eplacement[- ]level/;
/**
 * Components, hooks and workspace code, the extension's side panel, and the shared draft code whose strings reach the
 * screen as-is (assistant answers and recommendation explanations).
 */
const ROOTS = [
  '../features', '../components', '../lib', '../hooks', '../workspace', '../../../extension/src/sidepanel',
  '../../../shared/src/draft/assistant', '../../../shared/src/draft/recommendations',
];
/** Developer tools, not product copy. */
const EXCLUDED = /[\\/](experiments|visual)[\\/]|\.test\.|\.d\.ts$/;

const here = path.dirname(fileURLToPath(import.meta.url));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.(tsx?|html)$/.test(name) && !EXCLUDED.test(file) ? [file] : [];
  });
}
/** Drops comments, then keeps only quoted strings, template text and JSX text between tags. */
function visibleText(source: string): string {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
  const strings = code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
  const jsxText = code.match(/>[^<>{}]+</g) ?? [];
  return [...strings, ...jsxText].join('\n');
}

it('keeps model jargon out of user-visible copy', () => {
  const offenders = ROOTS.flatMap((root) => sources(path.resolve(here, root)))
    .flatMap((file) => visibleText(readFileSync(file, 'utf8')).split('\n')
      .filter((line) => BANNED.test(line))
      .map((line) => `${path.relative(here, file)}: ${line.trim().slice(0, 120)}`));
  expect(offenders).toEqual([]);
});

it('bans the provider and model terms the round 12 copy replaced', () => {
  for (const phrase of ['Provider Truth confirmed', 'a replacement-level player', 'replacement level', 'VOR +12']) expect(BANNED.test(phrase)).toBe(true);
  for (const phrase of ['Synced', 'a fill-in starter', "the provider's picks"]) expect(BANNED.test(phrase)).toBe(false);
});
