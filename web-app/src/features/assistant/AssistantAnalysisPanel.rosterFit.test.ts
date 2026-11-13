import { expect, it } from 'vitest';
import type { PositionNeed } from '@fantasy-draft/shared/draft';
import { describeRosterFit } from './AssistantAnalysisPanel';

const need = (overrides: Partial<PositionNeed>): PositionNeed => ({
  position: 'QB', startersFilled: 1, startersNeeded: 1, flexSlotsFilled: 0, flexSlotsNeeded: 1, isFlexEligible: false, ...overrides,
} as PositionNeed);

it('labels roster fit from this position only, not open slots elsewhere on the roster', () => {
  // A backup QB is depth even while other positions (and FLEX) are open.
  expect(describeRosterFit(need({}))).toBe('Bench depth');
  expect(describeRosterFit(need({ startersFilled: 0 }))).toBe('1 of 1 QB starter spot open');
  expect(describeRosterFit(need({ position: 'RB', startersFilled: 1, startersNeeded: 2 }))).toBe('1 of 2 RB starter spots open');
  expect(describeRosterFit(need({ position: 'RB', startersFilled: 2, startersNeeded: 2, isFlexEligible: true }))).toBe('1 of 1 FLEX spot open');
  // In words only: never the model's roster-fit score.
  expect(describeRosterFit(need({ startersFilled: 0 }))).not.toMatch(/[+-]\d/);
});
