import { Schema } from 'effect';
import { MAX_DRAFT_TEAMS, MAX_ROSTER_SPOTS } from './limits.js';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  type RosterRequirements,
} from './draft.js';
import { isPosition, POSITIONS, type Position } from './player.js';
import { DEFAULT_SCORING_RULES, type ScoringRules } from './scoring.js';

const leagueSettingsSourceSchema = /* @__PURE__ */ Schema.Literals(['default', 'sleeper', 'espn']);

type LeagueSettingsSource = typeof leagueSettingsSourceSchema.Type;

interface LeagueSettingsInput {
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

const recordSchema = /* @__PURE__ */ Schema.Record(Schema.String, Schema.Unknown);
const isFiniteNumber = /* @__PURE__ */ Schema.is(Schema.Finite);
const finiteNumberRecord = /* @__PURE__ */ Schema.Record(Schema.String, Schema.Finite);
const teamCount = /* @__PURE__ */ Schema.Int.check(/* @__PURE__ */ Schema.isBetween({ minimum: 2, maximum: MAX_DRAFT_TEAMS }));
const rosterCount = /* @__PURE__ */ Schema.Int.check(/* @__PURE__ */ Schema.isBetween({ minimum: 0, maximum: MAX_ROSTER_SPOTS }));
const positionRequirement = /* @__PURE__ */ Schema.Struct({ starters: rosterCount, max: rosterCount });
const rosterRequirementsSchema = /* @__PURE__ */ Schema.Struct({
  QB: positionRequirement,
  RB: positionRequirement,
  WR: positionRequirement,
  TE: positionRequirement,
  K: positionRequirement,
  DEF: positionRequirement,
  FLEX: /* @__PURE__ */ Schema.Struct({
    starters: rosterCount,
    eligiblePositions: /* @__PURE__ */ Schema.Array(/* @__PURE__ */ Schema.Literals(POSITIONS)).check(/* @__PURE__ */ Schema.isMaxLength(6)),
  }),
  BENCH: /* @__PURE__ */ Schema.Struct({ spots: rosterCount }),
}).check(/* @__PURE__ */ Schema.makeFilter(value =>
  value.QB.starters + value.RB.starters + value.WR.starters + value.TE.starters +
  value.K.starters + value.DEF.starters + value.FLEX.starters + value.BENCH.spots <= MAX_ROSTER_SPOTS
));
const rosterRequirementsPredicate = /* @__PURE__ */ Schema.is(rosterRequirementsSchema);

export function isRosterRequirements(value: unknown): value is RosterRequirements {
  return rosterRequirementsPredicate(value);
}

function scoringGroup<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return /* @__PURE__ */ Schema.StructWithRest(/* @__PURE__ */ Schema.Struct(fields), [finiteNumberRecord]);
}

const scoringRulesSchema = /* @__PURE__ */ Schema.Struct({
  passing: /* @__PURE__ */ scoringGroup({
    yardsPerPoint: Schema.Finite, touchdown: Schema.Finite,
    interception: Schema.Finite, twoPointConversion: Schema.Finite,
  }),
  rushing: /* @__PURE__ */ scoringGroup({
    yardsPerPoint: Schema.Finite, touchdown: Schema.Finite,
    attemptBonus: Schema.Finite, twoPointConversion: Schema.Finite,
  }),
  receiving: /* @__PURE__ */ scoringGroup({
    reception: Schema.Finite, yardsPerPoint: Schema.Finite, touchdown: Schema.Finite,
    tePremium: Schema.Finite, twoPointConversion: Schema.Finite,
  }),
  kicking: /* @__PURE__ */ scoringGroup({
    fieldGoal0_39: Schema.Finite, fieldGoal40_49: Schema.Finite, fieldGoal50Plus: Schema.Finite,
    extraPoint: Schema.Finite, missedFieldGoal: Schema.Finite, missedExtraPoint: Schema.Finite,
  }),
  defense: /* @__PURE__ */ Schema.StructWithRest(/* @__PURE__ */ Schema.Struct({
    touchdown: Schema.Finite, sack: Schema.Finite, interception: Schema.Finite,
    fumbleRecovery: Schema.Finite, safety: Schema.Finite, blockedKick: Schema.Finite,
    pointsAllowed: /* @__PURE__ */ scoringGroup({
      shutout: Schema.Finite, tier1_6: Schema.Finite, tier7_13: Schema.Finite,
      tier14_20: Schema.Finite, tier21_27: Schema.Finite, tier28_34: Schema.Finite,
      tier35Plus: Schema.Finite,
    }),
  }), [/* @__PURE__ */ Schema.Record(/* @__PURE__ */ Schema.String.check(/* @__PURE__ */ Schema.makeFilter(key => key !== 'pointsAllowed')), Schema.Finite)]),
  misc: /* @__PURE__ */ scoringGroup({ fumbleLost: Schema.Finite, fumbleRecoveryTD: Schema.Finite }),
});

const sleeperLeagueSchema = /* @__PURE__ */ Schema.Struct({
  league_id: Schema.String,
  total_rosters: teamCount,
  roster_positions: /* @__PURE__ */ Schema.Array(Schema.String).check(/* @__PURE__ */ Schema.isMaxLength(MAX_ROSTER_SPOTS)),
  scoring_settings: finiteNumberRecord,
  settings: /* @__PURE__ */ Schema.optional(recordSchema),
});
const sleeperLeaguePredicate = /* @__PURE__ */ Schema.is(sleeperLeagueSchema);

export type SleeperLeague = typeof sleeperLeagueSchema.Type;

export function isSleeperLeague(value: unknown): value is SleeperLeague {
  return sleeperLeaguePredicate(value);
}

const leagueSettingsSchema = /* @__PURE__ */ Schema.Struct({
  source: leagueSettingsSourceSchema,
  leagueId: /* @__PURE__ */ Schema.NullOr(Schema.String),
  totalTeams: teamCount,
  scoringRules: scoringRulesSchema,
  rosterRequirements: rosterRequirementsSchema,
  rawScoringSettings: finiteNumberRecord,
  unsupportedScoringKeys: /* @__PURE__ */ Schema.Array(Schema.String),
  unsupportedRosterSlots: /* @__PURE__ */ Schema.Array(Schema.String),
  /** Null when the provider does not expose a reliable keeper setting. */
  keepersEnabled: /* @__PURE__ */ Schema.NullOr(Schema.Boolean),
  /** Stable hash of scoring, roster, and team-count inputs. */
  fingerprint: Schema.String,
  updatedAt: Schema.Finite,
});
const leagueSettingsPredicate = /* @__PURE__ */ Schema.is(leagueSettingsSchema);

/** The subset of league configuration that changes player value. */
export type LeagueSettings = Omit<typeof leagueSettingsSchema.Type, 'scoringRules'> & {
  readonly scoringRules: ScoringRules;
};

export function isLeagueSettings(value: unknown): value is LeagueSettings {
  return leagueSettingsPredicate(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const item: unknown = Reflect.get(value, key);
        return `${JSON.stringify(key)}:${stableSerialize(item)}`;
      })
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
    } else if (isPosition(slot)) {
      fixedStarters[slot] += 1;
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
