/** Browser-only HTTP fixture. Keep the input files unchanged and retain their real identities. */
export function buildCatalogFixture(input, identities, predictions) {
  const snapshot = structuredClone(input);
  const identityByRank = new Map();
  const canonical = new Set();
  const sleeper = new Set();
  for (const player of identities.players) {
    if (!player.canonicalId || !player.sleeperId || !player.fantasyProsId ||
        identityByRank.has(player.fantasyProsId) || canonical.has(player.canonicalId) || sleeper.has(player.sleeperId)) {
      throw new Error('Catalog fixture requires unique real canonical, Sleeper and FantasyPros identities');
    }
    identityByRank.set(player.fantasyProsId, player);
    canonical.add(player.canonicalId); sleeper.add(player.sleeperId);
  }
  const ranked = new Set(snapshot.rankings.map(row => row.fantasyProsId));
  if (ranked.size !== snapshot.rankings.length || [...ranked].some(id => !identityByRank.has(id))) throw new Error('Rankings have duplicate or unknown identities');
  const points = new Map(predictions.players.map(row => [row.playerId, row.baseProjectedPoints]));
  const ranksByPosition = new Map();
  for (const row of snapshot.rankings) ranksByPosition.set(row.position, Math.max(ranksByPosition.get(row.position) ?? 0, row.positionalRank));
  for (const player of identities.players) {
    if (ranked.has(player.fantasyProsId)) continue;
    const rank = snapshot.rankings.length + 1;
    const positionalRank = (ranksByPosition.get(player.position) ?? 0) + 1;
    ranksByPosition.set(player.position, positionalRank);
    const identity = { fantasyProsId: player.fantasyProsId, name: player.name, position: player.position, team: player.team };
    snapshot.rankings.push({ ...identity, rank, byeWeek: 0, positionalRank, bestRank: rank, worstRank: rank, avgRank: rank });
    snapshot.projections.push({ ...identity, projectedPoints: points.get(player.canonicalId) ?? 0 });
    ranked.add(player.fantasyProsId);
  }
  snapshot.metadata = { ...snapshot.metadata, source: 'Browser persistence proof fixture expanded from installed demo identities',
    sourceType: 'fixture', rankingCount: snapshot.rankings.length, projectionCount: snapshot.projections.length };
  return { snapshot, catalog: snapshot.rankings.map(row => ({ id: identityByRank.get(row.fantasyProsId).canonicalId,
    sleeperId: identityByRank.get(row.fantasyProsId).sleeperId, fantasyProsId: row.fantasyProsId,
    name: row.name, position: row.position, team: row.team })) };
}
