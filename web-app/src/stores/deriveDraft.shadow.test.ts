import './draft/derive-shadow.setup';
import { describe, expect, it } from 'vitest';
import { createDraftStore } from './draftStore';
import { shadowFormat, shadowSource } from './draft/derive-shadow-source';
import { deriveDraft } from '@fantasy-draft/shared';
import { createShadowMock, shadowMockFormat } from './draft/derive-shadow-fixture';

describe('10 by 14 mock with keepers at 1, 70, and 140', () => {
  it('replays every CPU pick and keeper consumption through the real store', () => {
    const source = createShadowMock(140);
    const view = deriveDraft(source, shadowMockFormat);
    expect(source.history).toHaveLength(140);
    expect(view.currentPick).toBe(141);
    expect(view.draftedPlayerIds.size).toBe(140);
    expect(view.shortlistedPlayerIds).toEqual(['waiting-a', 'waiting-b']);
    expect(view.isMyTurn).toBe(false);
  });
});

it('exposes an explicit branch cursor that the proposed source facts cannot reconstruct', () => {
  const first = createDraftStore();
  const branched = createDraftStore();
  branched.getState().branchFromPick(96);
  expect(shadowSource(branched.getState())).toEqual(shadowSource(first.getState()));
  expect(branched.getState().currentPick).toBe(96);
  expect(first.getState().currentPick).toBe(1);
  expect(deriveDraft(shadowSource(branched.getState()), shadowFormat(branched.getState())).currentPick).toBe(1);
});
