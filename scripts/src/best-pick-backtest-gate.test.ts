import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertBestPickGateRecorded,
  assertBestPickPolicyUnchanged,
  bestPickGateFailures,
  bestPickPolicySources,
  bestPickReplayEntryChain,
  bestPickReplayProblems,
  hashBestPickPolicySources,
  nextBestPickGate,
  parseBestPickGateBlocks,
  renderBestPickGateBlocks,
  type BestPickFoldCoverage,
  type BestPickGateMeasurement,
} from './best-pick-backtest-gate.js';

const PICKS = [3, 22, 27, 46, 51, 70, 75, 94, 99, 118, 123, 142];
const FOLDS: readonly BestPickFoldCoverage[] = [2022, 2023, 2024, 2025]
  .map((season) => ({ season, pickNumbers: PICKS }));
const COMPLETE = FOLDS.map(({ season }) => ({ season, bestPickPicks: PICKS, ecrPicks: PICKS }));

const measurement = (
  policySourceHash: string,
  vorCaptured: number,
  averageRegret: number,
  folds: readonly BestPickFoldCoverage[] = FOLDS
): BestPickGateMeasurement => ({
  version: 3,
  policySourceHash,
  folds,
  bestPickVsEcr: { starterPoints: 0, vorCaptured, averageRegret, top24PositionHitRate: 0 },
});

describe('Best Pick backtest gate', () => {
  it('passes the committed report for the current policy source', () => {
    const report = readFileSync(new URL('../../docs/recommendation-backtest.md', import.meta.url), 'utf8');
    expect(bestPickGateFailures(parseBestPickGateBlocks(report), hashBestPickPolicySources())).toEqual([]);
    expect(bestPickReplayEntryChain()).toEqual([
      'shared/src/draft/index.ts',
      'shared/src/draft/calculations/recommendations.ts',
    ]);
  });

  it('hashes the runtime import graph of the policy, including transitive shared modules', () => {
    expect(bestPickPolicySources()).toEqual(expect.arrayContaining([
      'shared/src/draft/calculations/best-pick-policy.ts',
      'shared/src/draft/calculations/recommendations.ts',
      'shared/src/draft/calculations/tiers.ts',
      'shared/src/league/positions.ts',
    ]));

    const files: Record<string, string> = {
      'shared/src/draft/calculations/best-pick-policy.ts':
        "import type { Only } from './types.js';\nimport { helper } from '../helper.js';",
      'shared/src/draft/calculations/recommendations.ts': "export { policy } from './best-pick-policy.js';",
      'shared/src/draft/helper.ts': "import { deep } from '../league/deep.js';",
      'shared/src/league/deep.ts': 'export const deep = 1;',
      'shared/src/draft/calculations/types.ts': 'export type Only = 1;',
    };
    const read = (overrides: Record<string, string> = {}) => (path: string): string => {
      const text = overrides[path] ?? files[path];
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    };
    expect(bestPickPolicySources(read())).toEqual([
      'shared/src/draft/calculations/best-pick-policy.ts',
      'shared/src/draft/calculations/recommendations.ts',
      'shared/src/draft/helper.ts',
      'shared/src/league/deep.ts',
    ]);
    const base = hashBestPickPolicySources(read());
    expect(hashBestPickPolicySources(read({ 'shared/src/league/deep.ts': 'export const deep = 2;' }))).not.toBe(base);
    expect(hashBestPickPolicySources(read({ 'shared/src/draft/calculations/types.ts': 'export type Only = 2;' })))
      .toBe(base);
    expect(() => bestPickPolicySources(read({ 'shared/src/draft/helper.ts': "import { gone } from './gone.js';" })))
      .toThrow(/cannot resolve/);
  });

  it('follows @fantasy-draft/shared self-imports through the package source exports', () => {
    const files: Record<string, string> = {
      'shared/package.json': JSON.stringify({
        exports: {
          './league': { '@fantasy-draft/source': './src/league/index.ts', import: './dist/league/index.js' },
          './dist-only': { import: './dist/x.js' },
        },
      }),
      'shared/src/draft/calculations/best-pick-policy.ts':
        "import { slot } from '@fantasy-draft/shared/league';\nimport type { T } from '@fantasy-draft/shared/types';",
      'shared/src/draft/calculations/recommendations.ts': 'export const r = 1;',
      'shared/src/league/index.ts': "export { slot } from './slot.js';",
      'shared/src/league/slot.ts': 'export const slot = 1;',
    };
    const read = (overrides: Record<string, string> = {}) => (path: string): string => {
      const text = overrides[path] ?? files[path];
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    };
    expect(bestPickPolicySources(read())).toEqual([
      'shared/src/draft/calculations/best-pick-policy.ts',
      'shared/src/draft/calculations/recommendations.ts',
      'shared/src/league/index.ts',
      'shared/src/league/slot.ts',
    ]);
    const base = hashBestPickPolicySources(read());
    expect(hashBestPickPolicySources(read({ 'shared/src/league/slot.ts': 'export const slot = 2;' }))).not.toBe(base);
    expect(() => bestPickPolicySources(read({
      'shared/src/draft/calculations/recommendations.ts': "import { x } from '@fantasy-draft/shared/missing';",
    }))).toThrow(/does not export from source/);
    expect(() => bestPickPolicySources(read({
      'shared/src/draft/calculations/recommendations.ts': "import { x } from '@fantasy-draft/shared/dist-only';",
    }))).toThrow(/does not export from source/);
    expect(() => bestPickPolicySources(read({
      'shared/src/draft/calculations/recommendations.ts': "import { x } from '@fantasy-draft/other';",
    }))).toThrow(/only follows imports into shared\/src/);
  });

  it('follows string-literal dynamic imports anywhere in a policy file and rejects computed ones', () => {
    const files: Record<string, string> = {
      'shared/src/draft/calculations/best-pick-policy.ts':
        "export async function load() {\n  if (Math.random()) return (await import('./lazy.js')).lazy;\n}",
      'shared/src/draft/calculations/recommendations.ts': 'export const r = await import(`../eager.js`);',
      'shared/src/draft/calculations/lazy.ts': 'export const lazy = 1;',
      'shared/src/draft/eager.ts': 'export const eager = 1;',
    };
    const read = (overrides: Record<string, string> = {}) => (path: string): string => {
      const text = overrides[path] ?? files[path];
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    };
    expect(bestPickPolicySources(read())).toEqual([
      'shared/src/draft/calculations/best-pick-policy.ts',
      'shared/src/draft/calculations/lazy.ts',
      'shared/src/draft/calculations/recommendations.ts',
      'shared/src/draft/eager.ts',
    ]);
    const base = hashBestPickPolicySources(read());
    expect(hashBestPickPolicySources(read({ 'shared/src/draft/calculations/lazy.ts': 'export const lazy = 2;' })))
      .not.toBe(base);
    expect(() => bestPickPolicySources(read({
      'shared/src/draft/calculations/recommendations.ts': "const name = './lazy.js';\nexport const r = import(name);",
    }))).toThrow(/computed specifier/);
    expect(() => bestPickPolicySources(read({
      'shared/src/draft/calculations/recommendations.ts': 'export const r = import(`./${\'lazy\'}.js`);',
    }))).toThrow(/computed specifier/);
    expect(() => bestPickPolicySources(read({
      'shared/src/draft/calculations/recommendations.ts': "export const r = import('./gone.js');",
    }))).toThrow(/cannot resolve/);
  });

  const fakeRead = (files: Record<string, string>) => (overrides: Record<string, string> = {}) => (path: string): string => {
    const text = overrides[path] ?? files[path];
    if (text === undefined) throw new Error(`missing ${path}`);
    return text;
  };
  const POLICY = 'shared/src/draft/calculations/best-pick-policy.ts';
  const RECOMMENDATIONS = 'shared/src/draft/calculations/recommendations.ts';

  it('checks that the replay reaches getRecommendations in a hashed root through the export map', () => {
    const read = fakeRead({
      'shared/package.json': JSON.stringify({
        exports: { './draft': { '@fantasy-draft/source': './src/draft/index.ts', import: './dist/draft/index.js' } },
      }),
      'scripts/src/backtest-recommendations.ts': [
        "import type { Recommendation } from '@fantasy-draft/shared/draft';",
        "import { applyPositionTiers, getRecommendations as recommend } from '@fantasy-draft/shared/draft';",
      ].join('\n'),
      'shared/src/draft/index.ts': "export { getRecommendations } from './calculations/recommendations.js';",
      [RECOMMENDATIONS]: 'export function getRecommendations() { return []; }',
      'shared/src/draft/calculations/other.ts': 'export const getRecommendations = () => [];',
      'shared/src/draft/calculations/middle.ts': "export { getRecommendations } from './recommendations.js';",
    });
    expect(bestPickReplayEntryChain(read())).toEqual(['shared/src/draft/index.ts', RECOMMENDATIONS]);
    expect(bestPickReplayEntryChain(read({
      'shared/src/draft/index.ts': "export { getRecommendations as getRecommendations } from './calculations/middle.js';",
    }))).toEqual(['shared/src/draft/index.ts', 'shared/src/draft/calculations/middle.ts', RECOMMENDATIONS]);
    expect(() => bestPickReplayEntryChain(read({
      'shared/src/draft/index.ts': "export { getRecommendations } from './calculations/other.js';",
    }))).toThrow(/resolves to shared\/src\/draft\/calculations\/other\.ts, not a Best Pick policy root/);
    expect(() => bestPickReplayEntryChain(read({
      'shared/src/draft/index.ts': "export * from './calculations/recommendations.js';",
    }))).toThrow(/cannot trace/);
    expect(() => bestPickReplayEntryChain(read({
      'shared/src/draft/index.ts': "import { getRecommendations } from './calculations/recommendations.js';\n" +
        'export { getRecommendations };',
    }))).toThrow(/cannot trace/);
    expect(() => bestPickReplayEntryChain(read({
      'scripts/src/backtest-recommendations.ts': "import { getRecommendations } from './local.js';",
    }))).toThrow(/only traces imports from @fantasy-draft\/shared/);
    expect(() => bestPickReplayEntryChain(read({
      'scripts/src/backtest-recommendations.ts': "import * as draft from '@fantasy-draft/shared/draft';",
    }))).toThrow(/exactly once/);
  });

  it('rejects CommonJS loads anywhere in the policy graph', () => {
    const read = fakeRead({ [POLICY]: 'export const p = 1;', [RECOMMENDATIONS]: 'export const r = 1;' });
    expect(bestPickPolicySources(read())).toEqual([POLICY, RECOMMENDATIONS]);
    for (const text of [
      "const x = require('./helper.js');",
      "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);",
      "export function f() { return module.require('./helper.js'); }",
      "const path = require.resolve('./helper.js');",
      "import helper = require('./helper.js');",
    ]) {
      expect(() => bestPickPolicySources(read({ [RECOMMENDATIONS]: text }))).toThrow(/CommonJS/);
    }
  });

  it('rejects # package imports and absolute specifiers instead of treating them as third-party', () => {
    const read = fakeRead({ [POLICY]: 'export const p = 1;', [RECOMMENDATIONS]: "import { z } from 'effect';" });
    expect(bestPickPolicySources(read())).toEqual([POLICY, RECOMMENDATIONS]);
    for (const text of [
      "import { x } from '#internal/x';",
      "export const x = import('#internal/x');",
      "export { x } from '#x';",
      "import { x } from '/abs/x.js';",
    ]) {
      expect(() => bestPickPolicySources(read({ [RECOMMENDATIONS]: text }))).toThrow(/package imports or absolute/);
    }
  });

  it('resolves export conditions in Node order and fails closed on shapes it does not model', () => {
    const files = {
      [POLICY]: "import { x } from '@fantasy-draft/shared/x';",
      [RECOMMENDATIONS]: 'export const r = 1;',
      'shared/src/x.ts': 'export const x = 1;',
    };
    const withExports = (exports: unknown) =>
      fakeRead({ ...files, 'shared/package.json': JSON.stringify({ exports }) })();
    // `types` is not a Node runtime condition, so the source condition after it still wins.
    expect(bestPickPolicySources(withExports({
      './x': { types: './dist/x.d.ts', '@fantasy-draft/source': './src/x.ts', import: './dist/x.js' },
    }))).toContain('shared/src/x.ts');
    expect(() => bestPickPolicySources(withExports({
      './x': { import: './dist/x.js', '@fantasy-draft/source': './src/x.ts' },
    }))).toThrow(/Node selects "import" first/);
    expect(() => bestPickPolicySources(withExports({
      './x': { default: './src/x.ts', '@fantasy-draft/source': './src/x.ts' },
    }))).toThrow(/Node selects "default" first/);
    expect(() => bestPickPolicySources(withExports({
      './x': { '@fantasy-draft/source': { default: './src/x.ts' } },
    }))).toThrow(/not a plain path/);
    expect(() => bestPickPolicySources(withExports({ './x': './src/x.ts' }))).toThrow(/not a condition map/);
    expect(() => bestPickPolicySources(withExports({ './*': { '@fantasy-draft/source': './src/*.ts' } })))
      .toThrow(/wildcard subpath/);
    expect(() => bestPickPolicySources(withExports({ '@fantasy-draft/source': './src/x.ts' })))
      .toThrow(/not a subpath map/);
    expect(() => bestPickPolicySources(withExports({ './x': { '@fantasy-draft/source': '../server/src/x.ts' } })))
      .toThrow(/cannot resolve within shared\/src/);
  });

  it('refuses to record a replay whose policy sources changed mid-run', () => {
    expect(() => {
      assertBestPickPolicyUnchanged('sha256:a', 'sha256:a');
    }).not.toThrow();
    expect(() => {
      assertBestPickPolicyUnchanged('sha256:a', 'sha256:b');
    }).toThrow(/changed during the replay/);
  });

  it('fails when the policy source changes without a regenerated report', () => {
    const accepted = measurement('sha256:old', 0, 0);
    expect(bestPickGateFailures({ candidate: accepted, baseline: accepted }, 'sha256:new')).toEqual([
      expect.stringContaining('pnpm model:backtest'),
    ]);
  });

  it('fails when either block is missing', () => {
    const accepted = measurement('sha256:a', 0, 0);
    expect(bestPickGateFailures({ candidate: undefined, baseline: accepted }, 'sha256:a'))
      .toEqual([expect.stringContaining('no Best Pick gate block')]);
    expect(bestPickGateFailures({ candidate: accepted, baseline: undefined }, 'sha256:a'))
      .toEqual([expect.stringContaining('no accepted Best Pick baseline')]);
  });

  it('compares a changed policy with the accepted baseline, beyond the declared tolerance', () => {
    const baseline = measurement('sha256:a', -100, 2);
    expect(bestPickGateFailures({ candidate: measurement('sha256:b', -120, 2.5), baseline }, 'sha256:b'))
      .toEqual([]);
    expect(bestPickGateFailures({ candidate: measurement('sha256:b', -130, 3.5), baseline }, 'sha256:b'))
      .toEqual([expect.stringContaining('VOR margin'), expect.stringContaining('regret margin')]);
  });

  it('never promotes a failing candidate to baseline on regeneration, even after a source change', () => {
    const accepted = measurement('sha256:a', -100, 2);
    let blocks = nextBestPickGate({ candidate: accepted, baseline: accepted }, measurement('sha256:b', -200, 4), [], false);
    expect(bestPickGateFailures(blocks, 'sha256:b')).toHaveLength(2);
    // A comment-only change re-hashes the policy; the identical failing margins must still fail.
    blocks = nextBestPickGate(blocks, measurement('sha256:c', -200, 4), [], false);
    expect(blocks.baseline).toBe(accepted);
    expect(bestPickGateFailures(blocks, 'sha256:c')).toHaveLength(2);
  });

  it('does not let a report without a baseline make the candidate its own baseline', () => {
    const blocks = nextBestPickGate({ candidate: undefined, baseline: undefined }, measurement('sha256:a', 0, 0), [], false);
    expect(blocks.baseline).toBeUndefined();
    expect(bestPickGateFailures(blocks, 'sha256:a')).toEqual([expect.stringContaining('no accepted Best Pick baseline')]);
  });

  it('moves the baseline only through an explicit accept of a complete replay', () => {
    const replay = measurement('sha256:b', -200, 4);
    const accepted = nextBestPickGate({ candidate: undefined, baseline: undefined }, replay, [], true);
    expect(accepted).toMatchObject({ candidate: replay, baseline: replay, recorded: true });
    expect(() => nextBestPickGate(accepted, replay, ['partial'], true)).toThrow(/partial/);
  });

  it('keeps a partial or non-comparable replay out of the gate record', () => {
    const accepted = measurement('sha256:a', -100, 2);
    const previous = { candidate: accepted, baseline: accepted };
    const partial = bestPickReplayProblems(COMPLETE.slice(1));
    expect(partial).toEqual([expect.stringContaining('2023, 2024, 2025')]);
    const partialGate = nextBestPickGate(previous, measurement('sha256:b', 0, 0), partial, false);
    expect(partialGate).toMatchObject({ candidate: accepted, baseline: accepted, recorded: false });
    // The previous blocks still pass, so the run must fail itself rather than write a report beside them.
    expect(bestPickGateFailures(partialGate, 'sha256:a')).toEqual([]);
    expect(() => { assertBestPickGateRecorded(partialGate); }).toThrow(/no report was written/);
    const complete = nextBestPickGate(previous, measurement('sha256:a', -100, 2), [], false);
    expect(() => { assertBestPickGateRecorded(complete); }).not.toThrow();

    // Equal counts are not enough: Best Pick and ECR skipped different turns.
    const skippedOther = [...PICKS.slice(0, 11), 150];
    expect(bestPickReplayProblems([
      ...COMPLETE.slice(0, 3),
      { season: 2025, bestPickPicks: PICKS, ecrPicks: skippedOther },
    ])).toEqual([expect.stringContaining('in 2025 against')]);

    const otherPicks = FOLDS.map((fold) => ({ ...fold, pickNumbers: skippedOther }));
    expect(nextBestPickGate(previous, measurement('sha256:b', 0, 0, otherPicks), [], false))
      .toMatchObject({ candidate: accepted, recorded: false });
    expect(bestPickGateFailures({ candidate: measurement('sha256:a', -100, 2, otherPicks), baseline: accepted }, 'sha256:a'))
      .toEqual([expect.stringContaining('different draft picks per fold')]);
  });

  it('round-trips both blocks through the report', () => {
    const blocks = { candidate: measurement('sha256:b', -90, 1), baseline: measurement('sha256:a', -100, 2) };
    expect(parseBestPickGateBlocks(`# Report\n\n${renderBestPickGateBlocks(blocks)}\n`)).toEqual(blocks);
  });
});
