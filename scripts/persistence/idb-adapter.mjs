import { getBrowserWorkspace } from '/src/workspace/browser-workspace.ts';
import { getHarnessBinding } from '/src/workspace/harness-workspace.ts';
import { createSlotSequence } from '/@fs/SHARED_ROOT/draft-order.ts';

export async function attach({ session, actor }) {
  const mounted = getBrowserWorkspace();
  const binding = getHarnessBinding();
  const identity = { provider: 'sleeper', draftId: session };
  const workspace = await binding.bind(identity);
  await mounted.sendDurable(['setConfig', { totalTeams: 20, totalRounds: 20, draftType: 'linear' }]);
  const send = (...command) => mounted.sendDurable(command);
  const order = createSlotSequence({ type: 'linear', teams: 20, rounds: 20 });
  const snapshot = () => {
    const state = mounted.draft.getState();
    return structuredClone({ identity: state.liveSession, mode: state.sessionMode, picks: state.draftHistory,
      shortlist: state.shortlistedPlayerIds, progress: state.draftProgress,
      errors: binding.errors.map(({ phase, error }) => ({ phase, message: String(error) })) });
  };
  const inspect = async () => {
    await workspace.refresh();
    const head = await workspace.readPersisted();
    return { head, rawHead: JSON.stringify(head), journals: [] };
  };
  const issue = async cmd => {
    let accepted;
    if (cmd.type === 'pick') {
      accepted = (await send('recordProvisionalPick', { pickNumber: cmd.slot, playerId: cmd.player, playerName: cmd.player,
        position: 'WR', teamIndex: order.at(cmd.slot).teamIndex, teamName: `Team ${order.at(cmd.slot).slot}` })).result;
    } else if (cmd.type === 'shortlistAdd') {
      const committed = await send('addShortlistedPlayer', cmd.player);
      accepted = committed.session.shortlistedPlayerIds.includes(cmd.player);
    } else if (cmd.type === 'shortlistRemove') {
      const committed = await send('removePlayerFromShortlist', cmd.player);
      accepted = !committed.session.shortlistedPlayerIds.includes(cmd.player);
    } else if (cmd.type === 'shortlistMove') {
      const committed = await send('moveShortlistedPlayerTo', cmd.player, cmd.toIndex);
      accepted = committed.session.shortlistedPlayerIds[cmd.toIndex] === cmd.player;
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
        const cmd = i % 2 === 0 ? { id: player, type: 'pick', player, slot: actor * (count / 2) + i / 2 + 1 }
          : { id: player, type: 'shortlistAdd', player };
        issued.push(await issue(cmd));
      }
      return issued;
    } };
  return { origin: location.origin, url: location.href, documentId: performance.timeOrigin,
    key: `fantasy-draft-workspace-v2:${session}`, workspaceModuleUrl: '/src/workspace/browser-workspace.ts',
    adapterModuleUrl: import.meta.url, initial: snapshot(), secure: isSecureContext, indexedDB: !!indexedDB, locks: !!navigator.locks };
}
