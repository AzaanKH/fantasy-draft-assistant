import type {
  ECRPlayer,
  FantasyProsNewsItem,
  FantasyProsProjection,
  FantasyProsSnapshot,
  NFLTeam,
  NewsStatus,
  Position,
} from '@fantasy-draft/shared';
import { NFL_TEAMS, POSITIONS } from '@fantasy-draft/shared';

const FANTASYPROS_API_BASE_URL = 'https://api.fantasypros.com/public/v2/json';
const FANTASYPROS_SPORT_PATH = 'nfl';
const FANTASYPROS_SPORT_NAME = 'NFL';

export interface FantasyProsApiOptions {
  readonly apiKey: string;
  readonly season: number;
  readonly scoring?: 'STD' | 'PPR' | 'HALF';
}

interface FantasyProsPlayersResponse {
  readonly players?: readonly FantasyProsPlayerRecord[];
}

interface FantasyProsConsensusResponse {
  readonly source?: string;
  readonly last_updated?: string;
  readonly players?: readonly FantasyProsConsensusPlayer[];
}

interface FantasyProsProjectionResponse {
  readonly players?: readonly FantasyProsProjectionPlayer[];
}

interface FantasyProsNewsResponse {
  readonly items?: readonly FantasyProsNewsRecord[];
  readonly news?: readonly FantasyProsNewsRecord[];
}

interface FantasyProsPlayerRecord {
  readonly player_id?: number | string;
  readonly player_name?: string;
  readonly position_id?: string;
  readonly player_positions?: string;
  readonly team_id?: string;
}

interface FantasyProsConsensusPlayer {
  readonly player_id?: number | string;
  readonly player_name?: string;
  readonly player_team_id?: string;
  readonly player_position_id?: string;
  readonly player_bye_week?: string | number;
  readonly rank_ecr?: string | number;
  readonly rank_min?: string | number;
  readonly rank_max?: string | number;
  readonly rank_ave?: string | number;
  readonly pos_rank?: string;
}

interface FantasyProsProjectionPlayer {
  readonly fpid?: number | string;
  readonly name?: string;
  readonly position_id?: string;
  readonly team_id?: string;
  readonly stats?: {
    readonly points?: number;
    readonly points_ppr?: number;
    readonly points_half?: number;
  };
}

interface FantasyProsNewsRecord {
  readonly player_id?: number | string;
  readonly player_name?: string;
  readonly title?: string;
  readonly category?: string;
  readonly status?: string;
  readonly date?: string;
  readonly updated?: string;
  readonly published?: string;
}

interface FantasyProsPlayerIndexEntry {
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
}

function parseNumber(value: string | number | undefined, fallback: number = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeFantasyProsTeam(teamId: string | undefined): NFLTeam | null {
  if (!teamId) return null;

  const upper = teamId.toUpperCase();
  const normalized = upper === 'JAC' ? 'JAX' : upper;

  return NFL_TEAMS.includes(normalized as NFLTeam)
    ? (normalized as NFLTeam)
    : null;
}

function normalizeFantasyProsPosition(positionId: string | undefined): Position | null {
  if (!positionId) return null;

  const upper = positionId.toUpperCase();
  const normalized = upper === 'DST' ? 'DEF' : upper;

  return POSITIONS.includes(normalized as Position)
    ? (normalized as Position)
    : null;
}

function parsePositionalRank(posRank: string | undefined, fallbackRank: number): number {
  if (!posRank) return fallbackRank;

  const match = posRank.match(/\d+/);
  if (!match) return fallbackRank;

  return parseInt(match[0], 10);
}

function deriveNewsStatus(record: FantasyProsNewsRecord): NewsStatus {
  const normalized = [
    record.status,
    record.category,
    record.title,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    normalized.includes('out') ||
    normalized.includes('inactive') ||
    normalized.includes('injured reserve')
  ) {
    return 'out';
  }
  if (normalized.includes('questionable') || normalized.includes('doubtful')) {
    return 'questionable';
  }
  if (normalized.includes('limited')) {
    return 'limited';
  }
  if (normalized.includes('healthy') || normalized.includes('active')) {
    return 'healthy';
  }

  return 'unknown';
}

async function fetchFantasyProsJson<T>(
  path: string,
  apiKey: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(`${FANTASYPROS_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      'x-api-key': apiKey,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `FantasyPros API request failed (${response.status}) for ${url.pathname}: ${body.slice(0, 200)}`
    );
  }

  return response.json() as Promise<T>;
}

async function fetchFantasyProsPlayerIndex(
  apiKey: string
): Promise<Map<string, FantasyProsPlayerIndexEntry>> {
  const payload = await fetchFantasyProsJson<FantasyProsPlayersResponse>(
    `/${FANTASYPROS_SPORT_PATH}/players`,
    apiKey
  );

  const index = new Map<string, FantasyProsPlayerIndexEntry>();
  for (const player of payload.players ?? []) {
    const key = String(player.player_id ?? '');
    const position = normalizeFantasyProsPosition(player.position_id ?? player.player_positions);
    const team = normalizeFantasyProsTeam(player.team_id);
    if (!key || !player.player_name || !position || !team) {
      continue;
    }

    index.set(key, {
      name: player.player_name,
      position,
      team,
    });
  }

  return index;
}

function buildRankings(players: readonly FantasyProsConsensusPlayer[]): ECRPlayer[] {
  return players.flatMap((player) => {
    const team = normalizeFantasyProsTeam(player.player_team_id);
    const position = normalizeFantasyProsPosition(player.player_position_id);

    if (!team || !position || !player.player_name) {
      return [];
    }

    const rank = parseNumber(player.rank_ecr);

    return [{
      rank,
      name: player.player_name,
      position,
      team,
      byeWeek: parseNumber(player.player_bye_week),
      positionalRank: parsePositionalRank(player.pos_rank, rank),
      bestRank: parseNumber(player.rank_min, rank),
      worstRank: parseNumber(player.rank_max, rank),
      avgRank: parseNumber(player.rank_ave, rank),
    }];
  });
}

function buildProjections(
  players: readonly FantasyProsProjectionPlayer[],
  scoring: 'STD' | 'PPR' | 'HALF'
): FantasyProsProjection[] {
  return players.flatMap((player) => {
    const team = normalizeFantasyProsTeam(player.team_id);
    const position = normalizeFantasyProsPosition(player.position_id);
    if (!team || !position || !player.name) {
      return [];
    }

    const points = scoring === 'PPR'
      ? player.stats?.points_ppr
      : scoring === 'HALF'
        ? player.stats?.points_half
        : player.stats?.points;

    return typeof points === 'number'
      ? [{
          name: player.name,
          position,
          team,
          projectedPoints: points,
        }]
      : [];
  });
}

function buildNews(
  payload: FantasyProsNewsResponse,
  playerIndex: ReadonlyMap<string, FantasyProsPlayerIndexEntry>
): FantasyProsNewsItem[] {
  const records = payload.items ?? payload.news ?? [];

  return records.flatMap((record) => {
    const indexedPlayer = playerIndex.get(String(record.player_id ?? ''));
    const team = indexedPlayer?.team;
    const position = indexedPlayer?.position;
    const name = record.player_name ?? indexedPlayer?.name;

    if (!team || !position || !name) {
      return [];
    }

    return [{
      name,
      position,
      team,
      status: deriveNewsStatus(record),
      headline: record.title ?? 'FantasyPros news item',
      updatedAt: record.updated ?? record.date ?? record.published ?? new Date().toISOString(),
    }];
  });
}

export async function fetchFantasyProsSnapshot(
  options: FantasyProsApiOptions
): Promise<FantasyProsSnapshot> {
  const scoring = options.scoring ?? 'PPR';
  const [playerIndex, rankingsResponse, newsResponse] = await Promise.all([
    fetchFantasyProsPlayerIndex(options.apiKey),
    fetchFantasyProsJson<FantasyProsConsensusResponse>(
      `/${FANTASYPROS_SPORT_PATH}/${options.season}/consensus-rankings`,
      options.apiKey,
      {
        position: 'ALL',
        scoring,
        week: 0,
      }
    ),
    fetchFantasyProsJson<FantasyProsNewsResponse>(
      `/${FANTASYPROS_SPORT_PATH}/news`,
      options.apiKey,
      { limit: 100 }
    ),
  ]);

  let projectionsResponse: FantasyProsProjectionResponse = {};
  try {
    projectionsResponse = await fetchFantasyProsJson<FantasyProsProjectionResponse>(
      `/${FANTASYPROS_SPORT_PATH}/${options.season}/projections`,
      options.apiKey,
      {
        week: 0,
        positions: 'QB:RB:WR:TE:K:DST',
        scoring,
      }
    );
  } catch (error) {
    console.warn('FantasyPros projections endpoint unavailable; continuing without projections.');
    console.warn(error);
  }

  const rankings = buildRankings(rankingsResponse.players ?? []);
  const projections = buildProjections(projectionsResponse.players ?? [], scoring);
  const news = buildNews(newsResponse, playerIndex);
  const refreshedAt = new Date().toISOString();

  return {
    metadata: {
      season: options.season,
      sourceType: 'api',
      source: rankingsResponse.source ?? `${FANTASYPROS_API_BASE_URL}/${FANTASYPROS_SPORT_NAME}`,
      refreshedAt,
      rankingCount: rankings.length,
      projectionCount: projections.length,
      newsCount: news.length,
    },
    rankings,
    projections,
    news,
  };
}

export const fantasyProsApiInternals = {
  normalizeFantasyProsPosition,
  normalizeFantasyProsTeam,
  parsePositionalRank,
  deriveNewsStatus,
  buildRankings,
  buildProjections,
  buildNews,
};
