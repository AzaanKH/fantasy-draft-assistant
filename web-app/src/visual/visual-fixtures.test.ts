import { describe, expect, it } from 'vitest';
import { getDraftBoardRoundNumbers } from '@/features/draft-room/DraftBoard';
import { useDraftStore } from '@/stores/draftStore';
import {
  createVisualDraftStore,
  getVisualRoute,
  VISUAL_NOW,
  VISUAL_PLAYERS,
} from './VisualApp';

describe('visual fixtures', () => {
  it('maps the documented visual routes to deterministic states', () => {
    expect(getVisualRoute('/__visual/header', '?state=draft')).toEqual({
      screen: 'header',
      state: 'draft',
    });
    expect(getVisualRoute('/__visual/board', '?state=mid-draft')).toEqual({
      screen: 'board',
      state: 'mid-draft',
    });
    expect(getVisualRoute('/__visual/assistant', '?state=wait')).toEqual({
      screen: 'assistant',
      state: 'wait',
    });
    expect(getVisualRoute('/__visual/mobile/draft', '')).toEqual({
      screen: 'mobile-draft',
      state: 'draft',
    });
    expect(getVisualRoute('/__visual/mobile/assistant', '')).toEqual({
      screen: 'mobile-assistant',
      state: 'wait',
    });
    expect(getVisualRoute('/__visual/readiness', '?state=blocked')).toEqual({
      screen: 'readiness',
      state: 'blocked',
    });
  });

  it('seeds ten available players and fixed-time mid-draft state in an isolated store', () => {
    const defaultPick = useDraftStore.getState().currentPick;
    const store = createVisualDraftStore();
    const fixture = store.getState();

    expect(VISUAL_PLAYERS).toHaveLength(10);
    expect(fixture.currentPick).toBe(47);
    expect(fixture.config).toMatchObject({ totalTeams: 10, totalRounds: 14 });
    expect(fixture.draftHistory).toHaveLength(46);
    expect(fixture.draftHistory.every((pick) => pick.timestamp === VISUAL_NOW)).toBe(true);
    expect(useDraftStore.getState().currentPick).toBe(defaultPick);
  });

  it('centers a reduced board window without changing the draft configuration', () => {
    expect(getDraftBoardRoundNumbers(14, 5, 4)).toEqual([3, 4, 5, 6]);
    expect(getDraftBoardRoundNumbers(14, 14, 4)).toEqual([11, 12, 13, 14]);
    expect(getDraftBoardRoundNumbers(14, 5)).toHaveLength(14);
  });
});
