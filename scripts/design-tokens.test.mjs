import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTokenFiles, renderTokenFiles, tokenSource } from './design-tokens.mjs';

const root = path.resolve(import.meta.dirname, '..');
const readRepo = (file) => readFile(path.join(root, file), 'utf8');

/** Reads the repository, with some files replaced. */
function readWith(overrides) {
  return (file) => Object.hasOwn(overrides, file) ? Promise.resolve(overrides[file]) : readRepo(file);
}

describe('design token drift check', () => {
  it('passes on the committed files', async () => {
    expect(await checkTokenFiles()).toEqual([]);
  });

  it('fails when a generated file is edited by hand', async () => {
    const web = await readRepo('web-app/src/design-tokens.css');
    const edited = web.replace('--night-accent: #03FFFA;', '--night-accent: #03FFFB;');
    expect(edited).not.toBe(web);
    expect(await checkTokenFiles(readWith({ 'web-app/src/design-tokens.css': edited }))).toEqual([
      `web-app/src/design-tokens.css does not match ${tokenSource}. Edit the token source, then run pnpm tokens:write.`,
    ]);
  });

  it('fails on every generated file when a Paper value changes without regenerating', async () => {
    const json = JSON.parse(await readRepo(tokenSource));
    json.tokens.find(({ name }) => name === '--color-position-qb').value = '#FF80AE';
    const failures = await checkTokenFiles(readWith({ [tokenSource]: JSON.stringify(json) }));
    expect(failures).toHaveLength(2);
    expect(failures.join('\n')).toContain('docs/design-system/tokens.css');
    expect(failures.join('\n')).toContain('web-app/src/design-tokens.css');
  });

  it('writes each Paper value once and resolves web references to it', async () => {
    const json = JSON.parse(await readRepo(tokenSource));
    const web = renderTokenFiles(json)['web-app/src/design-tokens.css'];
    expect(web).toContain('--night-accent: #03FFFA;');
    expect(web).toContain('--color-position-ink: #051827;');
    expect(web).toContain('--font-sans: "DM Sans", sans-serif;');
    expect(web).not.toMatch(/\{--/);
  });

  it('rejects a reference to a token that Paper does not define', async () => {
    const json = JSON.parse(await readRepo(tokenSource));
    json.web.blocks[0].groups[0].values['--motion-ease-out'] = '{--motion-ease}';
    expect(() => renderTokenFiles(json)).toThrow('--motion-ease-out refers to unknown Paper token --motion-ease');
  });
});
