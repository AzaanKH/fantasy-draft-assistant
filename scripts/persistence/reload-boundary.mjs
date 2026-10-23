import { audit } from './audit.mjs';

export function inspectAttachedDocument(expected) {
  if (performance.timeOrigin !== expected) throw new Error('Unexpected document replacement during storage inspection');
  if (!window.persistenceHarness) throw new Error('Persistence adapter missing in its attached document');
  return window.persistenceHarness.inspect();
}

export async function readReloadBoundary({ read, attach, recordReplacement }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const rows = await read();
    const replacements = rows.filter(row => row.kind === 'replaced');
    if (replacements.length === 0) return rows.map(row => row.snapshot);
    recordReplacement(rows);
    if (rows.some(row => row.kind === 'snapshot' && !audit([], [row.snapshot, row.snapshot]).unique)) {
      throw new Error('Duplicate players, slots or queue members at explicit reload boundary');
    }
    const errors = rows.filter(row => row.kind === 'snapshot').flatMap(row => row.snapshot.errors);
    if (errors.length) throw new Error(`Storage errors at explicit reload boundary: ${JSON.stringify(errors)}`);
    await attach(replacements.map(row => row.actor));
  }
  throw new Error('Documents kept changing at the explicit reload boundary');
}
