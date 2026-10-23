import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { getRosterSlots } from './roster-slots';

export function DraftRosterPanel(): React.ReactElement {
  const { players } = usePlayerDataQuery();
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
  const rosterSize = slots.filter((slot) => slot.playerId).length;

  return (
    <div className="draft-roster">
      <div className="draft-roster-heading">
        <h3>Drafted players</h3>
        <span>Slot {String(config.myPickPosition)} · {String(rosterSize)} / {String(config.totalRounds)}</span>
      </div>
      <ul className="draft-roster-slots">
        {slots.map((slot, index) => {
          const player = slot.playerId ? playerById.get(slot.playerId) : undefined;
          const pick = slot.playerId ? pickByPlayerId.get(slot.playerId) : undefined;
          const name = player?.name ?? pick?.playerName;
          const position = player?.position ?? pick?.position;
          const details = player ? `${player.team} · Bye ${String(player.byeWeek)}` : null;
          return (
            <li key={`${slot.label}-${String(index)}`} className="draft-roster-slot">
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
                    {details || slot.label === 'FLEX' || slot.label === 'BN' ? (
                      <span className="draft-roster-meta">
                        {[slot.label === 'FLEX' || slot.label === 'BN' ? position : null, details]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  {pick ? (
                    <span className="draft-roster-pick">{createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }).label(pick.pickNumber)}</span>
                  ) : null}
                </>
              ) : (
                <span className="draft-roster-empty">{slot.playerId ? 'Player details unavailable' : 'Empty'}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
