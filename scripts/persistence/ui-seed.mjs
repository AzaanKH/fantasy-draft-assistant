import { readFile, writeFile } from 'node:fs/promises';
import { createDraftStore } from '../../web-app/src/stores/draftStore.ts';
import { deriveDraftCursor } from '@fantasy-draft/shared/draft';

const { ids, teams, rounds, output, processProofOutput, queues = {}, leaguePreferences } = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!Array.isArray(ids) || ids.some(id => !/^\d{13}$/.test(id)) || teams !== 20 || rounds !== 20 || typeof output !== 'string') throw new Error('Invalid v1 seed input');
if (processProofOutput !== undefined && typeof processProofOutput !== 'string') throw new Error('Invalid seed process proof path');
if (!queues || typeof queues !== 'object' || Object.entries(queues).some(([id, players]) => !ids.includes(id) || !Array.isArray(players) ||
    players.length > 4 || new Set(players).size !== players.length || players.some(player => typeof player !== 'string' || !player.trim()))) throw new Error('Invalid preflight queue fixture');
if (processProofOutput) await writeFile(processProofOutput, JSON.stringify({ execArgv: process.execArgv, node: process.version }), { flag: 'wx' });
// Older-format bytes for the importer to move: the session shape is the one the IndexedDB head keeps.
const values = new Map();
for (const draftId of ids) {
  const identity = { provider: 'sleeper', draftId };
  const store = createDraftStore({ session: identity });
  store.getState().setSessionMode('live');
  store.getState().setConfig({ totalTeams: teams, totalRounds: rounds, draftType: 'linear', myPickPosition: 1 });
  for (const playerId of queues[draftId] ?? []) store.getState().togglePlayerShortlisted(playerId);
  const state = store.getState();
  const session = { version: 1, identity, revision: 1, lineage: [], config: state.config, leagueSettings: state.leagueSettings,
    currentPick: deriveDraftCursor(state.draftHistory, state.draftProgress), draftProgress: state.draftProgress,
    draftHistory: state.draftHistory, shortlistedPlayerIds: state.shortlistedPlayerIds,
    preloadedKeepers: state.preloadedKeepers, keepersInitialized: state.keepersInitialized,
    unresolvedProviderPicks: state.unresolvedProviderPicks, decisionLens: state.decisionLens,
    manualContinuityBaselineAt: state.manualContinuityBaselineAt, lastConfirmedSyncAt: state.lastConfirmedSyncAt,
    lastConfirmedPickNumber: state.lastConfirmedPickNumber };
  store.dispose();
  if (session.config.totalTeams !== teams || session.config.totalRounds !== rounds || session.config.draftType !== 'linear') throw new Error(`Invalid generated v1 session: ${draftId}`);
  values.set(`fantasy-draft-session-v1:sleeper:${draftId}`, JSON.stringify(session));
}
if (leaguePreferences) {
  const { isLeagueSetupPreferences } = await import('@fantasy-draft/shared/draft');
  if (!isLeagueSetupPreferences(leaguePreferences)) throw new Error('Invalid fixture league preferences');
  values.set('fantasy-draft-league-setup-v1', JSON.stringify(leaguePreferences));
}
await writeFile(output, JSON.stringify([...values.entries()].sort(([a], [b]) => a.localeCompare(b))), { flag: 'wx' });
