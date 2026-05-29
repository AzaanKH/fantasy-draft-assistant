/**
 * Imports historical Sleeper league drafts into a clean local JSON dataset.
 *
 * Usage: pnpm --filter scripts import:league-history
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const LEAGUE_HISTORY_DIR = join(DATA_DIR, 'league-history');
const RAW_DIR = join(LEAGUE_HISTORY_DIR, 'raw');
const OUTPUT_FILE = join(LEAGUE_HISTORY_DIR, 'leagueDraftHistory.json');

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

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

interface SleeperDraft {
  readonly draft_id: string;
  readonly league_id: string;
  readonly season: string;
  readonly status: string;
  readonly type: string;
  readonly settings: Record<string, number>;
  readonly metadata: {
    readonly name?: string;
    readonly scoring_type?: string;
  } | null;
  readonly draft_order: Record<string, number> | null;
}

interface SleeperLeague {
  readonly league_id: string;
  readonly name: string;
  readonly season: string;
  readonly settings: Record<string, number>;
  readonly scoring_settings: Record<string, number>;
  readonly roster_positions: readonly string[];
}

interface SleeperDraftPick {
  readonly round: number;
  readonly roster_id: number;
  readonly player_id: string;
  readonly picked_by: string;
  readonly pick_no: number;
  readonly metadata: {
    readonly first_name?: string;
    readonly last_name?: string;
    readonly position?: string;
    readonly team?: string;
    readonly status?: string;
  } | null;
  readonly is_keeper: boolean | null;
  readonly draft_slot: number;
  readonly draft_id: string;
}

interface SleeperRoster {
  readonly roster_id: number;
  readonly owner_id: string | null;
  readonly league_id: string;
  readonly settings?: Record<string, number>;
  readonly players?: readonly string[] | null;
}

interface SleeperUser {
  readonly user_id: string;
  readonly display_name: string;
  readonly metadata?: {
    readonly team_name?: string;
  };
}

interface LeagueDraftPick {
  readonly season: number;
  readonly draftId: string;
  readonly leagueId: string;
  readonly pickNo: number;
  readonly round: number;
  readonly roundPick: number;
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

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${SLEEPER_API_BASE}${path}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Sleeper request failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.json() as Promise<T>;
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

function buildUserMaps(
  rosters: readonly SleeperRoster[],
  users: readonly SleeperUser[]
): {
  readonly rosterIdToOwner: Record<string, string | null>;
  readonly userIdToDisplayName: Record<string, string>;
} {
  return {
    rosterIdToOwner: Object.fromEntries(
      rosters.map((roster) => [String(roster.roster_id), roster.owner_id])
    ),
    userIdToDisplayName: Object.fromEntries(
      users.map((user) => [user.user_id, user.display_name])
    ),
  };
}

function cleanPicks(
  config: LeagueDraftConfig,
  league: SleeperLeague,
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
        leagueId: league.league_id,
        pickNo: pick.pick_no,
        round: pick.round,
        roundPick: ((pick.pick_no - 1) % (league.settings.num_teams ?? 10)) + 1,
        draftSlot: pick.draft_slot,
        rosterId: pick.roster_id,
        pickedByUserId: pick.picked_by,
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

async function importSeason(config: LeagueDraftConfig): Promise<LeagueSeasonHistory> {
  const [draft, picks, league, rosters, users] = await Promise.all([
    fetchJson<SleeperDraft>(`/draft/${config.draftId}`),
    fetchJson<SleeperDraftPick[]>(`/draft/${config.draftId}/picks`),
    fetchJson<SleeperLeague>(`/league/${config.leagueId}`),
    fetchJson<SleeperRoster[]>(`/league/${config.leagueId}/rosters`),
    fetchJson<SleeperUser[]>(`/league/${config.leagueId}/users`),
  ]);

  await Promise.all([
    writeJson(join(RAW_DIR, `${config.season}-draft.json`), draft),
    writeJson(join(RAW_DIR, `${config.season}-picks.json`), picks),
    writeJson(join(RAW_DIR, `${config.season}-league.json`), league),
    writeJson(join(RAW_DIR, `${config.season}-rosters.json`), rosters),
    writeJson(join(RAW_DIR, `${config.season}-users.json`), users),
  ]);

  const { rosterIdToOwner, userIdToDisplayName } = buildUserMaps(rosters, users);
  const cleanSeasonPicks = cleanPicks(config, league, picks, userIdToDisplayName);
  const userPicks = cleanSeasonPicks.filter((pick) => pick.isUserPick);

  return {
    season: config.season,
    leagueId: league.league_id,
    leagueName: league.name,
    draftId: config.draftId,
    draftStatus: draft.status,
    draftType: normalizeDraftType(draft.type),
    userSlot: config.userSlot,
    userRosterId: config.userRosterId,
    teams: draft.settings.teams ?? league.settings.num_teams ?? null,
    rounds: draft.settings.rounds ?? null,
    scoringType: normalizeScoringType(draft.metadata?.scoring_type),
    scoringSettings: league.scoring_settings,
    leagueSettings: league.settings,
    draftSettings: draft.settings,
    rosterPositions: league.roster_positions,
    draftOrder: draft.draft_order,
    rosterIdToOwner,
    userIdToDisplayName,
    picks: cleanSeasonPicks,
    userPicks,
  };
}

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });

  console.log('Importing historical Sleeper drafts...');
  const seasons = await Promise.all(LEAGUE_DRAFTS.map((config) => importSeason(config)));
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

  await writeJson(OUTPUT_FILE, leagueDraftHistory);

  console.log(`Wrote ${OUTPUT_FILE}`);
  console.log(`Imported ${totalPicks} picks across ${sortedSeasons.length} seasons.`);
  console.log(`Cleaned user-pick rows: ${userPicks}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
