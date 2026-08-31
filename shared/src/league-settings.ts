import {
  DEFAULT_ROSTER_REQUIREMENTS,
  type RosterRequirements,
} from './draft';
import { isPosition, type Position } from './player';
import { DEFAULT_SCORING_RULES, type ScoringRules } from './scoring';

export type LeagueSettingsSource = 'default' | 'sleeper' | 'espn';

export interface LeagueSettingsInput {
  readonly source: LeagueSettingsSource;
  readonly leagueId: string | null;
  readonly totalTeams: number;
  readonly scoringRules: ScoringRules;
  readonly rosterRequirements: RosterRequirements;
  readonly rawScoringSettings?: Readonly<Record<string, number>>;
  readonly unsupportedScoringKeys?: readonly string[];
  readonly unsupportedRosterSlots?: readonly string[];
  /** Null when the provider does not expose a reliable keeper setting. */
  readonly keepersEnabled: boolean | null;
}

export interface SleeperLeague {
  readonly league_id: string;
  readonly total_rosters: number;
  readonly roster_positions: readonly string[];
  readonly scoring_settings: Readonly<Record<string, number>>;
  readonly settings?: Readonly<Record<string, unknown>>;
}

/** The subset of league configuration that changes player value. */
export interface LeagueSettings {
  readonly source: LeagueSettingsSource;
  readonly leagueId: string | null;
  readonly totalTeams: number;
  readonly scoringRules: ScoringRules;
  readonly rosterRequirements: RosterRequirements;
  readonly rawScoringSettings: Readonly<Record<string, number>>;
  readonly unsupportedScoringKeys: readonly string[];
  readonly unsupportedRosterSlots: readonly string[];
  /** Null when the provider does not expose a reliable keeper setting. */
  readonly keepersEnabled: boolean | null;
  /** Stable hash of scoring, roster, and team-count inputs. */
  readonly fingerprint: string;
  readonly updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber);
}

function isPositionRequirement(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value['starters']) &&
    isFiniteNumber(value['max'])
  );
}

function isRosterRequirements(value: unknown): value is RosterRequirements {
  if (!isRecord(value) || !isRecord(value['FLEX']) || !isRecord(value['BENCH'])) {
    return false;
  }

  return (
    isPositionRequirement(value['QB']) &&
    isPositionRequirement(value['RB']) &&
    isPositionRequirement(value['WR']) &&
    isPositionRequirement(value['TE']) &&
    isPositionRequirement(value['K']) &&
    isPositionRequirement(value['DEF']) &&
    isFiniteNumber(value['FLEX']['starters']) &&
    Array.isArray(value['FLEX']['eligiblePositions']) &&
    value['FLEX']['eligiblePositions'].every(isPosition) &&
    isFiniteNumber(value['BENCH']['spots'])
  );
}

function isScoringRules(value: unknown): value is ScoringRules {
  if (
    !isRecord(value) ||
    !isRecord(value['passing']) ||
    !isRecord(value['rushing']) ||
    !isRecord(value['receiving']) ||
    !isRecord(value['kicking']) ||
    !isRecord(value['defense']) ||
    !isRecord(value['misc']) ||
    !isRecord(value['defense']['pointsAllowed'])
  ) {
    return false;
  }

  const allFinite = (record: Record<string, unknown>): boolean =>
    Object.values(record).every(isFiniteNumber);

  return (
    allFinite(value['passing']) &&
    allFinite(value['rushing']) &&
    allFinite(value['receiving']) &&
    allFinite(value['kicking']) &&
    allFinite(value['defense']['pointsAllowed']) &&
    allFinite(value['misc']) &&
    Object.entries(value['defense'])
      .filter(([key]) => key !== 'pointsAllowed')
      .every(([, item]) => isFiniteNumber(item))
  );
}

export function isSleeperLeague(value: unknown): value is SleeperLeague {
  return (
    isRecord(value) &&
    typeof value['league_id'] === 'string' &&
    isFiniteNumber(value['total_rosters']) &&
    Array.isArray(value['roster_positions']) &&
    value['roster_positions'].every((slot) => typeof slot === 'string') &&
    isFiniteNumberRecord(value['scoring_settings']) &&
    (value['settings'] === undefined || isRecord(value['settings']))
  );
}

export function isLeagueSettings(value: unknown): value is LeagueSettings {
  return (
    isRecord(value) &&
    (
      value['source'] === 'default' ||
      value['source'] === 'sleeper' ||
      value['source'] === 'espn'
    ) &&
    (value['leagueId'] === null || typeof value['leagueId'] === 'string') &&
    isFiniteNumber(value['totalTeams']) &&
    isScoringRules(value['scoringRules']) &&
    isRosterRequirements(value['rosterRequirements']) &&
    isFiniteNumberRecord(value['rawScoringSettings']) &&
    Array.isArray(value['unsupportedScoringKeys']) &&
    value['unsupportedScoringKeys'].every((key) => typeof key === 'string') &&
    Array.isArray(value['unsupportedRosterSlots']) &&
    value['unsupportedRosterSlots'].every((slot) => typeof slot === 'string') &&
    (
      value['keepersEnabled'] === null ||
      typeof value['keepersEnabled'] === 'boolean'
    ) &&
    typeof value['fingerprint'] === 'string' &&
    isFiniteNumber(value['updatedAt'])
  );
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function hashSettings(value: unknown): string {
  const input = stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ls-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function cloneScoringRules(rules: ScoringRules): ScoringRules {
  return {
    passing: { ...rules.passing },
    rushing: { ...rules.rushing },
    receiving: { ...rules.receiving },
    kicking: { ...rules.kicking },
    defense: {
      ...rules.defense,
      pointsAllowed: { ...rules.defense.pointsAllowed },
    },
    misc: { ...rules.misc },
  };
}

function cloneRosterRequirements(requirements: RosterRequirements): RosterRequirements {
  return {
    QB: { ...requirements.QB },
    RB: { ...requirements.RB },
    WR: { ...requirements.WR },
    TE: { ...requirements.TE },
    FLEX: {
      starters: requirements.FLEX.starters,
      eligiblePositions: [...requirements.FLEX.eligiblePositions],
    },
    K: { ...requirements.K },
    DEF: { ...requirements.DEF },
    BENCH: { ...requirements.BENCH },
  };
}

function createFingerprintInput(
  totalTeams: number,
  scoringRules: ScoringRules,
  rosterRequirements: RosterRequirements
): unknown {
  return { totalTeams, scoringRules, rosterRequirements };
}

export function createDefaultLeagueSettings(
  now: number = Date.now()
): LeagueSettings {
  return createLeagueSettings({
    source: 'default',
    leagueId: null,
    totalTeams: 10,
    scoringRules: DEFAULT_SCORING_RULES,
    rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
    keepersEnabled: true,
  }, now);
}

/** Creates a validated, cloned provider profile with a stable settings hash. */
export function createLeagueSettings(
  input: LeagueSettingsInput,
  now: number = Date.now()
): LeagueSettings {
  const scoringRules = cloneScoringRules(input.scoringRules);
  const rosterRequirements = cloneRosterRequirements(input.rosterRequirements);
  const totalTeams = Math.max(2, Math.round(input.totalTeams));
  return {
    source: input.source,
    leagueId: input.leagueId,
    totalTeams,
    scoringRules,
    rosterRequirements,
    rawScoringSettings: { ...input.rawScoringSettings },
    unsupportedScoringKeys: [...(input.unsupportedScoringKeys ?? [])].sort(),
    unsupportedRosterSlots: [...(input.unsupportedRosterSlots ?? [])].sort(),
    keepersEnabled: input.keepersEnabled,
    fingerprint: hashSettings(
      createFingerprintInput(totalTeams, scoringRules, rosterRequirements)
    ),
    updatedAt: now,
  };
}

const LOCALLY_RESCORED_KEYS = new Set([
  'pass_yd', 'pass_td',
  'rush_yd', 'rush_td', 'rush_att',
  'rec', 'rec_yd', 'rec_td', 'bonus_rec_te',
]);

/** Rules already represented in a standard FantasyPros PPR total. */
const PPR_BASELINE_ONLY_VALUES: Readonly<Record<string, number>> = {
  pass_int: -2,
  pass_2pt: 2,
  rush_2pt: 2,
  rec_2pt: 2,
  fgm: 3,
  fgm_0_19: 3,
  fgm_20_29: 3,
  fgm_30_39: 3,
  fgm_40_49: 4,
  fgm_50_59: 5,
  fgm_50p: 5,
  xpm: 1,
  fgmiss: -1,
  xpmiss: -1,
  def_td: 6,
  sack: 1,
  int: 2,
  fum_rec: 2,
  safe: 2,
  blk_kick: 2,
  pts_allow_0: 10,
  pts_allow_1_6: 7,
  pts_allow_7_13: 4,
  pts_allow_14_20: 1,
  pts_allow_21_27: 0,
  pts_allow_28_34: -1,
  pts_allow_35p: -4,
  fum_lost: -2,
  fum_rec_td: 6,
};

function isUnsupportedScoringEntry(key: string, value: number): boolean {
  if (value === 0 || LOCALLY_RESCORED_KEYS.has(key)) return false;
  return PPR_BASELINE_ONLY_VALUES[key] !== value;
}

function score(
  values: Readonly<Record<string, number>>,
  key: string,
  fallback: number = 0
): number {
  return values[key] ?? fallback;
}

function normalizeScoringRules(values: Readonly<Record<string, number>>): ScoringRules {
  const shortFieldGoal =
    values['fgm_30_39'] ??
    values['fgm_20_29'] ??
    values['fgm_0_19'] ??
    values['fgm'] ??
    0;

  return {
    passing: {
      yardsPerPoint: score(values, 'pass_yd'),
      touchdown: score(values, 'pass_td'),
      interception: score(values, 'pass_int'),
      twoPointConversion: score(values, 'pass_2pt'),
    },
    rushing: {
      yardsPerPoint: score(values, 'rush_yd'),
      touchdown: score(values, 'rush_td'),
      attemptBonus: score(values, 'rush_att'),
      twoPointConversion: score(values, 'rush_2pt'),
    },
    receiving: {
      reception: score(values, 'rec'),
      yardsPerPoint: score(values, 'rec_yd'),
      touchdown: score(values, 'rec_td'),
      tePremium: score(values, 'bonus_rec_te'),
      twoPointConversion: score(values, 'rec_2pt'),
    },
    kicking: {
      fieldGoal0_39: shortFieldGoal,
      fieldGoal40_49: score(values, 'fgm_40_49', score(values, 'fgm')),
      fieldGoal50Plus: score(
        values,
        'fgm_50p',
        score(values, 'fgm_50_59', score(values, 'fgm'))
      ),
      extraPoint: score(values, 'xpm'),
      missedFieldGoal: score(values, 'fgmiss'),
      missedExtraPoint: score(values, 'xpmiss'),
    },
    defense: {
      touchdown: score(values, 'def_td'),
      sack: score(values, 'sack'),
      interception: score(values, 'int'),
      fumbleRecovery: score(values, 'fum_rec'),
      safety: score(values, 'safe'),
      blockedKick: score(values, 'blk_kick'),
      pointsAllowed: {
        shutout: score(values, 'pts_allow_0'),
        tier1_6: score(values, 'pts_allow_1_6'),
        tier7_13: score(values, 'pts_allow_7_13'),
        tier14_20: score(values, 'pts_allow_14_20'),
        tier21_27: score(values, 'pts_allow_21_27'),
        tier28_34: score(values, 'pts_allow_28_34'),
        tier35Plus: score(values, 'pts_allow_35p'),
      },
    },
    misc: {
      fumbleLost: score(values, 'fum_lost'),
      fumbleRecoveryTD: score(values, 'fum_rec_td'),
    },
  };
}

const FIXED_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

function getConfiguredMax(
  settings: Readonly<Record<string, unknown>> | undefined,
  position: Position,
  fallback: number
): number {
  const value = settings?.[`max_${position.toLowerCase()}`];
  return isFiniteNumber(value) && value > 0 ? Math.round(value) : fallback;
}

function normalizeRosterRequirements(league: SleeperLeague): {
  requirements: RosterRequirements;
  unsupportedSlots: string[];
} {
  const fixedStarters: Record<Position, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DEF: 0,
  };
  const flexEligible = new Set<Position>();
  const flexEligibilityGroups = new Set<string>();
  const unsupportedSlots = new Set<string>();
  let flexStarters = 0;
  let benchSpots = 0;

  for (const rawSlot of league.roster_positions) {
    const slot = rawSlot.toUpperCase();
    if (slot === 'DST' || slot === 'D/ST') {
      fixedStarters.DEF += 1;
    } else if (FIXED_POSITIONS.includes(slot as Position)) {
      fixedStarters[slot as Position] += 1;
    } else if (slot === 'FLEX' || slot === 'WRRB_FLEX' || slot === 'RB_WR_TE') {
      flexStarters += 1;
      flexEligibilityGroups.add('RB,WR,TE');
      flexEligible.add('RB');
      flexEligible.add('WR');
      flexEligible.add('TE');
    } else if (slot === 'REC_FLEX' || slot === 'WR_TE') {
      flexStarters += 1;
      flexEligibilityGroups.add('WR,TE');
      flexEligible.add('WR');
      flexEligible.add('TE');
    } else if (slot === 'SUPER_FLEX' || slot === 'SUPERFLEX') {
      flexStarters += 1;
      flexEligibilityGroups.add('QB,RB,WR,TE');
      flexEligible.add('QB');
      flexEligible.add('RB');
      flexEligible.add('WR');
      flexEligible.add('TE');
    } else if (slot === 'BN') {
      benchSpots += 1;
    } else if (slot !== 'IR' && slot !== 'TAXI') {
      unsupportedSlots.add(rawSlot);
    }
  }
  if (flexEligibilityGroups.size > 1) {
    unsupportedSlots.add('mixed-flex-eligibility');
  }

  const rosterSize = Math.max(1, league.roster_positions.length);
  const positionRequirement = (position: Position) => ({
    starters: fixedStarters[position],
    max: Math.max(
      fixedStarters[position],
      getConfiguredMax(league.settings, position, rosterSize)
    ),
  });

  return {
    requirements: {
      QB: positionRequirement('QB'),
      RB: positionRequirement('RB'),
      WR: positionRequirement('WR'),
      TE: positionRequirement('TE'),
      FLEX: {
        starters: flexStarters,
        eligiblePositions: [...flexEligible],
      },
      K: positionRequirement('K'),
      DEF: positionRequirement('DEF'),
      BENCH: { spots: benchSpots },
    },
    unsupportedSlots: [...unsupportedSlots].sort(),
  };
}

export function normalizeSleeperLeagueSettings(
  league: SleeperLeague,
  now: number = Date.now()
): LeagueSettings {
  const scoringRules = normalizeScoringRules(league.scoring_settings);
  const { requirements: rosterRequirements, unsupportedSlots } =
    normalizeRosterRequirements(league);
  const unsupportedScoringKeys = Object.entries(league.scoring_settings)
    .filter(([key, value]) => isUnsupportedScoringEntry(key, value))
    .map(([key]) => key)
    .sort();

  return createLeagueSettings({
    source: 'sleeper',
    leagueId: league.league_id,
    totalTeams: league.total_rosters,
    scoringRules,
    rosterRequirements,
    rawScoringSettings: league.scoring_settings,
    unsupportedScoringKeys,
    unsupportedRosterSlots: unsupportedSlots,
    keepersEnabled: null,
  }, now);
}
