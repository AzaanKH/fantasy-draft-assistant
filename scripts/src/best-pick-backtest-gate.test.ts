import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bestPickGateFailures,
  buildBestPickGateRecord,
  hashBestPickPolicySources,
  parseBestPickGateBlock,
  renderBestPickGateBlock,
  type BestPickMargin,
} from './best-pick-backtest-gate.js';

const margin = (vorCaptured: number, averageRegret: number): BestPickMargin => ({
  starterPoints: 0,
  vorCaptured,
  averageRegret,
  top24PositionHitRate: 0,
});

describe('Best Pick backtest gate', () => {
  it('passes the committed report for the current policy source', () => {
    const report = readFileSync(new URL('../../docs/recommendation-backtest.md', import.meta.url), 'utf8');
    const record = parseBestPickGateBlock(report);
    expect(record, 'docs/recommendation-backtest.md has no Best Pick gate block').toBeDefined();
    expect(bestPickGateFailures(record!, hashBestPickPolicySources())).toEqual([]);
  });

  it('fails when the policy source changes without a regenerated report', () => {
    const record = buildBestPickGateRecord(undefined, 'sha256:old', margin(0, 0));
    expect(bestPickGateFailures(record, 'sha256:new')).toEqual([
      expect.stringContaining('pnpm model:backtest'),
    ]);
  });

  it('compares a changed policy with the one it replaces, beyond the declared tolerance', () => {
    const previous = buildBestPickGateRecord(undefined, 'sha256:a', margin(-100, 2));
    expect(bestPickGateFailures(buildBestPickGateRecord(previous, 'sha256:b', margin(-120, 2.5)), 'sha256:b'))
      .toEqual([]);
    expect(bestPickGateFailures(buildBestPickGateRecord(previous, 'sha256:b', margin(-130, 3.5)), 'sha256:b'))
      .toEqual([expect.stringContaining('VOR margin'), expect.stringContaining('regret margin')]);
  });

  it('keeps the baseline when an unchanged policy is regenerated', () => {
    const previous = buildBestPickGateRecord(undefined, 'sha256:a', margin(-100, 2));
    const regressed = buildBestPickGateRecord(previous, 'sha256:b', margin(-200, 2));
    const rerun = buildBestPickGateRecord(regressed, 'sha256:b', margin(-200, 2));
    expect(rerun.baseline.policySourceHash).toBe('sha256:a');
    expect(bestPickGateFailures(rerun, 'sha256:b')).toHaveLength(1);
  });

  it('round-trips through the report block and ignores an edited tolerance', () => {
    const record = buildBestPickGateRecord(undefined, 'sha256:a', margin(-100, 2));
    const edited = renderBestPickGateBlock({ ...record, tolerance: { vorCaptured: 1e9, averageRegret: 1e9 } as never });
    expect(parseBestPickGateBlock(`# Report\n\n${edited}\n`)).toEqual(record);
  });
});
