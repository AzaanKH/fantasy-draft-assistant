# Draft Workspace and local queue

The Draft Workspace shows the snake draft board and an available-player area with Players, Suggestions, Queue, and Roster tabs. A manager can add an available player to the local shortlist without submitting a provider pick.

## Sub-features

- `workspace.root-redirect`: `/` resolves to `/draft`.
- `workspace.board`: the Draft board shows teams, rounds, keeper slots, and the active pick.
- `workspace.player-pool`: the Players tab lists available players with position filters and search.
- `workspace.local-shortlist`: `Add <player> to local shortlist` adds one player.
- `workspace.queue-view`: the Queue tab shows the same player and exposes `Remove <player> from queue`.

## How to get to it (user POV)

- Open `http://localhost:3000/` and let the app replace the route with `/draft`.
- Open `http://localhost:3000/draft` directly.
- From Assistant, use the `Draft` button in `Primary navigation`.

## Driving it with Playwright verifier

Preconditions: doctor passes, the browser context has no saved provider connection, and player data has loaded.

- Root and direct route, local shortlist, and Queue confirmation:

  ```bash
  node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" workspace-queue
  ```

  The scenario first checks that `/` becomes `/draft`, then loads `/draft`, waits for `Draft board` and `Draft tools`, clicks the first button named `Add <player> to local shortlist`, opens the `Queue` tab, and requires `Remove <player> from queue`. The Queue panel is the second read-only view.

- Header return from Assistant:

  ```bash
  node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" assistant-navigation
  ```

  The last step clicks `Draft` inside `Primary navigation` and requires the `/draft` route. Keep this result separate from the queue proof.

## Gotchas

- The draft board is tall and scrollable. Use role and label locators, not coordinates.
- A browser profile may restore `fantasy-draft-live-sync-v1` and silently reconnect to a real draft. The helper's fresh context prevents that.
- The queue is browser memory, not server state. Confirm it in the Queue tab before closing the context.
- `Draft` buttons that record picks appear only during a mock. The local shortlist action is safe in preview mode.
