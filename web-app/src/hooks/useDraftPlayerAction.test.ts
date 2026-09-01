import { describe, expect, it } from 'vitest';
import { canDraftFromWorkspace } from './useDraftPlayerAction';

describe('canDraftFromWorkspace', () => {
  it('keeps live and setup workspaces read-only', () => {
    expect(canDraftFromWorkspace('live', true, false)).toBe(false);
    expect(canDraftFromWorkspace('setup', true, false)).toBe(false);
  });

  it('allows local pick mutation only during a manager mock turn', () => {
    expect(canDraftFromWorkspace('mock', true, false)).toBe(true);
    expect(canDraftFromWorkspace('mock', false, false)).toBe(false);
    expect(canDraftFromWorkspace('mock', true, true)).toBe(false);
  });
});
