import { createDraftStore, type RecordedDraftPick, type PreloadedKeeper } from '@/stores/draftStore';
import { deriveDraftState } from '@/stores/draft/source';
import { DRAFT_DISPLAY } from '@/lib/demo-mode';
import {
  POSITIONS,
  type Player,
} from '@fantasy-draft/shared/league';
import {
  createSlotSequence,
} from '@fantasy-draft/shared/draft';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
} from '@fantasy-draft/shared/league';
import {
  type DraftType,
} from '@fantasy-draft/shared/sync';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchFantasyProsSnapshot,
  fetchPlayerIdentityData,
  fetchSleeperData,
  fetchTeamEnvData,
} from '@/lib/player-data/queries';
import {
  mergeCoreSources,
  getRecommendationBoard,
  type RecommendationResult,
  applyLeagueSurvivalModel,
  calculateAllScarcityScores,
  calculateTeamNeeds,
} from '@fantasy-draft/shared/draft';

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
    const store = createDraftStore();
    store.getState().setConfig({
      totalTeams: 10, totalRounds: 15, myPickPosition: 1, draftType: state.draftType,
      rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
    });
    const keepers: PreloadedKeeper[] = state.keepers
      ? [{ team: 0, playerIndex: 25 }, { team: 1, playerIndex: 35 }].map(({ team, playerIndex }) => {
        const player = players[playerIndex];
        if (!player) throw new Error('Demo keeper is missing');
        return {
          playerId: player.id, playerName: player.name, position: player.position,
          teamIndex: team, round: 15, isMyKeeper: team === 0,
        };
      })
      : [];
    store.setState({ preloadedKeepers: keepers });
    const history: RecordedDraftPick[] = [];
    for (let pick = 1; pick < state.currentPick; pick += 1) {
      const team = createSlotSequence({ type: state.draftType, teams: 10, rounds: 15 }).at(pick).teamIndex;
      const view = deriveDraftState(store.getState());
      const roster = view.teamRosters[team];
      if (!roster) throw new Error('Demo draft team is missing');
      const player = players.find((candidate) => !view.draftedPlayerIds.has(candidate.id) &&
        roster[candidate.position].length < DEFAULT_ROSTER_REQUIREMENTS[candidate.position].max);
      if (!player) throw new Error('Demo draft pool is exhausted');
      history.push({
        pickNumber: pick, playerId: player.id, playerName: player.name, position: player.position,
        teamIndex: team, teamName: `Team ${String(team + 1)}`, timestamp: Date.now(), source: 'sync',
      });
      store.setState({ draftHistory: [...history] });
    }
    store.setState({
      draftProgress: { anchor: { kind: 'carry', pickNumber: state.currentPick }, historyLength: history.length },
    });
    const { myRoster: roster, draftedPlayerIds: drafted } = deriveDraftState(store.getState());
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
    }, DRAFT_DISPLAY);
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
