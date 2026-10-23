import { readFile, writeFile } from 'node:fs/promises';
import { createDraftStore } from '../../web-app/src/stores/draftStore.ts';
import { parseStoredDraftSession } from '../../web-app/src/stores/draftSessionStorage.ts';

const { ids, teams, rounds, output, processProofOutput } = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!Array.isArray(ids) || ids.some(id => !/^\d{13}$/.test(id)) || teams !== 20 || rounds !== 20 || typeof output !== 'string') throw new Error('Invalid v1 seed input');
if (processProofOutput !== undefined && typeof processProofOutput !== 'string') throw new Error('Invalid seed process proof path');
if (processProofOutput) await writeFile(processProofOutput, JSON.stringify({ execArgv: process.execArgv, node: process.version }), { flag: 'wx' });
const values = new Map();
const storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
  getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
for (const draftId of ids) {
  const store = createDraftStore({ storage, session: { provider: 'sleeper', draftId } });
  store.getState().setSessionMode('live');
  store.getState().setConfig({ totalTeams: teams, totalRounds: rounds, draftType: 'linear', myPickPosition: 1 });
  store.dispose();
  const session = parseStoredDraftSession(values.get(`fantasy-draft-session-v1:sleeper:${draftId}`), { provider: 'sleeper', draftId });
  if (!session || session.config.totalTeams !== teams || session.config.totalRounds !== rounds || session.config.draftType !== 'linear') throw new Error(`Invalid generated v1 session: ${draftId}`);
}
await writeFile(output, JSON.stringify([...values.entries()].sort(([a], [b]) => a.localeCompare(b))), { flag: 'wx' });
