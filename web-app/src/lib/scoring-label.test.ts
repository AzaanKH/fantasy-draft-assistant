import { expect, it } from 'vitest';
import { receptionScoringLabel } from './scoring-label';

it.each([[0, 'Standard'], [0.5, 'Half-PPR'], [1, 'PPR'], [0.25, '0.25 PPR'], [1.5, '1.5 PPR']] as const)('labels %d points per reception as %s', (points, label) => {
  expect(receptionScoringLabel(points)).toBe(label);
});
