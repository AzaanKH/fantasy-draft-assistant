# Fantasy Draft design system

Built from the supplied screenshots and [Sleeper's new draftboard](https://sleeper.com/beta/draft/nfl/1411445922956685312).

[Open the Paper file](https://app.paper.design/file/01M3WA2Q1MFA27D0073VKWBR6K).

## Saved in Paper

- 75 editable design tokens covering colors, position semantics, spacing, typography, radii, containers, breakpoints and opacity.
- Foundations sheet with palette, position colors, type specimens, spacing, corners and usage rules.
- Controls sheet with default, hover, focus, disabled, secondary, ghost and destructive actions.
- Default and focused search, position filters, upcoming/drafted/selected/keeper/active pick cards.
- Normal, active, urgent and paused countdown states, roster/queue/chat navigation, connection feedback.

The typefaces are DM Sans and Barlow Condensed. They match the project's existing typography choices. Color values were sampled from the supplied new-draftboard screenshot. Secondary text uses a brighter value for legibility. Position colors are consistent between board cells, player metadata and roster slots.

## Prepared locally, awaiting Paper import

Paper reported: "Weekly MCP limit reached. It resets tomorrow." The quota stopped writes after the header of the desktop composition. The desktop artboard in Paper is incomplete.

- `preview.html` renders the completed 1600px desktop and 390px compact compositions.
- `pending-paper-import.json` contains the remaining incremental Paper operations, including a new compact artboard.
- `tokens.json` contains the exact token names, types, values and descriptions saved in Paper.
- `tokens.css` contains equivalent Tailwind v4 theme variables.

The local preview is static. Player data reflects the reference mock draft; it is not a live data feed. Its controls illustrate states and do not draft, resume, queue or change league settings.

## Import continuation

Use the existing Paper file after MCP writes are available again. Read the Paper guide and validate DM Sans and Barlow Condensed before styling. Use the manifest's existing desktop binding, so its already-created header is preserved.

Process steps sequentially. Resolve each `targetRef` from bindings. A write binds its first created node to `bind`; `bindChildren` maps returned layer names to child references. Create new artboards in the manifest's file/page. Apply style updates to the bound target.

Stop immediately on any tool error or missing binding. Do not run dependent operations after a failed creation. The manifest contains 110 operations and may need more than one quota period if the available allowance is smaller.

After each section, capture a Paper screenshot and review spacing, type, contrast, alignment and fit. When content exceeds a starting height, use `height: "fit-content"`. Finish with `finish_working_on_nodes`.

## Verification

The two completed Paper sheets were visually reviewed after rendering and adjusted to fit their content. Their text colors were corrected after the first contrast check.

The local preview was inspected at 1280px and 1680px browser widths and a 390px mobile width. No player-name overflow or document-level horizontal overflow was found. All reference avatar/headshot images loaded. The desktop specimen intentionally scrolls inside its frame on narrow viewports.

Calculated color contrast ratios:
- Primary text on surface: 16.89:1.
- Secondary text on surface: 7.97:1.
- Primary action label: 14.31:1.
- Position labels: 7.67:1 or higher.

Disabled controls intentionally use a subdued treatment. Injury, position, connection and keeper states always retain labels.
