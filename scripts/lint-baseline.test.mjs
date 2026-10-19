import { describe, expect, it } from 'vitest';
import { compareBaseline } from './lint-baseline.mjs';

const file = 'cli/src/client.ts';
const rule = 'agent/no-bare-fetch';
const baseline = { [file]: { reason: 'Move the current HTTP call to the unit 8 runner.', counts: { [rule]: 1 } } };

describe('lint baseline counts', () => {
  it('accepts existing counts and rejects growth in the same file', () => {
    expect(compareBaseline({ [file]: { [rule]: 1 } }, baseline, ['cli'])).toEqual([]);
    expect(compareBaseline({ [file]: { [rule]: 2 } }, baseline, ['cli'])).toEqual([expect.stringContaining('rose from 1 to 2')]);
  });
  it('requires baseline reductions when a violation or file disappears', () => {
    expect(compareBaseline({}, baseline, ['cli'])).toEqual([expect.stringContaining('baseline is stale')]);
  });
  it('rejects new files and new rule kinds even when another count falls', () => {
    const actual = { [file]: { 'agent/no-json-cast': 1 }, 'cli/src/new.ts': { [rule]: 1 } };
    expect(compareBaseline(actual, baseline, ['cli'])).toHaveLength(3);
  });
  it('checks only the requested workspace and requires a reason', () => {
    expect(compareBaseline({}, baseline, ['shared'])).toEqual([]);
    expect(compareBaseline({ [file]: { [rule]: 1 } }, { [file]: { ...baseline[file], reason: '' } }, ['cli']))
      .toEqual([expect.stringContaining('document a reason')]);
  });
});
