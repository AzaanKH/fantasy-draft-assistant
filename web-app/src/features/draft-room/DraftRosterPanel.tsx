import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { SkeletonText } from '@/components/skeletons';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { getRosterSlots } from './roster-slots';
import { useDraftSessionKey, useJustAdded, useLandedPick } from './usePickLanded';

export function DraftRosterPanel(): React.ReactElement {
  const { players, isLoading } = usePlayerDataQuery();
  const myRoster = useDraftView((view) => view.myRoster);
  const config = useDraftState((state) => state.config);
  const draftHistory = useDraftState((state) => state.draftHistory);
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const pickByPlayerId = React.useMemo(
    () => new Map(draftHistory.map((pick) => [pick.playerId, pick])),
    [draftHistory]
  );
  const slots = React.useMemo(
    () => getRosterSlots(myRoster, config.rosterRequirements),
    [config.rosterRequirements, myRoster]
  );
  const sequence = React.useMemo(
    () => createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }),
    [config.draftType, config.totalRounds, config.totalTeams]
  );
  const rosterSize = slots.filter((slot) => slot.playerId).length;
  // The slot a pick just filled gets a brief highlight, so "pick landed" is visible on the roster too.
  // Keyed by the draft session, so opening another saved draft never reads as a pick landing.
  const sessionKey = useDraftSessionKey();
  const filledId = useJustAdded(React.useMemo(
    () => slots.flatMap((slot) => slot.playerId ? [slot.playerId] : []),
    [slots]
  ), sessionKey);
  // Only the one pick that just landed: a sync that adds several picks at once, one of them yours, flashes nothing.
  const landedPick = useLandedPick(draftHistory, sessionKey);
  const justFilledId = filledId !== null && filledId === landedPick?.playerId ? filledId : null;
  // Starters (from the league's roster settings) and bench, each with "Empty" placeholders until picks land.
  const groups = React.useMemo(() => {
    const indexed = slots.map((slot, index) => ({ slot, index }));
    return [
      { label: 'Starters', slots: indexed.filter(({ slot }) => slot.label !== 'BN') },
      { label: 'Bench', slots: indexed.filter(({ slot }) => slot.label === 'BN') },
    ].filter((group) => group.slots.length > 0);
  }, [slots]);

  return (
    <div className="draft-roster">
      <div className="draft-roster-heading">
        <h3>Drafted players</h3>
        <span>Slot {String(config.myPickPosition)} · {String(rosterSize)} / {String(config.totalRounds)}</span>
      </div>
      {groups.map((group) => (
        <section key={group.label} className="draft-roster-group" aria-labelledby={`draft-roster-${group.label.toLowerCase()}`}>
          <h4 id={`draft-roster-${group.label.toLowerCase()}`} className="draft-roster-group-heading">
            {group.label}
            <span>{String(group.slots.filter(({ slot }) => slot.playerId).length)} / {String(group.slots.length)}</span>
          </h4>
          <ul className="draft-roster-slots">
            {group.slots.map(({ slot, index }) => {
              const player = slot.playerId ? playerById.get(slot.playerId) : undefined;
              const pick = slot.playerId ? pickByPlayerId.get(slot.playerId) : undefined;
              const name = player?.name ?? pick?.playerName;
              const position = player?.position ?? pick?.position;
              const details = player ? `${player.team} · Bye ${String(player.byeWeek)}` : null;
              return (
                <li key={`${slot.label}-${String(index)}`} className="draft-roster-slot" data-just-filled={slot.playerId && slot.playerId === justFilledId ? '' : undefined}>
                  <span className="draft-slot-badge" data-slot-label={slot.label}>{slot.label}</span>
                  {slot.playerId && name ? (
                    <>
                      <PlayerHeadshot
                        playerId={slot.playerId}
                        name={name}
                        position={position}
                        className="size-8 shrink-0 rounded-full"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="draft-roster-name">{name}</span>
                        {isLoading ? (
                          <span className="draft-roster-meta"><SkeletonText className="w-24" /></span>
                        ) : details || slot.label === 'FLEX' || slot.label === 'BN' ? (
                          <span className="draft-roster-meta">
                            {[slot.label === 'FLEX' || slot.label === 'BN' ? position : null, details]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </span>
                      {pick ? (
                        <span className="draft-roster-pick">{sequence.label(pick.pickNumber)}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="draft-roster-empty">{slot.playerId ? 'Player details unavailable' : 'Empty'}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
