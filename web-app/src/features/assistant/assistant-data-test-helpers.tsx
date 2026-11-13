import { createElement, type ReactElement, type ReactNode } from 'react';
import { AssistantDataProvider, type AssistantData } from './AssistantDataContext';

/** Page data for rendering one Assistant view on its own; tiers read only the catalog and selection facts. */
export function createAssistantTestData(overrides: Partial<AssistantData> & Pick<AssistantData, 'players'>): AssistantData {
  // An explicit null is the final pick; leaving it out means a next pick at 2.08.
  const nextPickLabel = overrides.nextPickLabel === undefined ? '2.08' : overrides.nextPickLabel;
  return {
    playerById: new Map(overrides.players.map((player) => [player.id, player])),
    available: overrides.players,
    draftedPlayerIds: new Set<string>(),
    draftedPickLabels: new Map(),
    // Unused by the tier views these helpers render.
    overall: undefined as never,
    byPosition: undefined as never,
    recommendationById: new Map(),
    availabilityById: new Map(),
    alertsById: new Map(),
    queuedSet: new Set<string>(),
    needs: [],
    bestPickId: undefined,
    finalPick: nextPickLabel === null,
    mode: 'mock',
    rosterSize: 0,
    totalRounds: 15,
    totalTeams: 12,
    onQueue: () => undefined,
    ...overrides,
    nextPickLabel,
  };
}

export function withAssistantData(data: AssistantData, children: ReactNode): ReactElement {
  return createElement(AssistantDataProvider, { value: data, children });
}
