# Mock draft

A drafter can practice in the local room, make their own picks, let CPU teams advance, and undo or restart without sending picks to a provider.

## Sub-features

- `mock-start`: Open setup and start a mock with the confirmed keeper list.
- `mock-pick`: Draft an available player on the user's turn.
- `mock-cpu`: Advance one CPU turn or run to the next user pick.
- `mock-recovery`: Undo, restart, branch, or exit the mock.

## How to get to it (user POV)

- Open `/draft` and choose `Start mock` at the top of the workspace.
- In the setup dialog, review `League teams`, `Your draft slot`, `Randomness`, and `Draft seed`, then choose `Start mock draft`.
- Once active, use `Draft` in the Players or Queue tab; use `CPU pick`, `To my pick`, or `Settings` above the board.
- In `Settings`, use `Undo`, `Restart`, `Create branch`, or `Exit mock`.

## Driving it with agent-browser

Preconditions: `control.py doctor "$RUN_ID"` passes. Record the active league profile and mock keeper readiness from the draft-status control. Quick mock has no keepers; Primary League practice requires its validated keeper list. Do not force the start button when keeper validation disables it.

- `mock-start`: `agent-browser --session "$RUN_ID" click 'button:has-text("Start mock")'`; `snapshot -i` must show dialog `Start a mock draft` and the settings. Click the fresh `Start mock draft` button ref. Require the top control to change to `Settings` and mock controls to appear.
- `mock-pick`: If it is not the user's turn, click `To my pick` and wait for `Your selection` in `Settings`. Open Players and click an enabled `Draft` button from a visible row. Capture the before and after board, then open Roster as a second view to require that player on the user's roster.
- `mock-cpu`: On a CPU turn, click `CPU pick` for one pick or `To my pick` to stop at the next user turn. Verify the board's overall pick advances and the chosen CPU player's card appears. `To my pick` disables on the user's turn.
- `mock-recovery`: Open `Settings`; click `Undo` after an ordinary pick and require that pick to disappear. A reserved keeper turn is automatically consumed again. Make several ordinary selections before `Create branch`, set `Branch at overall pick` to an earlier selection, and require later ordinary picks to disappear while earlier picks and keeper reservations remain. Then `Restart` returns to the initial board with keepers retained. `Exit mock` returns to setup with `Start mock` available again.

## Gotchas

- Keeper supply depends on the active league profile. Record its count on each run; do not require the Primary League's keepers in Quick mock.
- Player and CPU picks mutate only the private copied app and isolated browser session. Never treat them as live provider picks.
- The user's turn depends on the selected draft slot. Check the turn indicator before expecting `Draft` or `CPU pick` to enable.

## CLI cross-check

The CLI reads provider snapshots and archives, not the browser mock store. It cannot start a mock, make or undo picks, run CPU turns, branch, restart, or inspect this mock roster. Offline replay reconstructs recorded provider history and is separate coverage, not proof of mock recovery. See [CLI and replay](cli-and-replay.md) for commands and evidence requirements.
