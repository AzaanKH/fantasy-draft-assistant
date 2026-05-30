import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Position } from '@fantasy-draft/shared';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DATA_DIR = join(REPO_ROOT, 'data');
const JSON_OUTPUT = join(DATA_DIR, 'draft-prep-report.json');
const MARKDOWN_OUTPUT = join(REPO_ROOT, 'docs', 'draft-prep-report.md');
const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const satisfies readonly Position[];

interface Pick {
  readonly pickNo: number;
  readonly round: number;
  readonly playerName: string;
  readonly position: Position;
  readonly isKeeper: boolean;
}

interface Season {
  readonly season: number;
  readonly userSlot: number;
  readonly picks: readonly Pick[];
  readonly userPicks: readonly Pick[];
}

interface LeagueHistory {
  readonly leagueName: string;
  readonly seasons: readonly Season[];
}

interface PositionSummary {
  readonly leagueMedianPick: number;
  readonly sleeperMedianPick: number;
  readonly pickPremium: number;
  readonly sampleSize: number;
}

interface SurvivalModel {
  readonly generatedAt: string;
  readonly positions: Record<Position, PositionSummary>;
}

interface Ranking {
  readonly rank: number;
  readonly name: string;
  readonly position: Position;
  readonly positionalRank: number;
}

interface FantasyProsSnapshot {
  readonly metadata: {
    readonly season: number;
    readonly refreshedAt: string;
  };
  readonly rankings: readonly Ranking[];
}

interface TeamEnvironment {
  readonly generatedAt: string;
  readonly season: number;
}

interface Predictions {
  readonly generatedAt: string;
  readonly modelVersion: string;
}

interface CurrentKeepers {
  readonly updatedAt: string | null;
  readonly season: number;
  readonly keepers: readonly {
    readonly playerId?: string;
    readonly playerName: string;
    readonly position: Position;
  }[];
}

function countAtOrBefore(picks: readonly Pick[], position: Position, maxPick: number): number {
  return picks.filter(
    (pick) => !pick.isKeeper && pick.position === position && pick.pickNo <= maxPick
  ).length;
}

function findFirstFreshPick(picks: readonly Pick[], position: Position): number | null {
  return picks.find((pick) => !pick.isKeeper && pick.position === position)?.pickNo ?? null;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    await access(path);
    return readJson<T>(path);
  } catch {
    return null;
  }
}

function isoAgeHours(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Number(((Date.now() - parsed) / 3_600_000).toFixed(1)) : null;
}

function markdownTable(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((value) => String(value ?? '-')).join(' | ')} |`),
  ].join('\n');
}

async function main(): Promise<void> {
  const [history, survival, fantasyPros, teamEnvironment, predictions, currentKeepers] =
    await Promise.all([
      readJson<LeagueHistory>(join(DATA_DIR, 'league-history', 'leagueDraftHistory.json')),
      readJson<SurvivalModel>(join(DATA_DIR, 'league-history', 'survival-model.json')),
      readJson<FantasyProsSnapshot>(join(DATA_DIR, 'fantasypros-snapshot.json')),
      readJson<TeamEnvironment>(join(DATA_DIR, 'team-environment.json')),
      readJson<Predictions>(join(DATA_DIR, 'predictions.json')),
      readOptionalJson<CurrentKeepers>(
        join(DATA_DIR, 'league-history', 'current-keepers.json')
      ),
    ]);

  const historicalRoomTrends = history.seasons.map((season) => {
    const freshPicks = season.picks.filter((pick) => !pick.isKeeper);
    return {
      season: season.season,
      userSlot: season.userSlot,
      freshPickCount: freshPicks.length,
      keeperCount: season.picks.length - freshPicks.length,
      firstFreshPickByPosition: Object.fromEntries(
        POSITIONS.map((position) => [position, findFirstFreshPick(season.picks, position)])
      ),
      top50FreshPicksByPosition: Object.fromEntries(
        POSITIONS.map((position) => [position, countAtOrBefore(season.picks, position, 50)])
      ),
      userDraftSequence: season.userPicks.map(
        (pick) => `${String(pick.round)}:${pick.playerName}(${pick.position})${pick.isKeeper ? '[K]' : ''}`
      ),
    };
  });

  const currentTiers = Object.fromEntries(
    POSITIONS.map((position) => [
      position,
      fantasyPros.rankings
        .filter((ranking) => ranking.position === position)
        .slice(0, position === 'QB' || position === 'TE' ? 12 : 18)
        .map((ranking) => ({
          rank: ranking.rank,
          positionalRank: ranking.positionalRank,
          name: ranking.name,
        })),
    ])
  ) as Record<(typeof POSITIONS)[number], Array<{
    rank: number;
    positionalRank: number;
    name: string;
  }>>;

  const report = {
    generatedAt: new Date().toISOString(),
    leagueName: history.leagueName,
    currentSeason: fantasyPros.metadata.season,
    canonicalApproach: '../docs/draft-approach.md',
    keeperStatus: currentKeepers ?? {
      updatedAt: null,
      season: fantasyPros.metadata.season,
      keepers: [],
      note: 'No current keeper file loaded. Add current keepers shortly before the draft.',
    },
    artifactFreshness: {
      fantasyProsHours: isoAgeHours(fantasyPros.metadata.refreshedAt),
      survivalModelHours: isoAgeHours(survival.generatedAt),
      teamEnvironmentHours: isoAgeHours(teamEnvironment.generatedAt),
      predictionsHours: isoAgeHours(predictions.generatedAt),
    },
    scoringNotes: [
      'Current projections add +0.20 points per rush attempt.',
      'Current TE projections add +0.50 points per reception on top of base PPR.',
    ],
    historicalRoomTrends,
    leaguePositionSummary: survival.positions,
    currentFantasyProsTiers: currentTiers,
    draftDayChecklist: [
      'Run pnpm prepare:draft during draft week.',
      'Enter the final keeper list in data/league-history/current-keepers.json when announced.',
      'Run pnpm report:draft-prep after keeper changes.',
      'Use best-ball ADP as external market context only; do not replace league-specific survival.',
    ],
  };

  await mkdir(dirname(JSON_OUTPUT), { recursive: true });
  await mkdir(dirname(MARKDOWN_OUTPUT), { recursive: true });
  await writeFile(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);

  const trendRows = historicalRoomTrends.map((season) => [
    season.season,
    season.keeperCount,
    season.firstFreshPickByPosition.QB,
    season.top50FreshPicksByPosition.QB,
    season.firstFreshPickByPosition.TE,
    season.top50FreshPicksByPosition.TE,
    season.top50FreshPicksByPosition.RB,
    season.top50FreshPicksByPosition.WR,
  ]);
  const keeperLines = report.keeperStatus.keepers.length > 0
    ? report.keeperStatus.keepers.map(
        (keeper) => `- ${keeper.playerName} (${keeper.position})`
      ).join('\n')
    : '- No current keepers loaded yet.';

  await writeFile(
    MARKDOWN_OUTPUT,
    `# Draft Prep Report

Generated: ${report.generatedAt}

Canonical strategy principles: [draft-approach.md](./draft-approach.md)

## Artifact Freshness

${markdownTable(
  ['Artifact', 'Age'],
  [
    ['FantasyPros', `${String(report.artifactFreshness.fantasyProsHours)}h`],
    ['League survival', `${String(report.artifactFreshness.survivalModelHours)}h`],
    ['Team environment', `${String(report.artifactFreshness.teamEnvironmentHours)}h`],
    ['Predictions', `${String(report.artifactFreshness.predictionsHours)}h`],
  ]
)}

## Historical Room Trends

Fresh picks exclude keepers.

${markdownTable(
  ['Season', 'Keepers', 'First QB', 'QB Top 50', 'First TE', 'TE Top 50', 'RB Top 50', 'WR Top 50'],
  trendRows
)}

## Current Keepers

${keeperLines}

## Current FantasyPros QB Tier

${markdownTable(
  ['Overall', 'QB', 'Player'],
  report.currentFantasyProsTiers.QB.map((player) => [player.rank, player.positionalRank, player.name])
)}

## Current FantasyPros TE Tier

${markdownTable(
  ['Overall', 'TE', 'Player'],
  report.currentFantasyProsTiers.TE.map((player) => [player.rank, player.positionalRank, player.name])
)}

## Draft-Week Checklist

${report.draftDayChecklist.map((item) => `- ${item}`).join('\n')}
`
  );

  console.log(`Draft prep JSON written to ${JSON_OUTPUT}`);
  console.log(`Draft prep Markdown written to ${MARKDOWN_OUTPUT}`);
}

main().catch((error: unknown) => {
  console.error('Draft prep report generation failed:', error);
  process.exit(1);
});
