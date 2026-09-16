# Draft approach

Use this guide to prepare for the Primary League draft and decide whom to take
when your turn arrives. Use the generated [draft prep report](draft-prep-report.md)
for current players, keepers, and room history. Definitions of Best Pick, Best
Player, and timing terms live in [CONTEXT.md](../CONTEXT.md).

## Prepare for this league

Confirm the [league settings](../data/primary-league-settings.json) and the
complete [keeper list](../data/league-history/current-keepers.json) against the
provider before relying on rankings or planning an opening sequence.

The saved Primary League profile rewards receptions, rushing attempts, and TE
receptions, and has two FLEX spots. Use league-scored value when comparing
players; generic PPR rankings alone do not capture those differences. Account
for your keeper when deciding which positions your roster still needs.

## At each pick

1. Compare Best Player with Best Pick. Best Player gives the expert-ranking
   baseline; Best Pick considers your roster and the cost of waiting. Read the
   stated reason when they differ.
2. Compare league-scored value among nearby candidates. Favor the player who
   improves your roster without abandoning a clear player-quality advantage
   merely to fill a position early.
3. Compare Depth Value once the starting lineup is covered. A first useful
   reserve at a thin position should beat another redundant bench player when
   their player quality is close. Depth Value measures projected lineup
   protection, not the raw points of players who would remain on the bench.
4. Check the remaining players in each relevant tier. Waiting is more costly
   when your candidate is the last attractive option and the next tier is much
   weaker. Several comparable options give you more room to wait.
5. Check Return Probability and the Expected Next-Pick Alternative. Identify a
   fallback you would accept before passing on a target. A return estimate is
   uncertain, even when the player has lasted longer than expected.
6. After the pick is recorded, reassess availability, roster needs, and timing.
   Keep enough remaining selections to complete a legal roster.

The live policy stays anchored to expert rankings. For source choices and
recommendation rules, use [data-strategy.md](data-strategy.md).

## Position choices

- Compare RB workload and receiving opportunities under this league's scoring.
  Secure needed volume before the remaining options weaken, while checking what
  you give up at WR or another position.
- Build WR depth for the WR and FLEX slots. Use the current prep report to judge
  how quickly this room is taking receivers; do not assume every year repeats
  the same opening rounds.
- Take a QB when the league-scored advantage and likely alternatives justify
  the pick. A run on QBs alone is not a reason to chase the position.
- Compare TEs by tier and expected reception value. The premium matters most
  when waiting would leave a substantially weaker option.
- Leave kicker until late unless the confirmed roster rules or available
  choices give you a specific reason to act sooner.

## Read the room

Use league history and current market cost to judge when players may be taken.
A player becoming more popular does not by itself improve their projected
production. Treat individual-manager tendencies cautiously when the sample is
small, and adjust your plan to the players actually available.

Keep an alternative opening plan in case a target goes early. The
[decision experiments](primary-league-experiments.md) can help compare plans,
but their outcomes depend on saved projections and opponent assumptions.
Check their inputs before applying them to the current board.

## Draft-week preparation

1. Confirm the complete keeper list and your draft slot. Mark your own keeper
   and only record confirmation once the full list has been checked, following
   the [artifact guidance](data-refresh.md#artifact-ownership).
2. Run the refresh and preparation commands in [data-refresh.md](data-refresh.md#commands).
   They fetch data and rewrite artifacts; allow time for modeling and backtests.
3. Review the regenerated prep report and rerun relevant decision experiments
   after material keeper, ranking, or draft-order changes. Update your preferred
   targets and fallback choices from that evidence.
4. Before live use, run the readiness check and resolve Core Draft Data blockers.
   Follow the [rehearsal guide](primary-league-rehearsal.md) for a complete draft
   and outage exercise. At startup, connect the intended provider draft and
   confirm its settings and keepers.

Submit actual picks in the provider draft room. If synchronization fails, use
Manual Continuity and verify reconciliation when it returns, following the
[outage recovery rules](primary-league-rehearsal.md#outage-recovery-rules).
