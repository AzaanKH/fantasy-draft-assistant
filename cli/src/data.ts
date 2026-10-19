import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import {
  type NFLTeam,
  type Player,
  type Position,
} from '@fantasy-draft/shared/league';
import {
  type MarketAdpPlayer,
} from '@fantasy-draft/shared/catalog';
import {
  type LeagueSettings,
} from '@fantasy-draft/shared/league';
import {
  type DraftType,
} from '@fantasy-draft/shared/sync';
import { mergeCoreSources, normalizePlayerName, type LeagueSurvivalModel, canonicalizeKeeperSupply, type CanonicalKeeperAssignment, type KeeperSupplyEntry, type evaluateWorkspaceDraftReadiness } from '@fantasy-draft/shared/draft';
import { decodeLeagueSurvivalModel, decodeTeamEnvDataFile, decodeRecommendationPolicyFile, decodePlayerIdentityFile, decodeFantasyProsSnapshot, decodeSleeperDataFile, decodeKeeperFile, decodeOrNull, CATALOG, catalogPath, SAFE_RECOMMENDATION_POLICY, type RecommendationPolicyFile, type DecodeOptions, type SleeperDataFile } from '@fantasy-draft/shared/catalog';
import { CliError, unexpected } from './errors';

type KeeperStatus = Parameters<typeof evaluateWorkspaceDraftReadiness>[0]['keeperStatus'];
export interface DraftData {
  readonly players: readonly Player[];
  readonly keepers: readonly CanonicalKeeperAssignment[];
  readonly keeperStatus: KeeperStatus;
  readonly survivalModel: LeagueSurvivalModel | null;
  readonly policy: RecommendationPolicyFile;
}

/** Read optional JSON, treating a missing or malformed file as absent. */
export const loadJson = (root: string, path: string): Effect.Effect<unknown> => Effect.tryPromise(
  async (): Promise<unknown> => JSON.parse(await readFile(join(root, path), 'utf8')),
).pipe(Effect.orElseSucceed(() => null));

export function resolveKeepers(value: unknown, players: readonly Player[], teams: number, rounds: number,
  draftType: DraftType | null): {
  keepers: readonly CanonicalKeeperAssignment[]; status: KeeperStatus;
} {
  const file = decodeOrNull(decodeKeeperFile, value);
  const byId = new Map(players.map(player => [player.id, player]));
  const byName = new Map(players.map(player => [`${normalizePlayerName(player.name)}:${player.position}`, player]));
  const resolved: KeeperSupplyEntry[] = [];
  const unresolvedNames: string[] = [];
  for (const entry of file?.keepers ?? []) {
    const player = (entry.playerId ? byId.get(entry.playerId) : undefined) ?? byName.get(`${normalizePlayerName(entry.playerName)}:${entry.position}`);
    if (!player || player.position !== entry.position) { unresolvedNames.push(entry.playerName); continue; }
    resolved.push({ playerId: player.id, playerName: player.name, position: player.position,
      teamIndex: entry.team - 1, round: entry.round, isMyKeeper: entry.isMyKeeper ?? false });
  }
  const supply = draftType === null
    ? { assignments: [], invalidEntries: resolved, conflictingEntries: [], duplicatePlayerIds: [] }
    : canonicalizeKeeperSupply(resolved, { totalTeams: teams, totalRounds: rounds, draftType });
  return {
    keepers: supply.assignments,
    status: {
      season: file?.season, confirmedAt: file?.updatedAt ?? null,
      configuredCount: file?.keepers.length ?? 0, resolvedCount: resolved.length,
      canonicalCount: supply.assignments.length, unresolvedNames,
      duplicateNames: supply.duplicatePlayerIds.map(id => byId.get(id)?.name ?? id),
      invalidAssignments: [...supply.invalidEntries, ...supply.conflictingEntries].map(entry =>
        `${entry.playerName}, team ${String(entry.teamIndex + 1)}, round ${String(entry.round)}`),
      isLoading: false, isError: !file, isInitialized: true, isConfirmed: file?.updatedAt != null,
      isMockReady: false, error: file ? null : new Error('The current keeper file is missing or invalid.'),
    },
  };
}

export const loadDraftData = Effect.fn('loadDraftData')(function* (root: string, settings: LeagueSettings, rounds: number,
  marketAdp: readonly MarketAdpPlayer[], draftType: DraftType | null, options: DecodeOptions = {}) {
  const [rawSnapshot, rawIdentities, sleeper, environment, keeperFile, survival, policy] = yield* Effect.all([
    loadJson(root, catalogPath(CATALOG.snapshot)), loadJson(root, catalogPath(CATALOG.identities)),
    loadJson(root, catalogPath(CATALOG.sleeper)), loadJson(root, catalogPath(CATALOG.environment)),
    loadJson(root, catalogPath(CATALOG.keepers)), loadJson(root, catalogPath(CATALOG.survival)),
    loadJson(root, catalogPath(CATALOG.policy)),
  ], { concurrency: 'unbounded' });
  const snapshot = decodeOrNull(decodeFantasyProsSnapshot, rawSnapshot);
  const identities = decodeOrNull(decodePlayerIdentityFile, rawIdentities);
  if (!snapshot || !identities) {
    return yield* new CliError('CORE_DATA_INVALID', 'Rankings or canonical player identities are missing or invalid. Run draft readiness --json for corrective actions.', 3,
      { invalidCoreKeys: [...(!snapshot ? ['trusted-rankings'] : []), ...(!identities ? ['canonical-player-identities'] : [])] });
  }
  function optional<A>(raw: unknown, decode: (value: unknown, options?: DecodeOptions) => A, label: string): A | null {
    if (raw === null) return null;
    try { return decode(raw, options); }
    catch (error) { options.onWarning?.(`${label} is unavailable: ${String(error)}`); return null; }
  }
  const sleeperPlayers: SleeperDataFile['players'] = optional(sleeper, decodeSleeperDataFile, 'Sleeper player directory')?.players ?? [];
  const teamEnvironments = optional(environment, decodeTeamEnvDataFile, 'Team environment')?.teams ?? {};
  // Status commands report a failed merge as a warning, so keep it in the error channel.
  const merged = yield* Effect.try({ try: () => mergeCoreSources({
    onWarning: (message) => { console.warn(message); },
    rankings: snapshot.rankings, projections: snapshot.projections, news: snapshot.news,
    sleeperPlayers, teamEnvironments, fantasyProsAdp: snapshot.adp, identities: identities.players,
    leagueContext: { marketAdp, scoringRules: settings.scoringRules, totalTeams: settings.totalTeams,
      rosterRequirements: settings.rosterRequirements },
  }, []), catch: unexpected });
  // The web merge's final fallback uses the changing ECR rank. CLI callers keep
  // IDs between refreshes, so use the source identifier when that join is absent.
  const sourceKey = (row: { name: string; position: Position; team: NFLTeam }) => `${normalizePlayerName(row.name)}:${row.position}:${row.team}`;
  const rankingsByPlayer = new Map(snapshot.rankings.map(row => [sourceKey(row), row]));
  const players: Player[] = [];
  for (const player of merged) {
    if (!player.id.startsWith('ecr-')) { players.push(player); continue; }
    const sourceId = rankingsByPlayer.get(sourceKey(player))?.fantasyProsId;
    if (!sourceId) return yield* new CliError('CORE_DATA_INVALID', `${player.name} has no stable player identifier. Refresh rankings and player identities.`, 3,
      { invalidCoreKeys: ['canonical-player-identities'] });
    players.push({ ...player, id: `fantasypros:${sourceId}` });
  }
  if (new Set(players.map(player => player.id)).size !== players.length) {
    return yield* new CliError('CORE_DATA_INVALID', 'Player identifiers are duplicated. Rebuild canonical player identities before using the CLI.', 3,
      { invalidCoreKeys: ['canonical-player-identities'] });
  }
  const keeperResolution = resolveKeepers(keeperFile, players, settings.totalTeams, rounds, draftType);
  const data: DraftData = { players, keepers: keeperResolution.keepers, keeperStatus: keeperResolution.status,
    survivalModel: optional(survival, decodeLeagueSurvivalModel, 'League survival model'),
    policy: optional(policy, value => decodeRecommendationPolicyFile(value), 'Recommendation policy') ?? SAFE_RECOMMENDATION_POLICY };
  return data;
});
