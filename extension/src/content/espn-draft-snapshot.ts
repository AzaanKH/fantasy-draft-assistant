import { objectValue, readProperty } from './unknown-properties';
import { createSlotSequence, type SlotRef } from '@fantasy-draft/shared/draft';
import type {
  Position,
} from '@fantasy-draft/shared/league';
import type {
  DraftMetadata,
  DraftPickEvent,
  DraftStatus,
  DraftType,
  EspnDraftSnapshot,
} from '@fantasy-draft/shared/sync';

type EspnDraftFrameCommand =
  | 'INIT'
  | 'SELECTED'
  | 'SOLD'
  | 'UNDONE'
  | 'STATE'
  | 'PAUSED'
  | 'RESUMED';

const SNAPSHOT_COMMANDS = new Set<EspnDraftFrameCommand>([
  'INIT',
  'SELECTED',
  'SOLD',
  'UNDONE',
  'STATE',
  'PAUSED',
  'RESUMED',
]);

const POSITION_BY_ESPN_ID: Readonly<Record<number, Position>> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'DEF',
};

const POSITION_BY_LINEUP_SLOT_ID: Readonly<Record<number, Position>> = {
  0: 'QB',
  2: 'RB',
  4: 'WR',
  6: 'TE',
  16: 'DEF',
  17: 'K',
};

const NFL_TEAM_BY_ESPN_ID: Readonly<Record<number, string>> = {
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WAS',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU',
};

const NFL_TEAM_ALIASES: Readonly<Record<string, string>> = {
  JAC: 'JAX',
  OAK: 'LV',
  SD: 'LAC',
  STL: 'LAR',
  WSH: 'WAS',
};

function firstDefined(...values: readonly unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveInteger(value: unknown): number | null {
  const number = toFiniteNumber(value);
  if (number === null || number < 1) return null;
  return Math.floor(number);
}

function toNonNegativeInteger(value: unknown): number | null {
  const number = toFiniteNumber(value);
  if (number === null || number < 0) return null;
  return Math.floor(number);
}

function toSafeString(value: unknown, maximumLength = 120): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximumLength) : null;
}

function toObjectArray(value: unknown): object[] {
  if (Array.isArray(value)) {
    return value.map(objectValue).filter((entry): entry is object => entry !== null);
  }
  if (value instanceof Map) {
    return [...value.values()]
      .map(objectValue)
      .filter((entry): entry is object => entry !== null);
  }
  const record = objectValue(value);
  if (!record) return [];
  return Object.values(record)
    .map(objectValue)
    .filter((entry): entry is object => entry !== null);
}

function normalizePositionName(value: string): Position | null {
  switch (value.trim().toUpperCase()) {
    case 'QB':
      return 'QB';
    case 'RB':
    case 'FB':
      return 'RB';
    case 'WR':
      return 'WR';
    case 'TE':
      return 'TE';
    case 'K':
    case 'PK':
      return 'K';
    case 'DEF':
    case 'DST':
    case 'D/ST':
      return 'DEF';
    default:
      return null;
  }
}

function normalizePosition(value: unknown, idMap = POSITION_BY_ESPN_ID): Position | null {
  if (typeof value === 'string') {
    return normalizePositionName(value) ?? idMap[toFiniteNumber(value) ?? -1] ?? null;
  }
  const numeric = toFiniteNumber(value);
  if (numeric !== null) return idMap[numeric] ?? null;

  const record = objectValue(value);
  if (!record) return null;
  return normalizePosition(
    firstDefined(
      readProperty(record, 'abbreviation'),
      readProperty(record, 'abbrev'),
      readProperty(record, 'name'),
      readProperty(record, 'id')
    ),
    idMap
  );
}

function getPlayerPosition(player: object | null, pick: object): Position | null {
  const defaultPosition = firstDefined(
    readProperty(player, 'defaultPosition'),
    readProperty(player, 'defaultPositionId'),
    readProperty(player, 'position'),
    readProperty(player, 'positionId')
  );
  const normalized = normalizePosition(defaultPosition);
  if (normalized) return normalized;

  const rosterSlot = firstDefined(
    readProperty(pick, 'lineupSlotId'),
    readProperty(objectValue(readProperty(pick, 'rosterSlot')), 'id')
  );
  return normalizePosition(rosterSlot, POSITION_BY_LINEUP_SLOT_ID);
}

function getPlayerName(
  player: object | null,
  pick: object,
  playerId: string,
  position: Position | null
): string {
  const firstName = toSafeString(readProperty(player, 'firstName'));
  const lastName = toSafeString(readProperty(player, 'lastName'));
  const combinedName = [firstName, lastName].filter(Boolean).join(' ');
  let name =
    toSafeString(
      firstDefined(
        readProperty(pick, 'playerName'),
        readProperty(player, 'fullName'),
        readProperty(player, 'displayName'),
        readProperty(player, 'name')
      )
    ) ?? (combinedName || playerId);

  if (position === 'DEF') {
    name = name.replace(/\s+(?:D\/ST|DST|Defense)$/i, '').trim();
  }
  return name;
}

function normalizeTeamAbbreviation(value: unknown): string | null {
  const direct = toSafeString(value, 8);
  if (direct && /^[A-Za-z]{2,4}$/.test(direct)) {
    const uppercase = direct.toUpperCase();
    return NFL_TEAM_ALIASES[uppercase] ?? uppercase;
  }

  const numeric = toFiniteNumber(value);
  if (numeric !== null) return NFL_TEAM_BY_ESPN_ID[numeric] ?? null;

  const record = objectValue(value);
  if (!record) return null;
  return normalizeTeamAbbreviation(
    firstDefined(
      readProperty(record, 'abbreviation'),
      readProperty(record, 'abbrev'),
      readProperty(record, 'teamAbbrev'),
      readProperty(record, 'id')
    )
  );
}

function getPlayerTeam(player: object | null): string | null {
  return normalizeTeamAbbreviation(
    firstDefined(
      readProperty(player, 'proTeam'),
      readProperty(player, 'proTeamAbbrev'),
      readProperty(player, 'proTeamId'),
      readProperty(player, 'team'),
      readProperty(player, 'teamAbbrev')
    )
  );
}

function getDraftType(value: unknown): DraftType {
  const record = objectValue(value);
  const raw = firstDefined(readProperty(record, 'name'), readProperty(record, 'id'), value);
  const normalized =
    typeof raw === 'string' || typeof raw === 'number'
      ? String(raw).toLowerCase()
      : '';
  if (normalized === '4' || normalized.includes('auction') || normalized.includes('salary')) {
    return 'auction';
  }
  if (normalized === '2' || normalized.includes('linear')) return 'linear';
  return 'snake';
}

function getTeamId(team: object | null): number | null {
  return toPositiveInteger(
    firstDefined(readProperty(team, 'id'), readProperty(team, 'teamId'), readProperty(team, 'rosterId'))
  );
}

function getExplicitTeamSlot(team: object | null): number | null {
  return toPositiveInteger(
    firstDefined(
      readProperty(team, 'draftSlot'),
      readProperty(team, 'draftPosition'),
      readProperty(team, 'draftOrder'),
      readProperty(team, 'pickOrder'),
      readProperty(team, 'slot')
    )
  );
}

function getExplicitTeamPosition(team: object | null): number | null {
  return toNonNegativeInteger(
    firstDefined(
      readProperty(team, 'draftSlot'),
      readProperty(team, 'draftPosition'),
      readProperty(team, 'draftOrder'),
      readProperty(team, 'pickOrder'),
      readProperty(team, 'slot')
    )
  );
}

function buildTeamSlots(teams: readonly object[], teamCount: number): Map<number, number> {
  const slots = new Map<number, number>();
  const explicitPositions = teams
    .map(getExplicitTeamPosition)
    .filter((position): position is number => position !== null);
  const positionsAreZeroBased =
    explicitPositions.includes(0) &&
    explicitPositions.every((position) => position < teamCount);

  teams.forEach((team, index) => {
    const teamId = getTeamId(team);
    if (teamId === null) return;
    const explicitPosition = getExplicitTeamPosition(team);
    const explicitSlot = explicitPosition === null
      ? null
      : explicitPosition + (positionsAreZeroBased ? 1 : 0);
    slots.set(teamId, explicitSlot && explicitSlot <= teamCount ? explicitSlot : index + 1);
  });
  return slots;
}

function getStandardDraftPick(
  pickNumber: number,
  teamCount: number,
  draftType: DraftType
): SlotRef {
  const pick = Math.max(1, pickNumber);
  return createSlotSequence({ type: draftType === 'auction' ? 'linear' : draftType,
    teams: teamCount, rounds: Math.ceil(pick / teamCount) }).at(pick);
}

function getDraftStatus(
  draft: object,
  selectedPickCount: number,
  totalPickCount: number
): DraftStatus {
  if (
    readProperty(draft, 'drafted') === true ||
    (totalPickCount > 0 && selectedPickCount >= totalPickCount)
  ) {
    return 'complete';
  }

  const rawState = readProperty(draft, 'state');
  const state =
    typeof rawState === 'string' || typeof rawState === 'number'
      ? String(rawState).toLowerCase()
      : '';
  if (state.includes('pause') || readProperty(draft, 'paused') === true) return 'paused';
  if (
    state === '8' ||
    state.includes('drafting') ||
    readProperty(draft, 'inProgress') === true ||
    selectedPickCount > 0
  ) {
    return 'drafting';
  }
  return 'pre_draft';
}

function getPickTimerSeconds(draft: object): number {
  const config = objectValue(readProperty(draft, 'config'));
  const leagueSettings = objectValue(readProperty(draft, 'leagueSettings'));
  const draftSettings = objectValue(readProperty(leagueSettings, 'draftSettings'));
  const raw = toFiniteNumber(
    firstDefined(
      readProperty(config, 'pickTimer'),
      readProperty(config, 'timePerSelection'),
      readProperty(draftSettings, 'pickTimer'),
      readProperty(draftSettings, 'timePerSelection')
    )
  );
  if (raw === null || raw < 0) return 0;
  return Math.round(raw > 1_000 ? raw / 1_000 : raw);
}

export function getEspnDraftFrameCommand(value: unknown): EspnDraftFrameCommand | null {
  if (typeof value !== 'string') return null;
  const command = value.trimStart().match(/^([A-Z_]+)/)?.[1] as
    | EspnDraftFrameCommand
    | undefined;
  return command && SNAPSHOT_COMMANDS.has(command) ? command : null;
}

export function buildEspnDraftSnapshot(
  value: unknown,
  pageUrl: string,
  observedAt: number = Date.now()
): EspnDraftSnapshot | null {
  const draft = objectValue(value);
  if (!draft) return null;

  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (url.hostname !== 'fantasy.espn.com' || url.pathname !== '/football/draft') {
    return null;
  }

  const draftId = url.searchParams.get('leagueId');
  if (!draftId || !/^\d{1,20}$/.test(draftId)) return null;

  const teams = toObjectArray(readProperty(draft, 'teams'));
  const templatePicks = toObjectArray(readProperty(draft, 'picks'));
  const teamCount =
    (teams.length > 0 ? teams.length : null) ??
    toPositiveInteger(readProperty(objectValue(readProperty(draft, 'leagueSettings')), 'size')) ??
    toPositiveInteger(readProperty(draft, 'teamCount')) ??
    0;
  if (teamCount < 1) return null;

  const draftType = getDraftType(readProperty(draft, 'draftType'));
  const teamSlots = buildTeamSlots(teams, teamCount);
  const normalizedPicks: DraftPickEvent[] = [];

  templatePicks.forEach((pick, index) => {
    const player = objectValue(readProperty(pick, 'player'));
    const numericPlayerId = toPositiveInteger(
      firstDefined(readProperty(pick, 'playerId'), readProperty(player, 'id'), readProperty(player, 'playerId'))
    );
    if (numericPlayerId === null) return;

    const pickNumber =
      toPositiveInteger(
        firstDefined(
          readProperty(pick, 'overallPickNumber'),
          readProperty(pick, 'pickNumber'),
          readProperty(pick, 'id')
        )
      ) ?? index + 1;
    const winningTeam =
      objectValue(readProperty(pick, 'winningTeam')) ?? objectValue(readProperty(pick, 'originalTeam'));
    const teamId =
      toPositiveInteger(readProperty(pick, 'teamId')) ?? getTeamId(winningTeam);
    const mappedSlot = teamId === null ? null : teamSlots.get(teamId) ?? null;
    const directSlot = toPositiveInteger(
      firstDefined(readProperty(pick, 'draftSlot'), getExplicitTeamSlot(winningTeam))
    );
    const teamIdSlot = teamId !== null && teamId <= teamCount ? teamId : null;
    const standardPick = getStandardDraftPick(pickNumber, teamCount, draftType);
    const draftSlot =
      mappedSlot ??
      directSlot ??
      teamIdSlot ??
      standardPick.teamIndex + 1;
    const position = getPlayerPosition(player, pick);
    const playerId = String(numericPlayerId);
    const explicitRound = toPositiveInteger(
      firstDefined(
        readProperty(pick, 'roundId'),
        readProperty(objectValue(readProperty(pick, 'round')), 'id'),
        readProperty(pick, 'round')
      )
    );

    normalizedPicks.push({
      draftId,
      pickNumber,
      round: explicitRound ?? standardPick.round,
      rosterId: teamId,
      draftSlot,
      teamIndex: draftSlot - 1,
      playerId,
      playerName: getPlayerName(player, pick, playerId, position),
      position,
      nflTeam: getPlayerTeam(player),
      isKeeper: Boolean(readProperty(pick, 'keeper') ?? readProperty(pick, 'isKeeper')),
      source: 'espn-extension',
      confidence: 'confirmed',
      observedAt,
    });
  });

  normalizedPicks.sort((left, right) => left.pickNumber - right.pickNumber);
  const rounds = Math.max(1, Math.ceil(templatePicks.length / teamCount));
  const draftOrder = Object.fromEntries(
    [...teamSlots.entries()].map(([teamId, slot]) => [String(teamId), slot])
  );
  const metadata: DraftMetadata = {
    provider: 'espn',
    draftId,
    providerKey: `${url.searchParams.get('seasonId') ?? 'current'}:${draftId}`,
    leagueId: draftId,
    status: getDraftStatus(draft, normalizedPicks.length, templatePicks.length),
    type: draftType,
    settings: {
      teams: teamCount,
      rounds,
      pickTimer: getPickTimerSeconds(draft),
    },
    draftOrder: Object.keys(draftOrder).length > 0 ? draftOrder : null,
  };

  const currentTeamId = toPositiveInteger(readProperty(draft, 'teamId'));
  const explicitCurrentSlot = getExplicitTeamSlot(objectValue(readProperty(draft, 'localTeam')));
  const currentTeamSlot =
    (currentTeamId === null ? null : teamSlots.get(currentTeamId) ?? null) ??
    explicitCurrentSlot ??
    (currentTeamId !== null && currentTeamId <= teamCount ? currentTeamId : null);

  return {
    draft: metadata,
    picks: normalizedPicks,
    observedAt,
    ...(currentTeamSlot === null ? {} : { myDraftSlot: currentTeamSlot }),
  };
}
