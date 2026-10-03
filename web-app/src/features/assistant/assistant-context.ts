import type { DraftPick, DraftProvider, DraftType, Player, Position, RosterRequirements } from '@fantasy-draft/shared';
import { formatDraftSyncAge, type DraftSynchronizationState } from '@/lib/draft-sync-state';
import { formatRoundPick, getTeamIndexForDraftPick } from '@/lib/mock-draft-engine';

/** Starter positions shown as team needs; K and DEF are late-round context, not planning signals. */
const NEED_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const satisfies readonly Position[];

type TeamRoster = Readonly<Record<Position, readonly string[]>>;

export interface UpcomingTeamPicks {
  readonly teamIndex: number;
  readonly teamName: string;
  readonly pickLabels: readonly string[];
  readonly openStarters: readonly Position[];
}

export interface PickWindow {
  /** The pick currently on the clock. */
  readonly currentPick: number;
  /** Whether the manager owns the current pick. */
  readonly onClock: boolean;
  /** The manager's selection that bounds Return Probability: the following pick when on the clock, otherwise the upcoming one. */
  readonly nextPick: number | null;
  /** Other teams' picks before that selection. */
  readonly picksBetween: readonly number[];
}

function findTeamPick(
  start: number,
  totalPicks: number,
  teamIndex: number,
  totalTeams: number,
  draftType: DraftType
): number | null {
  for (let pick = start; pick <= totalPicks; pick += 1) {
    if (getTeamIndexForDraftPick(pick, totalTeams, draftType) === teamIndex) return pick;
  }
  return null;
}

/**
 * Matches the recommendation engine's Next-Pick Horizon: on the clock, the horizon is the manager's
 * following pick; otherwise it is their upcoming pick.
 */
export function getPickWindow(
  currentPick: number,
  totalTeams: number,
  totalRounds: number,
  myPickPosition: number,
  draftType: DraftType
): PickWindow {
  const totalPicks = totalTeams * totalRounds;
  const myTeamIndex = myPickPosition - 1;
  const onClock = currentPick <= totalPicks &&
    getTeamIndexForDraftPick(currentPick, totalTeams, draftType) === myTeamIndex;
  const nextPick = findTeamPick(onClock ? currentPick + 1 : currentPick, totalPicks, myTeamIndex, totalTeams, draftType);
  const end = nextPick ?? totalPicks + 1;
  const picksBetween: number[] = [];
  for (let pick = onClock ? currentPick + 1 : currentPick; pick < end; pick += 1) picksBetween.push(pick);
  return { currentPick, onClock, nextPick, picksBetween };
}

function getOpenStarters(roster: TeamRoster | undefined, requirements: RosterRequirements): Position[] {
  return NEED_POSITIONS.filter((position) => (roster?.[position].length ?? 0) < requirements[position].starters);
}

/** Groups the picks before the manager's next turn by team, with each team's open starter positions. */
export function getUpcomingTeamPicks({
  picks,
  totalTeams,
  draftType,
  teamRosters,
  rosterRequirements,
  draftHistory,
}: {
  readonly picks: readonly number[];
  readonly totalTeams: number;
  readonly draftType: DraftType;
  readonly teamRosters: readonly TeamRoster[];
  readonly rosterRequirements: RosterRequirements;
  readonly draftHistory: readonly Pick<DraftPick, 'teamIndex' | 'teamName'>[];
}): readonly UpcomingTeamPicks[] {
  const teamNames = new Map<number, string>();
  draftHistory.forEach((pick) => {
    if (pick.teamName && pick.teamName !== 'My Team') teamNames.set(pick.teamIndex, pick.teamName);
  });
  const byTeam = new Map<number, UpcomingTeamPicks>();
  picks.forEach((pick) => {
    const teamIndex = getTeamIndexForDraftPick(pick, totalTeams, draftType);
    const existing = byTeam.get(teamIndex);
    const label = formatRoundPick(pick, totalTeams);
    byTeam.set(teamIndex, existing
      ? { ...existing, pickLabels: [...existing.pickLabels, label] }
      : {
          teamIndex,
          teamName: teamNames.get(teamIndex) ?? `Team ${String(teamIndex + 1)}`,
          pickLabels: [label],
          openStarters: getOpenStarters(teamRosters[teamIndex], rosterRequirements),
        });
  });
  return [...byTeam.values()];
}

export function countTeamsNeeding(teams: readonly UpcomingTeamPicks[], position: Position): number {
  return teams.filter((team) => team.openStarters.includes(position)).length;
}

/** Picks past consensus ADP before a falling-player chip is shown. Display-only; not a policy input. */
export const ADP_ALERT_THRESHOLD = 3;
/** A position run is this many of the most recent picks at one position. Display-only. */
export const RUN_ALERT_MINIMUM = 3;
export const RUN_ALERT_WINDOW = 5;

/**
 * Optional, text-labelled signals for a candidate. Each is omitted when its data is unavailable;
 * none of them changes the recommendation order.
 */
export function getAlertSignals({
  player,
  rosteredPlayers,
  recentPicks,
  currentPick,
}: {
  readonly player: Pick<Player, 'id' | 'position' | 'byeWeek' | 'consensusAdp'> | undefined;
  readonly rosteredPlayers: readonly Pick<Player, 'id' | 'name' | 'position' | 'byeWeek'>[];
  readonly recentPicks: readonly Pick<DraftPick, 'position'>[];
  readonly currentPick: number;
}): readonly string[] {
  if (!player) return [];
  const signals: string[] = [];
  const sameBye = rosteredPlayers.find((rostered) =>
    rostered.id !== player.id &&
    rostered.position === player.position &&
    player.byeWeek > 0 &&
    rostered.byeWeek === player.byeWeek
  );
  if (sameBye) signals.push(`Bye ${String(player.byeWeek)} · same as ${sameBye.name}`);

  const adp = player.consensusAdp;
  if (typeof adp === 'number' && adp > 0) {
    const picksPast = Math.round(currentPick - adp);
    if (picksPast >= ADP_ALERT_THRESHOLD) signals.push(`${String(picksPast)} picks past ADP`);
  }

  const window = recentPicks.slice(-RUN_ALERT_WINDOW);
  const run = window.filter((pick) => pick.position === player.position).length;
  if (run >= RUN_ALERT_MINIMUM) signals.push(`${player.position} run · ${String(run)} of last ${String(window.length)} picks`);
  return signals;
}

/**
 * How the manager is drafting, which decides the main action.
 * Companion advises beside the provider draft room and never submits provider picks.
 */
export type AssistantDraftMode = 'companion' | 'manual-continuity' | 'mock' | 'preview';

export function getAssistantDraftMode(
  sessionMode: 'setup' | 'mock' | 'live',
  synchronizationState: DraftSynchronizationState
): AssistantDraftMode {
  if (sessionMode === 'mock') return 'mock';
  if (sessionMode === 'setup') return 'preview';
  return synchronizationState === 'manual-continuity' ? 'manual-continuity' : 'companion';
}

export type SyncTone = 'ok' | 'pending' | 'local' | 'warn' | 'lost';

const PROVIDER_NAMES: Readonly<Record<DraftProvider, string>> = { sleeper: 'Sleeper', yahoo: 'Yahoo', espn: 'ESPN' };

/** Sync freshness for the context bar. Every recommendation is stale when this falls behind. */
export function getSyncStatus({
  mode,
  provider,
  synchronizationState,
  lastConfirmedPickNumber,
  lastSyncAgeMs,
  totalTeams,
}: {
  readonly mode: AssistantDraftMode;
  readonly provider: DraftProvider | null;
  readonly synchronizationState: DraftSynchronizationState;
  readonly lastConfirmedPickNumber: number;
  readonly lastSyncAgeMs: number | null;
  readonly totalTeams: number;
}): { readonly tone: SyncTone; readonly label: string } {
  if (mode === 'mock') return { tone: 'local', label: 'Local mock · no provider sync' };
  if (mode === 'preview') return { tone: 'local', label: 'Preview · no draft connected' };
  const name = provider ? PROVIDER_NAMES[provider] : 'Provider';
  if (mode === 'manual-continuity') return { tone: 'lost', label: `${name} sync unavailable · picks are provisional` };
  const age = formatDraftSyncAge(lastSyncAgeMs);
  const lastPick = lastConfirmedPickNumber > 0
    ? ` · last pick ${formatRoundPick(lastConfirmedPickNumber, totalTeams)}`
    : '';
  if (synchronizationState === 'reconciling') return { tone: 'pending', label: `Syncing latest ${name} picks` };
  if (synchronizationState === 'delayed') return { tone: 'warn', label: `${name} delayed · last sync ${age}` };
  if (synchronizationState === 'disconnected') return { tone: 'lost', label: `${name} disconnected` };
  if (synchronizationState === 'complete') return { tone: 'ok', label: `${name} draft complete` };
  return { tone: 'ok', label: `Synced with ${name}${lastPick} · ${age}` };
}
