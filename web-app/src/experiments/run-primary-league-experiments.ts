import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runPrimaryLeagueExperiments,
  type PrimaryLeagueExperimentReport,
} from './primary-league-experiments';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const JSON_REPORT_PATH = resolve(REPO_ROOT, 'data/primary-league-experiments.json');
const MARKDOWN_REPORT_PATH = resolve(REPO_ROOT, 'docs/primary-league-experiments.md');

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

function strategyTable(
  strategies: PrimaryLeagueExperimentReport['openingPlanTournament']['strategies']
): string {
  return [
    '| Plan | Starter points | P10 | Starter VOR | Delta vs Best Pick | Common opening |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...strategies.map((strategy) => [
      `| ${strategy.label}`,
      strategy.starterProjectedPoints.mean.toFixed(2),
      strategy.starterProjectedPoints.p10.toFixed(2),
      strategy.starterVor.mean.toFixed(2),
      strategy.pairedStarterPointsDeltaVsBestPick
        ? signed(strategy.pairedStarterPointsDeltaVsBestPick.mean)
        : 'baseline',
      strategy.mostCommonOpenings[0]?.positions ?? 'n/a',
    ].join(' | ') + ' |'),
  ].join('\n');
}

function timingTable(
  strategies: PrimaryLeagueExperimentReport['qbAndTeTiming']['qb'],
  position: 'QB' | 'TE'
): string {
  return [
    '| Timing | Starter points | P10 | Starter VOR | Average round | Common player | Position points |',
    '| --- | ---: | ---: | ---: | ---: | --- | ---: |',
    ...strategies.map((strategy) => {
      const positionResult = position === 'QB' ? strategy.qb : strategy.te;
      return [
      `| ${strategy.label}`,
      strategy.starterProjectedPoints.mean.toFixed(2),
      strategy.starterProjectedPoints.p10.toFixed(2),
      strategy.starterVor.mean.toFixed(2),
      positionResult.averageRound ?? 'n/a',
      positionResult.mostCommonPlayers[0]?.player ?? 'n/a',
      positionResult.averageProjectedPoints ?? 'n/a',
    ].join(' | ') + ' |';
    }),
  ].join('\n');
}

function waitMap(report: PrimaryLeagueExperimentReport): string {
  return report.takeNowOrWaitMap.decisions.map((decision) => {
    const rows = decision.candidates.map((candidate) => [
      `| ${candidate.playerName}`,
      candidate.position,
      String(candidate.ecrRank),
      percent(candidate.returnProbability),
      candidate.recommendation,
      candidate.isBestPick ? 'Best Pick' : candidate.isBestPlayer ? 'Best Player' : '',
    ].join(' | ') + ' |').join('\n');
    return [
      `### ${decision.roundPick}: ${decision.selectedPlayer}`,
      '',
      `Next selection: ${decision.nextPickNumber === null ? 'none' : String(decision.nextPickNumber)}`,
      '',
      '| Candidate | Pos | ECR | Return chance | Read | Lens |',
      '| --- | --- | ---: | ---: | --- | --- |',
      rows,
    ].join('\n');
  }).join('\n\n');
}

function scenarioTable(
  scenarios: PrimaryLeagueExperimentReport['positionalRunStressTest']['scenarios']
): string {
  return [
    '| Room | Starter points | P10 | QB in first 50 | RB | WR | TE | Common opening |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...scenarios.map((scenario) => [
      `| ${scenario.label}`,
      scenario.starterProjectedPoints.mean.toFixed(2),
      scenario.starterProjectedPoints.p10.toFixed(2),
      scenario.averageFirst50PositionCounts.QB.toFixed(2),
      scenario.averageFirst50PositionCounts.RB.toFixed(2),
      scenario.averageFirst50PositionCounts.WR.toFixed(2),
      scenario.averageFirst50PositionCounts.TE.toFixed(2),
      scenario.mostCommonOpenings[0]?.positions ?? 'n/a',
    ].join(' | ') + ' |'),
  ].join('\n');
}

function scoringTable(report: PrimaryLeagueExperimentReport): string {
  return [
    '| Scoring | Starter points | P10 | Starter VOR | First-four QB | RB | WR | TE |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.scoringRuleAblation.scenarios.map((scenario) => [
      `| ${scenario.label}`,
      scenario.strategy.starterProjectedPoints.mean.toFixed(2),
      scenario.strategy.starterProjectedPoints.p10.toFixed(2),
      scenario.strategy.starterVor.mean.toFixed(2),
      scenario.averageFirstFourPositionCounts.QB.toFixed(2),
      scenario.averageFirstFourPositionCounts.RB.toFixed(2),
      scenario.averageFirstFourPositionCounts.WR.toFixed(2),
      scenario.averageFirstFourPositionCounts.TE.toFixed(2),
    ].join(' | ') + ' |'),
  ].join('\n');
}

function renderMarkdown(report: PrimaryLeagueExperimentReport): string {
  const audit = report.bestPickAudit;
  const bestPickStrategy = report.openingPlanTournament.strategies.find(
    (strategy) => strategy.id === 'best-pick'
  );
  const bestPlayerStrategy = report.openingPlanTournament.strategies.find(
    (strategy) => strategy.id === 'best-player'
  );
  const scoringAdjustments = report.scoringRuleAblation.largestPlayerAdjustments
    .slice(0, 12)
    .map((player) =>
      `| ${player.playerName} | ${player.position} | ${player.standardPprPoints.toFixed(2)} | ${player.primaryLeaguePoints.toFixed(2)} | ${signed(player.adjustment)} |`
    )
    .join('\n');
  const divergenceRows = audit.commonDivergences
    .map((item) => `| ${item.bestPlayer} | ${item.bestPick} | ${String(item.count)} |`)
    .join('\n');

  return `# Primary League draft experiments

Generated: ${report.generatedAt}

These experiments use draft slot ${String(report.parameters.draftSlot)}, ${report.parameters.keeper.playerName} as the round-${String(report.parameters.keeper.round)} keeper, current FantasyPros inputs, and the Primary League opponent model. They measure the rosters acquired under current projections. They do not predict realized 2026 results.

## Read this first

- Projected-points leader: **${report.openingPlanTournament.projectedPointsLeader}**.
- Best downside result: **${report.openingPlanTournament.robustLeader}**.
- Best Pick versus Best Player starter-points delta: **${signed(audit.bestPickVsBestPlayer.starterProjectedPointsDelta)}**. The paired 95% interval is ${audit.bestPickVsBestPlayer.pairedStarterPointsDelta95.lower.toFixed(2)} to ${audit.bestPickVsBestPlayer.pairedStarterPointsDelta95.upper.toFixed(2)}.
- Best Pick made a policy-driven departure from Best Player on ${percent(audit.policyDivergenceRate)} of ${String(audit.decisions)} decisions. Legal-roster rescue changed the player on another ${String(audit.feasibilityDivergences)} decisions. It made ${String(audit.boundaryViolations)} unapproved boundary violations.
- The opponent sensitivity runs agreed on the most common opening ${percent(report.opponentModelSensitivity.openingAgreementRate)} of the time.

## Opening-plan tournament

${strategyTable(report.openingPlanTournament.strategies)}

Best Pick averaged ${bestPickStrategy?.starterProjectedPoints.mean.toFixed(2) ?? 'n/a'} projected starter points. Best Player averaged ${bestPlayerStrategy?.starterProjectedPoints.mean.toFixed(2) ?? 'n/a'}.

## Take-now-or-wait map

"Take now" means the estimated return chance was at most 25%. "Decision zone" covers 26% through 65%. The map follows one reproducible Best Pick draft, so regenerate it after material ranking or keeper changes.

${waitMap(report)}

## QB timing

${timingTable(report.qbAndTeTiming.qb, 'QB')}

## TE timing

${timingTable(report.qbAndTeTiming.te, 'TE')}

## Positional-run stress test

${scenarioTable(report.positionalRunStressTest.scenarios)}

## Opponent-model sensitivity

${scenarioTable(report.opponentModelSensitivity.scenarios)}

## Scoring-rule ablation

${scoringTable(report)}

The first-four columns count positions selected in the first four fresh picks. They are not full-roster counts.

Do not compare starter-point totals between rows in this table. Each row uses a different scoring scale. Compare the position counts and player adjustments instead.

### Largest league-scoring adjustments

| Player | Pos | Standard PPR | Primary League | Adjustment |
| --- | --- | ---: | ---: | ---: |
${scoringAdjustments}

## Best Pick audit

- Decisions: ${String(audit.decisions)}
- Policy-driven divergences: ${String(audit.policyDivergences)}
- Legal-roster rescue divergences: ${String(audit.feasibilityDivergences)}
- Average ECR gap when divergent: ${audit.averageEcrGapWhenDiverged.toFixed(2)}
- Maximum ECR gap: ${String(audit.maximumEcrGap)}
- Total feasibility exceptions: ${String(audit.feasibilityExceptions)}
- Unapproved boundary violations: ${String(audit.boundaryViolations)}

| Best Player | Best Pick | Count |
| --- | --- | ---: |
${divergenceRows}

## Limits

${report.limitations.map((limitation) => `- ${limitation}`).join('\n')}
`;
}

const report = runPrimaryLeagueExperiments();
await mkdir(dirname(JSON_REPORT_PATH), { recursive: true });
await mkdir(dirname(MARKDOWN_REPORT_PATH), { recursive: true });
await writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(MARKDOWN_REPORT_PATH, renderMarkdown(report), 'utf8');

console.log(`Primary League experiments: ${report.experimentVersion}`);
console.log(`JSON: ${JSON_REPORT_PATH}`);
console.log(`Markdown: ${MARKDOWN_REPORT_PATH}`);
console.log(`Opening leader: ${report.openingPlanTournament.projectedPointsLeader}`);
console.log(`Best Pick policy-divergence rate: ${percent(report.bestPickAudit.policyDivergenceRate)}`);
