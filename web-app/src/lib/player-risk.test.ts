import { describe, expect, it } from 'vitest';
import { getPlayerRisk } from './player-risk';

const risk = (injuryRiskScore: number, uncertaintyScore: number) =>
  getPlayerRisk({ injuryRiskScore, uncertaintyScore, predictionSource: 'model' });

describe('getPlayerRisk', () => {
  it('follows the higher of injury risk and projection uncertainty', () => {
    expect(risk(2, 3)?.level).toBe('low');
    expect(risk(5, 2)?.level).toBe('elevated');
    expect(risk(2, 7.5)?.level).toBe('high');
  });

  it('names both scores and their source', () => {
    expect(risk(6, 3)?.detail).toBe('Some risk: injury risk 6.0/10, projection uncertainty 3.0/10 (risk model)');
  });

  it('shows nothing when a score is missing', () => {
    expect(risk(Number.NaN, 3)).toBeNull();
  });
});
