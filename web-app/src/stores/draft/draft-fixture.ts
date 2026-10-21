import { POSITIONS } from '@fantasy-draft/shared/league';
import { createSlotSequence, type DraftSource } from '@fantasy-draft/shared/draft';
import { createDraftStore } from '../draftStore';
import { draftSource } from './source';

export const draftMockFormat = { type: 'snake', teams: 10, rounds: 14 } as const;

export function createDraftMockStore(completedPicks: number): ReturnType<typeof createDraftStore> {
  const order = createSlotSequence(draftMockFormat);
  const store = createDraftStore();
  store.getState().setConfig({ totalTeams: 10, totalRounds: 14, myPickPosition: 5 });
  store.getState().setSessionMode('mock');
  const keeperPicks = new Set([1, 70, 140]);
  store.getState().preloadKeepers([...keeperPicks].map(pick => ({
    playerId: `keeper-${pick}`, playerName: `Keeper ${pick}`, position: 'RB',
    teamIndex: order.at(pick).teamIndex, round: order.at(pick).round,
    isMyKeeper: order.at(pick).teamIndex === 4,
  })));
  for (const id of ['waiting-a', 'player-50', 'keeper-70', 'waiting-b']) {
    store.getState().togglePlayerShortlisted(id);
  }
  for (const slot of order.slots.slice(0, completedPicks)) {
    if (keeperPicks.has(slot.pick)) {
      store.getState().consumeKeeperAtCurrentPick();
    } else {
      store.getState().markPlayerDrafted(
        `player-${slot.pick}`, `Player ${slot.pick}`, POSITIONS[(slot.pick - 1) % POSITIONS.length] ?? 'WR',
        slot.teamIndex, `Team ${slot.teamIndex + 1}`, undefined, 'cpu'
      );
    }
  }
  return store;
}


export function createDraftMock(completedPicks: number): DraftSource {
  return draftSource(createDraftMockStore(completedPicks).getState());
}
