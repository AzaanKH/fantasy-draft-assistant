# Draft board and player pool

A drafter can inspect the snake draft board and narrow the available player list without changing picks.

## Sub-features

- `board-current`: See the current pick and keeper positions.
- `board-full`: Switch to the full all-team grid.
- `pool-search`: Find undrafted players by name or team.
- `pool-position`: Show only a position or FLEX candidates.
- `tools-tabs`: Open the Roster, Queue, and Suggestions views, plus Players below 80rem.
- `board-height`: Resize the board and retain its height after reload.
- `tools-collapse`: Collapse and expand the player workspace.

## How to get to it (user POV)

- Open the draft workspace at `/draft` or use the header's `Draft workspace` button from Assistant.
- Use `Current pick` or `Full board` in the `Draft board` region.
- Scroll to `Draft tools`. The player pool has a `Search player or team` field and a `Filter by position` group whose buttons are named with roster fill, such as `All, 0 of 15 filled` and `RB, 0 of 2 filled`, in the order All, QB, RB, WR, TE, FLEX, K, DEF. At 80rem (1280px) and wider, the pool sits in its own column and the tabs are `Roster` (default), `Queue`, and `Suggestions`. Below 80rem, `Players` (default) joins them as a fourth tab.
- Drag the `Resize draft board` separator between the board and the tools to change the board height.

## Driving it with agent-browser

Preconditions: `control.py doctor "$RUN_ID"` passes and the browser session starts at the private run's `/draft` URL. Wait for the `Draft board` and `Draft tools` regions in `snapshot -i`.

- `board-current`: `agent-browser --session "$RUN_ID" find role button click --name 'Current pick'`, then `snapshot -i`. The board shows the active overall pick and existing keeper cards.
- `board-full`: `agent-browser --session "$RUN_ID" find role button click --name 'Full board'`, then capture a screenshot. Verify the selected mode and full all-team grid; both modes contain all rounds. On mobile the current view centers three teams. Return with `Current pick`, or `Current` on mobile, before another recipe.
- `pool-search`: `agent-browser --session "$RUN_ID" fill 'input[placeholder="Search player or team"]' Chase`, then capture `snapshot -i`. Matching rows must remain and the footer must read `N players shown` with a smaller N. Clear with `agent-browser --session "$RUN_ID" fill 'input[placeholder="Search player or team"]' ''` to restore the list. Use a name actually present in the baseline snapshot when data changes.
- `pool-position`: Click the button whose accessible name starts with `RB,` in `Filter by position`, then require `aria-pressed=true`, visible rows carrying `RB`, and a smaller `N players shown`. Return with the `All, …` button.
- `tools-tabs`: Scroll until the tab strip is visible. `agent-browser --session "$RUN_ID" click '[role="tab"][aria-controls$="-content-suggestions"]'` opens Suggestions. Use the same suffix with `-content-queue` and `-content-roster`, and with `-content-players` only below 80rem; after each click, `snapshot -i` must show the corresponding selected tab and tabpanel. Radix tabs switch on pointer events, so use a real click rather than a scripted `element.click()`.
- `board-height`: Focus the `role="separator"` named `Resize draft board`. ArrowUp and ArrowDown change `aria-valuenow` by 24, Home sets the 160px minimum, End sets the maximum, and a double-click resets the height. The maximum depends on window height (264 at an 800px viewport), so check `aria-valuemax` and step down when the value is already at the maximum. Reload and require the same `aria-valuenow`; the value is stored in localStorage under `draft-board-height`. Source: `DraftWorkspace.tsx`.
- `tools-collapse`: Click `Collapse player workspace`, require `aria-expanded=false` and the resize separator to disappear, then click `Expand player workspace` and require the selected panel and separator to return. Source: `DraftDock.tsx`.

## Gotchas

- The board is tall. Scroll to the tab strip before clicking it; a click on an offscreen tab may report success without changing the selected tab.
- The pool lists every undrafted player, not just recommendations. Players on the recommendation list sort first, then the rest by ECR. Keepers and drafted players are excluded, and the footer reports `N players shown`.
- The `Current pick` button's text contains both its short (`Current`) and long labels, so match it by accessible name or prefix, not by exact text content.
- `Full board` changes display only. It does not advance the draft.

## CLI cross-check

For a matching provider session, `status` and `players --available --search TEXT --position RB --json` add machine-readable evidence. CLI player results use ECR order and canonical-ID search, lack FLEX, and have a configurable limit. The browser pool lists all undrafted players, with recommendations (capped at 60) sorted first. CLI results do not prove board modes, layout, filters, or tab controls. See [CLI and replay](cli-and-replay.md) for commands and evidence requirements.
