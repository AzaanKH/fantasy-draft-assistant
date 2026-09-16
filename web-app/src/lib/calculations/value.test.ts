import { describe, it, expect } from 'vitest';
import { calculateValueScore } from './value';

describe('calculateValueScore', () => {
  it('returns positive value when player is undervalued (ADP > ECR)', () => {
    // Player ranked #15 by experts but ADP is #25 on Sleeper
    const result = calculateValueScore(15, 25);
    expect(result).toBe(10);
  });

  it('returns negative value when player is overvalued (ADP < ECR)', () => {
    // Player ranked #30 by experts but ADP is #15 on Sleeper
    const result = calculateValueScore(30, 15);
    expect(result).toBe(-15);
  });

  it('returns zero when ECR equals ADP', () => {
    const result = calculateValueScore(20, 20);
    expect(result).toBe(0);
  });
});
