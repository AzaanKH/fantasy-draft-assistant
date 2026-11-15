import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { MOTION_EASE_CSS, MOTION_MS } from './motion';

/** Every UI transition is at most 200ms; the one exception is the 600ms turn pulse (useTurnStartPulse.ts). */
const LIMIT_MS = 200;
const here = path.dirname(fileURLToPath(import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? cssFiles(file) : name.endsWith('.css') ? [file] : [];
  });
}

it('keeps the shared motion durations within 200ms', () => {
  expect(Object.entries(MOTION_MS).filter(([, ms]) => ms > LIMIT_MS)).toEqual([]);
});

it('uses no transition or animation longer than 200ms in any stylesheet', () => {
  const long = cssFiles(path.resolve(here, '..')).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)]
    .map((match) => ({ file: path.basename(file), ms: Number(match[1]) * (match[2] === 's' ? 1000 : 1), text: match[0] }))
    .filter((entry) => entry.ms > LIMIT_MS))
    .map((entry) => `${entry.file}: ${entry.text}`);
  expect(long).toEqual([]);
});

it('mirrors the generated motion tokens', () => {
  const tokens = readFileSync(path.resolve(here, '../design-tokens.css'), 'utf8');
  const token = (name: string): string | undefined =>
    new RegExp(`--motion-${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim();
  for (const [name, ms] of Object.entries(MOTION_MS)) {
    expect(token(`duration-${name}`)).toBe(`${String(ms)}ms`);
  }
  expect(token('ease-out')).toBe(MOTION_EASE_CSS);
});
