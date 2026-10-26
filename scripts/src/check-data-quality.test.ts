import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), writeFile: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-09-10T12:00:00Z'), toFake: ['Date'] });
  vi.resetModules();
  vi.mocked(readFile).mockClear();
  vi.mocked(writeFile).mockClear();
});

it('records optional row rejection in the generated quality report and fails invalid sportsbook lines', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(readFile).mockImplementation(async path => {
    if (typeof path !== 'string') throw new Error('Expected a file path');
    if (path.endsWith('sportsbook-snapshot.json')) return JSON.stringify({
      metadata: { season: 2026, capturedAt: '2026-09-01', importedAt: '2026-09-01', sourceDirectory: 'fixture', overUnderCount: 1, milestoneCount: 0 },
      overUnder: [null], milestones: [], warnings: [],
    });
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  });
  await import('./check-data-quality.js');
  await vi.waitFor(() => { expect(writeFile).toHaveBeenCalled(); });
  const output = vi.mocked(writeFile).mock.calls[0]?.[1];
  expect(typeof output).toBe('string');
  if (typeof output !== 'string') throw new Error('Expected a JSON report');
  const report: unknown = JSON.parse(output);
  expect(report).toMatchObject({ checks: expect.arrayContaining([
    expect.objectContaining({ id: 'rows.sportsbook-snapshot.json', status: 'fail', message: 'Dropped 1 invalid sportsbook over/under rows.' }),
    expect.objectContaining({ id: 'sportsbook.lines.valid', status: 'fail' }),
  ]) });
});

it('keeps strict prediction checks failing when a malformed row is dropped', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(readFile).mockImplementation(async path => {
    if (typeof path !== 'string') throw new Error('Expected a file path');
    if (path.endsWith('predictions.json')) return JSON.stringify({
      generatedAt: '2026-09-01', modelVersion: 'fixture', players: [
        { name: 'Player', position: 'QB', team: 'BUF', source: 'model', projectedPoints: null },
      ],
    });
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  });
  await import('./check-data-quality.js');
  await vi.waitFor(() => { expect(writeFile).toHaveBeenCalled(); });
  const output = vi.mocked(writeFile).mock.calls[0]?.[1];
  if (typeof output !== 'string') throw new Error('Expected a JSON report');
  const report: unknown = JSON.parse(output);
  expect(report).toMatchObject({ checks: expect.arrayContaining([
    expect.objectContaining({ id: 'rows.predictions.json', status: 'fail' }),
    expect.objectContaining({ id: 'predictions.finite', status: 'fail' }),
    expect.objectContaining({ id: 'predictions.common-output-contract', status: 'fail' }),
  ]) });
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it.each([
  ['2027-02-28T23:59:59.999Z', 2026],
  ['2027-03-01T00:00:00.000Z', 2027],
])('labels the quality report with the NFL season at %s', async (timestamp, season) => {
  vi.useFakeTimers({ now: Date.parse(timestamp), toFake: ['Date'] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  try {
    await import('./check-data-quality.js');
    await vi.waitFor(() => { expect(writeFile).toHaveBeenCalled(); });
    const output = vi.mocked(writeFile).mock.calls[0]?.[1];
    if (typeof output !== 'string') throw new Error('Expected a JSON report');
    expect(JSON.parse(output)).toMatchObject({ season });
  } finally { vi.useRealTimers(); }
});
