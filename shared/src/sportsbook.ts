import type { Position } from './player';
import type { ScoringRules } from './scoring';

export const SPORTSBOOKS = ['draftkings', 'fanduel'] as const;
export type Sportsbook = (typeof SPORTSBOOKS)[number];

export const SPORTSBOOK_MARKETS = [
  'passingYards',
  'passingTouchdowns',
  'rushingYards',
  'rushingTouchdowns',
  'receivingYards',
  'receivingTouchdowns',
  'receptions',
] as const;
export type SportsbookMarket = (typeof SPORTSBOOK_MARKETS)[number];

export interface SportsbookOverUnderLine {
  readonly sportsbook: Sportsbook;
  readonly playerName: string;
  readonly market: SportsbookMarket;
  readonly line: number;
  readonly overOdds: number;
  readonly underOdds: number;
  readonly sourceFile: string;
}

export interface SportsbookMilestoneLine {
  readonly sportsbook: Sportsbook;
  readonly playerName: string;
  readonly market: SportsbookMarket;
  readonly threshold: number;
  readonly americanOdds: number;
  readonly sourceFile: string;
}

export interface SportsbookSnapshotMetadata {
  readonly season: number;
  readonly capturedAt: string;
  readonly importedAt: string;
  readonly sourceDirectory: string;
  readonly overUnderCount: number;
  readonly milestoneCount: number;
}

export interface SportsbookSnapshot {
  readonly metadata: SportsbookSnapshotMetadata;
  readonly overUnder: readonly SportsbookOverUnderLine[];
  readonly milestones: readonly SportsbookMilestoneLine[];
  readonly warnings: readonly string[];
}

export type FantasyProsMarketStats = Readonly<
  Partial<Record<SportsbookMarket, number>>
>;

export interface SportsbookMarketConsensus {
  readonly market: SportsbookMarket;
  readonly consensusStat: number;
  readonly fantasyProsStat: number;
  readonly statDelta: number;
  readonly leagueScoringValue: number;
  readonly confidence: number;
  readonly pointAdjustment: number;
  readonly sportsbooks: readonly Sportsbook[];
}

export interface SportsbookProjectionAdjustment {
  readonly existingProjection: number;
  readonly marketAdjustment: number;
  readonly adjustedProjection: number;
  readonly confidence: number;
  readonly markets: readonly SportsbookMarketConsensus[];
}

const PLAYER_NAME_ALIASES: Readonly<Record<string, string>> = {
  cameronward: 'camward',
  rhamondrestevenso: 'rhamondrestevenson',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSportsbook(value: unknown): value is Sportsbook {
  return (
    typeof value === 'string' &&
    SPORTSBOOKS.includes(value as Sportsbook)
  );
}

function isSportsbookMarket(value: unknown): value is SportsbookMarket {
  return (
    typeof value === 'string' &&
    SPORTSBOOK_MARKETS.includes(value as SportsbookMarket)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOverUnderLine(value: unknown): value is SportsbookOverUnderLine {
  return (
    isRecord(value) &&
    isSportsbook(value['sportsbook']) &&
    typeof value['playerName'] === 'string' &&
    isSportsbookMarket(value['market']) &&
    isFiniteNumber(value['line']) &&
    isFiniteNumber(value['overOdds']) &&
    isFiniteNumber(value['underOdds']) &&
    typeof value['sourceFile'] === 'string'
  );
}

function isMilestoneLine(value: unknown): value is SportsbookMilestoneLine {
  return (
    isRecord(value) &&
    isSportsbook(value['sportsbook']) &&
    typeof value['playerName'] === 'string' &&
    isSportsbookMarket(value['market']) &&
    isFiniteNumber(value['threshold']) &&
    isFiniteNumber(value['americanOdds']) &&
    typeof value['sourceFile'] === 'string'
  );
}

export function isSportsbookSnapshot(value: unknown): value is SportsbookSnapshot {
  if (
    !isRecord(value) ||
    !isRecord(value['metadata']) ||
    !Array.isArray(value['overUnder']) ||
    !Array.isArray(value['milestones']) ||
    !Array.isArray(value['warnings'])
  ) {
    return false;
  }

  const metadata = value['metadata'];
  return (
    isFiniteNumber(metadata['season']) &&
    typeof metadata['capturedAt'] === 'string' &&
    typeof metadata['importedAt'] === 'string' &&
    typeof metadata['sourceDirectory'] === 'string' &&
    isFiniteNumber(metadata['overUnderCount']) &&
    isFiniteNumber(metadata['milestoneCount']) &&
    value['overUnder'].every(isOverUnderLine) &&
    value['milestones'].every(isMilestoneLine) &&
    value['warnings'].every((warning) => typeof warning === 'string')
  );
}

export function normalizeSportsbookPlayerName(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '')
    .replace(/[^a-z0-9]/g, '');

  return PLAYER_NAME_ALIASES[normalized] ?? normalized;
}

export function americanOddsToImpliedProbability(americanOdds: number): number {
  if (!Number.isFinite(americanOdds) || americanOdds === 0) {
    return 0;
  }

  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : -americanOdds / (-americanOdds + 100);
}

export function getLeagueScoringValue(
  market: SportsbookMarket,
  position: Position,
  scoringRules: ScoringRules
): number {
  switch (market) {
    case 'passingYards':
      return scoringRules.passing.yardsPerPoint;
    case 'passingTouchdowns':
      return scoringRules.passing.touchdown;
    case 'rushingYards':
      return scoringRules.rushing.yardsPerPoint;
    case 'rushingTouchdowns':
      return scoringRules.rushing.touchdown;
    case 'receivingYards':
      return scoringRules.receiving.yardsPerPoint;
    case 'receivingTouchdowns':
      return scoringRules.receiving.touchdown;
    case 'receptions':
      return (
        scoringRules.receiving.reception +
        (position === 'TE' ? scoringRules.receiving.tePremium : 0)
      );
  }
}

function calculateLineBalance(line: SportsbookOverUnderLine): number {
  const overProbability = americanOddsToImpliedProbability(line.overOdds);
  const underProbability = americanOddsToImpliedProbability(line.underOdds);
  const probabilityTotal = overProbability + underProbability;
  if (probabilityTotal === 0) {
    return 0.75;
  }

  const noVigOverProbability = overProbability / probabilityTotal;
  return clamp(1 - Math.abs(noVigOverProbability - 0.5) * 2, 0.6, 1);
}

function calculateConsensusConfidence(
  lines: readonly SportsbookOverUnderLine[],
  consensusStat: number
): number {
  const sportsbookCount = new Set(lines.map((line) => line.sportsbook)).size;
  const coverageConfidence = sportsbookCount >= 2 ? 0.65 : 0.4;
  const averageBalance =
    lines.reduce((sum, line) => sum + calculateLineBalance(line), 0) /
    lines.length;
  const lineValues = lines.map((line) => line.line);
  const lineRange = Math.max(...lineValues) - Math.min(...lineValues);
  const disagreementScale = Math.max(1, Math.abs(consensusStat) * 0.08);
  const agreement = clamp(1 - lineRange / disagreementScale / 2, 0.55, 1);

  return round(coverageConfidence * averageBalance * agreement, 3);
}

export function calculateSportsbookProjectionAdjustment(input: {
  readonly playerName: string;
  readonly position: Position;
  readonly existingProjection: number;
  readonly fantasyProsStats: FantasyProsMarketStats;
  readonly overUnderLines: readonly SportsbookOverUnderLine[];
  readonly scoringRules: ScoringRules;
}): SportsbookProjectionAdjustment {
  const normalizedPlayerName = normalizeSportsbookPlayerName(input.playerName);
  const playerLines = input.overUnderLines.filter(
    (line) =>
      normalizeSportsbookPlayerName(line.playerName) === normalizedPlayerName
  );
  const markets: SportsbookMarketConsensus[] = [];

  for (const market of SPORTSBOOK_MARKETS) {
    const fantasyProsStat = input.fantasyProsStats[market];
    const marketLines = playerLines.filter((line) => line.market === market);
    if (
      fantasyProsStat === undefined ||
      !Number.isFinite(fantasyProsStat) ||
      marketLines.length === 0
    ) {
      continue;
    }

    const consensusStat =
      marketLines.reduce((sum, line) => sum + line.line, 0) /
      marketLines.length;
    const confidence = calculateConsensusConfidence(
      marketLines,
      consensusStat
    );
    const leagueScoringValue = getLeagueScoringValue(
      market,
      input.position,
      input.scoringRules
    );
    const statDelta = consensusStat - fantasyProsStat;
    const pointAdjustment = confidence * statDelta * leagueScoringValue;

    markets.push({
      market,
      consensusStat: round(consensusStat),
      fantasyProsStat: round(fantasyProsStat),
      statDelta: round(statDelta),
      leagueScoringValue,
      confidence,
      pointAdjustment: round(pointAdjustment),
      sportsbooks: [...new Set(marketLines.map((line) => line.sportsbook))].sort(),
    });
  }

  const marketAdjustment = round(
    markets.reduce((sum, market) => sum + market.pointAdjustment, 0)
  );
  const confidence =
    markets.length === 0
      ? 0
      : round(
          markets.reduce((sum, market) => sum + market.confidence, 0) /
            markets.length,
          3
        );

  return {
    existingProjection: round(input.existingProjection),
    marketAdjustment,
    adjustedProjection: round(input.existingProjection + marketAdjustment),
    confidence,
    markets,
  };
}
