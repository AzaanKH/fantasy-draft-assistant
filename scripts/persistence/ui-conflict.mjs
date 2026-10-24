import { auditPickConflict } from './ui-adapter.mjs';

export const invalidatedPick = slot => `Pick ${slot} was just recorded elsewhere. Choose a pick.`;
const selected = (value, cmd) => value?.slot === String(cmd.slot) && value.player === cmd.playerId;
const retargeted = (value, cmd) => value?.slot !== '' && value?.slot !== String(cmd.slot);
const invalidated = (value, cmd) => value.visible && value.slot === '' && value.disabled && value.alert.includes(invalidatedPick(cmd.slot));

export async function observeConflictDialog(dialog) {
  const slot = await dialog.getByLabel('Team and draft position').elementHandle();
  const player = await dialog.getByLabel('Observed player').elementHandle();
  const button = await dialog.getByRole('button', { name: 'Record Provisional Pick', exact: true }).elementHandle();
  if (!slot || !player || !button) throw new Error('Conflict controls are missing');
  const handle = await dialog.evaluateHandle((node, controls) => {
    const record = { node, ...controls, clicks: [] };
    record.listener = () => record.clicks.push({ slot: record.slot.value, player: record.player.value, disabled: record.button.disabled });
    record.button.addEventListener('click', record.listener, true);
    return record;
  }, { slot, player, button });
  return {
    snapshot: () => handle.evaluate(record => ({ slot: record.slot.value, player: record.player.value, disabled: record.button.disabled,
      visible: record.node.isConnected && record.node.getAttribute('data-state') !== 'closed',
      alert: [...record.node.querySelectorAll('[role="alert"]')].map(node => node.textContent.trim()).join('\n'), clicks: record.clicks })),
    dispose: async () => {
      try { await handle.evaluate(record => record.button.removeEventListener('click', record.listener, true)); }
      finally { await handle.dispose(); await Promise.all([slot.dispose(), player.dispose(), button.dispose()]); }
    },
  };
}

export async function prepareConflict(dialogs, commands, fill) {
  const observers = [];
  try {
    for (const [index, dialog] of dialogs.entries()) {
      await fill(dialog, commands[index]);
      observers.push(await observeConflictDialog(dialog));
    }
    const barrier = await Promise.all(observers.map(observer => observer.snapshot()));
    if (barrier.some((row, index) => !selected(row, commands[index]) || row.disabled || !row.visible || row.clicks.length)) {
      throw new Error(`Conflict barrier did not select the intended slot and player: ${JSON.stringify(barrier)}`);
    }
    return { barrier, observers };
  } catch (error) { await Promise.all(observers.map(observer => observer.dispose())); throw error; }
}

export async function submitConflict(dialog, cmd, barrier, observer, { timeoutMs = 25000, clickTimeoutMs = 3000 } = {}) {
  if (!selected(barrier, cmd) || barrier.disabled || !barrier.visible) throw new Error('Actor never selected the intended conflict slot at the barrier');
  const beforeClick = await observer.snapshot();
  let clickError; let click;
  const finish = (outcome, final, extra = {}) => ({ outcome, ...extra, observations: { barrier, beforeClick, final } });
  if (retargeted(beforeClick, cmd)) return finish('error', beforeClick, { message: 'Conflict selection silently retargeted before click' });
  if (invalidated(beforeClick, cmd)) return finish('rejected', beforeClick, { alert: beforeClick.alert, rejectionKind: 'invalidated-selection' });
  if (!selected(beforeClick, cmd) || beforeClick.disabled) return finish('error', beforeClick, { message: 'Conflict selection changed without an explicit disabled loser outcome' });
  click = dialog.getByRole('button', { name: 'Record Provisional Pick', exact: true }).click({ timeout: clickTimeoutMs }).catch(error => { clickError = error.message; });
  const deadline = Date.now() + timeoutMs;
  let final = beforeClick;
  try {
    while (Date.now() < deadline) {
      final = await observer.snapshot();
      if (retargeted(final, cmd) || final.clicks.some(value => !selected(value, cmd) || value.disabled)) {
        return finish('error', final, { message: 'Conflict slot intent changed at or after the Record click' });
      }
      if (invalidated(final, cmd)) return finish('rejected', final, { alert: final.alert, rejectionKind: 'invalidated-selection' });
      if (final.visible && final.alert && final.clicks.length === 1) return finish('rejected', final, { alert: final.alert, rejectionKind: 'submitted-command' });
      if (!final.visible) return final.clicks.length === 1 ? finish('ack', final) : finish('error', final, { message: 'Dialog closed without an observed intended Record click' });
      if (clickError) return finish('error', final, { message: clickError });
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return finish('error', final, { message: 'Conflict dialog neither closed nor showed an explicit loser' });
  } finally { await click; }
}

export function auditObservedConflict(row) {
  const checks = auditPickConflict(row);
  const observationsValid = row.barrier?.length === 2 && row.results.length === 2 && row.results.every((result, index) => {
    const { cmd, observations: observed } = result;
    if (cmd.slot !== row.slot || !observed || !selected(row.barrier[index], cmd) || row.barrier[index].disabled || !row.barrier[index].visible ||
        JSON.stringify(observed.barrier) !== JSON.stringify(row.barrier[index]) || retargeted(observed.beforeClick, cmd) || retargeted(observed.final, cmd)) return false;
    const clicks = observed.final.clicks;
    if (clicks.some(value => !selected(value, cmd) || value.disabled) || clicks.length > 1) return false;
    if (result.outcome === 'ack') return clicks.length === 1 && !observed.final.visible;
    if (result.rejectionKind === 'invalidated-selection') return invalidated(observed.final, cmd) && !!result.alert;
    return result.rejectionKind === 'submitted-command' && clicks.length === 1 && observed.final.visible && !!observed.final.alert && !!result.alert;
  });
  return { ...checks, observationsValid, good: checks.good && observationsValid };
}
