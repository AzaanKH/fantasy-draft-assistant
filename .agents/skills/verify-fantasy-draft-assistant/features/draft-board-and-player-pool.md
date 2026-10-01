# Draft board and player pool

A drafter can inspect the snake draft board and narrow the available player list without changing picks.

## Sub-features

- `board-current`: See the current pick and keeper positions.
- `board-full`: Switch to the full all-team grid.
- `pool-search`: Find available players by name or team.
- `pool-position`: Show only a position or FLEX candidates.
- `tools-tabs`: Open Players, Suggestions, Queue, and Roster views.
- `board-height`: Resize the board and retain its height after reload.
- `tools-collapse`: Collapse and expand the player workspace.

## How to get to it (user POV)

- Open the draft workspace at `/draft` or use the header's `Draft workspace` button from Assistant.
- Use `Current pick` or `Full board` in the `Draft board` region.
- Scroll to `Draft tools`. The `Players` tab contains `Search available players` and the `ALL`, `FLEX`, `QB`, `RB`, `WR`, `TE`, `K`, and `DEF` buttons. The other tabs are `Suggestions`, `Queue`, and `Roster`.

## Driving it with agent-browser

Preconditions: `control.py doctor "$RUN_ID"` passes and the browser session starts at the private run's `/draft` URL. Wait for the `Draft board` and `Draft tools` regions in `snapshot -i`.

- `board-current`: `agent-browser --session "$RUN_ID" find role button click --name 'Current pick'`, then `snapshot -i`. The board shows the active overall pick and existing keeper cards.
- `board-full`: `agent-browser --session "$RUN_ID" find role button click --name 'Full board'`, then capture a screenshot. Verify the selected mode and full all-team grid; both modes contain all rounds. On mobile the current view centers three teams. Return with `Current pick`, or `Current` on mobile, before another recipe.
- `pool-search`: `agent-browser --session "$RUN_ID" fill 'input[placeholder="Search players or teams"]' Chase`, then capture `snapshot -i`. A matching player row must remain. Clear with `agent-browser --session "$RUN_ID" fill 'input[placeholder="Search players or teams"]' ''` to restore the list. Use a name actually present in the baseline snapshot when data changes.
- `pool-position`: `agent-browser --session "$RUN_ID" find role button click --name RB`, then capture the player pool and require visible rows to carry `RB`. Return with `ALL`. Use the button ref from `snapshot -i` if the name is ambiguous.
- `tools-tabs`: Scroll until the tab strip is visible. `agent-browser --session "$RUN_ID" click '[role="tab"][aria-controls$="-content-suggestions"]'` opens Suggestions. Use the same suffix with `-content-queue`, `-content-roster`, and `-content-players`; after each click, `snapshot -i` must show the corresponding selected tab and tabpanel.
- `board-height`: Change the `Board height` slider with keyboard arrows, check its pixel value and visible board height, then reload and require the saved value. Source: `DraftBoard.tsx`.
- `tools-collapse`: Click `Collapse player workspace`, require `aria-expanded=false`, then `Expand player workspace` and require the selected panel to return. Source: `DraftDock.tsx`.

## Gotchas

- The board is tall. Scroll to the tab strip before clicking it; a click on an offscreen tab may report success without changing the selected tab.
- Search and filter work on available recommendations. Keeper or drafted players may be absent.
- `Full board` changes display only. It does not advance the draft.

## CLI cross-check

For a matching provider session, `status` and `players --available --search TEXT --position RB --json` add machine-readable evidence. CLI player results use ECR order and canonical-ID search, lack FLEX, and have a configurable limit. The browser uses the selected decision lens and caps its pool at 60 rows. CLI results do not prove board modes, layout, filters, or tab controls. See [CLI and replay](cli-and-replay.md) for commands and evidence requirements.
