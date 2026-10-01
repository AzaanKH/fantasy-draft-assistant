import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createDefaultLeagueSettings, createLeagueSettings, type DraftPickEvent, type DraftSyncSnapshot, type Position } from '@fantasy-draft/shared';

export const FIXTURE_NOW = Date.parse('2026-09-10T12:00:00.000Z');
const timestamp = new Date(FIXTURE_NOW).toISOString();
const positions: readonly Position[] = ['RB', 'WR', 'WR', 'RB', 'QB', 'TE', 'K', 'DEF'];
export const fixtureSettings = createLeagueSettings({ ...createDefaultLeagueSettings(FIXTURE_NOW),
  source: 'sleeper', leagueId: 'fixture-league', keepersEnabled: true }, FIXTURE_NOW);

export function fixturePick(pickNumber: number, playerNumber: number, overrides: Partial<DraftPickEvent> = {}): DraftPickEvent {
  return { draftId: 'fixture', pickNumber, round: Math.ceil(pickNumber / 10),
    rosterId: pickNumber, draftSlot: pickNumber, teamIndex: pickNumber - 1,
    playerId: `p${String(playerNumber)}`, playerName: `Player ${String(playerNumber)}`,
    position: positions[(playerNumber - 1) % positions.length]!, nflTeam: 'DET', isKeeper: false,
    source: 'sleeper-api', confidence: 'confirmed', observedAt: FIXTURE_NOW, ...overrides };
}

export function fixtureSnapshot(overrides: Partial<DraftSyncSnapshot> = {}): DraftSyncSnapshot {
  return { provider: 'sleeper', draftId: 'fixture', status: 'synced', lastPolledAt: FIXTURE_NOW,
    lastSuccessfulSyncAt: FIXTURE_NOW, lastError: null,
    draft: { provider: 'sleeper', draftId: 'fixture', providerKey: 'fixture', leagueId: 'fixture-league',
      leagueSettings: fixtureSettings, status: 'drafting', type: 'snake',
      settings: { teams: 10, rounds: 14, pickTimer: 60 }, draftOrder: null },
    picks: [fixturePick(1, 1)], ...overrides };
}

export async function writeFixtureData(root: string): Promise<void> {
  const rankings = Array.from({ length: 350 }, (_, index) => ({
    fantasyProsId: `fp${String(index + 1)}`, rank: index + 1, name: `Player ${String(index + 1)}`,
    position: positions[index % positions.length]!, team: 'DET', byeWeek: 5,
    positionalRank: Math.floor(index / positions.length) + 1,
    bestRank: index + 1, worstRank: index + 1, avgRank: index + 1,
  }));
  const identities = Array.from({ length: 850 }, (_, index) => ({
    canonicalId: `p${String(index + 1)}`, fantasyProsId: `fp${String(index + 1)}`,
    sleeperId: `p${String(index + 1)}`, name: `Player ${String(index + 1)}`,
    aliases: [], position: positions[index % positions.length]!, team: 'DET',
  }));
  const artifacts = {
    'data/fantasypros-snapshot.json': { metadata: { season: 2026, sourceType: 'manual-refresh',
      source: 'fixture', refreshedAt: timestamp, rankingCount: 350, adpCount: 0, projectionCount: 350, newsCount: 0 },
      rankings, projections: rankings.map(row => ({ ...row, projectedPoints: 400 - row.rank * 0.65 })), adp: [], news: [] },
    'data/player-identity.json': { generatedAt: timestamp, season: 2026, players: identities,
      coverage: { fantasyProsRankingMatchRate: 1, matchedDefenses: 32 } },
    'data/sleeper-adp.json': { fetchedAt: timestamp, source: 'fixture', playerCount: 350,
      players: rankings.map(row => ({ ...row, playerId: `p${String(row.rank)}`, sleeperAdp: row.rank + 3,
        age: 25, yearsExp: 3, status: 'Active' })) },
    'data/primary-league-settings.json': { season: 2026, leagueName: 'Ummati Official', source: 'sleeper',
      confirmedAt: timestamp, totalTeams: 10, totalRounds: 14,
      scoring: { passingTouchdown: 4, reception: 1, tightEndReceptionPremium: 0.5, rushAttemptBonus: 0.2 },
      roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DEF: 0, BENCH: 5 } },
    'data/league-history/current-keepers.json': { updatedAt: timestamp, season: 2026,
      keepers: Array.from({ length: 10 }, (_, index) => ({ playerName: `Player ${String(2 + index * 8)}`,
        position: 'WR', team: index + 1, round: 14 })) },
  };
  await Promise.all(Object.entries(artifacts).map(async ([path, value]) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(value));
  }));
}
