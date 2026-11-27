import * as React from 'react';
import type { DraftDecisionView, Recommendation } from '@fantasy-draft/shared/draft';
import { POSITIONS, type Player, type Position } from '@fantasy-draft/shared/league';
import { PositionTag } from '@/components/PositionTag';
import { cn } from '@/lib/utils';
import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import {
  buildByeStrip,
  byeWindow,
  computeLeagueRanks,
  ordinal,
  previewCandidate,
  rankOffset,
  shortName,
  type CandidatePreview,
  type LeagueRanks,
  type LineupSlot,
} from './roster-needs';
import './roster-needs.css';

const CANDIDATE_COUNT = 5;
const NO_PLAYERS: readonly Player[] = [];
const POINTS_HELP = 'Projected season points of your best starting lineup in your league’s scoring.';

const formatPoints = (points: number): string => Math.round(points).toLocaleString('en-US');

/** The top recommendations for this lens, always including the viewed player. */
function pickCandidates(recommendations: readonly Recommendation[], subjectId: string): readonly Recommendation[] {
  const top = recommendations.slice(0, CANDIDATE_COUNT);
  if (top.some((item) => item.playerId === subjectId)) return top;
  const subject = recommendations.find((item) => item.playerId === subjectId);
  return subject ? [...top.slice(0, CANDIDATE_COUNT - 1), subject] : top;
}

function Slot({ slot, isNew }: { readonly slot: LineupSlot<Player>; readonly isNew: boolean }): React.ReactElement {
  return (
    <li
      className={cn('roster-slot', !slot.player && 'roster-slot-empty', isNew && 'roster-slot-new')}
      data-slot={slot.key}
      data-preview={isNew ? '' : undefined}
      title={slot.player ? `${slot.label}: ${slot.player.name}` : undefined}
    >
      <span className="roster-slot-label">{slot.label}</span>
      {slot.player ? (
        // Full name when the slot is wide, "K. Williams" when it is tight; screen readers always get the full name.
        <span className="roster-slot-name">
          {isNew ? <span aria-hidden="true">+ </span> : null}
          <span className="roster-slot-full" aria-hidden="true">{slot.player.name}</span>
          <span className="roster-slot-short" aria-hidden="true">{shortName(slot.player.name, slot.player.position)}</span>
          <span className="sr-only">{slot.player.name}</span>
        </span>
      ) : <span className="roster-slot-name">Open</span>}
      {slot.player ? <span className="roster-slot-points">{formatPoints(slot.player.projectedPoints)}</span> : null}
      {isNew ? <span className="sr-only"> (this pick)</span> : null}
    </li>
  );
}

function Lineup({ preview, candidateId }: { readonly preview: CandidatePreview<Player>; readonly candidateId: string }): React.ReactElement {
  const benchIsNew = preview.slotKey === null;
  return (
    <section className="roster-block" aria-labelledby="roster-lineup-title">
      <h3 id="roster-lineup-title" className="roster-block-title">Lineup</h3>
      <ul className="roster-slots">
        {preview.after.slots.map((slot) => <Slot key={slot.key} slot={slot} isNew={slot.key === preview.slotKey} />)}
      </ul>
      {preview.after.bench.length > 0 ? (
        <>
          <h4 className="roster-bench-title">Bench</h4>
          <ul className="roster-slots">
            {preview.after.bench.map((player) => (
              <Slot key={player.id} slot={{ key: `BN-${player.id}`, label: 'BN', group: player.position, player }} isNew={benchIsNew && player.id === candidateId} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function RankChange({ now, after }: { readonly now: number; readonly after: number }): React.ReactElement {
  if (now === after) return <>{ordinal(now)}</>;
  const up = after < now;
  return (
    <>
      {ordinal(now)} <span aria-hidden="true">→</span><span className="sr-only">to</span> <b>{ordinal(after)}</b>{' '}
      <span className={up ? 'roster-rank-up' : 'roster-rank-down'}>
        <span aria-hidden="true">{up ? '▲' : '▼'}</span>
        <span className="sr-only">{up ? 'up' : 'down'}</span>
        {String(Math.abs(now - after))}
      </span>
    </>
  );
}

function teamLabel(teamIndex: number, isMine: boolean, names: ReadonlyMap<number, string>): string {
  if (isMine) return 'You';
  return names.get(teamIndex) ?? `Team ${String(teamIndex + 1)}`;
}

/**
 * One track per position: a hollow dot where you rank now and a filled dot where this pick moves you. The rows keep
 * their keys across candidates and only their transforms change, so the dots glide instead of re-rendering.
 */
function Ladders({ ranks, candidateName, teamNames }: { readonly ranks: LeagueRanks; readonly candidateName: string; readonly teamNames: ReadonlyMap<number, string> }): React.ReactElement {
  const { teamCount } = ranks;
  return (
    <>
      <ul className="roster-ladders">
        {ranks.ladders.map(({ position, now, after }) => {
          const start = rankOffset(Math.min(now, after), teamCount);
          const span = rankOffset(Math.max(now, after), teamCount) - start;
          return (
            <li key={position} className="roster-ladder" data-ladder={position} aria-label={`${position}: ${ordinal(now)} of ${String(teamCount)} now${now === after ? '' : `, ${ordinal(after)} with ${candidateName}`}`}>
              <PositionTag position={position} />
              <span className="roster-track" aria-hidden="true">
                {Array.from({ length: teamCount }, (_, index) => (
                  <span key={index} className="roster-tick" style={{ left: `${String(rankOffset(index + 1, teamCount))}%` }} />
                ))}
                <span className="roster-gain" style={{ transform: `translateX(${String(start)}%) scaleX(${String(span / 100)})` }} />
                <span className="roster-dot-rail" data-dot="now" data-hidden={now === after ? '' : undefined} style={{ transform: `translateX(${String(rankOffset(now, teamCount))}%)` }}><span className="roster-dot roster-dot-now" /></span>
                <span className="roster-dot-rail" data-dot="after" style={{ transform: `translateX(${String(rankOffset(after, teamCount))}%)` }}><span className="roster-dot roster-dot-after" /></span>
              </span>
              <span className="roster-rank" aria-hidden="true"><RankChange now={now} after={after} /></span>
            </li>
          );
        })}
      </ul>
      <div className="roster-ladder-ends" aria-hidden="true"><span>1st</span><span>{ordinal(teamCount)}</span></div>
      <details className="roster-all-teams">
        <summary>See all {String(teamCount)} teams</summary>
        <div className="roster-table-scroll">
          <table className="roster-table">
            <caption className="sr-only">Projected starter points by position for every team</caption>
            <thead>
              <tr>
                <th scope="col">Team</th>
                {ranks.ladders.map(({ position }) => <th key={position} scope="col">{position}</th>)}
              </tr>
            </thead>
            <tbody>
              {ranks.teams.map((team) => (
                <tr key={team.teamIndex} data-mine={team.isMine ? '' : undefined}>
                  <th scope="row">{teamLabel(team.teamIndex, team.isMine, teamNames)}</th>
                  {ranks.ladders.map(({ position }) => {
                    const now = team.points[position] ?? 0;
                    const after = team.isMine ? ranks.myPointsAfter[position] ?? now : now;
                    return (
                      <td key={position}>
                        {Math.round(after) === Math.round(now) ? formatPoints(now) : <>{formatPoints(now)} <span aria-hidden="true">→</span><span className="sr-only">to</span> <b>{formatPoints(after)}</b></>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function ByeStripView({ preview, candidate, range }: {
  readonly preview: CandidatePreview<Player>;
  readonly candidate: Player;
  readonly range: { readonly first: number; readonly last: number };
}): React.ReactElement {
  const starters = preview.after.slots.flatMap((slot) => (slot.player ? [slot.player] : []));
  // A benched candidate still has a bye worth seeing against the starters.
  const strip = buildByeStrip(preview.slotKey === null ? [...starters, candidate] : starters, candidate, range);
  return (
    <section className="roster-block" aria-labelledby="roster-bye-title">
      <h3 id="roster-bye-title" className="roster-block-title">Byes</h3>
      <ol className="roster-byes" style={{ '--bye-weeks': String(strip.weeks.length) } as React.CSSProperties}>
        {strip.weeks.map(({ week, out }) => (
          <li
            key={week}
            className={cn('roster-bye', out.length === 1 && 'roster-bye-one', out.length > 1 && 'roster-bye-clash')}
            data-candidate-week={week === strip.candidateWeek ? '' : undefined}
            title={out.length > 0 ? out.map((player) => player.name).join(', ') : undefined}
          >
            <span className="roster-bye-week">W{String(week)}</span>
            <span>{out.length > 0 ? String(out.length) : '·'}</span>
            <span className="sr-only">{` starter${out.length === 1 ? '' : 's'} out`}</span>
          </li>
        ))}
      </ol>
      {strip.candidateWeek === null ? null : (
        <p className={cn('roster-bye-note', strip.clashWith.length > 0 ? 'roster-bye-note-clash' : 'roster-bye-note-ok')} data-bye-note="">
          {strip.clashWith.length > 0
            ? `Week ${String(strip.candidateWeek)} bye, same as ${strip.clashWith.map((player) => player.name).join(', ')}`
            : `Week ${String(strip.candidateWeek)} bye, no starter clash`}
        </p>
      )}
    </section>
  );
}

export function RosterNeeds({ recommendation, decision, playerById, onViewPlayer }: {
  readonly recommendation: Recommendation;
  readonly decision: DraftDecisionView;
  readonly playerById: ReadonlyMap<string, Player>;
  readonly onViewPlayer: (playerId: string) => void;
}): React.ReactElement {
  const requirements = useDraftState((state) => state.config.rosterRequirements);
  const myTeamIndex = useDraftState((state) => state.config.myPickPosition - 1);
  const draftHistory = useDraftState((state) => state.draftHistory);
  const teamRosters = useDraftView((view) => view.teamRosters);

  const rosters = React.useMemo(
    () => teamRosters.map((roster) => POSITIONS.flatMap((position: Position) => roster[position]).flatMap((id) => {
      const player = playerById.get(id);
      return player ? [player] : [];
    })),
    [playerById, teamRosters]
  );
  const teamNames = React.useMemo(() => {
    const names = new Map<number, string>();
    for (const pick of draftHistory) if (pick.teamName) names.set(pick.teamIndex, pick.teamName);
    return names;
  }, [draftHistory]);
  const byeRange = React.useMemo(() => byeWindow(playerById.values()), [playerById]);
  const myRoster = rosters[myTeamIndex] ?? NO_PLAYERS;
  const candidate = playerById.get(recommendation.playerId);

  const candidates = React.useMemo(
    () => pickCandidates(decision.recommendations, recommendation.playerId).flatMap((item) => {
      const player = playerById.get(item.playerId);
      return player ? [{ player, gain: previewCandidate(myRoster, player, requirements).gain }] : [];
    }),
    [decision.recommendations, myRoster, playerById, recommendation.playerId, requirements]
  );
  const preview = React.useMemo(() => (candidate ? previewCandidate(myRoster, candidate, requirements) : null), [candidate, myRoster, requirements]);
  const ranks = React.useMemo(
    () => computeLeagueRanks({ teamRosters: rosters, myTeamIndex, candidate: candidate ?? null, requirements }),
    [candidate, myTeamIndex, requirements, rosters]
  );

  if (!candidate || !preview) {
    return <p role="status" className="rec-answer-footnote">No projection for {recommendation.playerName}, so there&apos;s no lineup preview.</p>;
  }

  return (
    <div className="roster-needs" data-roster-needs="">
      <div className="roster-head">
        <div className="roster-total" title={POINTS_HELP}>
          <span className="roster-total-label">Starter pts</span>
          <span className="roster-total-value" data-starter-points="">
            {formatPoints(preview.before.points)} <span aria-hidden="true">→</span><span className="sr-only">to</span> <b>{formatPoints(preview.after.points)}</b>
          </span>
        </div>
        <div className="roster-candidates" role="group" aria-label="Candidates">
          {candidates.map(({ player, gain }) => (
            <button
              key={player.id}
              type="button"
              className="roster-candidate"
              aria-pressed={player.id === candidate.id}
              data-candidate={player.id}
              onClick={() => { onViewPlayer(player.id); }}
            >
              <b>{player.name}</b>
              <span>{player.position} · <em>+{formatPoints(gain)}</em><span className="sr-only"> starter points</span></span>
            </button>
          ))}
        </div>
      </div>
      <div className="roster-grid">
        <Lineup preview={preview} candidateId={candidate.id} />
        <div className="roster-side">
          <section className="roster-block" aria-labelledby="roster-rank-title">
            <h3 id="roster-rank-title" className="roster-block-title">Where you rank</h3>
            {ranks
              ? <Ladders ranks={ranks} candidateName={candidate.name} teamNames={teamNames} />
              : <p className="roster-empty" role="status" data-ranks-empty="">League ranks appear once other teams have drafted.</p>}
          </section>
          {byeRange ? <ByeStripView preview={preview} candidate={candidate} range={byeRange} /> : null}
        </div>
      </div>
    </div>
  );
}
