import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import agent, { baselineRuleIds } from './agent-lint-rules.mjs';
import { cssParser } from './decoration-lint-rules.mjs';

const root = new URL('..', import.meta.url).pathname;
const rules = { 'agent/no-pill-shape': 'error', 'agent/no-accent-stripe': 'error' };

function tsx(source) {
  return new Linter({ cwd: root }).verify(source, [{
    files: ['**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { agent }, rules,
  }], { filename: `${root}web-app/src/probe.tsx` }).map(({ ruleId }) => ruleId);
}

function css(source) {
  return new Linter({ cwd: root }).verify(source, [{
    files: ['**/*.css'], languageOptions: { parser: cssParser }, plugins: { agent }, rules,
  }], { filename: `${root}web-app/src/probe.css` }).map(({ ruleId }) => ruleId);
}

describe('decoration lint', () => {
  it.each([
    '<span className="rounded-full border px-2 py-0.5 text-xs">QB</span>;',
    "<button className={cn('rounded-full px-3', active && 'bg-primary')}>All</button>;",
    '<span className="rounded-[999px] px-2">Keeper</span>;',
    '<span className="sm:rounded-full px-2">Live</span>;',
    "const badge = cva('inline-flex rounded-full px-2', { variants: {} });",
  ])('rejects a pill: %s', (source) => {
    expect(tsx(source)).toEqual(['agent/no-pill-shape']);
  });

  it.each([
    '<img className="size-9 shrink-0 rounded-full" />;',
    "<span className={cn('flex shrink-0 rounded-full border', strip ? 'size-8' : 'size-9')} />;",
    '<span className="aspect-square w-3 rounded-full bg-success" />;',
    '<span className="rounded-xs border px-2 py-0.5">QB</span>;',
    '<span className="rounded-md px-2">Keeper</span>;',
  ])('accepts circles and design radii: %s', (source) => {
    expect(tsx(source)).toEqual([]);
  });

  it.each([
    // The Best Pick card's stripe, removed in the skeletons PR.
    '<div className="border-l-4 border-l-emerald-500 px-3 py-3" />;',
    '<div className="border-r-2 px-3" />;',
    '<div className="border-s-[3px] px-3" />;',
    '<div className="border-l border-l-primary" />;',
    '<div className="relative before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary" />;',
    '<span className="absolute inset-y-0 left-0 w-1 bg-warning" />;',
    '<div className="shadow-[inset_3px_0_0_var(--color-primary)]" />;',
  ])('rejects an accent stripe: %s', (source) => {
    expect(tsx(source)).toEqual(['agent/no-accent-stripe']);
  });

  it.each([
    '<td className="border-l border-border/70 px-2" />;',
    '<button className="border-r border-border/70 last:border-r-0" />;',
    // The active route tab's underline.
    '<button className="relative after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-emerald-500" />;',
    // A full-height sheet pinned to one side is a panel, not a bar.
    '<div className="fixed inset-y-0 right-0 w-[min(440px,100vw)] border-y-0 border-r-0" />;',
  ])('accepts dividers, underlines and side panels: %s', (source) => {
    expect(tsx(source)).toEqual([]);
  });

  it.each([
    ['.chip { border-radius: 999px; }', 'agent/no-pill-shape'],
    ['.chip { border-radius: var(--radius-pill); }', 'agent/no-pill-shape'],
    ['.card { border-left: 3px solid var(--color-primary); }', 'agent/no-accent-stripe'],
    ['.card { border-left: 1px solid var(--color-warning); }', 'agent/no-accent-stripe'],
    ['.card { border-inline-start-width: 4px; }', 'agent/no-accent-stripe'],
    ['.row { box-shadow: inset 4px 0 0 var(--color-primary); }', 'agent/no-accent-stripe'],
  ])('rejects CSS decoration: %s', (source, ruleId) => {
    expect(css(source)).toEqual([ruleId]);
  });

  it.each([
    '.avatar { border-radius: 50%; }',
    ':root { --radius-pill: 999px; }',
    '.panel { border-left: 1px solid var(--color-border); }',
    '.panel { border-left: 0; }',
    '.tab[data-state=active] { border-bottom: 3px solid var(--color-primary); }',
    '.column { box-shadow: inset 1px 0 0 var(--edge), inset -1px 0 0 var(--edge); }',
    '/* border-left: 4px solid red; */ .panel { border-radius: 8px; }',
  ])('accepts CSS dividers, circles and token definitions: %s', (source) => {
    expect(css(source)).toEqual([]);
  });

  it('reports CSS at the declaration', () => {
    const [message] = new Linter({ cwd: root }).verify('.a {\n  color: red;\n  border-radius: 999px;\n}', [{
      files: ['**/*.css'], languageOptions: { parser: cssParser }, plugins: { agent }, rules,
    }], { filename: `${root}web-app/src/probe.css` });
    expect(message).toMatchObject({ line: 3, column: 3, message: expect.stringContaining('No pill shapes') });
  });

  it.each([
    'web-app/src/components/probe.tsx', 'web-app/src/probe.css', 'extension/src/sidepanel/probe.css', 'extension/src/probe.ts',
  ])('applies to UI source %s, under the baseline ratchet', async (filePath) => {
    const config = await new ESLint({ cwd: root }).calculateConfigForFile(filePath);
    expect(config.rules['agent/no-pill-shape']).toEqual([2]);
    expect(config.rules['agent/no-accent-stripe']).toEqual([2]);
    expect(baselineRuleIds).toEqual(expect.arrayContaining(['agent/no-pill-shape', 'agent/no-accent-stripe']));
  });

  it.each(['web-app/src/components/probe.test.tsx', 'server/src/probe.ts'])('does not apply to %s', async (filePath) => {
    const config = await new ESLint({ cwd: root }).calculateConfigForFile(filePath);
    expect(config.rules['agent/no-pill-shape']).toBeUndefined();
  });
});
