# Assistant

A drafter can inspect the current recommendation, ask four decision questions, compare alternatives, and return to the same draft workspace.

## Sub-features

- `assistant-header`: Open the Assistant from the header.
- `assistant-best-pick`: Open it from `Why this pick` under the board.
- `assistant-suggestion`: Open it from `Ask why` on the top Suggestions card.
- `assistant-questions`: Switch between explanation, comparison, waiting, and roster needs.
- `assistant-return`: Go back to the draft workspace.
- `assistant-pool`: Search, filter, sort, select, and expand the recommended player pool.
- `assistant-views`: Switch between the `Suggestions` and `Position tiers` views and between the Best Pick and Best Player lenses.

## How to get to it (user POV)

- Choose `Assistant` in the header, or open `/assistant` directly for the default analysis.
- From `/draft`, use `Why this pick` in `Current Best Pick` or `Ask why` in the top Suggestions card.
- On Assistant, choose `Why this player?`, `Compare options`, `Can I wait?`, or `What does my roster need?`. In Compare, `Change player` opens a picker for the comparison player.
- Choose `Draft board` (in the Suggestions view) or the header's `Draft workspace` to go back.

## Driving it with agent-browser

Preconditions: `control.py doctor "$RUN_ID"` passes, recommendations have loaded, and no Core Draft Data blocker hides the answers. Record the selected player before comparing answers.

- `assistant-header`: Open `/draft`, take `snapshot -i`, and click the `Assistant` button ref inside `Primary navigation`. Require URL `/assistant`, the heading `Your Best Pick` (or `Best Player available` under that lens), the subject line `Best Pick: <player>`, and the four question tabs.
- `assistant-best-pick`: Start again at `/draft`; click `Why this pick` in `Current Best Pick`. Require `/assistant`, `Why this player?` selected, and the same player as the bar's Best Pick in the subject line.
- `assistant-suggestion`: Start again at `/draft`; scroll to the `Suggestions` tab, open it, and click `Ask why` on its top card. Require the card's player in the subject line. Only the rank-1 card has `Ask why`.
- `assistant-questions`: On `/assistant`, click the fresh refs for `Compare options`, `Can I wait?`, and `What does my roster need?` one at a time. They are `role="tab"` controls: capture a snapshot after each and require `aria-selected=true` and a changed answer. The Compare answer names two players and offers `Change player`; Can I wait? shows a return probability; roster needs shows the positional depth chart.
- `assistant-return`: In the Suggestions view, click `Draft board` and require URL `/draft`; separately, use the header's `Draft workspace`. Verify the draft board still shows the same pick and the Queue count is unchanged.
- `assistant-pool`: Search an observed player using the `Search recommended players` field, clear it, filter a position (`aria-pressed`), switch the native `Sort` select to `Tier first` and back to `Recommendation`, then click another player's row and require the subject line to read `Viewing: <name>`. Click `Show N more players` and require `Show fewer players` with `aria-expanded=true`. Source: `AssistantPage.tsx`.
- `assistant-views`: Click the `Position tiers` view tab and require `aria-selected=true` and a `Position tiers` heading, then return to `Suggestions`. Toggle `Best Pick` / `Best Player` and require the heading to change. Source: `AssistantPage.tsx`, `AssistantContextBar.tsx`.

## Gotchas

- `/assistant` can show a readiness or provider identity blocker instead of analysis. Record that blocker, fix its stated precondition, and rerun the doctor before judging the Assistant.
- The `Draft board` back button exists only in the Suggestions view. From `Position tiers`, return with the header's `Draft workspace`.
- The header route opens the default player. `Why this pick` and `Ask why` pass a selected player; verify the identity shown rather than just the route.
- The `/sidepanel` route is a companion layout. Browser access to that route does not prove Chrome extension pairing or ESPN observation.

## CLI cross-check

The CLI imports the same decision output, comparison metrics, and answer generators. `recommend`, `compare`, `wait`, and `roster` can corroborate answers only when provider session, slot, lens, current pick, data, and keepers match. Browser Quick Mock, selected-player state, and filtered Assistant rankings may differ. Keep route entry points, question selection, comparison controls, and return navigation browser-driven. Compare requires at least two eligible recommendations. See [CLI and replay](cli-and-replay.md) for commands and evidence requirements.
