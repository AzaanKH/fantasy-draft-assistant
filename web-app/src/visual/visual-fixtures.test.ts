import { describe, expect, it } from 'vitest';
import { getDraftBoardRoundNumbers } from '@/features/draft-room/DraftBoard';
import { getDraftView } from '@/workspace/useDraftView';
import { createDraftStore } from '@/stores/draftStore';
const draftStore = createDraftStore();
import {
  createVisualDraftStore,
  getVisualLeague,
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
    expect(getVisualRoute('/__visual/loading', '?state=assistant')).toEqual({
      screen: 'loading',
      state: 'assistant',
    });
    expect(getVisualRoute('/__visual/loading', '')).toEqual({
      screen: 'loading',
      state: 'draft',
    });
    expect(getVisualRoute('/__visual/readiness', '?state=blocked')).toEqual({
      screen: 'readiness',
      state: 'blocked',
      refresh: 'idle',
    });
    expect(getVisualRoute('/__visual/readiness', '?refresh=failed')).toEqual({
      screen: 'readiness',
      state: 'blocked',
      refresh: 'failed',
    });
  });

  it('seeds ten available players and fixed-time mid-draft state in an isolated store', () => {
    const defaultPick = getDraftView(draftStore).currentPick;
    const store = createVisualDraftStore();
    const fixture = store.getState();

    expect(VISUAL_PLAYERS).toHaveLength(10);
    expect(getDraftView(store).currentPick).toBe(47);
    expect(fixture.config).toMatchObject({ totalTeams: 10, totalRounds: 14 });
    expect(getDraftView(store, VISUAL_PLAYERS).available).toEqual(VISUAL_PLAYERS);
    expect(getDraftView(store).myRoster).toEqual({
      QB: ['visual-drafted-25'], RB: ['visual-drafted-5', 'visual-drafted-16'],
      WR: ['visual-drafted-36'], TE: ['visual-drafted-45'], K: [], DEF: [],
    });
    expect(fixture.draftHistory).toHaveLength(46);
    expect(fixture.draftHistory.every((pick) => pick.timestamp === VISUAL_NOW)).toBe(true);
    expect(getDraftView(draftStore).currentPick).toBe(defaultPick);
  });

  it('seeds a superflex league only when the URL asks for one', () => {
    expect(getVisualLeague('?state=mid-draft&league=superflex')).toBe('superflex');
    expect(getVisualLeague('?league=other')).toBe('standard');
    const standard = createVisualDraftStore().getState().config.rosterRequirements;
    const superflex = createVisualDraftStore('superflex').getState().config.rosterRequirements;
    expect(standard.FLEX.eligiblePositions).toEqual(['RB', 'WR', 'TE']);
    expect(superflex.FLEX).toEqual({ starters: standard.FLEX.starters, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] });
  });

  it('centers a reduced board window without changing the draft configuration', () => {
    expect(getDraftBoardRoundNumbers(14, 5, 4)).toEqual([3, 4, 5, 6]);
    expect(getDraftBoardRoundNumbers(14, 14, 4)).toEqual([11, 12, 13, 14]);
    expect(getDraftBoardRoundNumbers(14, 5)).toHaveLength(14);
  });
});
