import {
  createDefaultLeagueSettings, createLeagueSettings, createEmptyRoster, POSITIONS, type DraftSyncSnapshot,
  type DraftReadinessReport, type LeagueSettings, type Player, type Roster,
} from '@fantasy-draft/shared';
import { resolveDraftPickImports, getNextOpenPickNumber } from '@/lib/draft-pick-imports';
import { getEffectiveKeeperAssignments, isKeeperSupplyComplete } from '@/lib/keeper-supply';
import { getTeamIndexForPick } from '@/lib/mock-draft-engine';
import { evaluateWorkspaceDraftReadiness } from '@/lib/draft-readiness';
import { applyLeagueSurvivalModel, filterDrafted, calculateTeamNeeds, calculateAllScarcityScores,
  getRecommendations, type RecommendationContext } from '@/lib/calculations';
import type { DraftData } from './data';
import { CliError } from './errors';

export function connectedSettings(snapshot: DraftSyncSnapshot, now: number): LeagueSettings {
  return snapshot.draft?.leagueSettings ?? createLeagueSettings({ ...createDefaultLeagueSettings(now),
    totalTeams: snapshot.draft?.settings.teams ?? 10 }, now);
}

export function replaceCoreReadiness(base: DraftReadinessReport,
  replacements: readonly DraftReadinessReport['coreDraftData'][number][]): DraftReadinessReport {
  const byKey = new Map(replacements.map(item => [item.key, item]));
  const coreDraftData = base.coreDraftData.map(item => byKey.get(item.key) ?? item);
  const productBlockingFailures = coreDraftData.filter(item => item.status === 'blocking');
  return { ...base, coreDraftData, productBlockingFailures,
    status: productBlockingFailures.length > 0 ? 'blocked' : 'ready',
    summary: { ...base.summary, productBlockingFailures: productBlockingFailures.length } };
}

export function withLocalKeeperReadiness(base: DraftReadinessReport, data: DraftData, now: number): DraftReadinessReport {
  const evaluated = evaluateWorkspaceDraftReadiness({ sources: {}, warnings: [],
    leagueSettings: createDefaultLeagueSettings(now), totalRounds: 14, keeperStatus: data.keeperStatus }, now);
  return replaceCoreReadiness(base, evaluated.coreDraftData.filter(item => item.key === 'confirmed-keeper-supply'));
}

/** Preserve the evaluator's source/dependency failures when replacing connected confirmations. */
export function withConnectedReadiness(base: DraftReadinessReport, snapshot: DraftSyncSnapshot,
  data: DraftData, now: number): DraftReadinessReport {
  const connected = evaluateWorkspaceDraftReadiness({
    sources: {}, warnings: [], leagueSettings: connectedSettings(snapshot, now),
    totalRounds: snapshot.draft?.settings.rounds ?? 0, keeperStatus: data.keeperStatus,
  }, now);
  return replaceCoreReadiness(base, connected.coreDraftData.filter(item =>
    item.key === 'primary-league-settings' || item.key === 'confirmed-keeper-supply'));
}

export function createSessionContext(snapshot: DraftSyncSnapshot, data: DraftData | null,
  slot: number | undefined, now: number) {
  const draft = snapshot.draft;
  if (slot !== undefined && draft && slot > draft.settings.teams) {
    throw new CliError('INVALID_ARGUMENT', `--slot must be between 1 and ${String(draft.settings.teams)} for this draft.`, 2);
  }
  const totalTeams = draft?.settings.teams ?? 0;
  const totalRounds = draft?.settings.rounds ?? 0;
  const totalPicks = totalTeams * totalRounds;
  const settings = connectedSettings(snapshot, now);
  const imports = resolveDraftPickImports(snapshot.picks, data?.players ?? [], slot ?? 0);
  const keeperSupplyReady = data !== null && settings.keepersEnabled !== false && isKeeperSupplyComplete({
    keepersEnabled: settings.keepersEnabled, season: data.keeperStatus.season,
    expectedSeason: new Date(now).getUTCFullYear(), isConfirmed: data.keeperStatus.isConfirmed,
    configuredCount: data.keeperStatus.configuredCount, expectedCount: totalTeams,
    resolvedCount: data.keeperStatus.resolvedCount, canonicalCount: data.keeperStatus.canonicalCount,
    unresolvedNames: data.keeperStatus.unresolvedNames, duplicateNames: data.keeperStatus.duplicateNames,
    invalidAssignments: data.keeperStatus.invalidAssignments,
  });
  const effectiveKeepers = getEffectiveKeeperAssignments(keeperSupplyReady ? data.keepers : [], imports.picks, totalTeams, draft?.type);
  const filled = new Set([...snapshot.picks, ...effectiveKeepers].map(pick => pick.pickNumber));
  const currentPick = draft ? draft.status === 'complete' ? totalPicks + 1
    : getNextOpenPickNumber([...snapshot.picks, ...effectiveKeepers], totalPicks) : null;
  const teamAtPick = (pick: number): number => draft?.type === 'linear'
    ? (pick - 1) % totalTeams : getTeamIndexForPick(pick, totalTeams);
  let nextTurn: number | null = null;
  if (slot !== undefined && currentPick !== null && draft?.type !== 'auction') {
    for (let pick = currentPick; pick <= totalPicks; pick += 1) {
      if (!filled.has(pick) && teamAtPick(pick) === slot - 1) { nextTurn = pick; break; }
    }
  }
  const isMyTurn = nextTurn !== null && nextTurn === currentPick;
  const draftedIds = new Set([...imports.picks, ...effectiveKeepers].map(pick => pick.playerId));
  const roster = createEmptyRoster() as { [P in keyof Roster]: string[] };
  for (const pick of [...imports.picks, ...effectiveKeepers]) {
    if (slot !== undefined && pick.teamIndex === slot - 1 && !roster[pick.position].includes(pick.playerId)) {
      roster[pick.position].push(pick.playerId);
    }
  }
  const availablePlayers = filterDrafted([...(data?.players ?? [])], draftedIds, [...imports.picks, ...effectiveKeepers]);
  const ageMs = snapshot.lastSuccessfulSyncAt === null ? null : Math.max(0, now - snapshot.lastSuccessfulSyncAt);
  const syncHealth = snapshot.status === 'error' ? 'error' : ageMs === null ? 'disconnected'
    : ageMs > 15_000 && draft?.status !== 'complete' ? 'stale' : 'healthy';
  return { snapshot, settings, totalTeams, totalRounds, totalPicks, currentPick,
    onTheClockSlot: currentPick !== null && currentPick <= totalPicks && draft?.type !== 'auction'
      ? teamAtPick(currentPick) + 1 : null,
    slot: slot ?? null, nextTurn, isMyTurn, roster, draftedIds, availablePlayers,
    unresolvedPicks: data ? imports.rejectedPicks : [],
    sync: { health: syncHealth, state: snapshot.status, lastPolledAt: snapshot.lastPolledAt,
      lastSuccessfulSyncAt: snapshot.lastSuccessfulSyncAt, ageMs, lastError: snapshot.lastError },
    keeperReservations: effectiveKeepers,
  };
}

export type SessionContext = ReturnType<typeof createSessionContext>;

export function requireAdvice(context: SessionContext, readiness: DraftReadinessReport): void {
  if (context.slot === null) throw new CliError('SLOT_REQUIRED', 'Set --slot NUMBER or DRAFT_SLOT to calculate advice for your roster.', 2);
  if (readiness.status === 'blocked') throw new CliError('READINESS_BLOCKED', 'Core Draft Data is blocked. Review the readiness details before using advice.', 3, { readiness });
  if (context.unresolvedPicks.length > 0) throw new CliError('PLAYER_IDENTITY_UNRESOLVED', 'Provider picks could not resolve to canonical players. Refresh player identities before using advice.', 3,
    { unresolvedPicks: context.unresolvedPicks });
  if (context.snapshot.draft?.type !== 'snake') throw new CliError('UNSUPPORTED_DRAFT_TYPE', 'Advice currently supports snake drafts. Status and player search support other draft types.');
  if (context.sync.health !== 'healthy') throw new CliError('SYNC_UNHEALTHY', 'The provider snapshot is unavailable or stale. Restore draft sync before using advice.', 3, { sync: context.sync });
}

export function adviceBoard(context: SessionContext, data: DraftData) {
  const currentPick = context.currentPick ?? 1;
  const players = applyLeagueSurvivalModel(data.players, data.survivalModel, {
    currentPick, myPickPosition: context.slot ?? 1, totalTeams: context.totalTeams, totalRounds: context.totalRounds,
    occupiedPickNumbers: new Set([...context.snapshot.picks, ...context.keeperReservations].map(pick => pick.pickNumber)),
  });
  const available = filterDrafted(players, context.draftedIds);
  const scarcity = calculateAllScarcityScores(context.availablePlayers);
  const needs = calculateTeamNeeds(context.roster, context.settings.rosterRequirements, scarcity, {
    currentPick, totalPicks: context.totalPicks, totalRounds: context.totalRounds,
  });
  const byId = new Map(players.map(player => [player.id, player]));
  const rosterPlayers: Player[] = POSITIONS.flatMap(position => context.roster[position].flatMap(id => {
    const player = byId.get(id); return player ? [player] : [];
  }));
  const selectionsRemaining = Math.max(0, context.totalRounds - rosterPlayers.length);
  const recommendationContext: RecommendationContext = {
    currentPick, totalPicks: context.totalPicks, totalTeams: context.totalTeams, isMyTurn: context.isMyTurn,
    architecture: 'best-pick-policy', requirements: context.settings.rosterRequirements,
    rosterPlayers, selectionsRemaining,
    rosterCounts: Object.fromEntries(POSITIONS.map(position => [position, context.roster[position].length])),
    allowPickEvOverrides: data.policy.pickEvOverrideEnabled, pickEvOverrideThreshold: data.policy.pickEvOverrideThreshold,
  };
  const hasDecision = currentPick <= context.totalPicks && selectionsRemaining > 0;
  const recommendations = getRecommendations(hasDecision ? available : [], needs, Math.max(1, available.length), recommendationContext);
  return { recommendations, needs, selectionsRemaining, hasDecision };
}
