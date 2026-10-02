import { POSITIONS } from '@fantasy-draft/shared';
import { calculateAllScarcityScores, calculateTeamNeeds } from '@/lib/calculations';
import { resolveDraftPickImports } from '@/lib/draft-pick-imports';
import type { DraftData } from './data';
import type { SessionContext } from './context';
import { CliError } from './errors';

export function inspectRoster(context: SessionContext, data: DraftData) {
  if (context.slot === null) throw new CliError('SLOT_REQUIRED', 'Set --slot NUMBER or DRAFT_SLOT, or connect with --slot to inspect your roster.', 2);
  const players = new Map(data.players.map(player => [player.id, player]));
  const imports = resolveDraftPickImports(context.snapshot.picks, data.players, context.slot).picks;
  const teamIndex = context.slot - 1;
  const confirmed = new Map(imports.filter(pick => pick.teamIndex === teamIndex).map(pick => [pick.playerId, pick]));
  const reservations = new Map(context.keeperReservations.filter(keeper => keeper.teamIndex === teamIndex).map(keeper => [keeper.playerId, keeper]));
  const entries = POSITIONS.flatMap(position => context.roster[position].flatMap(id => {
    const player = players.get(id);
    // Skip IDs missing from the local player pool instead of crashing the command.
    if (!player) return [];
    const pick = confirmed.get(id);
    const keeper = reservations.get(id);
    const providerPick = pick ? context.snapshot.picks.find(entry => entry.pickNumber === pick.pickNumber) : undefined;
    return { playerId: id, playerName: player.name, position, team: player.team,
      projectedPoints: player.projectedPoints, valueOverReplacement: player.valueOverReplacement,
      pickNumber: pick?.pickNumber ?? keeper?.pickNumber ?? null,
      isKeeper: providerPick?.isKeeper === true || keeper !== undefined,
      source: pick ? 'provider' : 'keeper-reservation' };
  })).sort((left, right) => (left.pickNumber ?? Infinity) - (right.pickNumber ?? Infinity));
  const needs = calculateTeamNeeds(context.roster, context.settings.rosterRequirements,
    calculateAllScarcityScores(context.availablePlayers), {
      currentPick: context.currentPick ?? 1, totalPicks: context.totalPicks, totalRounds: context.totalRounds,
    });
  return { slot: context.slot, roster: context.roster, players: entries, needs,
    rosterSize: entries.length, confirmedCount: entries.filter(entry => entry.source === 'provider').length,
    keeperReservationCount: entries.filter(entry => entry.source === 'keeper-reservation').length,
    selectionsRemaining: Math.max(0, context.totalRounds - entries.length),
    requirements: context.settings.rosterRequirements, settingsFingerprint: context.settings.fingerprint,
    unresolvedPicks: context.unresolvedPicks.filter(pick => context.snapshot.picks.some(entry =>
      entry.pickNumber === pick.pickNumber && entry.draftSlot === context.slot)) };
}
