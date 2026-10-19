import { readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), writeFile: vi.fn(async () => {}) }));

it('records optional row rejection in the generated quality report and fails invalid sportsbook lines', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(readFile).mockImplementation(async path => {
    if (typeof path !== 'string') throw new Error('Expected a file path');
    if (path.endsWith('sportsbook-snapshot.json')) return JSON.stringify({
      metadata: { season: new Date().getFullYear(), capturedAt: '2026-09-01', importedAt: '2026-09-01', sourceDirectory: 'fixture', overUnderCount: 1, milestoneCount: 0 },
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
