import type { DraftPickEvent, DraftType, Player, Position } from '@fantasy-draft/shared';
import { getKeeperPickNumber, type KeeperSupplyEntry } from './keeper-supply';

export interface DraftPickImportRejection {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly nflTeam: string | null;
}

export interface ImportedDraftPick {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly teamIndex: number;
  readonly teamName: string;
  readonly isMyPick: boolean;
}

export interface DraftPickImportResult {
  readonly picks: readonly ImportedDraftPick[];
  readonly rejectedPicks: readonly DraftPickImportRejection[];
}

const DRAFT_TEAM_ALIASES: Readonly<Record<string, string>> = {
  JAC: 'JAX',
  OAK: 'LV',
  SD: 'LAC',
  STL: 'LAR',
  WSH: 'WAS',
};

function getNormalizedPlayerName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\.?$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

function getNameTeamKey(name: string, team: string): string {
  const normalizedTeam = team.trim().toUpperCase();
  const canonicalTeam = DRAFT_TEAM_ALIASES[normalizedTeam] ?? normalizedTeam;
  const normalizedName = getNormalizedPlayerName(name);
  return `${normalizedName}|${canonicalTeam}`;
}

function usesCanonicalPlayerIds(pick: DraftPickEvent): boolean {
  // The app's canonical player IDs come from Sleeper. ESPN and Yahoo IDs can
  // be numeric too, but they belong to different namespaces and can collide
  // with an unrelated Sleeper player.
  return pick.source === 'sleeper-api' || pick.source === 'manual';
}

/**
 * Sleeper includes reserved keeper selections in its picks response before the
 * draft reaches them. The active selection is therefore the first unfilled
 * slot, not one after the largest pick number in the payload.
 */
export function getNextOpenPickNumber(
  picks: readonly Pick<DraftPickEvent, 'pickNumber'>[],
  totalPicks: number
): number {
  const filledPickNumbers = new Set(
    picks
      .map((pick) => pick.pickNumber)
      .filter((pickNumber) =>
        Number.isInteger(pickNumber) &&
        pickNumber >= 1 &&
        pickNumber <= totalPicks
      )
  );

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber += 1) {
    if (!filledPickNumbers.has(pickNumber)) {
      return pickNumber;
    }
  }

  return totalPicks + 1;
}

/**
 * Resolves nullable provider positions from local player identity data. Picks
 * that still lack a position are deliberately omitted from the store.
 */
export function resolveDraftPickImports(
  picks: readonly DraftPickEvent[],
  players: readonly Player[],
  myPickPosition: number,
  preloadedKeepers: readonly KeeperSupplyEntry[] = [],
  totalTeams: number = 0,
  draftType: DraftType = 'snake'
): DraftPickImportResult {
  const playersById = new Map<string, Player>();
  const playersByNameTeam = new Map<string, Player>();
  const playersByUniqueName = new Map<string, Player>();
  const ambiguousNames = new Set<string>();
  const importedPicks: ImportedDraftPick[] = [];
  const rejectedPicks: DraftPickImportRejection[] = [];
  const preloadedKeeperKeys = new Set(
    totalTeams > 0
      ? preloadedKeepers.map((keeper) => `${keeper.playerId}:${String(
        getKeeperPickNumber(keeper, totalTeams, draftType)
      )}`)
      : []
  );

  for (const player of players) {
    playersById.set(player.id, player);
    playersByNameTeam.set(
      getNameTeamKey(player.name, player.team),
      player
    );
    const normalizedName = getNormalizedPlayerName(player.name);
    if (playersByUniqueName.has(normalizedName)) {
      playersByUniqueName.delete(normalizedName);
      ambiguousNames.add(normalizedName);
    } else if (!ambiguousNames.has(normalizedName)) {
      playersByUniqueName.set(normalizedName, player);
    }
  }

  for (const pick of picks) {
    const matchedByNameTeam = pick.nflTeam
      ? playersByNameTeam.get(
        getNameTeamKey(pick.playerName, pick.nflTeam)
      )
      : undefined;
    const matchedByUniqueName = playersByUniqueName.get(
      getNormalizedPlayerName(pick.playerName)
    );
    const matchedByCanonicalId = usesCanonicalPlayerIds(pick)
      ? playersById.get(pick.playerId)
      : undefined;
    const matchedPlayer =
      matchedByNameTeam ?? matchedByUniqueName ?? matchedByCanonicalId;

    if (!matchedPlayer) {
      rejectedPicks.push({
        pickNumber: pick.pickNumber,
        playerId: pick.playerId,
        playerName: pick.playerName,
        nflTeam: pick.nflTeam,
      });
      continue;
    }

    // Exact keeper matches are already reserved by useKeeperPreload. A provider
    // keeper at another slot is a real conflict and must reach reconciliation.
    if (
      pick.isKeeper &&
      preloadedKeeperKeys.has(`${matchedPlayer.id}:${String(pick.pickNumber)}`)
    ) {
      continue;
    }

    const isMyPick = pick.draftSlot === myPickPosition;
    importedPicks.push({
      pickNumber: pick.pickNumber,
      playerId: matchedPlayer.id,
      playerName: matchedPlayer.name,
      position: matchedPlayer.position,
      teamIndex: pick.teamIndex,
      teamName: isMyPick ? 'My Team' : `Team ${String(pick.draftSlot)}`,
      isMyPick,
    });
  }

  return {
    picks: importedPicks,
    rejectedPicks,
  };
}
