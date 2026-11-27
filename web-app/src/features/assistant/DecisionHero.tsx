import { DECISION_LENS_LABELS, type DecisionLens, type DraftDecisionOutput, type DraftDecisionView, type PositionNeed } from '@fantasy-draft/shared/draft';
import type { Player, Position } from '@fantasy-draft/shared/league';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import { ArrowLeftRight, GitCompareArrows } from 'lucide-react';
import * as React from 'react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Button } from '@/components/ui/button';
import { useTurnStatus } from '@/features/draft-room/DraftTurnBanner';
import { getNextPickAvailability, type NextPickAvailability } from '@/lib/next-pick-availability';
import type { AssistantDraftMode } from './assistant-context';
import { HeroTopRow } from './AssistantLayout';
import { getDisagreeingLens, getHeroReason, getHeroStats, getSkipRow, getSkipRowLabel, shortPlayerName } from './decision-hero';
import { ViewedPlayerAction } from './ViewedPlayerAction';
import './decision-hero.css';

type HeroOutput = Pick<DraftDecisionOutput, 'rankedFit' | 'bestPick' | 'bestPlayer' | 'decisionDivergenceFactor'>;

/**
 * The call at the top of the Assistant: whose turn it is and when yours comes, the lens, then the selected lens's
 * top pick with its one decisive reason, the Draft action, and the facts that make it urgent. Everything below
 * (cards, analysis, pool) is the existing page, unchanged.
 */
export function DecisionHero({
  view,
  output,
  lens,
  onLensChange,
  byPosition,
  availabilityById,
  playerById,
  needs,
  draft,
  onCompare,
}: {
  /** The selected lens's order. */
  readonly view: DraftDecisionView;
  /** Every lens's top pick, for the switch to a lens that disagrees. */
  readonly output: HeroOutput;
  readonly lens: DecisionLens;
  readonly onLensChange: (lens: DecisionLens) => void;
  /** The selected lens's order within each position. */
  readonly byPosition: Readonly<Record<Position, DraftDecisionView>>;
  readonly availabilityById: ReadonlyMap<string, NextPickAvailability>;
  readonly playerById: ReadonlyMap<string, Player>;
  /** The team's needs by position: a roster-fit reason must name a slot the pick can fill. */
  readonly needs: readonly PositionNeed[];
  readonly draft: { readonly mode: AssistantDraftMode; readonly provider: DraftProvider | null; readonly nextPickLabel: string | null };
  /** Opens Compare on the call, when every lens agrees. */
  readonly onCompare: (playerId: string, origin: HTMLElement) => void;
}): React.ReactElement {
  const hero = view.preferred;
  const sectionRef = React.useRef<HTMLElement>(null);
  /** The switch button unmounts with the old call, so focus moves to the lens it selected. */
  const switchLens = (next: DecisionLens): void => {
    onLensChange(next);
    sectionRef.current?.querySelector<HTMLButtonElement>(`[role="group"] button[data-lens="${next}"]`)?.focus();
  };
  return (
    <section ref={sectionRef} className="call" aria-label="Decision">
      <HeroTopRow lens={lens} onLensChange={onLensChange} />
      {hero ? (
        // Keyed on the lens and the pick, so a lens switch replays the call's short fade-in (CSS, reduced-motion aware).
        <div key={`${lens}:${hero.playerId}`} className="call-swap">
          <HeroCall
            view={view}
            output={output}
            lens={lens}
            onLensChange={switchLens}
            byPosition={byPosition}
            availabilityById={availabilityById}
            player={playerById.get(hero.playerId)}
            need={needs.find((item) => item.position === hero.position)}
            draft={draft}
            onCompare={onCompare}
          />
        </div>
      ) : null}
    </section>
  );
}

function HeroCall({ view, output, lens, onLensChange, byPosition, availabilityById, player, need, draft, onCompare }: {
  readonly view: DraftDecisionView;
  readonly output: HeroOutput;
  readonly lens: DecisionLens;
  readonly onLensChange: (lens: DecisionLens) => void;
  readonly byPosition: Readonly<Record<Position, DraftDecisionView>>;
  readonly availabilityById: ReadonlyMap<string, NextPickAvailability>;
  readonly player: Player | undefined;
  readonly need: PositionNeed | undefined;
  readonly draft: { readonly mode: AssistantDraftMode; readonly provider: DraftProvider | null; readonly nextPickLabel: string | null };
  readonly onCompare: (playerId: string, origin: HTMLElement) => void;
}): React.ReactElement | null {
  // Keeper-aware: a reserved keeper at your slot is not a pick you can skip anything with.
  const onClock = useTurnStatus()?.kind === 'on-clock';
  const hero = view.preferred;
  if (!hero) return null;
  const reason = getHeroReason(hero, lens, output.decisionDivergenceFactor, need);
  const availability = availabilityById.get(hero.playerId) ?? getNextPickAvailability(hero.diagnostics);
  const stats = getHeroStats(hero, availability);
  const positionOrder: Partial<Record<Position, DraftDecisionView['recommendations']>> = {};
  (Object.keys(byPosition) as Position[]).forEach((position) => { positionOrder[position] = byPosition[position].recommendations; });
  const skip = getSkipRow({ hero, ranked: view.recommendations, byPosition: positionOrder, availabilityById });
  const skipAt = availability.kind === 'estimate' ? availability.pickLabel ?? draft.nextPickLabel : draft.nextPickLabel;
  const other = getDisagreeingLens(output, lens);
  const short = shortPlayerName(hero.playerName, hero.position);

  return (
    <>
      <div className="call-main">
        <span className="call-headshot" data-position={hero.position}>
          <PlayerHeadshot playerId={hero.playerId} name={hero.playerName} position={hero.position} team={player?.team} className="call-headshot-image" />
          {player?.team ? <span className="call-team">{player.team}</span> : null}
        </span>
        <div className="call-copy">
          <h1 className="call-name"><span className="call-verb">Draft</span> {hero.playerName}</h1>
          <p className="call-why"><span className="position-text" data-position={hero.position}>{hero.position}</span> · {reason}</p>
        </div>
        <div className="call-actions">
          <ViewedPlayerAction player={player} playerName={hero.playerName} mode={draft.mode} provider={draft.provider}
            nextPickLabel={draft.nextPickLabel} draftLabel={`Draft ${short}`} />
          {other ? (
            <Button variant="outline" className="call-secondary" title={`Switch to the ${DECISION_LENS_LABELS[other.lens]} lens`}
              onClick={() => { onLensChange(other.lens); }}>
              <ArrowLeftRight className="size-4" aria-hidden="true" />
              {DECISION_LENS_LABELS[other.lens]} picks {shortPlayerName(other.recommendation.playerName, other.recommendation.position)}
            </Button>
          ) : (
            <Button variant="outline" className="call-secondary" onClick={(event) => { onCompare(hero.playerId, event.currentTarget); }}>
              <GitCompareArrows className="size-4" aria-hidden="true" /> Compare options
            </Button>
          )}
        </div>
      </div>
      {stats.length > 0 || skip ? (
        <div className="call-foot">
          {stats.length > 0 ? (
            <div className="call-stats">
              {stats.map((stat) => (
                <div key={stat.key} className="call-stat" title={stat.title} data-urgent={stat.urgent || undefined}>
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </div>
              ))}
            </div>
          ) : null}
          {skip && skipAt ? (
            <div className="call-skip">
              <span className="call-skip-label">{getSkipRowLabel(skip.position, skipAt, onClock)}</span>
              <ul>
                {skip.players.map((item) => {
                  const percent = Math.round(item.probability * 100);
                  return (
                    <li key={item.playerId} title={`${String(percent)}% chance ${item.playerName} is still there at ${skipAt}`}>
                      <span className="call-skip-name">{item.playerName}</span>
                      <span className="call-skip-bar" aria-hidden="true"><i style={{ width: `${String(percent)}%` }} /></span>
                      <strong>{percent}%</strong>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
