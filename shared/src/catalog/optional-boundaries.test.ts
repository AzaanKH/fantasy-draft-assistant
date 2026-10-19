import { describe, expect, it } from 'vitest';
import { decodeLeagueSurvivalModel } from './decoders.js';
import { isLeagueSurvivalModel } from './league-survival-model.js';
import { isTeamEnvironment } from '../team-environment.js';
import { POSITIONS } from '../player.js';

const summary = { position: 'QB', leagueMedianPick: 50, sleeperMedianPick: 55, pickPremium: 5,
  top50RateDelta: 0, top100RateDelta: 0, sampleSize: 20 };
const model = { generatedAt: '2026-09-16', modelVersion: 'test', leagueName: 'Primary League', seasons: [2025], sampleSize: 140,
  positions: Object.fromEntries(POSITIONS.map(position => [position, { ...summary, position }])) };

describe('declared optional shapes', () => {
  it('rejects malformed declared survival bucket and manager fields', () => {
    expect(isLeagueSurvivalModel({ ...model, adpBuckets: [{}] })).toBe(false);
    expect(isLeagueSurvivalModel({ ...model, managerTendencies: [{}] })).toBe(false);
    expect(isLeagueSurvivalModel({ ...model, positions: { ...model.positions, QB: { ...summary, position: 'invalid' } } })).toBe(false);
  });

  it('requires a real NFL team and finite team environment measures', () => {
    const row = { team: 'DAL', name: 'Dallas', offenseScore: 5, passVolume: 'medium', rushVolume: 'medium',
      pointsRank: 16, passAttemptsRank: 16, rushAttemptsRank: 16, coachingStability: true };
    expect(isTeamEnvironment({ ...row, team: 'invalid' })).toBe(false);
    expect(isTeamEnvironment({ ...row, offenseScore: Infinity })).toBe(false);
  });
});


it('warns when unsupported survival position keys are discarded', () => {
  const warnings: string[] = [];
  const data = decodeLeagueSurvivalModel({ ...model, positions: { ...model.positions, INVALID: summary }, historicalPickNumbers: { INVALID: [1] } }, { onWarning: message => warnings.push(message) });
  expect(data.positions).toEqual(model.positions);
  expect(warnings).toEqual(['Dropped 1 invalid survival position rows.', 'Dropped 1 invalid historical position rows.']);
});
