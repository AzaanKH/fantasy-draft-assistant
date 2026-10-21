import { useDraftStore } from '/src/stores/draftStore.ts';
import { getDraftSessionStorageKey } from '/src/stores/draftSessionStorage.ts';
import { createSlotSequence } from '/@fs/SHARED_ROOT/draft-order.ts';

export function attach({ session, actor }) {
  const identity = { provider: 'sleeper', draftId: session };
  const key = getDraftSessionStorageKey(identity);
  const errors = [];
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (name, value) {
    try { return originalSet.call(this, name, value); }
    catch (error) { errors.push({ name, error: error.name, message: error.message }); throw error; }
  };
  useDraftStore.getState().setLiveDraftSession(identity);
  useDraftStore.getState().setSessionMode('live');
  useDraftStore.getState().setConfig({ totalTeams: 20, totalRounds: 20, draftType: 'linear' });
  const order = createSlotSequence({ type: 'linear', teams: 20, rounds: 20 });
  const snapshot = () => {
    const state = useDraftStore.getState();
    return structuredClone({ identity: state.liveSession, mode: state.sessionMode,
      picks: state.draftHistory, shortlist: state.shortlistedPlayerIds, progress: state.draftProgress, errors });
  };
  const inspect = () => ({ head: JSON.parse(localStorage.getItem(key)), journals: Object.keys(localStorage)
    .filter(name => name.startsWith(`fantasy-draft-session-unconfirmed-v1:sleeper:${session}:`))
    .map(name => ({ key: name, value: JSON.parse(localStorage.getItem(name)) })) });
  const issue = async cmd => {
    const state = useDraftStore.getState();
    let accepted;
    if (cmd.type === 'pick') {
      accepted = state.recordProvisionalPick({ pickNumber: cmd.slot, playerId: cmd.player, playerName: cmd.player,
        position: 'WR', teamIndex: order.at(cmd.slot).teamIndex, teamName: `Team ${order.at(cmd.slot).slot}` });
    } else if (cmd.type === 'shortlistAdd') {
      if (!state.shortlistedPlayerIds.includes(cmd.player)) state.togglePlayerShortlisted(cmd.player);
      accepted = useDraftStore.getState().shortlistedPlayerIds.includes(cmd.player);
    } else if (cmd.type === 'shortlistRemove') {
      state.removePlayerFromShortlist(cmd.player);
      accepted = !useDraftStore.getState().shortlistedPlayerIds.includes(cmd.player);
    } else if (cmd.type === 'shortlistMove') {
      state.moveShortlistedPlayer(cmd.player, cmd.toIndex - state.shortlistedPlayerIds.indexOf(cmd.player));
      accepted = useDraftStore.getState().shortlistedPlayerIds[cmd.toIndex] === cmd.player;
    } else throw new Error(`Unknown command ${cmd.type}`);
    return { cmd, receipt: { accepted }, at: performance.timeOrigin + performance.now() };
  };
  window.persistenceHarness = { snapshot, inspect, issue,
    async stress(seed, count) {
      let randomState = seed >>> 0;
      const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
      const issued = [];
      for (let i = 0; i < count; i++) {
        await new Promise(resolve => setTimeout(resolve, Math.floor(random() * 6)));
        const player = `${actor}:${i}`;
        const cmd = i % 2 === 0
          ? { id: player, type: 'pick', player, slot: actor * (count / 2) + i / 2 + 1 }
          : { id: player, type: 'shortlistAdd', player };
        issued.push(await issue(cmd));
      }
      return issued;
    },
  };
  return { origin: location.origin, url: location.href, key, storeModuleUrl: '/src/stores/draftStore.ts', adapterModuleUrl: import.meta.url,
    initial: snapshot(), secure: isSecureContext, indexedDB: !!indexedDB, locks: !!navigator.locks };
}
