import { describe, expect, it } from 'vitest';
import type { Player, Recommendation } from '@fantasy-draft/shared';
import {
  DEFAULT_ASSISTANT_NAVIGATION_TARGET,
  getAssistantNavigationTarget,
  resolveViewedPlayer,
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

describe('resolveViewedPlayer', () => {
  const recommendation = (playerId: string, playerName: string): Recommendation => ({
    playerId, playerName, position: 'WR', reason: 'Best available', score: 10,
  });
  const player = (id: string, name: string): Player => ({ id, name, position: 'WR' }) as Player;
  const leader = recommendation('wr-1', 'Receiver 1');
  // Recommendation lists stop at 60 per position; WR #100 is in the tier pool but has no recommendation.
  const recommendationById = new Map([[leader.playerId, leader]]);
  const playerById = new Map([['wr-1', player('wr-1', 'Receiver 1')], ['wr-100', player('wr-100', 'Receiver 100')]]);

  it('keeps the identity of a selected player outside the recommendation limit', () => {
    expect(resolveViewedPlayer({ selectedPlayerId: 'wr-100', recommendationById, playerById, draftedPlayerIds: new Set(), leader })).toEqual({
      kind: 'unavailable', playerId: 'wr-100', playerName: 'Receiver 100', position: 'WR', reason: 'unranked',
    });
  });

  it('says a selected player was drafted rather than unranked', () => {
    const viewed = resolveViewedPlayer({ selectedPlayerId: 'wr-100', recommendationById, playerById, draftedPlayerIds: new Set(['wr-100']), leader });
    expect(viewed).toMatchObject({ kind: 'unavailable', reason: 'drafted' });
  });

  it('shows the leader when nothing is selected or the selection is unknown', () => {
    for (const selectedPlayerId of [null, 'not-a-player']) {
      expect(resolveViewedPlayer({ selectedPlayerId, recommendationById, playerById, draftedPlayerIds: new Set(), leader }))
        .toEqual({ kind: 'recommendation', recommendation: leader });
    }
    expect(resolveViewedPlayer({ selectedPlayerId: null, recommendationById, playerById, draftedPlayerIds: new Set(), leader: null }))
      .toEqual({ kind: 'none' });
  });
});
