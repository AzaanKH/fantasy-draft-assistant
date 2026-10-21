import { POSITIONS, type Player } from '@fantasy-draft/shared/league';

export const shadowPlayers: Player[] = Array.from({ length: 600 }, (_, index) => ({
  id: `player-${index + 1}`, name: `Player ${index + 1}`,
  position: POSITIONS[index % POSITIONS.length] ?? 'WR', team: 'BUF', byeWeek: 7,
  ecrRank: index + 1, positionalRank: index + 1, sleeperAdp: index + 1,
  valueScore: 0, marketRank: index + 1, marketAdp: index + 1, marketAdpTrend: 0,
  isContractYear: false, offensiveEnvironmentScore: 5, projectedPoints: 100,
  valueOverReplacement: 0, tier: 1, tierDropoffScore: 0, nextPickSurvivalProbability: 0.5,
  ceilingScore: 100, floorScore: 80, upsideScore: 20, uncertaintyScore: 0,
  injuryRiskScore: 0, predictionSource: 'heuristic', newsStatus: 'healthy',
  stackPartnerTeam: 'BUF', highlightLevel: 'neutral',
}));
