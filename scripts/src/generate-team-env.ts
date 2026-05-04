/**
 * Team Environment Generator
 *
 * Generates the team offensive environment data.
 * This is mostly static/manual data based on research.
 *
 * Usage: pnpm generate:team-env
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TeamEnvironment, NFLTeam } from '@fantasy-draft/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const OUTPUT_FILE = join(DATA_DIR, 'team-environment.json');

/**
 * 2025 Team Environment Data
 * Based on 2024 performance and offseason changes
 *
 * offenseScore: 1-10 composite (higher = better fantasy environment)
 * passVolume/rushVolume: Based on historical tendencies
 * pointsRank/passAttemptsRank/rushAttemptsRank: 1-32 (1 = most)
 */
const TEAM_ENVIRONMENTS: TeamEnvironment[] = [
  // Elite Offenses (9-10)
  {
    team: 'DET',
    name: 'Detroit Lions',
    offenseScore: 9.5,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 1,
    passAttemptsRank: 5,
    rushAttemptsRank: 12,
    coachingStability: true,
  },
  {
    team: 'MIA',
    name: 'Miami Dolphins',
    offenseScore: 9.0,
    passVolume: 'high',
    rushVolume: 'high',
    pointsRank: 3,
    passAttemptsRank: 2,
    rushAttemptsRank: 8,
    coachingStability: true,
  },
  {
    team: 'SF',
    name: 'San Francisco 49ers',
    offenseScore: 9.0,
    passVolume: 'medium',
    rushVolume: 'high',
    pointsRank: 4,
    passAttemptsRank: 15,
    rushAttemptsRank: 3,
    coachingStability: true,
  },
  {
    team: 'PHI',
    name: 'Philadelphia Eagles',
    offenseScore: 9.0,
    passVolume: 'medium',
    rushVolume: 'high',
    pointsRank: 2,
    passAttemptsRank: 18,
    rushAttemptsRank: 1,
    coachingStability: true,
  },

  // Very Good Offenses (8-8.9)
  {
    team: 'KC',
    name: 'Kansas City Chiefs',
    offenseScore: 8.5,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 6,
    passAttemptsRank: 4,
    rushAttemptsRank: 18,
    coachingStability: true,
  },
  {
    team: 'BUF',
    name: 'Buffalo Bills',
    offenseScore: 8.5,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 5,
    passAttemptsRank: 6,
    rushAttemptsRank: 10,
    coachingStability: true,
  },
  {
    team: 'DAL',
    name: 'Dallas Cowboys',
    offenseScore: 8.0,
    passVolume: 'high',
    rushVolume: 'low',
    pointsRank: 7,
    passAttemptsRank: 3,
    rushAttemptsRank: 25,
    coachingStability: false,
  },
  {
    team: 'CIN',
    name: 'Cincinnati Bengals',
    offenseScore: 8.0,
    passVolume: 'high',
    rushVolume: 'low',
    pointsRank: 8,
    passAttemptsRank: 7,
    rushAttemptsRank: 28,
    coachingStability: true,
  },
  {
    team: 'HOU',
    name: 'Houston Texans',
    offenseScore: 8.0,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 10,
    passAttemptsRank: 8,
    rushAttemptsRank: 15,
    coachingStability: true,
  },

  // Good Offenses (7-7.9)
  {
    team: 'BAL',
    name: 'Baltimore Ravens',
    offenseScore: 7.5,
    passVolume: 'low',
    rushVolume: 'high',
    pointsRank: 9,
    passAttemptsRank: 30,
    rushAttemptsRank: 2,
    coachingStability: true,
  },
  {
    team: 'ATL',
    name: 'Atlanta Falcons',
    offenseScore: 7.5,
    passVolume: 'medium',
    rushVolume: 'high',
    pointsRank: 12,
    passAttemptsRank: 14,
    rushAttemptsRank: 5,
    coachingStability: true,
  },
  {
    team: 'LAR',
    name: 'Los Angeles Rams',
    offenseScore: 7.5,
    passVolume: 'high',
    rushVolume: 'low',
    pointsRank: 11,
    passAttemptsRank: 9,
    rushAttemptsRank: 22,
    coachingStability: true,
  },
  {
    team: 'SEA',
    name: 'Seattle Seahawks',
    offenseScore: 7.0,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 13,
    passAttemptsRank: 10,
    rushAttemptsRank: 16,
    coachingStability: false,
  },
  {
    team: 'TB',
    name: 'Tampa Bay Buccaneers',
    offenseScore: 7.0,
    passVolume: 'high',
    rushVolume: 'low',
    pointsRank: 14,
    passAttemptsRank: 1,
    rushAttemptsRank: 30,
    coachingStability: true,
  },
  {
    team: 'GB',
    name: 'Green Bay Packers',
    offenseScore: 7.0,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 15,
    passAttemptsRank: 16,
    rushAttemptsRank: 11,
    coachingStability: true,
  },
  {
    team: 'MIN',
    name: 'Minnesota Vikings',
    offenseScore: 7.0,
    passVolume: 'high',
    rushVolume: 'low',
    pointsRank: 16,
    passAttemptsRank: 11,
    rushAttemptsRank: 26,
    coachingStability: true,
  },

  // Average Offenses (5-6.9)
  {
    team: 'IND',
    name: 'Indianapolis Colts',
    offenseScore: 6.5,
    passVolume: 'medium',
    rushVolume: 'high',
    pointsRank: 17,
    passAttemptsRank: 20,
    rushAttemptsRank: 6,
    coachingStability: false,
  },
  {
    team: 'LAC',
    name: 'Los Angeles Chargers',
    offenseScore: 6.5,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 18,
    passAttemptsRank: 19,
    rushAttemptsRank: 14,
    coachingStability: true,
  },
  {
    team: 'JAX',
    name: 'Jacksonville Jaguars',
    offenseScore: 6.0,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 19,
    passAttemptsRank: 17,
    rushAttemptsRank: 17,
    coachingStability: false,
  },
  {
    team: 'CHI',
    name: 'Chicago Bears',
    offenseScore: 6.0,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 20,
    passAttemptsRank: 21,
    rushAttemptsRank: 13,
    coachingStability: false,
  },
  {
    team: 'ARI',
    name: 'Arizona Cardinals',
    offenseScore: 6.0,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 21,
    passAttemptsRank: 12,
    rushAttemptsRank: 19,
    coachingStability: true,
  },
  {
    team: 'PIT',
    name: 'Pittsburgh Steelers',
    offenseScore: 5.5,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 22,
    passAttemptsRank: 22,
    rushAttemptsRank: 9,
    coachingStability: true,
  },
  {
    team: 'NO',
    name: 'New Orleans Saints',
    offenseScore: 5.5,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 23,
    passAttemptsRank: 23,
    rushAttemptsRank: 20,
    coachingStability: false,
  },
  {
    team: 'DEN',
    name: 'Denver Broncos',
    offenseScore: 5.0,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 24,
    passAttemptsRank: 24,
    rushAttemptsRank: 21,
    coachingStability: true,
  },
  {
    team: 'CLE',
    name: 'Cleveland Browns',
    offenseScore: 5.0,
    passVolume: 'low',
    rushVolume: 'high',
    pointsRank: 25,
    passAttemptsRank: 28,
    rushAttemptsRank: 4,
    coachingStability: true,
  },

  // Below Average Offenses (3-4.9)
  {
    team: 'TEN',
    name: 'Tennessee Titans',
    offenseScore: 4.5,
    passVolume: 'low',
    rushVolume: 'high',
    pointsRank: 26,
    passAttemptsRank: 29,
    rushAttemptsRank: 7,
    coachingStability: false,
  },
  {
    team: 'NYJ',
    name: 'New York Jets',
    offenseScore: 4.5,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 27,
    passAttemptsRank: 25,
    rushAttemptsRank: 23,
    coachingStability: false,
  },
  {
    team: 'LV',
    name: 'Las Vegas Raiders',
    offenseScore: 4.0,
    passVolume: 'medium',
    rushVolume: 'low',
    pointsRank: 28,
    passAttemptsRank: 26,
    rushAttemptsRank: 27,
    coachingStability: false,
  },
  {
    team: 'NYG',
    name: 'New York Giants',
    offenseScore: 4.0,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 29,
    passAttemptsRank: 27,
    rushAttemptsRank: 24,
    coachingStability: false,
  },

  // Poor Offenses (1-2.9)
  {
    team: 'NE',
    name: 'New England Patriots',
    offenseScore: 3.5,
    passVolume: 'low',
    rushVolume: 'medium',
    pointsRank: 30,
    passAttemptsRank: 31,
    rushAttemptsRank: 29,
    coachingStability: false,
  },
  {
    team: 'CAR',
    name: 'Carolina Panthers',
    offenseScore: 3.0,
    passVolume: 'medium',
    rushVolume: 'low',
    pointsRank: 31,
    passAttemptsRank: 13,
    rushAttemptsRank: 31,
    coachingStability: false,
  },
  {
    team: 'WAS',
    name: 'Washington Commanders',
    offenseScore: 5.0,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 32,
    passAttemptsRank: 32,
    rushAttemptsRank: 32,
    coachingStability: false,
  },
];

async function main(): Promise<void> {
  console.log('='.repeat(50));
  console.log('Team Environment Generator');
  console.log('='.repeat(50));

  // Validate all teams are present
  const presentTeams = new Set(TEAM_ENVIRONMENTS.map((t) => t.team));
  const allTeams: NFLTeam[] = [
    'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
    'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
    'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
    'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
  ];

  const missingTeams = allTeams.filter((t) => !presentTeams.has(t));
  if (missingTeams.length > 0) {
    console.error(`Missing teams: ${missingTeams.join(', ')}`);
    process.exit(1);
  }

  console.log(`Generated data for ${TEAM_ENVIRONMENTS.length} teams`);

  // Ensure data directory exists
  await mkdir(DATA_DIR, { recursive: true });

  // Create lookup by team
  const teamMap: Record<string, TeamEnvironment> = {};
  for (const team of TEAM_ENVIRONMENTS) {
    teamMap[team.team] = team;
  }

  // Write output
  const output = {
    generatedAt: new Date().toISOString(),
    season: 2025,
    teamCount: TEAM_ENVIRONMENTS.length,
    teams: teamMap,
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nData written to ${OUTPUT_FILE}`);

  // Top offenses summary
  const sorted = [...TEAM_ENVIRONMENTS].sort((a, b) => b.offenseScore - a.offenseScore);
  console.log('\nTop 10 Offensive Environments:');
  sorted.slice(0, 10).forEach((team, i) => {
    console.log(`  ${i + 1}. ${team.name} (${team.team}): ${team.offenseScore}`);
  });
}

main();
