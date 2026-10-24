import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTrackedLeaks, compareLeakAllowances, leakFindings } from './check-tracked-leaks.mjs';
import { maxTrackedBytes, trackedDataFailure, checkTrackedData } from './check-tracked-data.mjs';
import { trackedFiles } from './tracked-files.mjs';

const temporaryRoots = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'draft-tracked-'));
  temporaryRoots.push(root);
  execFileSync('git', ['init', '-q', root]);
  return root;
}
async function track(root, file, content) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), content);
  execFileSync('git', ['add', '--', file], { cwd: root });
}
const secret = ['ghp_', 'A'.repeat(36)].join('');
const privateId = ['11803484', '05031780353'].join('');

describe('tracked-tree leak policy', () => {
  it.each([
    ['credential', secret], ['private-key', ['-----BEGIN ', 'PRIVATE KEY-----'].join('')],
    ['credential-assignment', `api_key = '${'A'.repeat(30)}'`], ['credential-assignment', `API_KEY=${'B'.repeat(30)}`], ['private-id', privateId],
    ['named-private-id', `userId: '${'726452'}'`], ['league-name', [['league', 'Name'].join(''), JSON.stringify('Synthetic League')].join(': ')],
    ['email', ['person', '@', 'private.example'].join('')], ['phone', ['415', '555', '0198'].join('-')],
    ['street-address', ['123', 'Main', 'Street'].join(' ')], ['street-address', ['123', 'Main', 'St.'].join(' ')],
  ])('detects %s without printing its value', (detector, value) => {
    const findings = leakFindings('source.ts', value);
    expect(findings.some(finding => finding.detector === detector)).toBe(true);
    const output = compareLeakAllowances(findings, []).join('\n');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain(value);
    expect(JSON.stringify(findings)).not.toContain(value);
  });
  it.each(['SYNC_REQUEST_TOKEN', 'token', 'secret', 'syncRequestToken', 'pairingToken', 'apiKey', 'accessToken', 'clientSecret', 'dbPassword'])('rejects literal credential assignment to %s with redacted output', name => {
    const value = 'A'.repeat(43);
    const findings = leakFindings('probe.ts', `const ${name} = ${JSON.stringify(value)};`);
    expect(findings.some(finding => finding.detector === 'credential-assignment')).toBe(true);
    expect(compareLeakAllowances(findings, []).join(' ')).not.toContain(value);
    expect(leakFindings('probe.ts', `const ${name} = process.env[${JSON.stringify(name)}];`)).toEqual([]);
  });
  it.each([
    ['bearer-token', ['Bearer', 'A'.repeat(43)].join(' ')],
    ['jwt', ['eyJ' + 'A'.repeat(12), 'eyJ' + 'B'.repeat(12), 'C'.repeat(32)].join('.')],
  ])('rejects %s credentials without printing matched content', (detector, value) => {
    const findings = leakFindings('probe.ts', value);
    expect(findings.some(finding => finding.detector === detector)).toBe(true);
    expect(compareLeakAllowances(findings, []).join(' ')).not.toContain(value);
  });
  it('allows injected credentials and runtime bearer interpolation', () => {
    expect(leakFindings('probe.ts', 'const token = makeToken(); const apiKey = config.apiKey; const header = `Bearer ${token}`;')).toEqual([]);
  });
  it('accepts legitimate provider implementations and public documentation URLs', () => {
    const source = 'https://api.fantasypros.com/v2/json/nfl/2026/consensus-rankings; https://api.sleeper.app/v1/league/${leagueId}';
    expect(leakFindings('provider.ts', source)).toEqual([]);
  });
  it('allows exact reasoned occurrences and fails adjacent additions in the same file', () => {
    const existing = leakFindings('import.ts', `const id = '${privateId}';`);
    const allowances = existing.map(finding => ({ ...finding, reason: 'Historical import must retain its input identifiers in this gate-only wave.' }));
    expect(compareLeakAllowances(existing, allowances)).toEqual([]);
    expect(compareLeakAllowances(leakFindings('import.ts', `const id = '${privateId}';\nconst token = '${secret}';`), allowances)).toEqual(expect.arrayContaining([expect.stringContaining('credential finding')]));
    expect(compareLeakAllowances([], allowances)).toEqual([expect.stringContaining('allowance is stale')]);
    expect(() => compareLeakAllowances(existing, allowances.map(entry => ({ ...entry, reason: '' })))).toThrow('written reason');
    expect(compareLeakAllowances([...existing, ...existing], allowances)).toHaveLength(1);
  });
  it('runs the real command against a synthetic tracked failing fixture with an odd filename', async () => {
    const root = await repository();
    await track(root, 'tracked-leak-baseline.json', '[]\n');
    await track(root, 'safe.ts', 'const url = "https://api.fantasypros.com/v2/json/nfl";');
    expect(await checkTrackedLeaks({ root })).toBe(0);
    const file = 'nested/leak\nwith spaces.ts';
    await track(root, file, `export const value = '${secret}';`);
    let result;
    try {
      execFileSync(process.execPath, [path.resolve(import.meta.dirname, 'check-tracked-leaks.mjs'), '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { result = error; }
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('credential finding [REDACTED]');
    expect(result.stderr).toContain(JSON.stringify(file));
    expect(result.stderr).not.toContain(secret);
  });
  it('scans binary ASCII content and refuses tracked symlinks or missing files', async () => {
    expect(leakFindings('binary.bin', Buffer.from(`\0${secret}\0`)).some(finding => finding.detector === 'credential')).toBe(true);
    const root = await repository();
    const outside = path.join(root, 'outside.txt');
    await writeFile(outside, secret);
    await symlink(outside, path.join(root, 'link'));
    execFileSync('git', ['add', 'link'], { cwd: root });
    await expect(trackedFiles(root)).rejects.toThrow('tracked symlinks are not allowed');
    await rm(path.join(root, 'link'));
    await expect(trackedFiles(root)).rejects.toThrow('regular readable file');
    expect(await readFile(outside, 'utf8')).toBe(secret);
  });
});

describe('catalog-owned tracked data and bounded assets', () => {
  it.each(['data/contracts.json', 'demo-data/predictions.json', 'data/model/.gitkeep',
    'scripts/persistence/fixtures/worker-stop-without-close.json', 'docs/design-system/tokens.json',
    'web-app/package.json', 'cli/src/client.ts', 'web-app/src/lib/calculations/__snapshots__/recommendations-snake-pick-1.jsonl'])('allows classified data or exact config/fixtures: %s', file => {
    expect(trackedDataFailure(file, 100)).toBeNull();
  });
  it.each(['data/primary-league-settings.json', 'data/unknown.json', 'demo-data/unknown.json',
    'data/model/raw/private.parquet', 'exports/run.json', 'other/raw/input.txt', 'report.csv',
    'web-app/src/lib/calculations/__snapshots__/new.jsonl', 'source/model.duckdb.wal', 'other.sqlite', 'other.json', 'other/image.png', 'other/large.ts'])('rejects %s', file => {
    expect(trackedDataFailure(file, file.endsWith('large.ts') ? maxTrackedBytes + 1 : 100)).toBeTypeOf('string');
  });
  it('rejects binary content hidden behind source or unknown extensions', () => {
    expect(trackedDataFailure('source.ts', 100, true)).toContain('binary content');
    expect(trackedDataFailure('payload.dat', 100, true)).toContain('binary content');
    expect(trackedDataFailure('data/contracts.json', 100, true)).toContain('must be text');
    expect(trackedDataFailure('docs/images/assistant.png', 100, true)).toBeNull();
    expect(trackedDataFailure('web-app/src/assets/fonts/typeface-0.woff2', 100, true)).toBeNull();
    expect(trackedDataFailure('web-app/src/assets/fonts/other.woff2', 100, true)).toContain('binary content');
    expect(trackedDataFailure('web-app/src/assets/fonts/typeface-0.woff2', maxTrackedBytes + 1, true)).toContain('exceeds');
  });
  it('enforces size limits on allowed data, ordinary source, and exact public reference images', () => {
    expect(trackedDataFailure('source.ts', maxTrackedBytes)).toBeNull();
    expect(trackedDataFailure('source.ts', maxTrackedBytes + 1)).toContain('exceeds');
    expect(trackedDataFailure('data/contracts.json', maxTrackedBytes + 1)).toContain('exceeds');
    expect(trackedDataFailure('docs/images/draft-workspace.png', maxTrackedBytes * 8)).toBeNull();
    expect(trackedDataFailure('docs/images/draft-workspace.png', maxTrackedBytes * 8 + 1)).toContain('exceeds');
  });
  it('runs against real tracked files and rejects new generated output', async () => {
    const root = await repository();
    await track(root, 'data/recommendation-policy.json', '{}');
    expect(await checkTrackedData({ root })).toBe(0);
    await track(root, 'data/new-private.json', '{}');
    expect(await checkTrackedData({ root })).toBe(1);
  });
});
