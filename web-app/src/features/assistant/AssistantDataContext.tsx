import * as React from 'react';
import type { Player, Position } from '@fantasy-draft/shared/league';
import type { DraftDecisionView, PositionNeed, Recommendation } from '@fantasy-draft/shared/draft';
import type { NextPickAvailability } from '@/lib/next-pick-availability';
import type { AssistantDraftMode } from './assistant-context';

/**
 * The Assistant page's derived draft data, computed once in AssistantPage and read by the views below it (the
 * best-available list, Position tiers) instead of being passed down prop by prop. Only page-wide facts live here;
 * each view's own controls (search, filters, selection) stay props.
 */
export interface AssistantData {
  /** Every catalog player, drafted or not (tiers can show drafted players). */
  readonly players: readonly Player[];
  readonly playerById: ReadonlyMap<string, Player>;
  /** Every available player: the draft room pool's catalog. */
  readonly available: readonly Player[];
  readonly draftedPlayerIds: ReadonlySet<string>;
  /** "1.05 · Team 6" for picks recorded in the draft history. */
  readonly draftedPickLabels: ReadonlyMap<string, string>;
  readonly overall: DraftDecisionView;
  readonly byPosition: Readonly<Record<Position, DraftDecisionView>>;
  readonly recommendationById: ReadonlyMap<string, Recommendation>;
  /** The survival model's figure for every available player. */
  readonly availabilityById: ReadonlyMap<string, NextPickAvailability>;
  readonly alertsById: ReadonlyMap<string, readonly string[]>;
  readonly queuedSet: ReadonlySet<string>;
  readonly needs: readonly PositionNeed[];
  readonly bestPickId: string | undefined;
  /** No later pick for the manager: every row says so instead of a percentage. */
  readonly finalPick: boolean;
  readonly nextPickLabel: string | null;
  readonly mode: AssistantDraftMode;
  readonly rosterSize: number;
  readonly totalRounds: number;
  readonly totalTeams: number;
  readonly onQueue: (playerId: string) => void;
}

const AssistantDataContext = React.createContext<AssistantData | null>(null);

export function AssistantDataProvider({ value, children }: { readonly value: AssistantData; readonly children: React.ReactNode }): React.ReactElement {
  return <AssistantDataContext.Provider value={value}>{children}</AssistantDataContext.Provider>;
}

export function useAssistantData(): AssistantData {
  const data = React.useContext(AssistantDataContext);
  if (!data) throw new Error('useAssistantData must be used inside an AssistantDataProvider');
  return data;
}
