export function conflictDialog(document, playerId, onClick = () => {}, beforeClick = () => {}) {
  const node = document.createElement('section');
  node.innerHTML = '<select data-slot><option value=""></option><option value="1">Pick 1</option><option value="2">Pick 2</option></select><select data-player><option value=""></option></select><button>Record Provisional Pick</button><p role="alert"></p>';
  const slot = node.querySelector('[data-slot]'), player = node.querySelector('[data-player]'), button = node.querySelector('button'), alert = node.querySelector('[role="alert"]');
  const option = document.createElement('option'); option.value = playerId; player.append(option); document.body.append(node);
  const handle = value => ({ evaluate: async (fn, arg) => fn(value, arg), dispose: async () => {} });
  const control = element => ({ elementHandle: async () => element, selectOption: async ({ value }) => { element.value = value; }, inputValue: async () => element.value });
  for (const element of [slot, player, button]) element.dispose = async () => {};
  button.addEventListener('click', onClick);
  const dialog = { getByLabel: label => control(label === 'Observed player' ? player : slot),
    getByRole: role => role === 'button' ? { ...control(button), isDisabled: async () => button.disabled, click: async () => {
      beforeClick(); if (button.disabled) throw new Error('Timed out waiting for disabled Record button'); button.click();
    } } : { count: async () => alert.textContent ? 1 : 0, first: () => ({ innerText: async () => alert.textContent }) },
    evaluateHandle: async (fn, arg) => handle(fn(node, arg)), isVisible: async () => node.isConnected };
  return { dialog, node, slot, player, button, alert };
}
