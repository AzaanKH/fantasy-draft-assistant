# Draft Approach

This is the canonical home for durable draft strategy. It should contain
principles and decision rules, not a frozen player ranking. Season-specific
evidence belongs in the generated [draft prep report](./draft-prep-report.md).

## Signal Order

Use signals in this order:

1. League-scored player projection and value over replacement.
2. Current FantasyPros PPR rankings and projections.
3. Sleeper platform proxy and this league's historical pick-survival model.
4. Current roster needs, positional scarcity, and tier drop-offs.
5. External markets such as Underdog best-ball ADP as context only.

Underdog is useful for detecting broad market movement. It must not replace the
home-league market signal because the current Sharp Football Analysis
[Underdog table](https://www.sharpfootballanalysis.com/fantasy/fantasy-football-adp-half-ppr-underdog-best-ball/)
is half-PPR and uses best-ball roster construction.

## Current League Rules

The recommendation layer must account for:

- full PPR scoring
- `+0.20` points per rush attempt
- `+0.50` additional points per TE reception
- 10 teams
- keeper-driven player availability

The rush-attempt bonus raises the value of workhorse RBs and rushing QBs. The TE
premium raises the value of target-heavy TEs, especially near a tier break.

## Room Tendencies

Historical league data should improve timing decisions, not base player quality.

- Use league history to answer whether a player is likely to survive until the
  next user pick.
- Recalculate after keepers are announced because keeper supply can materially
  change positional tiers.
- Avoid overreacting to one unusual pick or one season.
- Treat manager-level tendencies as secondary until the sample is larger.
- Map each player's current consensus market position into the Primary League's
  empirical position-pick distribution. Blend the resulting historical pick at
  70%, current consensus cost at 25%, and Sleeper search rank at 5%.
- Condition Return Probability on the player still being available at the live
  draft cursor. Recalculate it after every confirmed or provisional pick.

## Position Tiers

Displayed tiers are generated locally from league-scored projections and
within-position value-over-replacement gaps. FantasyPros PPR projections and
ECR supply the base signal, while the rush-attempt bonus, TE premium, current
availability, and sportsbook overlay shape the final projection used for tier
placement.

- Published FantasyPros tiers are retained as reference metadata when the
  source exposes them; they do not replace the league-adjusted tier.
- Consensus ADP and league pick-survival affect draft timing, not tier quality.
- Tier assignments stay fixed during the draft so their meaning does not move.
- Remaining-player counts and the gap to the next available tier update after
  every pick.
- The live Decision Policy turns a meaningful tier cliff into a bounded cost of
  waiting. The adjustment shrinks when several players remain in the tier, is
  capped at four policy points, and cannot cross the Conservative Override.
- The live Decision Policy separately compares drafting a candidate now with
  the Expected Next-Pick Alternative at the same position. This timing factor is
  capped at four policy points and stops after the manager's next selection.

## Draft-Day Decision Rules

- Prefer a player with materially higher league-scored VOR when the alternatives
  are in the same market tier.
- Take an elite QB when the projection edge and next-pick survival justify it;
  do not force QB solely because a run started.
- Secure RB volume before the room exhausts workhorse roles.
- Keep building WR depth because this league historically spends heavily on WR
  inside the top 50.
- Draft TE by tier. The TE-premium edge matters most when the next target-heavy
  option is unlikely to survive.
- Leave kicker until late unless the league settings change.

## Draft Week

1. Run `pnpm prepare:draft`.
2. Update `data/league-history/current-keepers.json` when keepers are announced.
   Each entry needs `playerName` and `position`; `playerId` is preferred, and
   the user's keeper should include `"isMyKeeper": true` so roster-aware VOR
   begins with that player already rostered. Set `updatedAt` to the confirmation
   timestamp only after the complete league list is present.
3. Run `pnpm report:draft-prep`.
4. Review `docs/draft-prep-report.md`.

The live app resolves and removes every confirmed keeper before pick 1 without
advancing the mock. Mock controls stay locked when the list is unconfirmed or a
keeper cannot be matched to the current player pool.
