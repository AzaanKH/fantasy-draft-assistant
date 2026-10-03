import { describe, expect, it } from 'vitest';
import { combineMetrics, measureSource } from './effect-adoption-metrics.js';

describe('effect adoption metrics', () => {
  it('counts Effect constructs and hand-written control flow in code only', () => {
    const metrics = measureSource([
      "import { Effect } from 'effect';",
      '// try { throw new Error() } is documentation, not code',
      'const load = Effect.fn("load")(function* () { return yield* Effect.gen(function* () {}); });',
      'const url = "http://127.0.0.1"; try { await fetch(url, { signal: AbortSignal.timeout(5) }); } catch { }',
      'setTimeout(() => { throw new Error("late"); }, 10);',
    ].join('\n'));
    expect(metrics.filesUsingEffect).toBe(1);
    expect(metrics.lines).toBe(4);
    expect(metrics.adoption).toMatchObject({ effectFunctions: 1, effectGenerators: 1, runners: 0 });
    expect(metrics.plumbing).toMatchObject({ tryBlocks: 1, thrownErrors: 1, abortSignalPlumbing: 1, manualTimers: 1, swallowedErrors: 1 });
  });

  it('sums metrics across files', () => {
    const combined = combineMetrics([measureSource('try { x() } catch { }'), measureSource("import { Stream } from 'effect'; Stream.make(1)")]);
    expect(combined).toMatchObject({ files: 2, filesUsingEffect: 1, adoption: { streams: 1 }, plumbing: { tryBlocks: 1, swallowedErrors: 1 } });
  });
});
