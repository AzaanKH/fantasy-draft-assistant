import type {
  NFLTeam,
  NewsStatus,
  Position,
} from '@fantasy-draft/shared/league';
import type {
  ECRPlayer,
  FantasyProsAdpPlayer,
  FantasyProsNewsItem,
  FantasyProsProjection,
  FantasyProsSnapshot,
} from '@fantasy-draft/shared/catalog';
import { isNFLTeam, isPosition } from '@fantasy-draft/shared/league';
import { Data, Effect, Schema } from 'effect';
import { fetchJson, type HttpRequestError } from './effect-runtime.js';

const FANTASYPROS_API_BASE_URL = 'https://api.fantasypros.com/public/v2/json';
const FANTASYPROS_SPORT_PATH = 'nfl';
const FANTASYPROS_SPORT_NAME = 'NFL';
const FANTASYPROS_REQUEST_TIMEOUT_MS = 10_000;

interface FantasyProsApiOptions {
  readonly apiKey: string;
  readonly season: number;
  readonly scoring?: 'STD' | 'PPR' | 'HALF';
}

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
}
const providerId = Schema.optional(Schema.NullOr(Schema.Union([Schema.Finite, Schema.String])));
const optionalText = Schema.optional(Schema.String);
const optionalNumericText = Schema.optional(Schema.Union([Schema.String, Schema.Finite]));
const fantasyProsPlayerRecord = openStruct({
  player_id: providerId,
  player_name: optionalText,
  position_id: optionalText,
  player_positions: optionalText,
  team_id: optionalText,
});
const fantasyProsConsensusPlayer = openStruct({
  player_id: providerId,
  player_name: optionalText,
  player_team_id: optionalText,
  player_position_id: optionalText,
  player_bye_week: optionalNumericText,
  rank_ecr: optionalNumericText,
  rank_min: optionalNumericText,
  rank_max: optionalNumericText,
  rank_ave: optionalNumericText,
  pos_rank: optionalText,
});
type FantasyProsConsensusPlayer = typeof fantasyProsConsensusPlayer.Type;
const fantasyProsProjectionPlayer = openStruct({
  fpid: providerId,
  name: optionalText,
  position_id: optionalText,
  team_id: optionalText,
  stats: Schema.optional(openStruct({
    points: Schema.optional(Schema.Finite),
    points_ppr: Schema.optional(Schema.Finite),
    points_half: Schema.optional(Schema.Finite),
    rush_att: Schema.optional(Schema.Finite),
    rushing_attempts: Schema.optional(Schema.Finite),
    pass_yds: Schema.optional(Schema.Finite),
    pass_tds: Schema.optional(Schema.Finite),
    rush_yds: Schema.optional(Schema.Finite),
    rush_tds: Schema.optional(Schema.Finite),
    rec_rec: Schema.optional(Schema.Finite),
    rec: Schema.optional(Schema.Finite),
    receptions: Schema.optional(Schema.Finite),
    rec_yds: Schema.optional(Schema.Finite),
    rec_tds: Schema.optional(Schema.Finite),
  })),
});
type FantasyProsProjectionPlayer = typeof fantasyProsProjectionPlayer.Type;
const fantasyProsNewsRecord = openStruct({
  player_id: providerId,
  player_name: optionalText,
  team_id: optionalText,
  title: optionalText,
  category: optionalText,
  categories: Schema.optional(Schema.Array(Schema.String)),
  status: optionalText,
  status_short: optionalText,
  created: optionalText,
  date: optionalText,
  updated: optionalText,
  published: optionalText,
  desc: optionalText,
  impact: optionalText,
  link: optionalText,
});
type FantasyProsNewsRecord = typeof fantasyProsNewsRecord.Type;
const fantasyProsInjuryRecord = openStruct({
  player_id: providerId,
  name: optionalText,
  team_id: optionalText,
  position_id: optionalText,
  status: optionalText,
  status_short: optionalText,
  injury_type: optionalText,
  comment: optionalText,
  injury_update_date: Schema.optional(Schema.NullOr(Schema.String)),
  practice_1: Schema.optional(Schema.NullOr(Schema.String)),
  practice_2: Schema.optional(Schema.NullOr(Schema.String)),
  practice_3: Schema.optional(Schema.NullOr(Schema.String)),
});
const fantasyProsPlayersResponse = openStruct({ players: Schema.optional(Schema.Array(fantasyProsPlayerRecord)) });
const fantasyProsConsensusResponse = openStruct({
  source: optionalText, last_updated: optionalText, players: Schema.optional(Schema.Array(fantasyProsConsensusPlayer)),
});
const fantasyProsProjectionResponse = openStruct({ players: Schema.optional(Schema.Array(fantasyProsProjectionPlayer)) });
const fantasyProsNewsResponse = openStruct({
  items: Schema.optional(Schema.Array(fantasyProsNewsRecord)), news: Schema.optional(Schema.Array(fantasyProsNewsRecord)),
});
const fantasyProsInjuriesResponse = openStruct({ injuries: Schema.optional(Schema.Array(fantasyProsInjuryRecord)) });
type FantasyProsPlayersResponse = typeof fantasyProsPlayersResponse.Type;
type FantasyProsNewsResponse = typeof fantasyProsNewsResponse.Type;
type FantasyProsInjuriesResponse = typeof fantasyProsInjuriesResponse.Type;
const decodePlayersResponse = Schema.decodeUnknownSync(fantasyProsPlayersResponse);
const decodeConsensusResponse = Schema.decodeUnknownSync(fantasyProsConsensusResponse);
const decodeProjectionsResponse = Schema.decodeUnknownSync(fantasyProsProjectionResponse);
const decodeNewsResponse = Schema.decodeUnknownSync(fantasyProsNewsResponse);
const decodeInjuriesResponse = Schema.decodeUnknownSync(fantasyProsInjuriesResponse);

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

  return isNFLTeam(normalized) ? normalized : null;
}

function normalizeFantasyProsPosition(positionId: string | undefined): Position | null {
  if (!positionId) return null;

  const upper = positionId.toUpperCase();
  const normalized = upper === 'DST' ? 'DEF' : upper;

  return isPosition(normalized) ? normalized : null;
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

/** FantasyPros returned JSON that does not have the expected shape. */
class FantasyProsPayloadError extends Data.TaggedError('FantasyProsPayloadError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Run a payload parser, so a malformed response is an expected failure rather than a defect. */
const parsePayload = <A>(label: string, parse: () => A): Effect.Effect<A, FantasyProsPayloadError> => Effect.try({
  try: parse,
  catch: (cause) => new FantasyProsPayloadError({
    message: `FantasyPros returned an unexpected ${label} payload: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  }),
});

function fetchFantasyProsJson<T>(
  path: string,
  apiKey: string,
  decode: (value: unknown) => T,
  query: Record<string, string | number | undefined> = {}
): Effect.Effect<T, HttpRequestError | FantasyProsPayloadError> {
  const url = new URL(`${FANTASYPROS_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return fetchJson(url, {
    label: 'FantasyPros API',
    timeoutMs: FANTASYPROS_REQUEST_TIMEOUT_MS,
    headers: { 'x-api-key': apiKey, accept: 'application/json' },
  }).pipe(Effect.flatMap(value => parsePayload(path, () => decode(value))));
}

const fetchFantasyProsPlayerIndex = (apiKey: string) => fetchFantasyProsJson(
  `/${FANTASYPROS_SPORT_PATH}/players`,
  apiKey, decodePlayersResponse
).pipe(Effect.flatMap((payload) => parsePayload('player index', () => buildPlayerIndex(payload))));

function buildPlayerIndex(payload: FantasyProsPlayersResponse): Map<string, FantasyProsPlayerIndexEntry> {

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

/** Optional endpoints degrade to empty data with a warning instead of failing the refresh. */
const optionalEndpoint = <T>(label: string, request: Effect.Effect<T, HttpRequestError | FantasyProsPayloadError>, fallback: T) =>
  request.pipe(Effect.catch((error) => Effect.sync(() => {
    console.warn(`FantasyPros ${label} endpoint unavailable; continuing without ${label}.`);
    console.warn(error.message);
    return fallback;
  })));

export const fetchFantasyProsSnapshot = Effect.fn('fetchFantasyProsSnapshot')(function* (
  options: FantasyProsApiOptions
) {
  const scoring = options.scoring ?? 'PPR';
  // Five independent requests; the player index and rankings must succeed.
  const {
    playerIndex,
    rankingsResponse,
    adpResponse,
    newsResponse,
    injuriesResponse,
    projectionsResponse,
  } = yield* Effect.all({
    playerIndex: fetchFantasyProsPlayerIndex(options.apiKey),
    rankingsResponse: fetchFantasyProsJson(
      `/${FANTASYPROS_SPORT_PATH}/${options.season}/consensus-rankings`,
      options.apiKey, decodeConsensusResponse,
      {
        position: 'ALL',
        scoring,
        week: 0,
      }
    ),
    adpResponse: fetchFantasyProsJson(
      `/${FANTASYPROS_SPORT_PATH}/${options.season}/consensus-rankings`,
      options.apiKey, decodeConsensusResponse,
      {
        position: 'ALL',
        scoring,
        week: 0,
        type: 'ADP',
      }
    ),
    newsResponse: fetchFantasyProsJson(
      `/${FANTASYPROS_SPORT_PATH}/news`,
      options.apiKey, decodeNewsResponse,
      {
        limit: 100,
        category: 'injury',
        order_by: 'updated',
      }
    ),
    injuriesResponse: optionalEndpoint('injuries', fetchFantasyProsJson(
      `/${FANTASYPROS_SPORT_PATH}/injuries`,
      options.apiKey, decodeInjuriesResponse,
      {
        year: options.season,
        week: 0,
      }
    ), {}),
    projectionsResponse: optionalEndpoint('projections', fetchFantasyProsJson(
      `/${FANTASYPROS_SPORT_PATH}/${options.season}/projections`,
      options.apiKey, decodeProjectionsResponse,
      {
        week: 0,
        positions: 'QB:RB:WR:TE:K:DST',
        scoring,
      }
    ), {}),
  }, { concurrency: 3 });

  const rankings = yield* parsePayload('rankings', () => buildRankings(rankingsResponse.players ?? []));
  const adp = yield* parsePayload('ADP', () => buildAdp(adpResponse.players ?? []));
  const projections = yield* parsePayload('projections', () => buildProjections(projectionsResponse.players ?? [], scoring));
  const news = yield* parsePayload('news', () => combineNewsWithInjuries(
    buildNews(newsResponse, playerIndex),
    buildInjuryNews(injuriesResponse, playerIndex)
  ));
  const refreshedAt = new Date().toISOString();

  const snapshot: FantasyProsSnapshot = {
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
  return snapshot;
});

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
