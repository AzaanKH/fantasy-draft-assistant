/** Renders a SeasonReview as a readable markdown report. Pure. */
import type { CorrelationRow, DraftedPick, SeasonReview, TeamSummary } from './analysis.js';
import { OFFENSIVE_POSITIONS } from '@fantasy-draft/shared/league';
import { AGE_CLIFF, REACH_THRESHOLD_PICKS, type RiskCategory } from './core.js';

const fmt = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '–' : value.toFixed(digits);
const signed = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '–' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
const pct = (value: number | null | undefined): string =>
  value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`;
const escape = (value: string): string => value.replaceAll('|', '\\|');

function table(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const line = (cells: readonly (string | number)[]) => `| ${cells.map((cell) => escape(String(cell))).join(' | ')} |`;
  return [line(headers), `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(line)].join('\n');
}

const pickLabel = (pick: DraftedPick) => `${String(pick.round)}.${String(pick.roundPick).padStart(2, '0')}`;
const rankLabel = (position: string, rank: number | null) => rank === null ? '–' : `${position}${String(rank)}`;

const RISK_LABELS: Readonly<Record<RiskCategory | 'all-drafted', string>> = {
  'all-drafted': 'All drafted offensive players (baseline)',
  rookie: 'Rookie',
  'prior-missed-games': 'Prior season < 12 games',
  'age-cliff': `Age cliff (${OFFENSIVE_POSITIONS.map((position) => `${position} ${String(AGE_CLIFF[position])}+`).join(' · ')})`,
  'team-change': 'Changed team in offseason',
  'qb-change': 'New starting QB on team',
  'contract-year': 'Contract year',
  'expert-disagreement': 'High expert disagreement (top-quartile rank spread)',
  'sportsbook-disagreement': 'Sportsbook vs projection gap ≥ 15%',
  'reach-vs-adp': `Reach ≥ ${String(REACH_THRESHOLD_PICKS)} picks ahead of ADP`,
};

function correlationTable(rows: readonly CorrelationRow[], label = 'Scope'): string {
  return table([label, 'n', 'Spearman ρ', '95% CI', 'Mean abs rank error'], rows.map((row) => [
    row.scope, row.n, fmt(row.rho, 2), row.interval ? `${fmt(row.interval[0], 2)} to ${fmt(row.interval[1], 2)}` : '–', fmt(row.meanAbsoluteRankError),
  ]));
}

function teamLabel(team: TeamSummary): string {
  return `${team.manager}${team.isManager ? ' (you)' : ''}`;
}

function learnings(review: SeasonReview): string[] {
  const out: string[] = [];
  const cf = review.myDraft.counterfactual;
  const me = review.teams.find((team) => team.isManager);
  const all = review.risks.summary.find((row) => row.category === 'all-drafted');
  const risk = (category: RiskCategory) => review.risks.summary.find((row) => row.category === category);
  const adp = review.rankings.adpVsEcr[0]?.row;
  const ecr = review.rankings.adpVsEcr[1]?.row;
  const rbEarly = review.strategyCorrelations.find((row) => row.measure.startsWith('RBs'));
  const waiverCorr = review.strategyCorrelations.find((row) => row.measure.startsWith('Waiver'));
  const valueCorr = review.strategyCorrelations.find((row) => row.measure.startsWith('Draft value'));

  out.push('### (a) Draft strategy for next year', '');
  if (me) {
    out.push(`- **Your draft ranks ${String(me.draftValueRank)}/${String(review.teams.length)} on value over cost (grade ${me.draftGrade}); you are ${String(me.standingsRank)}${ordinal(me.standingsRank)} in the standings and ${String(me.pointsForRank)}${ordinal(me.pointsForRank)} in points for.** ` +
      `Starter points from drafted players ${fmt(me.starterPointsBySource.draft, 0)}, waivers/FA ${fmt(me.starterPointsBySource.waiver + me.starterPointsBySource.free_agent, 0)}, trades ${fmt(me.starterPointsBySource.trade, 0)}.`);
  }
  out.push(`- **Roster-aware ECR would have scored ${signed(cf.ecr.totalPoints - cf.actual.totalPoints, 0)} total points (${signed(cf.ecr.seasonLineupPoints - cf.actual.seasonLineupPoints, 0)} best-lineup points) versus your picks; the replayed Best Pick rule ${signed(cf.bestPick.totalPoints - cf.actual.totalPoints, 0)} (${signed(cf.bestPick.seasonLineupPoints - cf.actual.seasonLineupPoints, 0)}).** ` +
    'One season and fixed opponent picks: treat the sign as a hint and the magnitude as noise-heavy.');
  if (rbEarly && rbEarly.rho !== null) {
    const spansZero = !rbEarly.interval || (rbEarly.interval[0] <= 0 && rbEarly.interval[1] >= 0);
    out.push(`- RB-heavy starts: ρ(RBs in rounds 1–5, points for) = ${fmt(rbEarly.rho, 2)} with n = ${String(rbEarly.n)} (95% CI ${rbEarly.interval ? `${fmt(rbEarly.interval[0], 2)} to ${fmt(rbEarly.interval[1], 2)}` : '–'}${spansZero ? ', spans zero' : ', excludes zero only barely and with an approximation that is loose at n = 10'}). ` +
      '**n = 10 teams in one season cannot support a positional-timing rule**; it is consistent with this year\'s RB-early busts, not evidence that RB-early loses. Keep using tiers and roster need.');
  }
  if (waiverCorr && valueCorr) {
    out.push(`- Points for vs draft value over cost: ρ = ${fmt(valueCorr.rho, 2)} (${clearOfZero(valueCorr.interval)}); vs waiver/FA starter points: ρ = ${fmt(waiverCorr.rho, 2)} (${clearOfZero(waiverCorr.interval)}), n = ${String(valueCorr.n)}. ` +
      'Value over cost is measured in the same season-to-date points that make up points for, so part of that link is mechanical; it still says draft-day value, not build labels, separated teams this year.');
  }
  const reach = risk('reach-vs-adp');
  if (reach && all) {
    out.push(`- Reaches (≥ ${String(REACH_THRESHOLD_PICKS)} picks before ADP) hit ${pct(reach.hitRate)} (n = ${String(reach.n)}) vs ${pct(all.hitRate)} for all picks; mean value over cost ${signed(reach.meanValueOverCost)} vs ${signed(all.meanValueOverCost)}.`);
  }

  out.push('', '### (b) Testable proposals for the recommendation policy and model', '');
  out.push('Each proposal names the evidence from this season, its strength, and the backtest that would confirm or reject it. None should change live ordering until the 2026 fold is complete (after week 18) and the release gate passes.', '');
  const positions = review.rankings.ecrByPosition.map((row) => `${row.scope} ${fmt(row.rho, 2)} (n = ${String(row.n)})`).join('; ');
  out.push(`1. **Position-specific trust in the ECR Anchor.** ECR→season-to-date rank correlation by position: ${positions}. ` +
    `Proposal: let Conservative Override neighborhoods vary by position (wider where ECR was least reliable). Evidence: weak (one season, 11 weeks; intervals overlap). Test: per-position ρ across 2022–2026 folds in \`pnpm model:backtest\`.`);
  if (adp && ecr) {
    out.push(`2. **ADP vs ECR as the quality anchor.** On the ADP top 150, ADP ρ = ${fmt(adp.rho, 2)} (MAE ${fmt(adp.meanAbsoluteRankError)}) vs ECR ρ = ${fmt(ecr.rho, 2)} (MAE ${fmt(ecr.meanAbsoluteRankError)}). ` +
      'Proposal: keep ADP as timing evidence only unless it beats ECR in at least 3 of 5 seasons. Evidence: weak — the two orderings are highly collinear. Test: add an ADP-anchored strategy row to the backtest once historical observed ADP exists.');
  }
  const rookie = risk('rookie');
  const prior = risk('prior-missed-games');
  const age = risk('age-cliff');
  if (rookie && prior && age && all) {
    out.push(`3. **Risk penalties.** Hit rates vs baseline ${pct(all.hitRate)}: rookies ${pct(rookie.hitRate)} (n = ${String(rookie.n)}), prior-season < 12 games ${pct(prior.hitRate)} (n = ${String(prior.n)}), age cliff ${pct(age.hitRate)} (n = ${String(age.n)}). ` +
      'Proposal: a bounded injuryRiskScore/age penalty only for categories whose hit rate trails baseline by ≥ 15 points in a pooled 2022–2026 replay with dated injury data. Evidence: weak (small n per category; risks are not independent). Test: needs the dated-injury replay listed as missing in the backtest limitations.');
  }
  const book = risk('sportsbook-disagreement');
  if (book) {
    out.push(`4. **Sportsbook context stays informational.** Players with a ≥ 15% gap between book lines and the FantasyPros projection hit ${pct(book.hitRate)} (n = ${String(book.n)}). Direction matters more than size; record signed gaps in shadow logs before any policy use. Evidence: very weak.`);
  }
  const shadow = review.rankings.modelVsFantasyPros;
  if (shadow.length > 0) {
    const pairs = shadow.reduce<string[]>((acc, row, index) => {
      if (index % 2 === 1) return acc;
      const model = shadow[index + 1];
      acc.push(`${row.row.scope}: FP ${fmt(row.row.rho, 2)} vs model ${fmt(model?.row.rho, 2)}`);
      return acc;
    }, []);
    out.push(`5. **Shadow model vs FantasyPros projections** (points-rank correlation among relevant players): ${pairs.join('; ')}. Proposal: keep the model in Shadow Recommendation; promote nothing on an 11-week partial season. Test: 2026 provisional prospective fold.`);
  }
  const calibration = review.adpCalibration;
  out.push(`6. **Draft Timing calibration.** ${pct(calibration.withinOneRound)} of ${String(calibration.n)} non-keeper picks went within one round of FantasyPros ADP; mean |pick − ADP| ${fmt(calibration.meanAbsoluteDelta)}, mean signed ${signed(calibration.meanDelta)}. ` +
    'Proposal: score the Return Probability curve against these observed outcomes (Brier score per pick) and against the league-history survival model before changing timing weights. Evidence: descriptive; one room, one draft.');

  out.push('', '### (c) Re-run after week 18', '');
  out.push(
    '- `pnpm report:season-review -- --season 2026 --through-week 18` (full regular season); all season-to-date numbers here are provisional.',
    '- The 2026 provisional prospective backtest fold (owned elsewhere) — compare its roster-aware ECR and Best Pick rows with the counterfactual table here.',
    '- Re-score risk hit rates and per-position ECR correlations with full-season games played; injuries after week 11 will move several categories.',
    '- Refresh manager tendencies with the final 2026 transaction log before the 2027 keeper deadline.',
  );
  return out;
}

function clearOfZero(interval: readonly [number, number] | null): string {
  if (!interval) return 'no interval';
  return interval[0] > 0 || interval[1] < 0 ? `95% CI ${fmt(interval[0], 2)} to ${fmt(interval[1], 2)}, clear of zero` : `95% CI ${fmt(interval[0], 2)} to ${fmt(interval[1], 2)}, spans zero`;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  return value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
}

export function renderSeasonReviewMarkdown(review: SeasonReview): string {
  const { meta, myDraft } = review;
  const label = meta.label;
  const sections: string[] = [];
  sections.push(
    `# ${String(meta.season)} Primary League season retrospective (${label})`,
    '',
    `Generated from Sleeper league data ${label}, FantasyPros rankings refreshed ${meta.predraftRankingsAt} (pre-draft) and ${meta.currentRankingsAt ?? 'n/a'} (current snapshot).`,
    '',
    '**Read this first**',
    '',
    ...meta.caveats.map((caveat) => `- ${caveat}`),
    `- The current FantasyPros snapshot is ${meta.currentRankingsAreDraftRankings ? '**still draft (week 0) consensus rankings, not rest-of-season**, so "current rank" below is the season-to-date league-scored points rank (and PPG rank)' : 'treated as rest-of-season rankings'}.`,
    `- Your team: draft slot ${String(meta.managerSlot)} (roster ${String(meta.managerRosterId)}). Evidence: ${meta.managerSlotEvidence.join('; ')}.`,
    `- Replacement levels (${label} points): ${Object.entries(meta.replacementLevels).map(([position, value]) => `${position} ${fmt(value)}`).join(' · ')}.`,
    ...(meta.unmatchedDraftedPlayers.length ? [`- Drafted players without a pre-draft FantasyPros match: ${meta.unmatchedDraftedPlayers.join('; ')}.`] : []),
    '',
  );

  // 1. My draft.
  sections.push(`## 1. Your draft (${label})`, '',
    `**Grade: ${myDraft.grade} including keepers / ${myDraft.gradeExKeepers} on fresh picks only** — value over cost ${signed(myDraft.valueOverCost)} VOR (${String(myDraft.valueRank)}${ordinal(myDraft.valueRank)} of ${String(review.teams.length)}); excluding the keeper ${signed(myDraft.valueOverCostExKeepers)} (${String(myDraft.valueRankExKeepers)}${ordinal(myDraft.valueRankExKeepers)}). Grades rank teams by summed value over cost (A ≈ top 2, B next 2, C middle 3, D next 2, F last). Keepers are cheap by construction, so the fresh-pick grade isolates draft-day decisions.`, '',
    'Pick cost vs ADP: positive = taken later than FantasyPros ADP (value), negative = reach. Return vs slot = (order the position was drafted) − (season-to-date position rank); positive beat the slot.', '',
    table(['Pick', 'Player', 'Pos', 'Keeper', 'Pre ECR', 'Pre pos', 'ADP', 'Cost vs ADP', 'Pts', 'PPG', 'G', 'Pos rank (pts)', 'Pos rank (PPG)', 'Drafted as', 'Return vs slot', 'Value over cost'],
      myDraft.picks.map((pick) => [
        pickLabel(pick), pick.name, pick.position, pick.isKeeper ? 'yes' : '', fmt(pick.ecrRank, 0), rankLabel(pick.position, pick.ecrPositionRank), fmt(pick.adpRank, 0),
        signed(pick.adpDelta, 0), fmt(pick.points), fmt(pick.pointsPerGame), pick.games, rankLabel(pick.position, pick.positionRank),
        rankLabel(pick.position, pick.ppgPositionRank), rankLabel(pick.position, pick.positionDraftOrder), signed(pick.returnVsSlot, 0), signed(pick.valueOverCost),
      ])),
    '',
    '**Where you reached (≥ 6 picks before ADP):** ' + (myDraft.reaches.length ? myDraft.reaches.map((pick) => `${pick.name} at ${pickLabel(pick)} (${signed(pick.adpDelta, 0)}; ${pick.valueOverCost >= 0 ? 'worked' : 'did not work'}, ${signed(pick.valueOverCost)} VOR over cost)`).join('; ') : 'none') + '.',
    '',
    '**Where you waited (≥ 6 picks after ADP):** ' + (myDraft.waits.length ? myDraft.waits.map((pick) => `${pick.name} at ${pickLabel(pick)} (${signed(pick.adpDelta, 0)}; ${pick.valueOverCost >= 0 ? 'worked' : 'did not work'}, ${signed(pick.valueOverCost)})`).join('; ') : 'none') + '.',
    '',
    '### Counterfactual: roster-aware ECR and Best Pick at each of your picks', '',
    myDraft.counterfactual.bestPickMethod, '',
    table(['Pick', 'You took', 'Pts', 'Roster-aware ECR', 'Pts', 'Best Pick (replayed)', 'Pts'],
      myDraft.counterfactual.picks.map((row) => [
        String(row.pickNo), `${row.actual.name} (${row.actual.position})`, fmt(row.actual.points),
        row.ecr ? `${row.ecr.name} (${row.ecr.position})` : '–', fmt(row.ecr?.points),
        row.bestPick ? `${row.bestPick.name} (${row.bestPick.position})` : '–', fmt(row.bestPick?.points),
      ])),
    '',
    table(['Strategy', 'Total pts', 'Δ vs you', 'Best-lineup pts', 'Δ vs you', 'Total VOR'], [
      ['Your picks', fmt(myDraft.counterfactual.actual.totalPoints), '', fmt(myDraft.counterfactual.actual.seasonLineupPoints), '', fmt(myDraft.counterfactual.actual.totalVor)],
      ['Roster-aware ECR', fmt(myDraft.counterfactual.ecr.totalPoints), signed(myDraft.counterfactual.ecr.totalPoints - myDraft.counterfactual.actual.totalPoints),
        fmt(myDraft.counterfactual.ecr.seasonLineupPoints), signed(myDraft.counterfactual.ecr.seasonLineupPoints - myDraft.counterfactual.actual.seasonLineupPoints), fmt(myDraft.counterfactual.ecr.totalVor)],
      ['Best Pick (replayed)', fmt(myDraft.counterfactual.bestPick.totalPoints), signed(myDraft.counterfactual.bestPick.totalPoints - myDraft.counterfactual.actual.totalPoints),
        fmt(myDraft.counterfactual.bestPick.seasonLineupPoints), signed(myDraft.counterfactual.bestPick.seasonLineupPoints - myDraft.counterfactual.actual.seasonLineupPoints), fmt(myDraft.counterfactual.bestPick.totalVor)],
    ]),
    '',
    'Best-lineup points = the season-total points of the best legal starting lineup from those picks (not week-by-week start/sit). Roster-aware ECR follows the recommendation backtest: it takes the best-ranked legal player, so it can stack backup QBs; compare strategies on best-lineup points.',
    '',
  );

  // 2. Opponents.
  const teams = [...review.teams].sort((a, b) => a.standingsRank - b.standingsRank);
  sections.push(`## 2. Teams and opponents (${label})`, '',
    'Standings include Sleeper\'s league-median games (two results per week).', '',
    table(['#', 'Manager', 'Slot', 'W-L', 'PF', 'PF rank', 'Max PF', 'Draft grade (incl / excl keeper)', 'Draft value', 'Drafted pts', 'Starter pts: draft', 'waiver+FA', 'trade', 'Moves (W/FA/T)', 'FAAB'],
      teams.map((team) => [
        team.standingsRank, teamLabel(team), team.draftSlot, `${String(team.wins)}-${String(team.losses)}${team.ties ? `-${String(team.ties)}` : ''}`, fmt(team.pointsFor), team.pointsForRank, fmt(team.maxPoints),
        `${team.draftGrade} / ${team.draftGradeExKeepers}`, `${signed(team.draftValueOverCost, 0)} / ${signed(team.draftValueExKeepers, 0)}`, fmt(team.draftedPoints, 0), fmt(team.starterPointsBySource.draft, 0),
        fmt(team.starterPointsBySource.waiver + team.starterPointsBySource.free_agent, 0), fmt(team.starterPointsBySource.trade, 0),
        `${String(team.transactions.waiver)}/${String(team.transactions.freeAgent)}/${String(team.transactions.trade)}`, team.transactions.faabSpent,
      ])),
    '',
    '### Draft builds', '',
    table(['Manager', 'Rounds 1–14 by position', 'Build', 'Keepers', 'Biggest reach', 'Biggest value', 'First QB', 'First TE'],
      teams.map((team) => [
        teamLabel(team), team.positionsByRound.join(' '), team.strategy.join(', '), team.keepers.join('; ') || '–',
        team.biggestReach ? `${team.biggestReach.name} #${String(team.biggestReach.pickNo)} (${signed(team.biggestReach.adpDelta, 0)})` : '–',
        team.biggestValue ? `${team.biggestValue.name} #${String(team.biggestValue.pickNo)} (${signed(team.biggestValue.adpDelta, 0)})` : '–',
        team.firstQbRound === null ? '–' : `R${String(team.firstQbRound)}`, team.firstTeRound === null ? '–' : `R${String(team.firstTeRound)}`,
      ])),
    '',
    '### Which builds are winning?', '',
    table(['Build tag', 'Teams', 'Mean PF', 'Others mean PF', 'Mean wins'],
      review.strategies.map((row) => [row.tag, `${String(row.teams.length)}: ${row.teams.join(', ')}`, fmt(row.meanPointsFor), fmt(row.othersMeanPointsFor), fmt(row.meanWins)])),
    '',
    table(['Measure (team level)', 'n', 'Spearman ρ', '95% CI'],
      review.strategyCorrelations.map((row) => [row.measure, row.n, fmt(row.rho, 2), row.interval ? `${fmt(row.interval[0], 2)} to ${fmt(row.interval[1], 2)}` : '–'])),
    '',
    `**Plainly: with n = ${String(review.teams.length)} teams, no build comparison here is statistically meaningful.** A 95% interval for ρ at n = 10 is roughly ±0.6 wide; tags overlap (keepers fill early rounds), and in-season management moves points for as much as the draft does.`,
    '',
    '### Manager tendencies to exploit', '',
    `Pick number minus pre-draft ECR for non-keeper picks (positive = waited past ECR, negative = reached). Every manager drifts negative because a drafted player is, by selection, one the room liked more than ECR did, so compare each manager with the room-average row. ${String(meta.season)} uses FantasyPros ECR; history adds ${review.tendencies.historySeasons.join(', ') || 'no seasons'} vs pre-draft ECR from the historical training dataset when supplied.`, '',
    table(['Manager', 'Seasons', 'Picks w/ ECR', 'Mean vs ECR', ...OFFENSIVE_POSITIONS, 'Avg first QB rd', 'Avg first TE rd', 'RB share R1–4'],
      review.tendencies.withHistory.map((row) => [
        row.manager, row.seasons.join(' '), row.picks, signed(row.meanEcrDelta),
        ...OFFENSIVE_POSITIONS.map((position) => {
          const value = row.ecrDeltaByPosition[position];
          return value ? `${signed(value.mean)} (${String(value.n)})` : '–';
        }),
        fmt(row.meanFirstQbRound), fmt(row.meanFirstTeRound), pct(row.earlyRbShare),
      ])),
    '',
  );

  // 3. Rankings.
  sections.push(`## 3. Rankings movement (${label})`, '',
    'Pre-draft ECR position rank vs season-to-date position rank by league-scored points (players ranked inside the draftable depth: QB 24, RB 48, WR 60, TE 24). Positive ρ = consensus ordered players well.', '',
    correlationTable(review.rankings.ecrByPosition, 'Position'), '',
    'Same, by points per game (min games shown), which removes injury absences:', '',
    correlationTable(review.rankings.ecrPpgByPosition, 'Position'), '',
    '### Were ADP or ECR more accurate?', '',
    'Overall rank by season-to-date VOR among the FantasyPros ADP top 150 (offense):', '',
    table(['Ordering', 'n', 'Spearman ρ', '95% CI', 'Mean abs rank error'], review.rankings.adpVsEcr.map(({ source, row }) => [
      source, row.n, fmt(row.rho, 2), row.interval ? `${fmt(row.interval[0], 2)} to ${fmt(row.interval[1], 2)}` : '–', fmt(row.meanAbsoluteRankError),
    ])), '',
    ...(review.rankings.modelVsFantasyPros.length ? [
      'Pre-draft projections (points-rank correlation within position, relevant players):', '',
      table(['Projection', 'n', 'Spearman ρ', '95% CI'], review.rankings.modelVsFantasyPros.map(({ source, row }) => [
        source, row.n, fmt(row.rho, 2), row.interval ? `${fmt(row.interval[0], 2)} to ${fmt(row.interval[1], 2)}` : '–',
      ])), '',
    ] : []),
    '### Biggest risers (pre-draft position rank → current)', '',
    table(['Player', 'Pos', 'Pre-draft', 'Now (pts)', 'Change', 'Pts', 'G', 'Drafted'], review.rankings.risers.map((row) => [
      row.name, row.position, rankLabel(row.position, row.predraftPositionRank), rankLabel(row.position, row.actualPositionRank), signed(row.change, 0), fmt(row.points), row.games, row.drafted ? 'yes' : 'no',
    ])), '',
    '### Biggest fallers (among pre-draft top half of draftable depth)', '',
    table(['Player', 'Pos', 'Pre-draft', 'Now (pts)', 'Change', 'Pts', 'G', 'Drafted'], review.rankings.fallers.map((row) => [
      row.name, row.position, rankLabel(row.position, row.predraftPositionRank), rankLabel(row.position, row.actualPositionRank), signed(row.change, 0), fmt(row.points), row.games, row.drafted ? 'yes' : 'no',
    ])), '',
    '### Breakouts from outside the pre-draft draftable depth', '',
    table(['Player', 'Pos', 'Pre-draft', 'Now (pts)', 'Pts', 'G', 'Drafted'], review.rankings.unrankedBreakouts.map((row) => [
      row.name, row.position, rankLabel(row.position, row.predraftPositionRank), rankLabel(row.position, row.actualPositionRank), fmt(row.points), row.games, row.drafted ? 'yes' : 'no',
    ])), '',
    '### FantasyPros draft-ranking drift (Aug 30 → current snapshot, overall ECR)', '',
    table(['Player', 'Pos', 'Aug 30', 'Now', 'Δ'], review.rankings.fantasyProsMovement.map((row) => [row.name, row.position, row.before, row.after, signed(row.before - row.after, 0)])),
    '',
  );

  // 4. Risks.
  sections.push(`## 4. Risk categories (${label})`, '',
    `A pick "paid off" when its return vs slot ≥ 0. Expert-disagreement threshold: (worst − best rank) / average rank ≥ ${fmt(review.risks.expertSpreadThreshold, 2)} (top quartile of drafted players). Categories overlap.`, '',
    table(['Category', 'n', 'Paid off', 'Hit rate', 'Mean return vs slot', 'Mean value over cost', 'Paid off (best first)', 'Did not (worst first)'],
      review.risks.summary.map((row) => [
        RISK_LABELS[row.category], row.n, row.hits, pct(row.hitRate), signed(row.meanReturnVsSlot), signed(row.meanValueOverCost),
        row.category === 'all-drafted' ? '' : row.paidOff.slice(0, 6).join(', '), row.category === 'all-drafted' ? '' : row.didNot.slice(0, 6).join(', '),
      ])),
    '',
    '### Your roster', '',
    table(['Player', 'Risks', 'Return vs slot', 'Value over cost'], review.risks.myTeam.map((row) => [row.name, row.risks.join(', ') || '–', signed(row.returnVsSlot, 0), signed(row.valueOverCost)])),
    '',
  );

  // 5. Returns.
  const valueRow = (pick: DraftedPick) => [pickLabel(pick), pick.name, pick.position, pick.manager, pick.isKeeper ? 'yes' : '', fmt(pick.points), rankLabel(pick.position, pick.positionRank), signed(pick.valueOverCost)];
  sections.push(`## 5. Best and worst returns (${label})`, '',
    '### Top value over draft cost (league-wide)', '',
    table(['Pick', 'Player', 'Pos', 'Manager', 'Keeper', 'Pts', 'Pos rank', 'Value over cost'], review.returns.topValue.map(valueRow)), '',
    '### Worst value over draft cost', '',
    table(['Pick', 'Player', 'Pos', 'Manager', 'Keeper', 'Pts', 'Pos rank', 'Value over cost'], review.returns.worstValue.map(valueRow)), '',
    '### Your picks by value over cost', '',
    table(['Pick', 'Player', 'Pos', 'Manager', 'Keeper', 'Pts', 'Pos rank', 'Value over cost'], [...myDraft.picks].sort((a, b) => b.valueOverCost - a.valueOverCost).map(valueRow)), '',
    '### Best and worst pick by round', '',
    table(['Round', 'Best', 'Value', 'Worst', 'Value'], review.returns.byRound.map((row) => [
      row.round, `${row.best.name} (${row.best.manager})`, signed(row.best.valueOverCost), `${row.worst.name} (${row.worst.manager})`, signed(row.worst.valueOverCost),
    ])), '',
    '### Best waiver and free-agent pickups (points while on the acquiring roster)', '',
    table(['Player', 'Pos', 'Manager', 'First week', 'Source', 'FAAB', 'Started pts', 'Rostered pts'], review.returns.waiverPickups.map((row) => [
      row.name, row.position, row.manager, row.firstWeek, row.source, row.faabBid ?? '–', fmt(row.startedPoints), fmt(row.rosteredPoints),
    ])),
    '',
  );

  sections.push(`## 6. Learnings (${label})`, '', ...learnings(review), '');
  return sections.join('\n');
}
