import { beforeAll, describe, expect, it } from 'vitest';
import type {
  FantasyProsSnapshot,
  NFLTeam,
  Player,
  Position,
  TeamEnvironment,
} from '@fantasy-draft/shared';
import { DEFAULT_ROSTER_REQUIREMENTS } from '@fantasy-draft/shared';
import {
  mergePlayerData,
  normalizePlayerName,
  type PlayerIdentityData,
  type SleeperADPPlayer,
} from './calculations/player-value';
import {
  simulateCpuDraft,
  type MockDraftEngineConfig,
  type MockKeeperAssignment,
  type MockLeagueHistoryModel,
} from './mock-draft-engine';
import fantasyProsJson from '../../../data/fantasypros-snapshot.json';
import sleeperJson from '../../../data/sleeper-adp.json';
import teamEnvironmentJson from '../../../data/team-environment.json';
import identityJson from '../../../data/player-identity.json';
import keeperJson from '../../../data/league-history/current-keepers.json';
import survivalModelJson from '../../../data/league-history/survival-model.json';

interface SleeperFile {
  readonly players: readonly SleeperADPPlayer[];
}

interface TeamEnvironmentFile {
  readonly teams: Record<NFLTeam, TeamEnvironment>;
}

interface IdentityFile {
  readonly players: readonly PlayerIdentityData[];
}

interface KeeperFile {
  readonly keepers: readonly {
    readonly playerName: string;
    readonly position: Position;
    readonly team: number;
    readonly round: number;
  }[];
}

interface CalibrationSummary {
  readonly iterations: number;
  readonly averageQbsFirst50Fresh: number;
  readonly averageTesFirst50Fresh: number;
  readonly targetWindowRates: Readonly<Record<string, number>>;
  readonly distinctTopPlayerAt206: number;
  readonly distinctTopPlayerAt305: number;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function resolveKeepers(
  keepers: KeeperFile,
  players: readonly Player[]
): MockKeeperAssignment[] {
  return keepers.keepers.map((keeper) => {
    const match = players.find((player) =>
      player.position === keeper.position &&
      normalizePlayerName(player.name) === normalizePlayerName(keeper.playerName)
    );
    if (!match) throw new Error(`Missing keeper player: ${keeper.playerName}`);
    return {
      playerId: match.id,
      playerName: match.name,
      position: match.position,
      teamIndex: keeper.team - 1,
      round: keeper.round,
    };
  });
}

function wasPickedInRange(
  picks: ReturnType<typeof simulateCpuDraft>,
  playerName: string,
  minimumPick: number,
  maximumPick: number
): boolean {
  return picks.some((pick) =>
    normalizePlayerName(pick.playerName) === normalizePlayerName(playerName) &&
    pick.pickNumber >= minimumPick &&
    pick.pickNumber <= maximumPick
  );
}

describe('2026 mock draft calibration', () => {
  let players: Player[] = [];
  let keepers: MockKeeperAssignment[] = [];
  let historyModel: MockLeagueHistoryModel | null = null;

  beforeAll(() => {
    const fantasyPros = fantasyProsJson as unknown as FantasyProsSnapshot;
    const sleeper = sleeperJson as unknown as SleeperFile;
    const environments = teamEnvironmentJson as unknown as TeamEnvironmentFile;
    const identities = identityJson as unknown as IdentityFile;
    const keeperFile = keeperJson as unknown as KeeperFile;
    const history = survivalModelJson as unknown as MockLeagueHistoryModel;
    players = mergePlayerData(
      fantasyPros.rankings,
      fantasyPros.projections,
      fantasyPros.news,
      sleeper.players,
      environments.teams,
      [],
      [],
      fantasyPros.adp ?? [],
      identities.players
    );
    keepers = resolveKeepers(keeperFile, players);
    historyModel = history;
  });

  it('finishes a complete mock with legal starters, two FLEX slots, and roster maximums', () => {
    const config: MockDraftEngineConfig = {
      totalTeams: 10,
      totalRounds: 15,
      myPickPosition: 5,
      rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
      randomness: 0.55,
      seed: 20260810,
    };
    const picks = simulateCpuDraft({ players, keepers, config, historyModel });
    expect(picks).toHaveLength(150);

    for (let teamIndex = 0; teamIndex < 10; teamIndex += 1) {
      const teamPicks = picks.filter((pick) => pick.teamIndex === teamIndex);
      const counts = Object.fromEntries(
        (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const).map((position) => [
          position,
          teamPicks.filter((pick) => pick.position === position).length,
        ])
      ) as Record<Position, number>;
      expect(teamPicks).toHaveLength(15);
      expect(counts.QB).toBeGreaterThanOrEqual(1);
      expect(counts.RB).toBeGreaterThanOrEqual(2);
      expect(counts.WR).toBeGreaterThanOrEqual(2);
      expect(counts.TE).toBeGreaterThanOrEqual(1);
      expect(counts.K).toBeGreaterThanOrEqual(1);
      expect(counts.RB + counts.WR + counts.TE).toBeGreaterThanOrEqual(7);
      expect(counts.QB).toBeLessThanOrEqual(DEFAULT_ROSTER_REQUIREMENTS.QB.max);
      expect(counts.RB).toBeLessThanOrEqual(DEFAULT_ROSTER_REQUIREMENTS.RB.max);
      expect(counts.WR).toBeLessThanOrEqual(DEFAULT_ROSTER_REQUIREMENTS.WR.max);
      expect(counts.TE).toBeLessThanOrEqual(DEFAULT_ROSTER_REQUIREMENTS.TE.max);
      expect(counts.K).toBeLessThanOrEqual(DEFAULT_ROSTER_REQUIREMENTS.K.max);
      expect(counts.DEF).toBe(0);
    }
  });

  it('hits the requested early-position and player-window targets across 500 drafts', () => {
    const iterations = 500;
    const qbCounts: number[] = [];
    const teCounts: number[] = [];
    const windowHits: Record<string, number> = {
      'Trey McBride': 0,
      'Brock Bowers': 0,
      'Josh Allen': 0,
      'Lamar Jackson': 0,
    };
    const topAt206 = new Set<string>();
    const topAt305 = new Set<string>();
    const keeperIds = new Set(keepers.map((keeper) => keeper.playerId));

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const config: MockDraftEngineConfig = {
        totalTeams: 10,
        totalRounds: 15,
        myPickPosition: 5,
        rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
        randomness: 0.55,
        seed: 20260000 + iteration,
      };
      const picks = simulateCpuDraft({
        players,
        keepers,
        config,
        historyModel,
        freshSelectionLimit: 60,
      });
      const first50Fresh = picks.filter((pick) => pick.source === 'cpu').slice(0, 50);
      qbCounts.push(first50Fresh.filter((pick) => pick.position === 'QB').length);
      teCounts.push(first50Fresh.filter((pick) => pick.position === 'TE').length);

      if (wasPickedInRange(picks, 'Trey McBride', 11, 25)) {
        windowHits['Trey McBride'] = (windowHits['Trey McBride'] ?? 0) + 1;
      }
      if (wasPickedInRange(picks, 'Brock Bowers', 11, 25)) {
        windowHits['Brock Bowers'] = (windowHits['Brock Bowers'] ?? 0) + 1;
      }
      if (wasPickedInRange(picks, 'Josh Allen', 21, 40)) {
        windowHits['Josh Allen'] = (windowHits['Josh Allen'] ?? 0) + 1;
      }
      if (wasPickedInRange(picks, 'Lamar Jackson', 21, 40)) {
        windowHits['Lamar Jackson'] = (windowHits['Lamar Jackson'] ?? 0) + 1;
      }

      for (const [pickNumber, outcomes] of [[16, topAt206], [25, topAt305]] as const) {
        const unavailable = new Set(keeperIds);
        for (const pick of picks) {
          if (pick.pickNumber < pickNumber) unavailable.add(pick.playerId);
        }
        const topAvailable = players
          .filter((player) => !unavailable.has(player.id))
          .sort((left, right) => left.ecrRank - right.ecrRank)[0];
        if (topAvailable) outcomes.add(topAvailable.name);
      }
    }

    const summary: CalibrationSummary = {
      iterations,
      averageQbsFirst50Fresh: Number(mean(qbCounts).toFixed(2)),
      averageTesFirst50Fresh: Number(mean(teCounts).toFixed(2)),
      targetWindowRates: Object.fromEntries(
        Object.entries(windowHits).map(([name, hits]) => [
          name,
          Number((hits / iterations).toFixed(3)),
        ])
      ),
      distinctTopPlayerAt206: topAt206.size,
      distinctTopPlayerAt305: topAt305.size,
    };
    console.info('Mock draft calibration:', summary);

    expect(summary.averageQbsFirst50Fresh).toBeGreaterThanOrEqual(4);
    expect(summary.averageQbsFirst50Fresh).toBeLessThanOrEqual(7);
    expect(summary.averageTesFirst50Fresh).toBeGreaterThanOrEqual(4);
    expect(summary.averageTesFirst50Fresh).toBeLessThanOrEqual(5.5);
    expect(summary.targetWindowRates['Trey McBride']).toBeGreaterThanOrEqual(0.6);
    expect(summary.targetWindowRates['Brock Bowers']).toBeGreaterThanOrEqual(0.6);
    expect(summary.targetWindowRates['Josh Allen']).toBeGreaterThanOrEqual(0.55);
    expect(summary.targetWindowRates['Lamar Jackson']).toBeGreaterThanOrEqual(0.55);
    expect(summary.distinctTopPlayerAt206).toBeGreaterThan(1);
    expect(summary.distinctTopPlayerAt305).toBeGreaterThan(1);
  }, 90_000);
});
