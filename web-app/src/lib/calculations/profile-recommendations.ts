import { LIVE_RECOMMENDATION_ARCHITECTURE } from '@fantasy-draft/shared';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  POSITIONS,
  type Player,
  type PositionNeed,
} from '@fantasy-draft/shared';
import { getRecommendationBoard } from './recommendations';

// Synthetic 600-player calculation profile matching the hook's overall and
// six position decisions. This measures CPU work, not rendered UI latency.
const positionCycle: Player['position'][] = ['RB', 'WR', 'WR', 'RB', 'QB', 'TE', 'K', 'DEF'];
const players: Player[] = Array.from({ length: 600 }, (_, index) => {
  const rank = index + 1;
  const position = positionCycle[index % positionCycle.length] ?? 'RB';
  return {
    id: `player-${rank}`,
    name: `Player ${rank}`,
    position,
    team: 'DET',
    byeWeek: 6,
    ecrRank: rank,
    positionalRank: rank,
    sleeperAdp: rank + 4,
    valueScore: 4,
    marketRank: rank + 4,
    marketAdp: rank + 4,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints: 300 - rank * 0.2,
    valueOverReplacement: Math.max(0, 110 - rank * 0.18),
    tier: Math.floor(index / 50) + 1,
    tierDropoffScore: 0.8,
    nextPickNumber: 65,
    nextPickSurvivalProbability: Math.max(0.05, 1 - rank / 700),
    ceilingScore: 7,
    floorScore: 6,
    upsideScore: 6,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
    predictionSource: 'heuristic',
    newsStatus: 'healthy',
    stackPartnerTeam: 'DET',
    highlightLevel: 'neutral',
  };
});
const needs: PositionNeed[] = POSITIONS.map((position) => ({
  position,
  priority: 'medium',
  startersFilled: 0,
  startersNeeded: 1,
  flexSlotsFilled: 0,
  flexSlotsNeeded: 0,
  isFlexEligible: false,
  scarcityScore: 5,
}));
const context = {
  architecture: LIVE_RECOMMENDATION_ARCHITECTURE,
  currentPick: 55,
  totalPicks: 150,
  totalTeams: 10,
  isMyTurn: true,
  requirements: DEFAULT_ROSTER_REQUIREMENTS,
  rosterCounts: { QB: 1, RB: 2, WR: 2, TE: 1, K: 0, DEF: 0 },
  selectionsRemaining: 9,
};

function runFullAndPositions(): number {
  const start = performance.now();
  getRecommendationBoard(players, needs, 5, context);
  return performance.now() - start;
}

for (let index = 0; index < 2; index += 1) runFullAndPositions();
const samples: number[] = [];
for (let index = 0; index < 5; index += 1) {
  samples.push(runFullAndPositions());
}
console.log(JSON.stringify({
  players: players.length,
  positionLists: POSITIONS.length,
  samplesMs: samples.map((sample) => Number(sample.toFixed(1))),
  medianMs: Number(([...samples].sort((left, right) => left - right)[2] ?? 0).toFixed(1)),
}));
