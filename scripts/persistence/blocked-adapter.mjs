export function installBlockedAdapter({ session, actor }) {
  const error = document.querySelector('[data-storage-blocked]')?.getAttribute('data-storage-blocked') ||
    (!document.querySelector('#error-state')?.hidden && document.querySelector('#error-state')?.textContent?.trim());
  if (!error) throw new Error('Missing explicit storage setup error');
  const entries = () => Object.keys(localStorage).filter(key => key.startsWith('fantasy-draft-session')).sort().map(key => [key, localStorage.getItem(key)]);
  const initialBytes = entries();
  const snapshot = () => ({ identity: null, mode: 'setup', picks: [], shortlist: [], errors: [], blocked: true, setupError: error });
  const issue = async cmd => ({ cmd, receipt: { accepted: false, reason: error }, at: performance.timeOrigin + performance.now() });
  window.persistenceHarness = { snapshot, issue, inspect: () => ({ blocked: true, setupError: error, initialBytes, bytes: entries() }),
    async stress(_seed, count) {
      const rows = [];
      for (let i = 0; i < count; i++) rows.push(await issue({ id: `${actor}:${i}`, type: 'shortlistAdd', player: `${actor}:${i}` }));
      return rows;
    } };
  return { origin: location.origin, documentId: performance.timeOrigin, session, blocked: true, setupError: error, initialBytes };
}

export function auditBlocked(issued, before, after) {
  return { attempted: issued.length, acknowledged: issued.filter(row => row.receipt.accepted).length,
    rejected: issued.filter(row => !row.receipt.accepted && row.receipt.reason).length,
    explicitSetupError: before.blocked === true && after.blocked === true && Boolean(before.setupError) && Boolean(after.setupError),
    unchanged: JSON.stringify(before.initialBytes) === JSON.stringify(before.bytes) && JSON.stringify(before.bytes) === JSON.stringify(after.bytes) };
}
