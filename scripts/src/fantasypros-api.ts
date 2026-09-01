import type {
  ECRPlayer,
  FantasyProsAdpPlayer,
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
const FANTASYPROS_REQUEST_TIMEOUT_MS = 10_000;

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

interface FantasyProsInjuriesResponse {
  readonly injuries?: readonly FantasyProsInjuryRecord[];
}

interface FantasyProsPlayerRecord {
  readonly player_id?: number | string | null;
  readonly player_name?: string;
  readonly position_id?: string;
  readonly player_positions?: string;
  readonly team_id?: string;
}

interface FantasyProsConsensusPlayer {
  readonly player_id?: number | string | null;
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
  readonly fpid?: number | string | null;
  readonly name?: string;
  readonly position_id?: string;
  readonly team_id?: string;
  readonly stats?: {
    readonly points?: number;
    readonly points_ppr?: number;
    readonly points_half?: number;
    readonly rush_att?: number;
    readonly rushing_attempts?: number;
    readonly pass_yds?: number;
    readonly pass_tds?: number;
    readonly rush_yds?: number;
    readonly rush_tds?: number;
    readonly rec_rec?: number;
    readonly rec?: number;
    readonly receptions?: number;
    readonly rec_yds?: number;
    readonly rec_tds?: number;
  };
}

interface FantasyProsNewsRecord {
  readonly player_id?: number | string | null;
  readonly player_name?: string;
  readonly team_id?: string;
  readonly title?: string;
  readonly category?: string;
  readonly categories?: readonly string[];
  readonly status?: string;
  readonly status_short?: string;
  readonly created?: string;
  readonly date?: string;
  readonly updated?: string;
  readonly published?: string;
  readonly desc?: string;
  readonly impact?: string;
  readonly link?: string;
}

interface FantasyProsInjuryRecord {
  readonly player_id?: number | string | null;
  readonly name?: string;
  readonly team_id?: string;
  readonly position_id?: string;
  readonly status?: string;
  readonly status_short?: string;
  readonly injury_type?: string;
  readonly comment?: string;
  readonly injury_update_date?: string | null;
  readonly practice_1?: string | null;
  readonly practice_2?: string | null;
  readonly practice_3?: string | null;
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

function deriveStructuredStatus(
  record: { readonly status?: string; readonly status_short?: string }
): NewsStatus {
  const structuredValues = [record.status, record.status_short]
    .filter(Boolean)
    .map((value) => value?.toLowerCase().trim() ?? '');
  const structuredStatus = structuredValues.join(' ');
  const structuredTokens: readonly string[] = structuredStatus.match(/[a-z]+/g) ?? [];

  if (
    structuredTokens.includes('out') ||
    structuredTokens.includes('inactive') ||
    structuredValues.includes('o') ||
    /\binjured\s+reserve\b/.test(structuredStatus) ||
    /\b(ir|pup|reserve|res)\b/.test(structuredStatus) ||
    /\bphysically\s+unable\s+to\s+perform\b/.test(structuredStatus)
  ) {
    return 'out';
  }
  if (
    structuredTokens.includes('questionable') ||
    structuredTokens.includes('doubtful') ||
    structuredValues.some((value) => ['q', 'd'].includes(value))
  ) {
    return 'questionable';
  }
  if (
    structuredTokens.includes('limited') ||
    structuredValues.includes('l')
  ) {
    return 'limited';
  }
  if (
    structuredTokens.includes('healthy') ||
    structuredTokens.includes('active') ||
    structuredTokens.includes('full')
  ) {
    return 'healthy';
  }

  return 'unknown';
}

function deriveNewsStatus(record: FantasyProsNewsRecord): NewsStatus {
  const structuredStatus = deriveStructuredStatus(record);
  if (structuredStatus !== 'unknown') {
    return structuredStatus;
  }

  const headline = record.title?.toLowerCase() ?? '';
  const tokens: readonly string[] = headline.match(/[a-z]+/g) ?? [];
  const hasToken = (term: string): boolean => tokens.includes(term);
  const isPracticeAbsence =
    /\b(sat|sits|sitting|held|missed|misses|missing|absent)\b[^.]*\bpractice\b/.test(headline) ||
    /\bpractice\b[^.]*\b(sat|sits|sitting|held|missed|misses|missing|absent)\b/.test(headline) ||
    /\b(not|isn['’]?t|wasn['’]?t|won['’]?t|didn['’]?t)\s+(practice|practicing)\b/.test(headline) ||
    /\bdid\s+not\s+practice\b/.test(headline) ||
    /\bdnp\b/.test(headline);

  if (isPracticeAbsence) {
    return 'limited';
  }
  const isExplicitlyOut =
    /\bruled\s+out\b/.test(headline) ||
    /\bwill\s+miss\b/.test(headline) ||
    /\binactive\b/.test(headline) ||
    /\binjured\s+reserve\b/.test(headline);

  if (isExplicitlyOut) {
    return 'out';
  }
  const hasStandaloneOut = tokens.some((term, index) =>
    term === 'out' &&
    !['stand', 'stands', 'stood', 'standing'].includes(tokens[index - 1] ?? '') &&
    tokens[index + 1] !== 'practice'
  );

  if (hasStandaloneOut) {
    return 'out';
  }
  if (
    hasToken('questionable') ||
    hasToken('doubtful') ||
    hasToken('uncertain') ||
    hasToken('unclear')
  ) {
    return 'questionable';
  }
  if (hasToken('limited')) {
    return 'limited';
  }
  if (hasToken('healthy') || hasToken('active')) {
    return 'healthy';
  }

  return 'unknown';
}

function normalizeFantasyProsTimestamp(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const utcTimestamp = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );
  if (utcTimestamp) {
    return `${utcTimestamp[1]}-${utcTimestamp[2]}-${utcTimestamp[3]}T${utcTimestamp[4]}:${utcTimestamp[5]}:${utcTimestamp[6]}Z`;
  }

  return value;
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

  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FANTASYPROS_REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        headers: {
          'x-api-key': apiKey,
          accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `FantasyPros API request timed out after ${FANTASYPROS_REQUEST_TIMEOUT_MS}ms for ${url.pathname}`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    if (response.status !== 429 || attempt === 2) break;
    const retryHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryHeader === null ? Number.NaN : Number(retryHeader);
    const delayMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(10_000, Math.max(500, retryAfterSeconds * 1000))
      : (attempt + 1) * 1500;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!response) throw new Error(`FantasyPros API returned no response for ${url.pathname}`);

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

    const rank = parseNumber(player.rank_ecr, Number.NaN);
    if (!Number.isFinite(rank)) {
      return [];
    }

    return [{
      fantasyProsId: player.player_id != null ? String(player.player_id) : undefined,
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

function buildAdp(players: readonly FantasyProsConsensusPlayer[]): FantasyProsAdpPlayer[] {
  return players.flatMap((player) => {
    const team = normalizeFantasyProsTeam(player.player_team_id);
    const position = normalizeFantasyProsPosition(player.player_position_id);
    const rank = parseNumber(player.rank_ecr, Number.NaN);
    if (!team || !position || !player.player_name || !Number.isFinite(rank)) {
      return [];
    }

    return [{
      fantasyProsId: player.player_id != null ? String(player.player_id) : undefined,
      rank,
      name: player.player_name,
      position,
      team,
      positionalRank: parsePositionalRank(player.pos_rank, rank),
      bestRank: parseNumber(player.rank_min, rank),
      worstRank: parseNumber(player.rank_max, rank),
      averageRank: parseNumber(player.rank_ave, rank),
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

    if (typeof points !== 'number') return [];

    const rushAttempts = player.stats?.rush_att ?? player.stats?.rushing_attempts;
    const receptions = player.stats?.rec_rec ?? player.stats?.rec ?? player.stats?.receptions;
    const passingYards = player.stats?.pass_yds;
    const passingTouchdowns = player.stats?.pass_tds;
    const rushingYards = player.stats?.rush_yds;
    const rushingTouchdowns = player.stats?.rush_tds;
    const receivingYards = player.stats?.rec_yds;
    const receivingTouchdowns = player.stats?.rec_tds;
    return [{
          fantasyProsId: player.fpid != null ? String(player.fpid) : undefined,
          name: player.name,
          position,
          team,
          projectedPoints: points,
          baseProjectedPoints: points,
          ...(typeof rushAttempts === 'number' ? { projectedRushAttempts: rushAttempts } : {}),
          ...(typeof receptions === 'number' ? { projectedReceptions: receptions } : {}),
          ...(typeof passingYards === 'number' ? { projectedPassingYards: passingYards } : {}),
          ...(typeof passingTouchdowns === 'number'
            ? { projectedPassingTouchdowns: passingTouchdowns }
            : {}),
          ...(typeof rushingYards === 'number' ? { projectedRushingYards: rushingYards } : {}),
          ...(typeof rushingTouchdowns === 'number'
            ? { projectedRushingTouchdowns: rushingTouchdowns }
            : {}),
          ...(typeof receivingYards === 'number'
            ? { projectedReceivingYards: receivingYards }
            : {}),
          ...(typeof receivingTouchdowns === 'number'
            ? { projectedReceivingTouchdowns: receivingTouchdowns }
            : {}),
        }];
  });
}

function buildNews(
  payload: FantasyProsNewsResponse,
  playerIndex: ReadonlyMap<string, FantasyProsPlayerIndexEntry>
): FantasyProsNewsItem[] {
  const records = payload.items ?? payload.news ?? [];

  return records.flatMap((record) => {
    const indexedPlayer = playerIndex.get(String(record.player_id ?? ''));
    const team = normalizeFantasyProsTeam(record.team_id) ?? indexedPlayer?.team;
    const position = indexedPlayer?.position;
    const name = record.player_name ?? indexedPlayer?.name;

    if (!team || !position || !name) {
      return [];
    }

    const categories = record.categories ?? (record.category ? [record.category] : undefined);
    const updatedAt = normalizeFantasyProsTimestamp(
      record.updated ?? record.created ?? record.date ?? record.published
    );

    return [{
      fantasyProsId: record.player_id != null ? String(record.player_id) : undefined,
      name,
      position,
      team,
      status: deriveNewsStatus(record),
      headline: record.title ?? 'FantasyPros news item',
      ...(categories && categories.length > 0 ? { categories } : {}),
      ...(record.desc ? { description: record.desc } : {}),
      ...(record.impact ? { impact: record.impact } : {}),
      ...(record.link ? { link: record.link } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    }];
  });
}

function buildInjuryNews(
  payload: FantasyProsInjuriesResponse,
  playerIndex: ReadonlyMap<string, FantasyProsPlayerIndexEntry>
): FantasyProsNewsItem[] {
  return (payload.injuries ?? []).flatMap((record) => {
    const indexedPlayer = playerIndex.get(String(record.player_id ?? ''));
    const team = normalizeFantasyProsTeam(record.team_id) ?? indexedPlayer?.team;
    const position = normalizeFantasyProsPosition(record.position_id) ?? indexedPlayer?.position;
    const name = record.name ?? indexedPlayer?.name;
    const practiceStatuses = [record.practice_1, record.practice_2, record.practice_3]
      .filter((status): status is string => Boolean(status));
    const hasAvailabilitySignal = Boolean(
      record.status ||
      record.status_short ||
      record.injury_type ||
      record.comment ||
      record.injury_update_date ||
      practiceStatuses.length > 0
    );

    if (!team || !position || !name || !hasAvailabilitySignal) {
      return [];
    }

    const status = deriveStructuredStatus(record);
    const softPracticeStatus = practiceStatuses.some((practice) =>
      /\b(limit|limited|dnp|did\s+not\s+practice)\b/i.test(practice)
    )
      ? 'limited'
      : 'unknown';
    const headlineDetails = [record.status, record.injury_type]
      .filter(Boolean)
      .join(' - ');
    const updatedAt = normalizeFantasyProsTimestamp(record.injury_update_date);

    return [{
      fantasyProsId: record.player_id != null ? String(record.player_id) : undefined,
      name,
      position,
      team,
      status: status === 'unknown' ? softPracticeStatus : status,
      headline:
        record.comment || `${name}${headlineDetails ? `: ${headlineDetails}` : ' injury update'}`,
      categories: ['injury'],
      ...(record.comment ? { description: record.comment } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    }];
  });
}

function newsPlayerKey(item: FantasyProsNewsItem): string {
  return item.fantasyProsId ?? `${item.name.toLowerCase()}|${item.position}|${item.team}`;
}

function combineNewsWithInjuries(
  news: readonly FantasyProsNewsItem[],
  injuries: readonly FantasyProsNewsItem[]
): FantasyProsNewsItem[] {
  const injuriesByPlayer = new Map<string, FantasyProsNewsItem>();
  for (const injury of injuries) {
    const key = newsPlayerKey(injury);
    const existing = injuriesByPlayer.get(key);
    const injuryUpdatedAt = Date.parse(injury.updatedAt ?? '');
    const existingUpdatedAt = Date.parse(existing?.updatedAt ?? '');
    if (
      !existing ||
      (Number.isFinite(injuryUpdatedAt) &&
        (!Number.isFinite(existingUpdatedAt) || injuryUpdatedAt > existingUpdatedAt))
    ) {
      injuriesByPlayer.set(key, injury);
    }
  }
  const matchedInjuryKeys = new Set<string>();
  const combinedNews = news.map((item) => {
    const key = newsPlayerKey(item);
    const injury = injuriesByPlayer.get(key);
    if (!injury) return item;

    matchedInjuryKeys.add(key);
    return injury.status === 'unknown'
      ? item
      : { ...item, status: injury.status };
  });

  return [
    ...combinedNews,
    ...injuries.filter((injury) => !matchedInjuryKeys.has(newsPlayerKey(injury))),
  ];
}

export async function fetchFantasyProsSnapshot(
  options: FantasyProsApiOptions
): Promise<FantasyProsSnapshot> {
  const scoring = options.scoring ?? 'PPR';
  const [
    playerIndex,
    rankingsResponse,
    adpResponse,
    newsResponse,
    injuriesResponse,
  ] = await Promise.all([
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
    fetchFantasyProsJson<FantasyProsConsensusResponse>(
      `/${FANTASYPROS_SPORT_PATH}/${options.season}/consensus-rankings`,
      options.apiKey,
      {
        position: 'ALL',
        scoring,
        week: 0,
        type: 'ADP',
      }
    ),
    fetchFantasyProsJson<FantasyProsNewsResponse>(
      `/${FANTASYPROS_SPORT_PATH}/news`,
      options.apiKey,
      {
        limit: 100,
        category: 'injury',
        order_by: 'updated',
      }
    ),
    fetchFantasyProsJson<FantasyProsInjuriesResponse>(
      `/${FANTASYPROS_SPORT_PATH}/injuries`,
      options.apiKey,
      {
        year: options.season,
        week: 0,
      }
    ).catch((error: unknown): FantasyProsInjuriesResponse => {
      console.warn('FantasyPros injuries endpoint unavailable; continuing without injuries.');
      console.warn(error);
      return {};
    }),
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
  const adp = buildAdp(adpResponse.players ?? []);
  const projections = buildProjections(projectionsResponse.players ?? [], scoring);
  const news = combineNewsWithInjuries(
    buildNews(newsResponse, playerIndex),
    buildInjuryNews(injuriesResponse, playerIndex)
  );
  const refreshedAt = new Date().toISOString();

  return {
    metadata: {
      season: options.season,
      sourceType: 'api',
      source: rankingsResponse.source ?? `${FANTASYPROS_API_BASE_URL}/${FANTASYPROS_SPORT_NAME}`,
      refreshedAt,
      projectionRefreshedAt: projections.length > 0 ? refreshedAt : undefined,
      projectionSource: projections.length > 0 ? 'api' : undefined,
      rankingCount: rankings.length,
      adpCount: adp.length,
      projectionCount: projections.length,
      newsCount: news.length,
    },
    rankings,
    adp,
    projections,
    news,
  };
}

export const fantasyProsApiInternals = {
  normalizeFantasyProsPosition,
  normalizeFantasyProsTeam,
  parsePositionalRank,
  deriveStructuredStatus,
  deriveNewsStatus,
  normalizeFantasyProsTimestamp,
  buildRankings,
  buildAdp,
  buildProjections,
  buildNews,
  buildInjuryNews,
  combineNewsWithInjuries,
};
