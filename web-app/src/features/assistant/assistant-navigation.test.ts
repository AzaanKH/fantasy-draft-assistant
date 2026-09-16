import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSISTANT_NAVIGATION_TARGET,
  getAssistantNavigationTarget,
} from './assistant-navigation';

describe('assistant navigation target', () => {
  it('preserves a valid lens and selected player', () => {
    expect(getAssistantNavigationTarget({ lens: 'compare', selectedPlayerId: 'player-2' })).toEqual({
      lens: 'compare',
      selectedPlayerId: 'player-2',
    });
  });

  it('falls back safely for unrelated browser history state', () => {
    expect(getAssistantNavigationTarget({ lens: 'unknown', selectedPlayerId: 42 })).toEqual(
      DEFAULT_ASSISTANT_NAVIGATION_TARGET
    );
  });
});
