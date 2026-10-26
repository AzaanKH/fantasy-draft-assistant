import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFileCount, checkPrSize } from './check-pr-size.mjs';

const temporaryRoots = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'draft-pr-size-'));
  temporaryRoots.push(root);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Gate fixture', '-c', `user.email=${['fixture', 'example.invalid'].join('@')}`, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('commit', '--allow-empty', '-qm', 'base');
  return { root, git };
}

describe('PR diff size', () => {
  it('accepts 99 files and rejects 100 against the explicit stack base', async () => {
    const { root, git } = await repository();
    const base = git('rev-parse', 'HEAD');
    for (let index = 0; index < 99; index++) await writeFile(path.join(root, `file ${index}\n.ts`), `export const value = ${index};`);
    git('add', '.'); git('commit', '-qm', '99 files');
    const head99 = git('rev-parse', 'HEAD');
    expect(await checkPrSize(['--base', base, '--head', head99], { root })).toBe(0);
    await writeFile(path.join(root, 'file100.ts'), 'export const value = 100;');
    git('add', '.'); git('commit', '-qm', '100 files');
    const head100 = git('rev-parse', 'HEAD');
    await expect(checkPrSize(['--base', base, '--head', head100], { root })).rejects.toThrow('100 files');
    expect(changedFileCount({ root, base: head99, head: head100 })).toBe(1);
    const event = path.join(root, 'event.json');
    await writeFile(event, JSON.stringify({ pull_request: { base: { sha: head99 }, head: { sha: head100 } } }));
    expect(await checkPrSize([], { root, env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event } })).toBe(0);
    await writeFile(event, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head100 } } }));
    await expect(checkPrSize([], { root, env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event } })).rejects.toThrow('100 files');
  });
  it('counts a rename with an odd filename exactly once and requires the commit graph', async () => {
    const { root, git } = await repository();
    await writeFile(path.join(root, 'old name\n.ts'), 'export const value = 1;');
    git('add', '.'); git('commit', '-qm', 'file');
    const base = git('rev-parse', 'HEAD');
    git('mv', 'old name\n.ts', 'new\tname.ts'); git('commit', '-qm', 'rename');
    const head = git('rev-parse', 'HEAD');
    expect(changedFileCount({ root, base, head })).toBe(1);
    expect(() => changedFileCount({ root, base: 'absent-commit', head })).toThrow('Fetch both commits');
    await expect(checkPrSize(['--base', base], { root })).rejects.toThrow('Supply --base');
  });
  it('does not claim a local check passed when no diff was supplied', async () => {
    expect(await checkPrSize([], { env: {} })).toBe(0);
  });
});
