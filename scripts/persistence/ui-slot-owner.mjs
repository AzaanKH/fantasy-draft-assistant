import assert from 'node:assert/strict';

export function scoreSlotOwnership(proof) {
  const expected = ['user-choice', 'reload', 'reconnect', 'stale-cross-draft-url', 'return-to-draft', 'second-tab', 'two-tab-slot-change', 'two-tab-reload'];
  return proof?.checks?.length === expected.length && proof.checks.every((row, index) => row.kind === expected[index] && row.expected === [6, 6, 6, 1, 6, 6, 8, 8][index] && row.actual === row.expected) &&
    proof.commands?.length === 2 && proof.commands.every((row, index) => row.outcome === 'ack' && row.requested === [6, 8][index] && row.committed === row.requested && Number.isFinite(row.revision)) && proof.checks.at(-1).actual === 8;
}

export async function checkSlotOwnership({ ctxInfo, ids: [id, other], openTab, readCommitted, drained, proof = { commands: [], checks: [] }, record = async () => {} }) {
  const actors = [];
  const check = async (kind, actual, expected) => {
    proof.checks.push({ kind, actual, expected });
    await record();
    assert.equal(actual, expected, `u12 ${kind}: STOP without retry`);
  };
  const url = (draft, position) => {
    const target = new URL('/draft', actors[0].page.url());
    for (const [key, value] of Object.entries({ provider: 'sleeper', draftId: draft, position: String(position) })) target.searchParams.set(key, value);
    return target.href;
  };
  const slot = async (actor, expected) => {
    await actor.ctx.getByRole('button', { name: 'Manage Sleeper draft connection', exact: true }).click();
    const select = actor.ctx.getByRole('combobox', { name: 'Your draft slot', exact: true });
    await actor.page.waitForFunction(value => document.querySelector('select[aria-label="Your draft slot"]')?.value === String(value), expected);
    const selected = Number(await select.inputValue());
    await actor.page.keyboard.press('Escape');
    return selected;
  };
  const change = async (actor, position) => {
    await actor.ctx.getByRole('button', { name: 'Manage Sleeper draft connection', exact: true }).click();
    const command = { id: `u12-slot-${proof.commands.length + 1}`, requested: position, startedAt: Date.now(), outcome: 'pending' };
    proof.commands.push(command); await record();
    await actor.ctx.getByRole('combobox', { name: 'Your draft slot', exact: true }).selectOption(String(position));
    await drained(actor.ctx);
    await actor.page.waitForFunction(value => new URL(location.href).searchParams.get('position') === String(value), position);
    const committed = await readCommitted(actor.page, id);
    command.committed = committed.myPickPosition; command.revision = committed.revision;
    command.outcome = command.committed === position ? 'ack' : 'error'; await record();
    assert.equal(command.outcome, 'ack', 'Slot command did not commit: STOP without retry');
    await actor.page.keyboard.press('Escape');
  };
  try {
    const first = await openTab(ctxInfo, id); actors.push(first);
    await change(first, 6);
    await check('user-choice', (await readCommitted(first.page, id)).myPickPosition, 6);
    await first.page.reload(); await first.page.waitForFunction(() => new URL(location.href).searchParams.get('position') === '6');
    await check('reload', await slot(first, 6), 6);
    await first.page.goto(url(id, 2)); await first.page.waitForFunction(() => new URL(location.href).searchParams.get('position') === '6');
    await check('reconnect', await slot(first, 6), 6);
    await first.page.goto(url(other, 19)); await first.page.waitForFunction(() => new URL(location.href).searchParams.get('position') === '1');
    assert.equal((await readCommitted(first.page, other)).myPickPosition, 1);
    await check('stale-cross-draft-url', await slot(first, 1), 1);
    await first.page.goto(url(id, 2)); await first.page.waitForFunction(() => new URL(location.href).searchParams.get('position') === '6');
    await check('return-to-draft', await slot(first, 6), 6);
    const second = await openTab(ctxInfo, id, 'tab1'); actors.push(second);
    await second.page.waitForFunction(() => new URL(location.href).searchParams.get('position') === '6');
    await check('second-tab', await slot(second, 6), 6);
    await first.page.bringToFront(); await change(first, 8);
    await second.page.bringToFront();
    await second.page.waitForFunction(() => new URL(location.href).searchParams.get('position') === '8');
    await check('two-tab-slot-change', await slot(second, 8), 8);
    await second.page.reload(); await second.page.waitForFunction(() => new URL(location.href).searchParams.get('position') === '8');
    await check('two-tab-reload', (await readCommitted(second.page, id)).myPickPosition, 8);
    assert(scoreSlotOwnership(proof), 'Incomplete u12 slot proof');
    return proof;
  } catch (error) {
    error.slotOwnership = proof;
    throw error;
  } finally { for (const actor of actors) await actor.page.close(); }
}
