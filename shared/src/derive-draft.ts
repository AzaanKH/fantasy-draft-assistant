import { deriveDraftCursor, type DraftProgress } from './draft-progress.js';
import { createSlotSequence, type DraftFormat } from './draft-order.js';
import type { Roster, RosterRequirements } from './draft.js';
import { POSITIONS, type Player, type Position } from './player.js';
import { filterDrafted } from './draft/calculations/player-value.js';

export interface DraftSelection {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName?: string;
  readonly position: Position;
  readonly teamIndex: number;
}

export interface DraftKeeper extends Omit<DraftSelection, 'pickNumber'> {
  readonly round: number;
}

/** Source facts, including accepted cursor commands. Legacy saved cursors enter only through a carry anchor. */
export interface DraftSource {
  readonly progress: DraftProgress;
  readonly sessionMode: 'setup' | 'live' | 'mock';
  readonly rosterRequirements: RosterRequirements;
  readonly history: readonly DraftSelection[];
  readonly keepers: readonly DraftKeeper[];
  readonly myTeamIndex: number;
  readonly shortlistOrder: readonly string[];
}

export interface DerivedDraft {
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly teamRosters: readonly Roster[];
  readonly myRoster: Roster;
  readonly currentPick: number;
  readonly shortlistedPlayerIds: readonly string[];
  readonly isMyTurn: boolean;
  readonly available: readonly Player[];
  readonly canDraft: boolean;
  readonly canDraftByPosition: Readonly<Record<Position, boolean>>;
  readonly canRecord: boolean;
}

type MutableRoster = { -readonly [P in keyof Roster]: string[] };

function emptyRoster(): MutableRoster {
  return { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
}

/** Complete draft view derived from accepted commands, selections and the catalog. */
export function deriveDraft(source: DraftSource, format: DraftFormat, players: readonly Player[] = []): DerivedDraft {
  const order = createSlotSequence(format);
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
    const players = teamRosters[pick.teamIndex]?.[pick.position];
    if (players && !players.includes(pick.playerId)) players.push(pick.playerId);
  }
  const currentPick = deriveDraftCursor(source.history, source.progress);
  const mine = teamRosters[source.myTeamIndex] ?? emptyRoster();
  const isMyTurn = order.nextForTeam(source.myTeamIndex, currentPick)?.pick === currentPick;
  const hasKeeperAtCurrentPick = source.keepers.some(keeper =>
    order.forTeamRound(keeper.teamIndex, keeper.round).pick === currentPick);
  const canDraft = source.sessionMode === 'mock' && isMyTurn && !hasKeeperAtCurrentPick;
  const canDraftByPosition = {
    QB: false, RB: false, WR: false, TE: false, K: false, DEF: false,
  };
  for (const position of POSITIONS) {
    canDraftByPosition[position] = canDraft && mine[position].length < source.rosterRequirements[position].max;
  }
  const draftedPlayers = [...effectiveKeepers, ...source.history].flatMap(pick =>
    pick.playerName === undefined ? [] : [{ playerName: pick.playerName, position: pick.position }]);
  return {
    available: filterDrafted([...players], draftedPlayerIds, draftedPlayers),
    canDraft,
    canDraftByPosition,
    canRecord: source.sessionMode === 'live',
    draftedPlayerIds,
    teamRosters,
    myRoster: {
      QB: [...mine.QB], RB: [...mine.RB], WR: [...mine.WR],
      TE: [...mine.TE], K: [...mine.K], DEF: [...mine.DEF],
    },
    currentPick,
    shortlistedPlayerIds: source.shortlistOrder.filter(id => !draftedPlayerIds.has(id)),
    isMyTurn,
  };
}
