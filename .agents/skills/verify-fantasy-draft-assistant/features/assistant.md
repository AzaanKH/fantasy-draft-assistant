# Assistant

A drafter can inspect the current recommendation, ask four decision questions, compare alternatives, and return to the same draft workspace.

## Sub-features

- `assistant-header`: Open the Assistant from the header.
- `assistant-best-pick`: Open it from `Why this pick` under the board.
- `assistant-suggestion`: Open it from `Ask why` on the top Suggestions card.
- `assistant-questions`: Switch between explanation, comparison, waiting, and roster needs.
- `assistant-return`: Go back to the draft workspace.
- `assistant-pool`: Search, filter, sort, select, and expand the recommended player pool.

## How to get to it (user POV)

- Choose `Assistant` in the header, or open `/assistant` directly for the default analysis.
- From `/draft`, use `Why this pick` in `Current Best Pick` or `Ask why` in the top Suggestions card.
- On Assistant, choose `Why this player?`, `Compare options`, `Can I wait?`, or `What does my roster need?`.
- Choose `Return to draft` or `Return to board` to go back.

## Driving it with agent-browser

Preconditions: `control.py doctor "$RUN_ID"` passes, recommendations have loaded, and no Core Draft Data blocker hides the answers. Record the selected player before comparing answers.

- `assistant-header`: Open `/draft`, take `snapshot -i`, and click the `Assistant` button ref inside `Primary navigation`. Require URL `/assistant`, a heading `Analysis for <player>`, and the four question buttons.
- `assistant-best-pick`: Start again at `/draft`; click `Why this pick` in `Current Best Pick`. Require `/assistant` and the same player as the bar's Best Pick.
- `assistant-suggestion`: Start again at `/draft`; scroll to the `Suggestions` tab, open it, and click `Ask why` on its top card. Require the card's player in the Assistant heading.
- `assistant-questions`: On `/assistant`, click the fresh refs for `Compare options`, `Can I wait?`, and `What does my roster need?` one at a time. Capture a snapshot after each; the active question has `aria-pressed=true` and the answer text changes. The Compare answer names two players.
- `assistant-return`: Click `Return to draft` and require URL `/draft`, or use the lower `Return to board` button. Verify the draft board still shows the same pick. Test both return buttons as separate entry points.
- `assistant-pool`: Search an observed player using `Search recommended players`, clear it, filter a position, switch `Sort` to `Tier first` and back to `Best recommendation`, then select another player and require its analysis heading. Expand results when the list exceeds its collapsed count and verify `aria-expanded`. Source: `AssistantPage.tsx`.

## Gotchas

- `/assistant` can show a readiness or provider identity blocker instead of analysis. Record that blocker, fix its stated precondition, and rerun the doctor before judging the Assistant.
- The header route opens the default player. `Why this pick` and `Ask why` pass a selected player; verify the identity shown rather than just the route.
- The `/sidepanel` route is a companion layout. Browser access to that route does not prove Chrome extension pairing or ESPN observation.

## CLI cross-check

The CLI imports the same decision output, comparison metrics, and answer generators. `recommend`, `compare`, `wait`, and `roster` can corroborate answers only when provider session, slot, lens, current pick, data, and keepers match. Browser Quick Mock, selected-player state, and filtered Assistant rankings may differ. Keep route entry points, question selection, comparison controls, and return navigation browser-driven. Compare requires at least two eligible recommendations. See [CLI and replay](cli-and-replay.md) for commands and evidence requirements.
