import { describe, expect, it } from 'vitest';
import { calculatePlayerRisk } from './risk';

describe('calculatePlayerRisk', () => {
  it('keeps a healthy, stable player low risk', () => {
    expect(calculatePlayerRisk({
      injuryRiskScore: 2,
      uncertaintyScore: 2.5,
    })).toMatchObject({
      score: 2.2,
      level: 'low',
      driver: 'mixed',
    });
  });

  it('keeps elevated availability risk visible when volatility is lower', () => {
    expect(calculatePlayerRisk({
      injuryRiskScore: 6,
      uncertaintyScore: 3.5,
    })).toMatchObject({
      score: 6.5,
      level: 'high',
      driver: 'availability',
    });
  });

  it('adds projection volatility above the neutral baseline', () => {
    expect(calculatePlayerRisk({
      injuryRiskScore: 2,
      uncertaintyScore: 7,
    })).toMatchObject({
      score: 3.8,
      level: 'moderate',
      driver: 'volatility',
    });
  });
});

