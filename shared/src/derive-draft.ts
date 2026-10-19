import { createSlotSequence, type DraftFormat } from './draft-order.js';
import type { Roster } from './draft.js';
import type { Position } from './player.js';

export interface DraftSelection {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly position: Position;
  readonly teamIndex: number;
}

export interface DraftKeeper extends Omit<DraftSelection, 'pickNumber'> {
  readonly round: number;
}

/** Source facts only. In particular, neither a stored cursor nor a roster is an input. */
export interface DraftSource {
  readonly history: readonly DraftSelection[];
  readonly keepers: readonly DraftKeeper[];
  readonly myTeamIndex: number;
  readonly shortlistOrder: readonly string[];
  readonly unresolvedPicks: readonly { readonly pickNumber: number }[];
}

export interface DerivedDraft {
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly teamRosters: readonly Roster[];
  readonly myRoster: Roster;
  readonly currentPick: number;
  readonly shortlistedPlayerIds: readonly string[];
  readonly isMyTurn: boolean;
}

type MutableRoster = { -readonly [P in keyof Roster]: string[] };

function emptyRoster(): MutableRoster {
  return { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
}

/** Shadow selector for the stored draft fields. It has no production consumer yet. */
export function deriveDraft(source: DraftSource, format: DraftFormat): DerivedDraft {
  const order = createSlotSequence(format);
  const occupiedPicks = new Set(source.unresolvedPicks.map(pick => pick.pickNumber));
  const effectiveKeepers = source.keepers.flatMap(keeper => {
    const pickNumber = order.forTeamRound(keeper.teamIndex, keeper.round).pick;
    if (source.history.some(pick =>
      (pick.pickNumber === pickNumber && pick.playerId !== keeper.playerId) ||
      (pick.playerId === keeper.playerId && pick.pickNumber !== pickNumber)
    )) return [];
    return [{ ...keeper, pickNumber }];
  });
  const draftedPlayerIds = new Set<string>();
  const teamRosters = Array.from({ length: format.teams }, emptyRoster);
  for (const pick of [...effectiveKeepers, ...source.history]) {
    draftedPlayerIds.add(pick.playerId);
    occupiedPicks.add(pick.pickNumber);
    const players = teamRosters[pick.teamIndex]?.[pick.position];
    if (players && !players.includes(pick.playerId)) players.push(pick.playerId);
  }
  const currentPick = order.slots.find(slot => !occupiedPicks.has(slot.pick))?.pick ?? order.slots.length + 1;
  const mine = teamRosters[source.myTeamIndex] ?? emptyRoster();
  return {
    draftedPlayerIds,
    teamRosters,
    myRoster: {
      QB: [...mine.QB], RB: [...mine.RB], WR: [...mine.WR],
      TE: [...mine.TE], K: [...mine.K], DEF: [...mine.DEF],
    },
    currentPick,
    shortlistedPlayerIds: source.shortlistOrder.filter(id => !draftedPlayerIds.has(id)),
    isMyTurn: order.nextForTeam(source.myTeamIndex, currentPick)?.pick === currentPick,
  };
}
