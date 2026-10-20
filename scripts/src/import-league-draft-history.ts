/**
 * Imports historical Sleeper league drafts into a clean local JSON dataset.
 *
 * Usage: pnpm --filter scripts import:league-history
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { fetchJson, HttpRequestError, io, isEntryPoint, runMain } from './effect-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const LEAGUE_HISTORY_DIR = join(DATA_DIR, 'league-history');
const RAW_DIR = join(LEAGUE_HISTORY_DIR, 'raw');
const OUTPUT_FILE = join(LEAGUE_HISTORY_DIR, 'leagueDraftHistory.json');

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';
const FETCH_TIMEOUT_MS = 10_000;
const REDACTED = '[REDACTED]';

type ScoringType = 'standard' | 'half_ppr' | 'ppr' | 'custom' | null;
type DraftType = 'snake' | 'auction' | 'linear' | null;
type UserRosterAction = 'include' | 'exclude';
type OverrideReason = 'draft_trade' | 'manual_correction';
type UserPickSource = 'roster_id' | 'manual_include' | 'manual_exclude' | 'not_user';

interface LeagueDraftConfig {
  readonly season: number;
  readonly draftId: string;
  readonly leagueId: string;
  readonly userSlot: number;
  readonly userRosterId: number;
}

interface LeagueDraftPickOverride {
  readonly season: number;
  readonly draftId: string;
  readonly pickNo: number;
  readonly userRosterAction: UserRosterAction;
  readonly reason: OverrideReason;
  readonly note: string;
}

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
}
const numberRecord = Schema.Record(Schema.String, Schema.Finite);
const unknownRecord = Schema.Record(Schema.String, Schema.Unknown);
const sleeperDraftSchema = openStruct({
  draft_id: Schema.String, league_id: Schema.String, season: Schema.String, status: Schema.String,
  type: Schema.String, start_time: Schema.Finite, settings: numberRecord,
  metadata: Schema.NullOr(openStruct({ name: Schema.optional(Schema.String), scoring_type: Schema.optional(Schema.String) })),
  draft_order: Schema.NullOr(numberRecord),
});
const sleeperLeagueSchema = openStruct({
  league_id: Schema.String, name: Schema.String, season: Schema.String,
  settings: numberRecord, scoring_settings: numberRecord, roster_positions: Schema.Array(Schema.String),
});
const sleeperDraftPickSchema = openStruct({
  round: Schema.Finite, roster_id: Schema.Finite, player_id: Schema.String, picked_by: Schema.String,
  pick_no: Schema.Finite, draft_slot: Schema.Finite, draft_id: Schema.String,
  metadata: Schema.NullOr(openStruct({
    first_name: Schema.optional(Schema.String), last_name: Schema.optional(Schema.String),
    position: Schema.optional(Schema.String), team: Schema.optional(Schema.String), status: Schema.optional(Schema.String),
  })),
  is_keeper: Schema.NullOr(Schema.Boolean),
});
const sleeperRosterSchema = openStruct({
  roster_id: Schema.Finite, owner_id: Schema.NullOr(Schema.String), league_id: Schema.String,
  metadata: Schema.optional(Schema.NullOr(unknownRecord)), settings: Schema.optional(numberRecord),
  players: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});
const sleeperUserSchema = openStruct({
  user_id: Schema.String, display_name: Schema.String,
  metadata: Schema.optional(Schema.NullOr(unknownRecord)), settings: Schema.optional(Schema.NullOr(unknownRecord)),
});
type SleeperDraftPick = typeof sleeperDraftPickSchema.Type;
type SleeperRoster = typeof sleeperRosterSchema.Type;
type SleeperUser = typeof sleeperUserSchema.Type;
export const decodeLeagueHistoryDraft = Schema.decodeUnknownSync(sleeperDraftSchema);
export const decodeLeagueHistoryPicks = Schema.decodeUnknownSync(Schema.Array(sleeperDraftPickSchema));
const decodeLeagueHistoryLeague = Schema.decodeUnknownSync(sleeperLeagueSchema);
export const decodeLeagueHistoryRosters = Schema.decodeUnknownSync(Schema.Array(sleeperRosterSchema));
export const decodeLeagueHistoryUsers = Schema.decodeUnknownSync(Schema.Array(sleeperUserSchema));
const isNumberMap = Schema.is(numberRecord);

interface LeagueDraftPick {
  readonly season: number;
  readonly draftId: string;
  readonly leagueId: string;
  readonly pickNo: number;
  readonly round: number;
  readonly roundPick: number | null;
  readonly draftSlot: number;
  readonly rosterId: number;
  readonly pickedByUserId: string;
  readonly pickedByDisplayName: string | null;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: string | null;
  readonly nflTeam: string | null;
  readonly isKeeper: boolean;
  readonly isUserSlotPick: boolean;
  readonly isUserRosterPick: boolean;
  readonly isUserPick: boolean;
  readonly userPickSource: UserPickSource;
  readonly appliedOverride: LeagueDraftPickOverride | null;
}

interface LeagueSeasonHistory {
  readonly season: number;
  readonly leagueId: string;
  readonly leagueName: string;
  readonly draftId: string;
  readonly draftStatus: string;
  readonly draftType: DraftType;
  readonly draftStartTimestamp: string;
  readonly userSlot: number;
  readonly userRosterId: number;
  readonly teams: number | null;
  readonly rounds: number | null;
  readonly scoringType: ScoringType;
  readonly scoringSettings: Record<string, number>;
  readonly leagueSettings: Record<string, number>;
  readonly draftSettings: Record<string, number>;
  readonly rosterPositions: readonly string[];
  readonly draftOrder: Record<string, number> | null;
  readonly rosterIdToOwner: Record<string, string | null>;
  readonly userIdToDisplayName: Record<string, string>;
  readonly picks: readonly LeagueDraftPick[];
  readonly userPicks: readonly LeagueDraftPick[];
}

interface LeagueDraftHistory {
  readonly generatedAt: string;
  readonly source: string;
  readonly leagueName: string;
  readonly seasons: readonly LeagueSeasonHistory[];
  readonly manualOverrides: readonly LeagueDraftPickOverride[];
  readonly warnings: readonly string[];
  readonly summary: {
    readonly seasons: number;
    readonly totalPicks: number;
    readonly userPicks: number;
  };
}

const LEAGUE_DRAFTS: readonly LeagueDraftConfig[] = [
  {
    season: 2022,
    draftId: '856833702632767488',
    leagueId: '856833701722570752',
    userSlot: 7,
    userRosterId: 4,
  },
  {
    season: 2023,
    draftId: '989653487862562817',
    leagueId: '989653487862562816',
    userSlot: 6,
    userRosterId: 4,
  },
  {
    season: 2024,
    draftId: '1117608116687826945',
    leagueId: '1117608116687826944',
    userSlot: 8,
    userRosterId: 4,
  },
  {
    season: 2025,
    draftId: '1180348405031780353',
    leagueId: '1180348405031780352',
    userSlot: 8,
    userRosterId: 4,
  },
] as const;

const USER_2024_PICK_OVERRIDES: readonly LeagueDraftPickOverride[] = [
  {
    season: 2024,
    draftId: '1117608116687826945',
    pickNo: 13,
    userRosterAction: 'exclude',
    reason: 'draft_trade',
    note: 'Original slot 8 pick, not user actual selection after trades.',
  },
  {
    season: 2024,
    draftId: '1117608116687826945',
    pickNo: 17,
    userRosterAction: 'include',
    reason: 'draft_trade',
    note: 'User selected Chris Olave at 2.07.',
  },
  {
    season: 2024,
    draftId: '1117608116687826945',
    pickNo: 24,
    userRosterAction: 'include',
    reason: 'draft_trade',
    note: 'User selected Cooper Kupp at 3.04.',
  },
  {
    season: 2024,
    draftId: '1117608116687826945',
    pickNo: 28,
    userRosterAction: 'exclude',
    reason: 'draft_trade',
    note: 'Original slot 8 pick, not user actual selection after trades.',
  },
  {
    season: 2024,
    draftId: '1117608116687826945',
    pickNo: 57,
    userRosterAction: 'include',
    reason: 'draft_trade',
    note: 'User selected Evan Engram at 6.07.',
  },
];

function sleeperRequest<T>(path: string, decode: (value: unknown) => T): Effect.Effect<T, HttpRequestError> {
  const url = `${SLEEPER_API_BASE}${path}`;
  return fetchJson(url, { label: 'Sleeper', timeoutMs: FETCH_TIMEOUT_MS }).pipe(
    Effect.flatMap(value => Effect.try({
      try: () => decode(value),
      catch: error => new HttpRequestError({
        message: `Sleeper response did not match expected shape for ${url}: ${String(error)}`,
        url,
      }),
    })),
  );
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

function normalizeScoringType(value: string | undefined): ScoringType {
  switch (value) {
    case 'std':
    case 'standard':
      return 'standard';
    case 'half_ppr':
      return 'half_ppr';
    case 'ppr':
      return 'ppr';
    case undefined:
      return null;
    default:
      return 'custom';
  }
}

function normalizeDraftType(value: string): DraftType {
  if (value === 'snake' || value === 'auction' || value === 'linear') {
    return value;
  }

  return null;
}

function playerName(pick: SleeperDraftPick): string {
  const metadataName = [pick.metadata?.first_name, pick.metadata?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return metadataName || pick.player_id;
}

export function pseudonymizeUserId(userId: string): string {
  const digest = createHash('sha256').update(`league-history:${userId}`).digest('hex');
  return `user_${digest.slice(0, 12)}`;
}

export function sanitizeRawValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeRawValue(entry));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const entries: [string, unknown][] = Object.entries(value);
  return Object.fromEntries(
    entries.map(([key, entry]) => {
      if (key.startsWith('p_nick_')) {
        return [key, REDACTED];
      }

      if (key === 'user_id' || key === 'owner_id' || key === 'picked_by') {
        return [key, typeof entry === 'string' ? pseudonymizeUserId(entry) : entry];
      }

      if (key === 'draft_order' && isNumberMap(entry)) {
        return [
          key,
          Object.fromEntries(
            Object.entries(entry).map(([userId, draftSlot]) => [
              pseudonymizeUserId(userId),
              draftSlot,
            ])
          ),
        ];
      }

      if (key === 'reactions' && typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        return [
          key,
          Object.fromEntries(
            Object.entries(entry).map(([userId, reactions]) => [
              pseudonymizeUserId(userId),
              sanitizeRawValue(reactions),
            ])
          ),
        ];
      }

      if (
        key === 'display_name' ||
        key === 'team_name' ||
        key === 'last_author_display_name'
      ) {
        return [key, REDACTED];
      }

      if (key === 'avatar' || key.endsWith('_avatar')) {
        return [key, null];
      }

      if (
        key === 'allow_pn' ||
        key === 'allow_sms' ||
        key === 'mention_pn' ||
        key.endsWith('_pn')
      ) {
        return [key, 'off'];
      }

      return [key, sanitizeRawValue(entry)];
    })
  );
}

function buildUserMaps(
  rosters: readonly SleeperRoster[],
  users: readonly SleeperUser[]
): {
  readonly rosterIdToOwner: Record<string, string | null>;
  readonly rawUserIdToDisplayName: Record<string, string>;
  readonly sanitizedUserIdToDisplayName: Record<string, string>;
} {
  return {
    rosterIdToOwner: Object.fromEntries(
      rosters.map((roster) => [
        String(roster.roster_id),
        roster.owner_id ? pseudonymizeUserId(roster.owner_id) : null,
      ])
    ),
    rawUserIdToDisplayName: Object.fromEntries(
      users.map((user) => [user.user_id, pseudonymizeUserId(user.user_id)])
    ),
    sanitizedUserIdToDisplayName: Object.fromEntries(
      users.map((user) => {
        const pseudonymizedUserId = pseudonymizeUserId(user.user_id);
        return [pseudonymizedUserId, pseudonymizedUserId];
      })
    ),
  };
}

function cleanPicks(
  config: LeagueDraftConfig,
  leagueId: string,
  resolvedTeamCount: number | null,
  picks: readonly SleeperDraftPick[],
  userIdToDisplayName: Record<string, string>
): readonly LeagueDraftPick[] {
  const overridesByPick = new Map(
    USER_2024_PICK_OVERRIDES.filter(
      (override) => override.season === config.season && override.draftId === config.draftId
    ).map((override) => [override.pickNo, override])
  );

  return [...picks]
    .sort((a, b) => a.pick_no - b.pick_no)
    .map((pick) => {
      const override = overridesByPick.get(pick.pick_no) ?? null;
      const isUserRosterPick = pick.roster_id === config.userRosterId;
      const isUserPick =
        override?.userRosterAction === 'include'
          ? true
          : override?.userRosterAction === 'exclude'
            ? false
            : isUserRosterPick;
      const userPickSource: UserPickSource =
        override?.userRosterAction === 'include'
          ? 'manual_include'
          : override?.userRosterAction === 'exclude'
            ? 'manual_exclude'
            : isUserRosterPick
              ? 'roster_id'
              : 'not_user';

      return {
        season: config.season,
        draftId: config.draftId,
        leagueId,
        pickNo: pick.pick_no,
        round: pick.round,
        roundPick: resolvedTeamCount ? ((pick.pick_no - 1) % resolvedTeamCount) + 1 : null,
        draftSlot: pick.draft_slot,
        rosterId: pick.roster_id,
        pickedByUserId: pseudonymizeUserId(pick.picked_by),
        pickedByDisplayName: userIdToDisplayName[pick.picked_by] ?? null,
        playerId: pick.player_id,
        playerName: playerName(pick),
        position: pick.metadata?.position ?? null,
        nflTeam: pick.metadata?.team ?? null,
        isKeeper: Boolean(pick.is_keeper),
        isUserSlotPick: pick.draft_slot === config.userSlot,
        isUserRosterPick,
        isUserPick,
        userPickSource,
        appliedOverride: override,
      };
    });
}

function buildWarnings(seasons: readonly LeagueSeasonHistory[]): readonly string[] {
  const warnings: string[] = [];
  const rosterPositionSets = new Set(
    seasons.map((season) => season.rosterPositions.join(' '))
  );

  if (rosterPositionSets.size > 1) {
    warnings.push(
      'Roster positions changed across seasons; use season-specific roster settings for roster-need backtests.'
    );
  }

  const scoringSignatures = new Set(
    seasons.map((season) => JSON.stringify(season.scoringSettings))
  );

  if (scoringSignatures.size > 1) {
    warnings.push(
      'Scoring settings changed across seasons; do not grade old drafts with current scoring.'
    );
  }

  const season2024 = seasons.find((season) => season.season === 2024);
  const expected2024UserPicks = 15;
  if (season2024 && season2024.userPicks.length !== expected2024UserPicks) {
    warnings.push(
      `2024 user-pick count is ${season2024.userPicks.length}, expected ${expected2024UserPicks} after draft-pick trades.`
    );
  }

  return warnings;
}

const importSeason = Effect.fn('importSeason')(function* (config: LeagueDraftConfig) {
  const [draft, picks, league, rosters, users] = yield* Effect.all([
    sleeperRequest(`/draft/${config.draftId}`, decodeLeagueHistoryDraft),
    sleeperRequest(
      `/draft/${config.draftId}/picks`,
      decodeLeagueHistoryPicks
    ),
    sleeperRequest(`/league/${config.leagueId}`, decodeLeagueHistoryLeague),
    sleeperRequest(
      `/league/${config.leagueId}/rosters`,
      decodeLeagueHistoryRosters
    ),
    sleeperRequest(
      `/league/${config.leagueId}/users`,
      decodeLeagueHistoryUsers
    ),
  ], { concurrency: 'unbounded' });
  const resolvedTeamCount = draft.settings.teams ?? league.settings.num_teams ?? null;

  yield* io(() => Promise.all([
    writeJson(join(RAW_DIR, `${config.season}-draft.json`), sanitizeRawValue(draft)),
    writeJson(join(RAW_DIR, `${config.season}-picks.json`), sanitizeRawValue(picks)),
    writeJson(join(RAW_DIR, `${config.season}-league.json`), sanitizeRawValue(league)),
    writeJson(join(RAW_DIR, `${config.season}-rosters.json`), sanitizeRawValue(rosters)),
    writeJson(join(RAW_DIR, `${config.season}-users.json`), sanitizeRawValue(users)),
  ]));

  const { rosterIdToOwner, rawUserIdToDisplayName, sanitizedUserIdToDisplayName } =
    buildUserMaps(rosters, users);
  const cleanSeasonPicks = cleanPicks(
    config,
    league.league_id,
    resolvedTeamCount,
    picks,
    rawUserIdToDisplayName
  );
  const userPicks = cleanSeasonPicks.filter((pick) => pick.isUserPick);

  const history: LeagueSeasonHistory = {
    season: config.season,
    leagueId: league.league_id,
    leagueName: league.name,
    draftId: config.draftId,
    draftStatus: draft.status,
    draftType: normalizeDraftType(draft.type),
    draftStartTimestamp: new Date(draft.start_time).toISOString(),
    userSlot: config.userSlot,
    userRosterId: config.userRosterId,
    teams: resolvedTeamCount,
    rounds: draft.settings.rounds ?? null,
    scoringType: normalizeScoringType(draft.metadata?.scoring_type),
    scoringSettings: league.scoring_settings,
    leagueSettings: league.settings,
    draftSettings: draft.settings,
    rosterPositions: league.roster_positions,
    draftOrder: draft.draft_order
      ? Object.fromEntries(
          Object.entries(draft.draft_order).map(([userId, draftSlot]) => [
            pseudonymizeUserId(userId),
            draftSlot,
          ])
        )
      : null,
    rosterIdToOwner,
    userIdToDisplayName: sanitizedUserIdToDisplayName,
    picks: cleanSeasonPicks,
    userPicks,
  };
  return history;
});

const program = Effect.gen(function* () {
  yield* io(() => mkdir(RAW_DIR, { recursive: true }));

  console.log('Importing historical Sleeper drafts...');
  // Five requests per season; two seasons at a time keeps bursts small for Sleeper.
  const seasons = yield* Effect.forEach(LEAGUE_DRAFTS, importSeason, { concurrency: 2 });
  const sortedSeasons = [...seasons].sort((a, b) => a.season - b.season);
  const totalPicks = sortedSeasons.reduce((sum, season) => sum + season.picks.length, 0);
  const userPicks = sortedSeasons.reduce((sum, season) => sum + season.userPicks.length, 0);

  const leagueDraftHistory: LeagueDraftHistory = {
    generatedAt: new Date().toISOString(),
    source: SLEEPER_API_BASE,
    leagueName: sortedSeasons[0]?.leagueName ?? 'Unknown',
    seasons: sortedSeasons,
    manualOverrides: USER_2024_PICK_OVERRIDES,
    warnings: buildWarnings(sortedSeasons),
    summary: {
      seasons: sortedSeasons.length,
      totalPicks,
      userPicks,
    },
  };

  yield* io(() => writeJson(OUTPUT_FILE, leagueDraftHistory));

  console.log(`Wrote ${OUTPUT_FILE}`);
  console.log(`Imported ${totalPicks} picks across ${sortedSeasons.length} seasons.`);
  console.log(`Cleaned user-pick rows: ${userPicks}.`);
});

if (isEntryPoint(import.meta.url)) {
  runMain(program);
}
