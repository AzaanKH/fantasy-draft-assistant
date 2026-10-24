import { decodeFantasyProsSnapshot, decodePlayerIdentityFile, decodeKeeperFile, decodeSleeperDataFile, decodeDraftDataRefreshStatus } from '@fantasy-draft/shared/catalog';

export const FIXTURE_LEAGUE = { profile: 'quick-mock', quickMock: { totalTeams: 20, totalRounds: 20, reception: 1, passingTouchdown: 4 } };
export const READINESS_PATHS = ['/data/fantasypros-snapshot.json', '/data/player-identity.json', '/data/sleeper-adp.json',
  '/api/draft-data/current-keepers', '/data/league-history/current-keepers.json', '/api/draft-data/refresh', '/api/health'];

export function hasReadinessProof(meta) {
  const fixture = meta.readinessFixture;
  return JSON.stringify(fixture?.leaguePreferences) === JSON.stringify(FIXTURE_LEAGUE) && READINESS_PATHS.every(url =>
    /^[a-f0-9]{64}$/.test(fixture?.files?.[url] ?? '') && meta.productionHttp?.readinessFiles?.[url] === fixture.files[url]);
}

export function buildReadinessFixture({ snapshot, identities, sleeper, catalog }, now = Date.now()) {
  const timestamp = new Date(now - 1000).toISOString(), season = new Date(now).getUTCFullYear();
  const ranks = decodeFantasyProsSnapshot({ ...snapshot, metadata: { ...snapshot.metadata, season,
    sourceType: 'manual-refresh', source: 'Controlled offline manual-refresh fixture, reviewed real identities; not live provider data', refreshedAt: timestamp } });
  const canonical = decodePlayerIdentityFile({ ...identities, season, generatedAt: timestamp });
  const directory = decodeSleeperDataFile({ ...sleeper, fetchedAt: timestamp });
  const keepers = decodeKeeperFile({ season, updatedAt: timestamp, keepers: catalog.slice(-10).map((player, index) => ({
    playerId: player.id, playerName: player.name, position: player.position, team: index + 1, round: 14, isMyKeeper: index === 0,
  })) });
  const refresh = decodeDraftDataRefreshStatus({ state: 'idle', steps: [], startedAt: null, finishedAt: null, error: null,
    detail: 'Offline fixture is ready; no live refresh is available or invoked.' });
  return { leaguePreferences: structuredClone(FIXTURE_LEAGUE), timestamp, files: {
    '/data/fantasypros-snapshot.json': ranks, '/data/player-identity.json': canonical, '/data/sleeper-adp.json': directory,
    '/api/draft-data/current-keepers': keepers, '/data/league-history/current-keepers.json': keepers,
    '/api/draft-data/refresh': refresh, '/api/health': { status: 'ok', fixture: true },
  }, note: 'Freshness and trusted-source metadata are controlled HTTP test inputs. Ordinary quick-mock league settings fit the 20x20 fixture; runtime demo/harness flags remain absent. Product readiness and provider identity decoders remain enabled.' };
}
