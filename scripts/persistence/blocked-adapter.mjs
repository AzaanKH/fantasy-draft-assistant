export function installBlockedAdapter({ session, actor }) {
  const error = document.querySelector('[data-storage-blocked]')?.getAttribute('data-storage-blocked') ||
    (!document.querySelector('#error-state')?.hidden && document.querySelector('#error-state')?.textContent?.trim());
  if (!error) throw new Error('Missing explicit storage setup error');
  const entries = () => Object.keys(localStorage).filter(key => key.startsWith('fantasy-draft-session')).sort().map(key => [key, localStorage.getItem(key)]);
  const writableOwnerAbsent = () => location.protocol === 'chrome-extension:'
    ? !document.querySelector('#sidepanel-frame')?.getAttribute('src')
    : typeof window.__persistenceHasOwner === 'function' && !window.__persistenceHasOwner();
  if (!writableOwnerAbsent()) throw new Error('A blocked view still has a writable workspace');
  const initialBytes = entries();
  const snapshot = () => ({ identity: null, mode: 'setup', picks: [], shortlist: [], errors: [], blocked: true, setupError: error, ownerAbsent: writableOwnerAbsent() });
  const issue = async cmd => {
    if (!writableOwnerAbsent()) throw new Error('A blocked command reached a writable workspace');
    return { cmd, receipt: { accepted: false, reason: error }, at: performance.timeOrigin + performance.now() };
  };
  window.persistenceHarness = { snapshot, issue, inspect: () => ({ blocked: true, setupError: error, initialBytes, bytes: entries(), ownerAbsent: writableOwnerAbsent() }),
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
    explicitSetupError: before.ownerAbsent === true && after.ownerAbsent === true && before.blocked === true && after.blocked === true && Boolean(before.setupError) && Boolean(after.setupError),
    unchanged: JSON.stringify(before.initialBytes) === JSON.stringify(before.bytes) && JSON.stringify(before.bytes) === JSON.stringify(after.bytes) };
}
