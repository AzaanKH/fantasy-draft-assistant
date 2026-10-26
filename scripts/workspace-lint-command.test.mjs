import { describe, expect, it } from 'vitest';
import { validWorkspaceLint } from './check-workspace-gates.mjs';

describe('workspace lint execution contract', () => {
  it.each(['node ../scripts/lint.mjs scripts', 'pnpm node ../scripts/lint.mjs scripts', 'pnpm exec node ../scripts/lint.mjs scripts'])('accepts %s', command => {
    expect(validWorkspaceLint(command, 'scripts')).toBe(true);
  });
  it.each(['echo ok', 'echo scripts/lint.mjs', 'echo node ../scripts/lint.mjs scripts',
    'node ../scripts/lint.mjs web-app', 'node ../scripts/lint.mjs', 'node other.mjs scripts',
    'false || node ../scripts/lint.mjs scripts', 'node ../scripts/lint.mjs scripts; echo ok', 'pnpm exec echo ../scripts/lint.mjs scripts'])('rejects %s', command => {
    expect(validWorkspaceLint(command, 'scripts')).toBe(false);
  });
});
