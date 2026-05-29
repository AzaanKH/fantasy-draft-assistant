import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NFLTeam, Position } from '@fantasy-draft/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const LEAGUE_HISTORY_FILE = join(DATA_DIR, 'league-history', 'leagueDraftHistory.json');
const SLEEPER_ADP_FILE = join(DATA_DIR, 'sleeper-adp.json');
const OUTPUT_FILE = join(DATA_DIR, 'league-history', 'survival-model.json');
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const satisfies readonly Position[];

interface LeagueHistoryPick {
  readonly pickNo: number;
  readonly draftSlot: number;
  readonly pickedByDisplayName: string;
  readonly position: Position;
}

interface LeagueHistorySeason {
  readonly season: number;
  readonly leagueName: string;
  readonly picks: readonly LeagueHistoryPick[];
}

interface LeagueDraftHistory {
  readonly leagueName: string;
  readonly seasons: readonly LeagueHistorySeason[];
}

interface SleeperAdpPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly sleeperAdp: number;
}

interface SleeperAdpFile {
  readonly players: readonly SleeperAdpPlayer[];
}

interface PositionSummary {
  readonly position: Position;
  readonly leagueMedianPick: number;
  readonly sleeperMedianPick: number;
  readonly pickPremium: number;
  readonly top50RateDelta: number;
  readonly top100RateDelta: number;
  readonly sampleSize: number;
}

interface PositionRateSummary {
  readonly picks: number;
  readonly pickRate: number;
  readonly earlyPickRate: number;
  readonly leaguePickRateDelta?: number;
}

interface ManagerTendencySummary {
  readonly managerKey: string;
  readonly draftSlots: readonly number[];
  readonly sampleSize: number;
  readonly positions: Record<Position, PositionRateSummary>;
}

interface AdpBucketSummary {
  readonly label: string;
  readonly minPick: number;
  readonly maxPick: number;
  readonly leagueSampleSize: number;
  readonly sleeperSampleSize: number;
  readonly positions: Record<Position, {
    readonly leaguePickRate: number;
    readonly sleeperPickRate: number;
    readonly rateDelta: number;
  }>;
}

const ADP_BUCKETS = [
  { label: 'top-24', minPick: 1, maxPick: 24 },
  { label: '25-50', minPick: 25, maxPick: 50 },
  { label: '51-100', minPick: 51, maxPick: 100 },
  { label: '101-plus', minPick: 101, maxPick: Number.POSITIVE_INFINITY },
] as const;

function isPosition(value: string): value is Position {
  return POSITIONS.includes(value as Position);
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function rateAtOrBefore(values: readonly number[], pick: number): number {
  if (values.length === 0) {
    return 0;
  }
  return values.filter((value) => value <= pick).length / values.length;
}

function getPositionRateSummary(
  picks: readonly LeagueHistoryPick[],
  leaguePositionRates: Readonly<Record<Position, number>>,
  position: Position
): PositionRateSummary {
  const positionPicks = picks.filter((pick) => pick.position === position);
  const pickRate = positionPicks.length / Math.max(1, picks.length);
  const earlyPickRate = positionPicks.filter((pick) => pick.pickNo <= 100).length /
    Math.max(1, positionPicks.length);

  return {
    picks: positionPicks.length,
    pickRate: round(pickRate, 3),
    earlyPickRate: round(earlyPickRate, 3),
    leaguePickRateDelta: round(pickRate - (leaguePositionRates[position] ?? 0), 3),
  };
}

function round(value: number, digits: number = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function main(): Promise<void> {
  const [history, sleeperAdp] = await Promise.all([
    readJson<LeagueDraftHistory>(LEAGUE_HISTORY_FILE),
    readJson<SleeperAdpFile>(SLEEPER_ADP_FILE),
  ]);

  const leaguePicks = history.seasons.flatMap((season) =>
    season.picks.filter((pick) => isPosition(pick.position))
  );
  const maxHistoricalPick = Math.max(...leaguePicks.map((pick) => pick.pickNo));
  const marketPlayers = sleeperAdp.players.filter(
    (player) => isPosition(player.position) && player.sleeperAdp <= maxHistoricalPick
  );
  const totalLeaguePicks = leaguePicks.length;
  const totalMarketPlayers = marketPlayers.length;

  const positions = Object.fromEntries(
    POSITIONS.map((position): [Position, PositionSummary] => {
      const leaguePickNos = leaguePicks
        .filter((pick) => pick.position === position)
        .map((pick) => pick.pickNo);
      const marketPickNos = marketPlayers
        .filter((player) => player.position === position)
        .map((player) => player.sleeperAdp);

      const leagueMedianPick = median(leaguePickNos);
      const sleeperMedianPick = median(marketPickNos);
      const pickPremium = leagueMedianPick === 0 || sleeperMedianPick === 0
        ? 0
        : leagueMedianPick - sleeperMedianPick;
      const leagueTop50Rate = rateAtOrBefore(leaguePickNos, 50);
      const marketTop50Rate = rateAtOrBefore(marketPickNos, 50);
      const leagueTop100Rate = rateAtOrBefore(leaguePickNos, 100);
      const marketTop100Rate = rateAtOrBefore(marketPickNos, 100);

      return [
        position,
        {
          position,
          leagueMedianPick: round(leagueMedianPick, 1),
          sleeperMedianPick: round(sleeperMedianPick, 1),
          pickPremium: round(Math.max(-25, Math.min(25, pickPremium)), 1),
          top50RateDelta: round(leagueTop50Rate - marketTop50Rate, 3),
          top100RateDelta: round(leagueTop100Rate - marketTop100Rate, 3),
          sampleSize: leaguePickNos.length,
        },
      ];
    })
  ) as Record<Position, PositionSummary>;
  const leaguePositionRates = Object.fromEntries(
    POSITIONS.map((position) => [
      position,
      leaguePicks.filter((pick) => pick.position === position).length / Math.max(1, totalLeaguePicks),
    ])
  ) as Record<Position, number>;

  const managerGroups = new Map<string, LeagueHistoryPick[]>();
  for (const pick of leaguePicks) {
    const managerKey = pick.pickedByDisplayName || `slot-${String(pick.draftSlot)}`;
    const existing = managerGroups.get(managerKey) ?? [];
    existing.push(pick);
    managerGroups.set(managerKey, existing);
  }

  const managerTendencies: ManagerTendencySummary[] = [...managerGroups.entries()]
    .map(([managerKey, picks]) => ({
      managerKey,
      draftSlots: [...new Set(picks.map((pick) => pick.draftSlot))].sort((a, b) => a - b),
      sampleSize: picks.length,
      positions: Object.fromEntries(
        POSITIONS.map((position) => [
          position,
          getPositionRateSummary(picks, leaguePositionRates, position),
        ])
      ) as Record<Position, PositionRateSummary>,
    }))
    .sort((a, b) => b.sampleSize - a.sampleSize);

  const adpBuckets: AdpBucketSummary[] = ADP_BUCKETS.map((bucket) => {
    const isInBucket = (pick: number) => pick >= bucket.minPick && pick <= bucket.maxPick;
    const bucketLeaguePicks = leaguePicks.filter((pick) => isInBucket(pick.pickNo));
    const bucketMarketPlayers = marketPlayers.filter((player) => isInBucket(player.sleeperAdp));

    return {
      label: bucket.label,
      minPick: bucket.minPick,
      maxPick: Number.isFinite(bucket.maxPick) ? bucket.maxPick : maxHistoricalPick,
      leagueSampleSize: bucketLeaguePicks.length,
      sleeperSampleSize: bucketMarketPlayers.length,
      positions: Object.fromEntries(
        POSITIONS.map((position) => {
          const leaguePickRate = bucketLeaguePicks.filter((pick) => pick.position === position).length /
            Math.max(1, bucketLeaguePicks.length);
          const sleeperPickRate = bucketMarketPlayers.filter((player) => player.position === position).length /
            Math.max(1, bucketMarketPlayers.length);
          return [
            position,
            {
              leaguePickRate: round(leaguePickRate, 3),
              sleeperPickRate: round(sleeperPickRate, 3),
              rateDelta: round(leaguePickRate - sleeperPickRate, 3),
            },
          ];
        })
      ) as AdpBucketSummary['positions'],
    };
  });

  const roundPositionRates = history.seasons.map((season) => {
    const seasonPickCount = season.picks.length;
    return {
      season: season.season,
      positions: Object.fromEntries(
        POSITIONS.map((position) => [
          position,
          round(
            season.picks.filter((pick) => pick.position === position).length /
              Math.max(1, seasonPickCount),
            3
          ),
        ])
      ),
    };
  });

  const model = {
    generatedAt: new Date().toISOString(),
    modelVersion: `league-history-survival-v1-${history.seasons[0]?.season ?? 'unknown'}-${history.seasons.at(-1)?.season ?? 'unknown'}`,
    leagueName: history.leagueName,
    seasons: history.seasons.map((season) => season.season),
    sampleSize: totalLeaguePicks,
    sourceResponsibilities: {
      leagueHistory: 'Estimates draft-room position cost and pick survival from this league only.',
      sleeperAdp: 'Provides broad-market draft cost baseline within the historical draftable pick range.',
      predictionLayer: 'Not used for player quality; survival is applied after projected value is known.',
    },
    baseline: {
      leaguePickCount: totalLeaguePicks,
      maxHistoricalPick,
      sleeperPlayerCount: totalMarketPlayers,
    },
    positions,
    adpBuckets,
    managerTendencies,
    roundPositionRates,
  };

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(model, null, 2)}\n`);
  console.log(`League survival model written to ${OUTPUT_FILE}`);
}

main().catch((error: unknown) => {
  console.error('League survival model build failed:', error);
  process.exit(1);
});
