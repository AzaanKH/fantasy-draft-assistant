import { PositionTag } from '@/components/PositionTag';
import type { Player, Position } from '@fantasy-draft/shared/league';
import type { PositionNeed, Recommendation } from '@fantasy-draft/shared/draft';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import * as React from 'react';
import { type AssistantDraftMode, type UpcomingTeamPicks, NEED_POSITIONS, countTeamsNeeding } from './assistant-context';
import { survivalPercent } from '@fantasy-draft/shared/draft';

/** Ordered, local, draft-specific queue. Each player shows the chance of reaching the next pick. */
export function AssistantQueue({
  queuedPlayerIds,
  playerById,
  recommendationById,
  bestPick,
  nextPickLabel,
  mode,
  provider,
  onMove,
  onRemove,
  onSelect,
}: {
  readonly queuedPlayerIds: readonly string[];
  readonly playerById: ReadonlyMap<string, Player>;
  readonly recommendationById: ReadonlyMap<string, Recommendation>;
  readonly bestPick: Recommendation | null;
  readonly nextPickLabel: string | null;
  readonly mode: AssistantDraftMode;
  readonly provider: DraftProvider | null;
  readonly onMove: (playerId: string, offset: number) => void;
  readonly onRemove: (playerId: string) => void;
  readonly onSelect: (playerId: string) => void;
}): React.ReactElement {
  const firstDiffers = bestPick !== null && queuedPlayerIds.length > 0 && queuedPlayerIds[0] !== bestPick.playerId;

  return (
    <section className="rec-rail-section" aria-labelledby="rec-queue-heading">
      <div className="rec-section-heading">
        <h2 id="rec-queue-heading">Your queue</h2>
        <span className="rec-muted">{String(queuedPlayerIds.length)} {queuedPlayerIds.length === 1 ? 'player' : 'players'}</span>
      </div>
      {firstDiffers ? (
        <p className="rec-rail-note">Your first queued player differs from the Best Pick, <strong className="rec-accent">{bestPick.playerName}</strong>.</p>
      ) : null}
      {queuedPlayerIds.length === 0 ? (
        <p className="rec-rail-note">Empty. Queue players you would take at your next pick.</p>
      ) : (
        <ol className="rec-queue">
          {queuedPlayerIds.map((playerId, index) => {
            const player = playerById.get(playerId);
            const recommendation = recommendationById.get(playerId);
            const survival = recommendation ? survivalPercent(recommendation) : null;
            const name = player?.name ?? recommendation?.playerName ?? 'Unknown player';
            return (
              <li key={playerId}>
                <span className="rec-queue-index">{String(index + 1)}</span>
                <button type="button" className="rec-queue-identity" onClick={() => { onSelect(playerId); }}>
                  <strong>{name}</strong>
                  <span className="rec-meta">
                    {player ? <PositionTag position={player.position} /> : null}
                    <span className={survival !== null && survival < 35 ? 'rec-attention' : undefined}>
                      {survival === null
                        ? 'Timing unavailable'
                        : `${String(survival)}% at ${nextPickLabel ?? 'next pick'}`}
                    </span>
                  </span>
                </button>
                <span className="rec-queue-actions">
                  <button type="button" className="rec-icon-button" aria-label={`Move ${name} up in queue`} disabled={index === 0} onClick={() => { onMove(playerId, -1); }}><ChevronUp aria-hidden="true" /></button>
                  <button type="button" className="rec-icon-button" aria-label={`Move ${name} down in queue`} disabled={index === queuedPlayerIds.length - 1} onClick={() => { onMove(playerId, 1); }}><ChevronDown aria-hidden="true" /></button>
                  <button type="button" className="rec-icon-button" aria-label={`Remove ${name} from queue`} onClick={() => { onRemove(playerId); }}><X aria-hidden="true" /></button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {/* Only a live draft needs the caveat: a provider's autopick reads its own queue, not this one. */}
      {mode === 'companion' || mode === 'manual-continuity' ? (
        <p className="rec-muted rec-rail-help">
          {`Local to this assistant.${provider === 'sleeper' ? ' Sleeper autopick uses your Sleeper queue.' : ''} Queuing does not change recommendations.`}
        </p>
      ) : null}
    </section>
  );
}

/** Teams picking before the manager's next turn, with their open starter positions. Context, not a prediction.
 *
 * Neighbours with the same needs share a row, and position tags appear only where a team's needs are specific, so a
 * tag is a signal: at the start of a draft this is one line, not a column of identical tags.
 */
export function UpcomingPicks({
  teams,
  nextPickLabel,
  viewedPosition,
}: {
  readonly teams: readonly UpcomingTeamPicks[];
  readonly nextPickLabel: string | null;
  readonly viewedPosition: Position | null;
}): React.ReactElement | null {
  if (teams.length === 0) return null;
  const needing = viewedPosition ? countTeamsNeeding(teams, viewedPosition) : 0;
  const groups = groupUpcomingNeeds(teams);

  return (
    <section className="rec-rail-section" aria-labelledby="rec-upcoming-heading">
      <div className="rec-section-heading">
        <h2 id="rec-upcoming-heading">Before your next pick</h2>
        <span className="rec-muted">{String(teams.length)} {teams.length === 1 ? 'team' : 'teams'}</span>
      </div>
      {viewedPosition ? (
        <p className="rec-upcoming-demand">
          {needing > 0
            ? <><strong>{String(needing)} of {String(teams.length)}</strong> still need a starting {viewedPosition}.</>
            : <>None of them needs a starting {viewedPosition}.</>}
        </p>
      ) : null}
      <ul className="rec-upcoming">
        {groups.map((group) => (
          <li key={group.key}>
            <span className="rec-upcoming-team">{group.label}</span>
            <span className="rec-muted">{String(group.picks)} {group.picks === 1 ? 'pick' : 'picks'}</span>
            <span className="rec-need-tags" aria-label={group.openStarters.length > 0 ? `Open starters: ${group.openStarters.join(', ')}` : 'Starters filled'}>
              {group.openStarters.length === 0 ? <span className="rec-muted">Starters set</span>
                : group.openStarters.length === NEED_POSITIONS.length ? <span className="rec-muted">Every spot open</span>
                  : group.openStarters.map((position) => <PositionTag key={position} position={position} />)}
            </span>
          </li>
        ))}
      </ul>
      <p className="rec-muted rec-rail-help" title={`Roster context from recorded picks. It does not change the chance a player is still there at ${nextPickLabel ?? 'your next pick'}.`}>{UPCOMING_NEEDS_NOTE}</p>
    </section>
  );
}

/** Consecutive teams with the same open starters, as one row: eleven identical rows say no more than one. */
export interface UpcomingNeedGroup {
  readonly key: string;
  /** "Team 7", "Teams 2–12" for a run of default names, or "Team 7 +2" when a run includes a provider's own names. */
  readonly label: string;
  readonly teams: number;
  readonly picks: number;
  readonly openStarters: readonly Position[];
}

export function groupUpcomingNeeds(teams: readonly UpcomingTeamPicks[]): readonly UpcomingNeedGroup[] {
  const runs: UpcomingTeamPicks[][] = [];
  for (const team of teams) {
    const run = runs.at(-1);
    if (run?.[0] && run[0].openStarters.join() === team.openStarters.join()) run.push(team);
    else runs.push([team]);
  }
  return runs.flatMap((run) => {
    const [first] = run;
    const last = run.at(-1);
    if (!first || !last) return [];
    const firstSlot = /^Team (\d+)$/.exec(first.teamName)?.[1];
    const lastSlot = /^Team (\d+)$/.exec(last.teamName)?.[1];
    const label = run.length === 1 ? first.teamName
      : firstSlot && lastSlot && run.every((team) => /^Team \d+$/.test(team.teamName)) ? `Teams ${firstSlot}\u2013${lastSlot}`
        : `${first.teamName} +${String(run.length - 1)}`;
    return [{
      key: String(first.teamIndex),
      label,
      teams: run.length,
      picks: run.reduce((sum, team) => sum + team.pickLabels.length, 0),
      openStarters: first.openStarters,
    }];
  });
}

/** Starter slots by position, from the same team needs used by the recommendation policy. */
export function AssistantRoster({
  needs,
  rosterNames,
  rosterSize,
  totalRounds,
}: {
  readonly needs: readonly PositionNeed[];
  readonly rosterNames: Readonly<Partial<Record<Position, readonly string[]>>>;
  readonly rosterSize: number;
  readonly totalRounds: number;
}): React.ReactElement {
  return (
    <section className="rec-rail-section" aria-labelledby="rec-roster-heading">
      <div className="rec-section-heading">
        <h2 id="rec-roster-heading">Your roster</h2>
        <span className="rec-muted">{String(rosterSize)} / {String(totalRounds)}</span>
      </div>
      <ul className="rec-roster">
        {needs.map((need) => {
          const names = rosterNames[need.position] ?? [];
          const open = Math.max(0, need.startersNeeded - need.startersFilled);
          return (
            <li key={need.position}>
              <PositionTag position={need.position} />
              <span className="min-w-0">
                {names.length > 0 ? names.join(', ') : open > 1 ? `${String(open)} starters open` : open === 1 ? 'Starter open' : 'No starter slot'}
                {names.length > 0 && open > 0 ? <span className="rec-muted"> · {String(open)} open</span> : null}
              </span>
              <span className="rec-muted">{String(need.startersFilled)} / {String(need.startersNeeded)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Scrolls the rail into view and moves focus to its first heading, for the summary strip's button. */
function revealRail(): void {
  const heading = document.getElementById('rec-queue-heading');
  heading?.closest<HTMLElement>('.rec-rail')?.scrollIntoView({ block: 'start' });
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

/** At most this many teams are named in the laptop summary; the full list is in the rail. */
const SUMMARY_TEAMS = 3;
/**
 * Characters the compact needs line may use beside the "Queue & roster" button (about 265px of 11px text in the
 * 400px analysis column, the same width at every laptop size). A third team is named only when it fits, so the line
 * never ends partway through a team; the browser gate asserts nothing is clipped.
 */
const SUMMARY_NEEDS_CHARS = 40;
/** Custom team names are shortened to this many characters on the compact line; the full name is in its title. */
const SUMMARY_NAME_CHARS = 9;

/** "T7" for a default "Team 7" name; a provider's own name is kept, shortened. */
function shortTeamName(team: Pick<UpcomingTeamPicks, 'teamName'>): string {
  const slot = /^Team (\d+)$/.exec(team.teamName)?.[1];
  if (slot) return `T${slot}`;
  return team.teamName.length > SUMMARY_NAME_CHARS ? `${team.teamName.slice(0, SUMMARY_NAME_CHARS - 1).trimEnd()}…` : team.teamName;
}

/** "RB·WR", "all open" when every starter is open, or "set" when none is. */
function compactNeeds(team: Pick<UpcomingTeamPicks, 'openStarters'>): string {
  if (team.openStarters.length === 0) return 'set';
  if (team.openStarters.length === NEED_POSITIONS.length) return 'all open';
  return team.openStarters.join('·');
}

/** "Team 7 needs RB and WR", for titles and screen readers. */
function spokenNeeds(team: Pick<UpcomingTeamPicks, 'teamName' | 'openStarters'>): string {
  if (team.openStarters.length === 0) return `${team.teamName} has its starters`;
  if (team.openStarters.length === NEED_POSITIONS.length) return `${team.teamName} has every starter spot open`;
  return `${team.teamName} needs ${team.openStarters.join(', ')}`;
}

export interface UpcomingNeedsSummary {
  /** "T7 RB·WR · T8 QB · T9 all open +19": what the strip shows. */
  readonly compact: string;
  /** The same teams in words, plus how many more pick before you. */
  readonly spoken: string;
}

/**
 * The next two or three teams to pick and what they still need, in a form that fits the laptop strip whole. Teams in
 * a row with the same needs share one entry ("T6–T8 all open"), so the start of a draft still names three teams.
 */
export function describeUpcomingNeeds(teams: readonly UpcomingTeamPicks[]): UpcomingNeedsSummary {
  // The start of a draft: one plain sentence, not "T2–4 all open +8".
  if (teams.length > SUMMARY_TEAMS && teams.every((team) => team.openStarters.length === NEED_POSITIONS.length)) {
    return {
      compact: `all ${String(teams.length)} teams need every position`,
      spoken: `All ${String(teams.length)} teams picking before you have every starter spot open.`,
    };
  }
  const named = teams.slice(0, SUMMARY_TEAMS);
  const groups: { first: UpcomingTeamPicks; last: UpcomingTeamPicks; count: number; needs: string }[] = [];
  for (const team of named) {
    const needs = compactNeeds(team);
    const previous = groups.at(-1);
    const slot = /^Team (\d+)$/.exec(team.teamName)?.[1];
    const previousSlot = previous ? /^Team (\d+)$/.exec(previous.last.teamName)?.[1] : undefined;
    if (previous && previous.needs === needs && slot && previousSlot && Number(slot) === Number(previousSlot) + 1) {
      previous.last = team;
      previous.count += 1;
    } else {
      groups.push({ first: team, last: team, count: 1, needs });
    }
  }
  const entry = (group: (typeof groups)[number]): string => `${shortTeamName(group.first)}${group.count > 1 ? `\u2013${shortTeamName(group.last).slice(1)}` : ''} ${group.needs}`;
  const line = (groupCount: number): { readonly text: string; readonly teams: number } => {
    const shown = groups.slice(0, groupCount).reduce((sum, group) => sum + group.count, 0);
    const rest = teams.length - shown;
    return { text: groups.slice(0, groupCount).map(entry).join(' · ') + (rest > 0 ? ` +${String(rest)}` : ''), teams: shown };
  };
  let groupCount = groups.length;
  while (groupCount > 1 && line(groupCount).text.length > SUMMARY_NEEDS_CHARS && line(groupCount - 1).teams >= Math.min(2, teams.length)) groupCount -= 1;
  const { text, teams: shown } = line(groupCount);
  const rest = teams.length - shown;
  return {
    compact: text,
    spoken: `${teams.slice(0, shown).map(spokenNeeds).join('. ')}.${rest > 0 ? ` ${String(rest)} more ${rest === 1 ? 'team picks' : 'teams pick'} before you.` : ''}`,
  };
}

/** The strip's own reminder that opponents' needs are roster context, not part of the availability estimate. */
export const UPCOMING_NEEDS_NOTE = 'Context only; not used in the % estimates.';

/**
 * The two lines above the analysis on laptop widths, where the queue and roster sit below the cards instead of beside
 * the analysis: who picks before you and what they still need, then a note that this is context and not an input to
 * the % estimate. The next turn itself is in the bar at the top of the page, and is not repeated here; the queue count
 * rides on the button that opens the queue. Wide screens hide the strip, because the rail itself is beside the
 * analysis there. Its height is fixed so the analysis can be sized around it.
 */
export function AssistantRailSummary({ nextPickLabel, queueCount, upcomingTeams = [] }: {
  /** Undefined while loading; null when the manager has no later pick. */
  readonly nextPickLabel: string | null | undefined;
  readonly queueCount: number | undefined;
  /** Teams picking before the manager's next turn, in pick order. */
  readonly upcomingTeams?: readonly UpcomingTeamPicks[];
}): React.ReactElement {
  const loading = nextPickLabel === undefined;
  const needs = nextPickLabel && upcomingTeams.length > 0 ? describeUpcomingNeeds(upcomingTeams) : null;
  return (
    <div className="rec-side-summary" data-rail-summary="" data-has-needs={needs ? '' : undefined}>
      {loading ? (
        <span className="rec-side-summary-line" aria-hidden="true"><span className="rec-side-summary-placeholder" /></span>
      ) : needs ? (
        <>
          <span className="rec-side-summary-line rec-side-summary-needs" data-upcoming-needs="" title={needs.spoken}>
            <span aria-hidden="true"><span className="rec-muted">Before you: </span>{needs.compact}</span>
            <span className="sr-only">Before your pick: {needs.spoken}</span>
          </span>
          <span className="rec-side-summary-line rec-side-summary-note rec-muted" data-upcoming-note="">{UPCOMING_NEEDS_NOTE}</span>
        </>
      ) : (
        <span className="rec-side-summary-line rec-muted">{nextPickLabel === null ? 'No later pick' : 'Nobody picks between your turns.'}</span>
      )}
      <button type="button" className="rec-text-button" disabled={loading} onClick={revealRail}>
        Queue{loading ? '' : ` (${String(queueCount ?? 0)})`} &amp; roster <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
