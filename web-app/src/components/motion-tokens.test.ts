import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { MOTION_EASE_CSS, MOTION_MS } from './motion';

it('mirrors the generated motion tokens', async () => {
  const tokens = await readFile(new URL('../design-tokens.css', import.meta.url), 'utf8');
  const token = (name: string): string | undefined =>
    new RegExp(`--motion-${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim();
  for (const [name, ms] of Object.entries(MOTION_MS)) {
    expect(token(`duration-${name}`)).toBe(`${String(ms)}ms`);
  }
  expect(token('ease-out')).toBe(MOTION_EASE_CSS);
});
