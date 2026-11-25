import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BEST_PICK_POLICY_SOURCES,
  bestPickGateFailures,
  bestPickReplayProblems,
  hashBestPickPolicySources,
  nextBestPickGate,
  parseBestPickGateBlocks,
  renderBestPickGateBlocks,
  type BestPickFoldCoverage,
  type BestPickGateMeasurement,
} from './best-pick-backtest-gate.js';

const FOLDS: readonly BestPickFoldCoverage[] = [2022, 2023, 2024, 2025]
  .map((season) => ({ season, evaluatedPicks: 12 }));
const COMPLETE = FOLDS.map(({ season }) => ({ season, bestPickPicks: 12, ecrPicks: 12 }));

const measurement = (
  policySourceHash: string,
  vorCaptured: number,
  averageRegret: number,
  folds: readonly BestPickFoldCoverage[] = FOLDS
): BestPickGateMeasurement => ({
  version: 2,
  policySourceHash,
  folds,
  bestPickVsEcr: { starterPoints: 0, vorCaptured, averageRegret, top24PositionHitRate: 0 },
});

describe('Best Pick backtest gate', () => {
  it('passes the committed report for the current policy source', () => {
    const report = readFileSync(new URL('../../docs/recommendation-backtest.md', import.meta.url), 'utf8');
    expect(bestPickGateFailures(parseBestPickGateBlocks(report), hashBestPickPolicySources())).toEqual([]);
  });

  it('hashes the recommendation entry point and its selection modules, not only the policy', () => {
    expect(BEST_PICK_POLICY_SOURCES).toEqual(expect.arrayContaining([
      'shared/src/draft/calculations/best-pick-policy.ts',
      'shared/src/draft/calculations/recommendations.ts',
      'shared/src/draft/calculations/tiers.ts',
    ]));
    const base = hashBestPickPolicySources((path) => path);
    const edited = hashBestPickPolicySources((path) =>
      path.endsWith('recommendations.ts') ? `${path}// edit` : path
    );
    expect(edited).not.toBe(base);
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
    expect(nextBestPickGate(previous, measurement('sha256:b', 0, 0), partial, false))
      .toMatchObject({ candidate: accepted, baseline: accepted, recorded: false });

    expect(bestPickReplayProblems([...COMPLETE.slice(0, 3), { season: 2025, bestPickPicks: 11, ecrPicks: 12 }]))
      .toEqual([expect.stringContaining('11 picks in 2025')]);

    const fewerPicks = FOLDS.map((fold) => ({ ...fold, evaluatedPicks: fold.evaluatedPicks - 1 }));
    expect(nextBestPickGate(previous, measurement('sha256:b', 0, 0, fewerPicks), [], false))
      .toMatchObject({ candidate: accepted, recorded: false });
    expect(bestPickGateFailures({ candidate: measurement('sha256:a', -100, 2, fewerPicks), baseline: accepted }, 'sha256:a'))
      .toEqual([expect.stringContaining('different picks per fold')]);
  });

  it('round-trips both blocks through the report', () => {
    const blocks = { candidate: measurement('sha256:b', -90, 1), baseline: measurement('sha256:a', -100, 2) };
    expect(parseBestPickGateBlocks(`# Report\n\n${renderBestPickGateBlocks(blocks)}\n`)).toEqual(blocks);
  });
});
