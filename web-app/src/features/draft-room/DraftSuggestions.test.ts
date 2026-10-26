import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { DraftSuggestions } from './DraftSuggestions';

// While player data loads, readiness has no sources, so recommendations read as blocked and not loading.
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: [], isLoading: true }) }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({ isLoading: false, recommendationsBlocked: true, overall: { recommendations: [] } }),
}));

describe('DraftSuggestions', () => {
  it('shows placeholder cards while player data loads, even though recommendations read as blocked', () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceTestProvider, {
      store: createDraftStore(),
      children: createElement(DraftSuggestions, { onOpenAssistant: vi.fn() }),
    }));
    expect(markup).toContain('Loading suggestions');
    expect(markup.match(/aria-hidden="true" class="flex min-w-0 flex-col/g)).toHaveLength(3);
  });
});
