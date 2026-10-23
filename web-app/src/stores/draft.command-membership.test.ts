import { expect, it } from 'vitest';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import { createDraftStore } from './draftStore';
import { getDraftView } from '@/workspace/useDraftView';

it.each(['mock-pick', 'provisional'] as const)('validates %s membership from the same view after a format change', (command) => {
  const store = createDraftStore();
  store.getState().setSessionMode(command === 'mock-pick' ? 'mock' : 'live');
  store.getState().preloadKeepers([{
    playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 0, round: 2, isMyKeeper: false,
  }]);
  const order = createSlotSequence({ type: 'snake', teams: 10, rounds: 14 });
  for (let pick = 1; pick <= 11; pick += 1) {
    store.getState().markPlayerDrafted(`player-${pick}`, `Player ${pick}`, 'WR', order.at(pick).teamIndex, 'Team', pick, 'cpu');
  }
  store.getState().setConfig({ draftType: 'linear' });
  expect(getDraftView(store).draftedPlayerIds.has('keeper')).toBe(false);
  expect(getDraftView(store).teamRosters[0]?.RB).toEqual([]);
  if (command === 'mock-pick') {
    store.getState().markPlayerDrafted('keeper', 'Keeper', 'RB', 1, 'Team 2', 12, 'cpu');
  } else {
    expect(store.getState().recordProvisionalPick({
      playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 1, teamName: 'Team 2', pickNumber: 12,
    })).toBe(true);
  }
  expect(store.getState().draftHistory.at(-1)).toMatchObject({ playerId: 'keeper', pickNumber: 12 });
  expect(getDraftView(store).teamRosters[1]?.RB).toEqual(['keeper']);
});
