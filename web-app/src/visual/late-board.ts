/** Fixed pick 11.05 data for real board geometry, independent of demo rankings and CPU draft choices. */
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import type { Player } from '@fantasy-draft/shared/league';
import type { DraftStoreApi, RecordedDraftPick } from '@/stores/draftStore';

// Include long surnames with and without a hyphen, plus initials and a suffix. All widths exercise the same content on every run.
const NAMES = ['Jacory Croskey-Merritt', 'Alex Constantinidis', 'Marvin Harrison Jr.', 'A.J. Brown', 'Jonathan Taylor', 'Justin Jefferson'];

export function seedLateBoard(store: DraftStoreApi, templates: readonly Player[], now: number): Player[] {
  const order = createSlotSequence({ type: 'snake', teams: 12, rounds: 16 });
  const players = Array.from({ length: 124 }, (_, index): Player => {
    const template = templates[index % templates.length];
    const name = NAMES[index % NAMES.length];
    if (!template || !name) throw new Error('Late-board fixture requires player templates and names');
    return { ...template, id: `late-board-${String(index + 1)}`, name };
  });
  const draftHistory: RecordedDraftPick[] = players.map((player, index) => {
    const pickNumber = index + 1;
    const teamIndex = order.at(pickNumber).teamIndex;
    return { pickNumber, playerId: player.id, playerName: player.name, position: player.position, teamIndex,
      teamName: teamIndex === 4 ? 'My Team' : `Team ${String(teamIndex + 1)}`, timestamp: now, source: 'sync' };
  });
  store.setState({
    config: { ...store.getState().config, totalTeams: 12, totalRounds: 16, myPickPosition: 5, draftType: 'snake' },
    draftHistory,
    draftProgress: { anchor: { kind: 'carry', pickNumber: 125 }, historyLength: draftHistory.length },
    shortlistedPlayerIds: [],
    keepersInitialized: true,
  });
  return [...players, ...templates];
}
