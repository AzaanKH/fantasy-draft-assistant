import { createSlotSequence } from '@fantasy-draft/shared';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyRoster,
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
  POSITIONS,
  type DraftType,
  type Player,
} from '@fantasy-draft/shared';
import {
  fetchFantasyProsSnapshot,
  fetchPlayerIdentityData,
  fetchSleeperData,
  fetchTeamEnvData,
} from '@/lib/player-data/queries';
import { mergeCoreSources } from './recommendation-player-variants';
import { getRecommendationBoard, type RecommendationResult } from './recommendations';
import { applyLeagueSurvivalModel } from './survival';
import { calculateAllScarcityScores } from './scarcity';
import { calculateTeamNeeds } from './team-needs';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function demoPlayers(): Promise<Player[]> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(
    new URL(`../../../../demo-data/${url.replace('/data/', '')}`, import.meta.url),
    'utf8'
  )));
  const [snapshot, identities, sleeper, environment] = await Promise.all([
    fetchFantasyProsSnapshot(),
    fetchPlayerIdentityData(),
    fetchSleeperData(),
    fetchTeamEnvData(),
  ]);
  return mergeCoreSources({
    rankings: snapshot.rankings,
    projections: snapshot.projections,
    news: snapshot.news,
    fantasyProsAdp: snapshot.adp,
    identities: identities.players,
    sleeperPlayers: sleeper.players,
    teamEnvironments: environment.teams,
    leagueContext: {
      scoringRules: DEFAULT_SCORING_RULES,
      rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
      totalTeams: 10,
    },
  }, []).sort((a, b) => a.ecrRank - b.ecrRank);
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) => {
    if (field === null || typeof field !== 'object' || Array.isArray(field)) return field;
    return Object.fromEntries(Object.entries(field).sort(([left], [right]) => left.localeCompare(right)));
  });
}

describe('live Best Pick and Best Player demo boards', () => {
  it.each([
    { name: 'snake-pick-1', currentPick: 1, draftType: 'snake', keepers: false },
    { name: 'snake-pick-50', currentPick: 50, draftType: 'snake', keepers: false },
    { name: 'snake-pick-100', currentPick: 100, draftType: 'snake', keepers: false },
    { name: 'linear-pick-50', currentPick: 50, draftType: 'linear', keepers: false },
    { name: 'snake-pick-50-keepers', currentPick: 50, draftType: 'snake', keepers: true },
  ] satisfies readonly {
    name: string;
    currentPick: number;
    draftType: DraftType;
    keepers: boolean;
  }[])('preserves complete lists and diagnostics at $name', async (state) => {
    const players = await demoPlayers();
    expect(players.length).toBeGreaterThan(400);
    const rosters = Array.from({ length: 10 }, () => createEmptyRoster());
    const drafted = new Set<string>();
    if (state.keepers) {
      for (const { team, playerIndex } of [{ team: 0, playerIndex: 25 }, { team: 1, playerIndex: 35 }]) {
        const player = players[playerIndex];
        if (!player) throw new Error('Demo keeper is missing');
        const roster = rosters[team];
        if (!roster) throw new Error('Demo keeper team is missing');
        rosters[team] = { ...roster, [player.position]: [...roster[player.position], player.id] };
        drafted.add(player.id);
      }
    }
    for (let pick = 1; pick < state.currentPick; pick += 1) {
      const team = createSlotSequence({ type: state.draftType, teams: 10, rounds: Math.ceil(pick / 10) }).at(pick).teamIndex;
      const roster = rosters[team];
      if (!roster) throw new Error('Demo draft team is missing');
      const player = players.find((candidate) => !drafted.has(candidate.id) &&
        roster[candidate.position].length < DEFAULT_ROSTER_REQUIREMENTS[candidate.position].max);
      if (!player) throw new Error('Demo draft pool is exhausted');
      rosters[team] = { ...roster, [player.position]: [...roster[player.position], player.id] };
      drafted.add(player.id);
    }
    const roster = rosters[0];
    if (!roster) throw new Error('Demo manager team is missing');
    const rosterIds = new Set(Object.values(roster).flat());
    const rosterPlayers = players.filter((player) => rosterIds.has(player.id));
    const available = applyLeagueSurvivalModel(players, null, {
      currentPick: state.currentPick,
      myPickPosition: 1,
      totalTeams: 10,
      totalRounds: 15,
      draftType: state.draftType,
    }).filter((player) => !drafted.has(player.id));
    const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS,
      calculateAllScarcityScores(available), { currentPick: state.currentPick, totalPicks: 150, totalRounds: 15 });
    const board = getRecommendationBoard(available, needs, 5, {
      currentPick: state.currentPick,
      totalPicks: 150,
      totalTeams: 10,
      isMyTurn: createSlotSequence({ type: state.draftType, teams: 10, rounds: Math.ceil(state.currentPick / 10) }).at(state.currentPick).teamIndex === 0,
      requirements: DEFAULT_ROSTER_REQUIREMENTS,
      rosterCounts: Object.fromEntries(POSITIONS.map((position) => [position, roster[position].length])),
      rosterPlayers,
      selectionsRemaining: 15 - rosterPlayers.length,
    });
    const lines: string[] = [];
    const record = (scope: string, result: RecommendationResult): void => {
      lines.push(serialize({ scope, selection: result.selection }));
      for (const lens of ['draftNow', 'bestAvailable', 'rbIntentionalReaches', 'marketValues', 'marketStashes', 'byNeed'] as const) {
        result[lens].forEach((recommendation, rank) => {
          lines.push(serialize({ scope, lens, rank: rank + 1, ...recommendation }));
        });
      }
    };
    record('overall', board.overall);
    for (const position of POSITIONS) record(position, board.byPosition[position]);
    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(`./__snapshots__/recommendations-${state.name}.jsonl`);
  });
});
