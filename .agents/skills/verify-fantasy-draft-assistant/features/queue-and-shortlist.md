# Queue and shortlist

A drafter can save an available player to a local queue, see the same player in the Queue tab, and remove the player again.

## Sub-features

- `queue-pool`: Add from the Players tab.
- `queue-best-pick`: Add the current Best Pick from the bar below the board.
- `queue-suggestion`: Add from a Suggestions card.
- `queue-assistant`: Add from the Assistant recommendation.
- `queue-remove`: Remove from the Queue tab.
- `queue-assistant-pool`: Add from an Assistant player row or recommendation card.
- `queue-depth`: Add from the roster-needs positional-depth table.
- `queue-undo`: Undo a queue addition or removal from its toast.

## How to get to it (user POV)

- From `/draft`, scroll to `Draft tools` > `Players` and use the add button in a player row.
- From `/draft`, use the queue button in `Current Best Pick`.
- From `/draft`, open `Suggestions` and use a card's `Queue` button.
- From `/assistant`, use `Add to queue` beside the selected recommendation.
- From `/draft`, open the `Queue` tab to inspect or remove saved players.

## Driving it with agent-browser

Preconditions: `control.py doctor "$RUN_ID"` passes, the page is `/draft`, recommendations have loaded, and the Queue tab starts empty for an isolated browser session. Save the first `snapshot -i` to `$EVIDENCE/shortlist-before.txt` and a screenshot to `$EVIDENCE/shortlist-before.png`.

- `queue-pool`: Scroll until Players rows are visible. Choose one named player from the snapshot and click its exact `Add <player name> to local shortlist` button. Save a new snapshot. Require that button's accessible name to change to `Remove <same player> from local shortlist` and the Queue tab count to rise by one. This path was proven with Ja'Marr Chase.
- `queue-best-pick`: Start with an empty queue. Run `agent-browser --session "$RUN_ID" click 'section[aria-label="Current Best Pick"] button[aria-label^="Add "][aria-label$=" to the local queue"]'`. Require `Remove <same player> from the local queue`, then confirm the Queue tab row. Do not count the pool path as proof of this entry point.
- `queue-suggestion`: Start with an empty queue. Scroll to Draft tools and click `'[role="tab"][aria-controls$="-content-suggestions"]'`. Take a snapshot, select the first visible `Queue` button in the Suggestions tabpanel, and click its fresh ref. Require that card's button to read `Queued`, then confirm the player in Queue. `Queue` is hidden in favor of `Draft` on the user's ordinary mock turn when that player can be drafted.
- `queue-assistant`: Start with an empty queue. Open `/assistant` through the header and click the `Add to queue` button beside the selected recommendation. Require `In draft queue`; return to Draft workspace and confirm the Queue tab row.
- `queue-remove`: Scroll until the Queue tab strip is visible. Run `agent-browser --session "$RUN_ID" click '[role="tab"][aria-controls$="-content-queue"]'`, then `snapshot -i`. Require a selected `Queue 1` tab, a `Queue 1` tabpanel, and `Remove <same player> from queue`. Save `$EVIDENCE/shortlist-queue.txt`, `$EVIDENCE/shortlist-queue.png`, and the panel text. Click that remove button, then require `Your draft queue is empty` and a zero count.

The baseline browser proof used `shortlist-before.txt/png`, `shortlist-action.txt/png`, `shortlist-queue.txt/png`, and `shortlist-queue-content.txt` in one evidence directory. For a new run, record the chosen player name and each entry point in a short text file alongside the captures.
- `queue-assistant-pool`: On Assistant, find one named pool row or card, use its queue button, and confirm that player in the draft Queue tab. Test row and card layouts separately when affected. Sources: `AssistantPage.tsx`, `AssistantRecommendationCard.tsx`.
- `queue-depth`: Open `What does my roster need?`, choose an available position/tier in Positional depth, and use `Add <name> to queue`. Confirm the same player in Queue. Source: `PositionalDepthChart.tsx`.
- `queue-undo`: After one add, immediately click the toast `Undo` and require the prior queue state. Repeat after removing a queued player. Source: `useQueueActions.ts`.

## Gotchas

- `local shortlist` and `queue` label the same saved list. It is local to the current browser draft state and is not a provider pick.
- A click can complete before the browser snapshot reflects a React update. Check the count and accessible label after the action, not the click exit code alone.
- At shorter window heights, the notification stack can cover a Queue row's remove button. Scroll the workspace so the row clears the stack, or dismiss the earlier add notification before removing. Require the empty Queue state and the named player's removal notification before Undo; target that notification's Undo when several notices exist.
- The tab strip sits below a tall board. Scroll it into view before clicking and confirm that `Queue` becomes selected.

## CLI cross-check

The CLI has no queue commands and cannot read this browser-owned list. `players` or `recommend` can corroborate connected player data, but cannot verify queue mutations, counts, feedback, or any add/remove entry point. Keep every queue path browser-driven. See [CLI and replay](cli-and-replay.md) for commands and evidence requirements.
