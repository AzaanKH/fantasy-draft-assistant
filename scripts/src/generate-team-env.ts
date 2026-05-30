/**
 * Generates reproducible team offensive environments from the latest completed
 * nflverse regular season. This is a baseline for the upcoming draft season;
 * current offseason news remains a separate recommendation signal.
 *
 * Usage: pnpm --filter scripts generate:team-env
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import type {
  NFLTeam,
  TeamEnvironment,
  VolumeLevel,
} from '@fantasy-draft/shared';
import { NFL_TEAMS } from '@fantasy-draft/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const OUTPUT_FILE = join(DATA_DIR, 'team-environment.json');
const COMPLETED_SEASON = new Date().getFullYear() - 1;
const SOURCE_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_reg_${COMPLETED_SEASON}.parquet`;

const TEAM_NAMES: Record<NFLTeam, string> = {
  ARI: 'Arizona Cardinals',
  ATL: 'Atlanta Falcons',
  BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers',
  CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals',
  CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos',
  DET: 'Detroit Lions',
  GB: 'Green Bay Packers',
  HOU: 'Houston Texans',
  IND: 'Indianapolis Colts',
  JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs',
  LAC: 'Los Angeles Chargers',
  LAR: 'Los Angeles Rams',
  LV: 'Las Vegas Raiders',
  MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings',
  NE: 'New England Patriots',
  NO: 'New Orleans Saints',
  NYG: 'New York Giants',
  NYJ: 'New York Jets',
  PHI: 'Philadelphia Eagles',
  PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers',
  TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans',
  WAS: 'Washington Commanders',
};

interface TeamStatRow {
  readonly team: string;
  readonly pass_attempts: number;
  readonly rush_attempts: number;
  readonly total_yards: number;
  readonly offensive_tds: number;
  readonly passing_epa: number;
  readonly rushing_epa: number;
}

interface RankedTeamStat extends TeamStatRow {
  readonly team: NFLTeam;
  readonly pointsRank: number;
  readonly passAttemptsRank: number;
  readonly rushAttemptsRank: number;
  readonly totalYardsRank: number;
  readonly passingEpaRank: number;
  readonly rushingEpaRank: number;
}

function normalizeTeam(value: string): NFLTeam | null {
  const normalized = value === 'JAC'
    ? 'JAX'
    : value === 'LA'
      ? 'LAR'
      : value;
  return NFL_TEAMS.includes(normalized as NFLTeam) ? normalized as NFLTeam : null;
}

function rankDescending(
  rows: readonly TeamStatRow[],
  getValue: (row: TeamStatRow) => number
): Map<string, number> {
  return new Map(
    [...rows]
      .sort((a, b) => getValue(b) - getValue(a))
      .map((row, index) => [row.team, index + 1])
  );
}

function getRank(ranks: ReadonlyMap<string, number>, team: string): number {
  return ranks.get(team) ?? NFL_TEAMS.length;
}

function toVolumeLevel(rank: number): VolumeLevel {
  if (rank <= 10) return 'high';
  if (rank >= 23) return 'low';
  return 'medium';
}

function round(value: number, digits: number = 1): number {
  return Number(value.toFixed(digits));
}

function buildEnvironments(rows: readonly TeamStatRow[]): TeamEnvironment[] {
  const offensiveTdsRanks = rankDescending(rows, (row) => row.offensive_tds);
  const passAttemptsRanks = rankDescending(rows, (row) => row.pass_attempts);
  const rushAttemptsRanks = rankDescending(rows, (row) => row.rush_attempts);
  const totalYardsRanks = rankDescending(rows, (row) => row.total_yards);
  const passingEpaRanks = rankDescending(rows, (row) => row.passing_epa);
  const rushingEpaRanks = rankDescending(rows, (row) => row.rushing_epa);

  const rankedRows: RankedTeamStat[] = rows.flatMap((row) => {
    const team = normalizeTeam(row.team);
    if (!team) return [];

    return [{
      ...row,
      team,
      pointsRank: getRank(offensiveTdsRanks, row.team),
      passAttemptsRank: getRank(passAttemptsRanks, row.team),
      rushAttemptsRank: getRank(rushAttemptsRanks, row.team),
      totalYardsRank: getRank(totalYardsRanks, row.team),
      passingEpaRank: getRank(passingEpaRanks, row.team),
      rushingEpaRank: getRank(rushingEpaRanks, row.team),
    }];
  });

  return rankedRows.map((row) => {
    const compositeRank =
      row.pointsRank * 0.55 +
      row.totalYardsRank * 0.2 +
      row.passingEpaRank * 0.15 +
      row.rushingEpaRank * 0.1;
    const offenseScore = 1 + 9 * ((NFL_TEAMS.length - compositeRank) / (NFL_TEAMS.length - 1));

    return {
      team: row.team,
      name: TEAM_NAMES[row.team],
      offenseScore: round(Math.max(1, Math.min(10, offenseScore))),
      passVolume: toVolumeLevel(row.passAttemptsRank),
      rushVolume: toVolumeLevel(row.rushAttemptsRank),
      pointsRank: row.pointsRank,
      passAttemptsRank: row.passAttemptsRank,
      rushAttemptsRank: row.rushAttemptsRank,
      coachingStability: false,
    };
  });
}

async function fetchTeamStats(): Promise<TeamStatRow[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();

  try {
    const reader = await connection.runAndReadAll(`
      select
        team::varchar as team,
        attempts::double as pass_attempts,
        carries::double as rush_attempts,
        (passing_yards + rushing_yards)::double as total_yards,
        (passing_tds + rushing_tds)::double as offensive_tds,
        passing_epa::double as passing_epa,
        rushing_epa::double as rushing_epa
      from read_parquet('${SOURCE_URL}')
      where season = ${COMPLETED_SEASON}
    `);

    return reader.getRowObjects() as unknown as TeamStatRow[];
  } finally {
    connection.closeSync();
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(50));
  console.log('Derived Team Environment Generator');
  console.log('='.repeat(50));

  const environments = buildEnvironments(await fetchTeamStats());
  const presentTeams = new Set(environments.map((team) => team.team));
  const missingTeams = NFL_TEAMS.filter((team: NFLTeam) => !presentTeams.has(team));
  if (missingTeams.length > 0 || environments.length !== NFL_TEAMS.length) {
    throw new Error(`Expected 32 NFL teams. Missing: ${missingTeams.join(', ') || 'unknown'}`);
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        season: COMPLETED_SEASON,
        source: SOURCE_URL,
        method: 'Derived from completed-season nflverse team TDs, yards, pass/rush volume, and EPA.',
        caveat: 'Coaching continuity is not yet sourced, so coachingStability defaults to false.',
        teamCount: environments.length,
        teams: Object.fromEntries(environments.map((team) => [team.team, team])),
      },
      null,
      2
    )}\n`
  );

  console.log(`Derived ${String(environments.length)} team environments from ${String(COMPLETED_SEASON)}.`);
  console.log(`Data written to ${OUTPUT_FILE}`);
}

main().catch((error: unknown) => {
  console.error('Team environment generation failed:', error);
  process.exit(1);
});
