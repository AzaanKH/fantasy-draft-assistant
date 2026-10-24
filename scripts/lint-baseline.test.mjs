import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import agent from './agent-lint-rules.mjs';
import { baselineOccurrences, compareBaseline, newDiagnostics, ruleHint } from './lint-baseline.mjs';

const file = 'cli/src/client.ts';
const rule = 'agent/no-json-cast';
const old = 'const old = JSON.parse(input) as Old;';
function diagnostics(source) {
  return new Linter().verify(source, [{ languageOptions: { parser: tseslint.parser }, plugins: { agent }, rules: { [rule]: 'error' } }]);
}
function occurrences(source) {
  return baselineOccurrences([{ filePath: `/repo/${file}`, messages: diagnostics(source) }], '/repo', new Map([[`/repo/${file}`, source]]));
}
const baseline = { [file]: { reason: 'Decode existing JSON at its owning boundary.', occurrences: occurrences(old)[file] } };

describe('lint occurrence baseline', () => {
  it('accepts existing occurrences after a line insertion', () => {
    expect(compareBaseline(occurrences(`\n${old}`), baseline, ['cli'])).toEqual([]);
  });
  it('reports only a new violation inserted before an old occurrence', () => {
    const source = `const fresh = JSON.parse(other) as Fresh;\n${old}`;
    expect(compareBaseline(occurrences(source), baseline, ['cli'])).toEqual([expect.stringContaining('1 new violation')]);
    const messages = newDiagnostics(diagnostics(source), source, baseline[file]);
    expect(messages).toHaveLength(1);
    expect(messages[0].line).toBe(1);
  });
  it('treats duplicate fingerprints as a multiset and detects stale reductions', () => {
    const doubled = `${old}\n${old}`;
    expect(newDiagnostics(diagnostics(doubled), doubled, baseline[file])).toHaveLength(1);
    const doubleBaseline = { [file]: { ...baseline[file], occurrences: occurrences(doubled)[file] } };
    expect(compareBaseline(occurrences(old), doubleBaseline, ['cli'])).toEqual([expect.stringContaining('baseline is stale')]);
    expect(compareBaseline({}, baseline, ['cli'])).toEqual([expect.stringContaining('baseline is stale')]);
  });
  it('does not reveal accepted diagnostics when another rule or file fails', () => {
    const ordinary = { ruleId: 'agent/no-bare-fetch', line: 3, column: 1 };
    expect(newDiagnostics([...diagnostics(old), ordinary], old, baseline[file])).toEqual([ordinary]);
    const actual = { ...occurrences(old), 'cli/src/new.ts': occurrences(old)[file] };
    expect(compareBaseline(actual, baseline, ['cli'])).toEqual([expect.stringContaining('cli/src/new.ts')]);
    expect(newDiagnostics(diagnostics(old), old, baseline[file])).toEqual([]);
  });
  it('rejects count-only snapshots, missing reasons, and ineligible rules', () => {
    for (const saved of [
      { reason: 'old', counts: { [rule]: 1 } }, { ...baseline[file], reason: ' ' },
      { reason: 'fetch', occurrences: { 'agent/no-bare-fetch': baseline[file].occurrences[rule] } },
    ]) expect(compareBaseline(occurrences(old), { [file]: saved }, ['cli'])).toEqual([expect.stringContaining('invalid baseline')]);
    expect(compareBaseline({}, baseline, ['shared'])).toEqual([]);
  });
  it('uses each rule owner’s hint', () => {
    for (const [name, definition] of Object.entries(agent.rules)) {
      expect(ruleHint(`agent/${name}`)).toBe(definition.meta.docs.hint);
      expect(definition.meta.docs.hint.length).toBeGreaterThan(10);
    }
    expect(ruleHint('@typescript-eslint/explicit-module-boundary-types')).toContain('return type');
  });
});
