import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isPosition, isNFLTeam, isNewsStatus, isTeamEnvironment, type FantasyProsSnapshot, type LeagueSettings,
  type DraftType, type MarketAdpPlayer, type NFLTeam, type Player, type Position, type TeamEnvironment,
} from '@fantasy-draft/shared';
import { mergeCoreSources } from '@/lib/calculations/recommendation-player-variants';
import { normalizePlayerName } from '@/lib/calculations/player-value';
import { canonicalizeKeeperSupply, type CanonicalKeeperAssignment, type KeeperSupplyEntry } from '@/lib/keeper-supply';
import { isLeagueSurvivalModel } from '@/lib/league-survival-model';
import type { LeagueSurvivalModel } from '@/lib/calculations/survival';
import { isPlayerIdentityFile, isRecommendationPolicyFile, isRecord } from '@/lib/player-data/validators';
import { SAFE_RECOMMENDATION_POLICY } from '@/lib/player-data/policy';
import type { RecommendationPolicyFile, SleeperDataFile } from '@/lib/player-data/types';
import type { evaluateWorkspaceDraftReadiness } from '@/lib/draft-readiness';
import { CliError } from './errors';

type KeeperStatus = Parameters<typeof evaluateWorkspaceDraftReadiness>[0]['keeperStatus'];
interface KeeperEntry {
  readonly playerId?: string;
  readonly playerName: string;
  readonly position: Position;
  readonly team: number;
  readonly round: number;
  readonly isMyKeeper?: boolean;
}
interface KeeperFile { readonly season: number; readonly updatedAt: string | null; readonly keepers: readonly KeeperEntry[] }
export interface DraftData {
  readonly players: readonly Player[];
  readonly keepers: readonly CanonicalKeeperAssignment[];
  readonly keeperStatus: KeeperStatus;
  readonly survivalModel: LeagueSurvivalModel | null;
  readonly policy: RecommendationPolicyFile;
}

export async function loadJson(root: string, path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(join(root, path), 'utf8')) as unknown; }
  catch { return null; }
}

function isSnapshot(value: unknown): value is FantasyProsSnapshot {
  return isRecord(value) && isRecord(value.metadata) && Array.isArray(value.rankings) &&
    value.rankings.every(row => isRecord(row) && typeof row.name === 'string' && isPosition(row.position) &&
      isNFLTeam(row.team) && ['rank', 'byeWeek', 'positionalRank', 'bestRank', 'worstRank', 'avgRank'].every(
        key => typeof row[key] === 'number' && Number.isFinite(row[key]))) &&
    Array.isArray(value.projections) && value.projections.every(row => isRecord(row) &&
      typeof row.name === 'string' && isPosition(row.position) && isNFLTeam(row.team) &&
      typeof row.projectedPoints === 'number' && Number.isFinite(row.projectedPoints) &&
      Object.entries(row).every(([key, stat]) => !key.startsWith('projected') && !['baseProjectedPoints', 'ceilingPoints', 'floorPoints'].includes(key) ||
        stat === undefined || typeof stat === 'number' && Number.isFinite(stat))) &&
    Array.isArray(value.news) && value.news.every(row => isRecord(row) && typeof row.name === 'string' &&
      isPosition(row.position) && isNFLTeam(row.team) && isNewsStatus(row.status)) &&
    Array.isArray(value.adp) && value.adp.every(row => isRecord(row) && typeof row.name === 'string' &&
      isPosition(row.position) && isNFLTeam(row.team) && ['rank', 'positionalRank', 'bestRank', 'worstRank', 'averageRank'].every(
        key => typeof row[key] === 'number' && Number.isFinite(row[key])));
}

function isKeeperFile(value: unknown): value is KeeperFile {
  return isRecord(value) && typeof value.season === 'number' &&
    (value.updatedAt === null || typeof value.updatedAt === 'string') && Array.isArray(value.keepers) &&
    value.keepers.every(entry => isRecord(entry) && typeof entry.playerName === 'string' && isPosition(entry.position) &&
      typeof entry.team === 'number' && Number.isInteger(entry.team) &&
      typeof entry.round === 'number' && Number.isInteger(entry.round) &&
      (entry.playerId === undefined || typeof entry.playerId === 'string'));
}

export function resolveKeepers(value: unknown, players: readonly Player[], teams: number, rounds: number,
  draftType: DraftType = 'snake'): {
  keepers: readonly CanonicalKeeperAssignment[]; status: KeeperStatus;
} {
  const file = isKeeperFile(value) ? value : null;
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
  const supply = canonicalizeKeeperSupply(resolved, { totalTeams: teams, totalRounds: rounds, draftType });
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

export async function loadDraftData(root: string, settings: LeagueSettings, rounds: number,
  marketAdp: readonly MarketAdpPlayer[] = [], draftType: DraftType = 'snake'): Promise<DraftData> {
  const [snapshot, identities, sleeper, environment, keeperFile, survival, policy] = await Promise.all([
    loadJson(root, 'data/fantasypros-snapshot.json'), loadJson(root, 'data/player-identity.json'),
    loadJson(root, 'data/sleeper-adp.json'), loadJson(root, 'data/team-environment.json'),
    loadJson(root, 'data/league-history/current-keepers.json'), loadJson(root, 'data/league-history/survival-model.json'),
    loadJson(root, 'data/recommendation-policy.json'),
  ]);
  if (!isSnapshot(snapshot) || !isPlayerIdentityFile(identities)) {
    throw new CliError('CORE_DATA_INVALID', 'Rankings or canonical player identities are missing or invalid. Run draft readiness --json for corrective actions.', 3,
      { invalidCoreKeys: [...(!isSnapshot(snapshot) ? ['trusted-rankings'] : []), ...(!isPlayerIdentityFile(identities) ? ['canonical-player-identities'] : [])] });
  }
  const sleeperPlayers = isRecord(sleeper) && Array.isArray(sleeper.players) && sleeper.players.every(row =>
    isRecord(row) && typeof row.playerId === 'string' && typeof row.name === 'string' && isPosition(row.position) && isNFLTeam(row.team) &&
    typeof row.sleeperAdp === 'number' && Number.isFinite(row.sleeperAdp))
    ? (sleeper as unknown as SleeperDataFile).players : [];
  const teamEnvironments = isRecord(environment) && isRecord(environment.teams) && Object.values(environment.teams).every(isTeamEnvironment)
    ? environment.teams as Record<NFLTeam, TeamEnvironment> : {} as Record<NFLTeam, TeamEnvironment>;
  const merged = mergeCoreSources({
    rankings: snapshot.rankings, projections: snapshot.projections, news: snapshot.news,
    sleeperPlayers, teamEnvironments, fantasyProsAdp: snapshot.adp, identities: identities.players,
    leagueContext: { marketAdp, scoringRules: settings.scoringRules, totalTeams: settings.totalTeams,
      rosterRequirements: settings.rosterRequirements },
  }, []);
  // The web merge's final fallback uses the changing ECR rank. CLI callers keep
  // IDs between refreshes, so use the source identifier when that join is absent.
  const sourceKey = (row: { name: string; position: Position; team: NFLTeam }) => `${normalizePlayerName(row.name)}:${row.position}:${row.team}`;
  const rankingsByPlayer = new Map(snapshot.rankings.map(row => [sourceKey(row), row]));
  const players = merged.map(player => {
    if (!player.id.startsWith('ecr-')) return player;
    const sourceId = rankingsByPlayer.get(sourceKey(player))?.fantasyProsId;
    if (!sourceId) throw new CliError('CORE_DATA_INVALID', `${player.name} has no stable player identifier. Refresh rankings and player identities.`, 3,
      { invalidCoreKeys: ['canonical-player-identities'] });
    return { ...player, id: `fantasypros:${sourceId}` };
  });
  if (new Set(players.map(player => player.id)).size !== players.length) {
    throw new CliError('CORE_DATA_INVALID', 'Player identifiers are duplicated. Rebuild canonical player identities before using the CLI.', 3,
      { invalidCoreKeys: ['canonical-player-identities'] });
  }
  const keeperResolution = resolveKeepers(keeperFile, players, settings.totalTeams, rounds, draftType);
  return { players, keepers: keeperResolution.keepers, keeperStatus: keeperResolution.status,
    survivalModel: isLeagueSurvivalModel(survival) ? survival : null,
    policy: isRecommendationPolicyFile(policy) ? policy : SAFE_RECOMMENDATION_POLICY };
}
