import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Guards shared's NodeNext configuration: consumers must load the built package
// under plain Node, and its types must actually resolve (not silently become `any`).
const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function consumerDiagnostics(source: string): { code: number; message: string }[] {
  const fileName = join(SCRIPTS_DIR, 'src', '__shared-contract-probe__.ts');
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const baseHost = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (path) => path === fileName || baseHost.fileExists(path),
    readFile: (path) => (path === fileName ? source : baseHost.readFile(path)),
    getSourceFile: (path, languageVersion, ...rest) =>
      path === fileName
        ? ts.createSourceFile(path, source, languageVersion)
        : baseHost.getSourceFile(path, languageVersion, ...rest),
  };

  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === fileName)
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    }));
}

describe('@fantasy-draft/shared package contract', () => {
  const subpaths = ['draft', 'catalog', 'league', 'node', 'sync', 'units'];

  it('rejects the root, temporary draft URL path and undeclared deep paths in plain Node', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
const errors = [];
for (const path of ['', '/draft-url', '/draft/calculations/recommendations']) {
  try {
    await import('@fantasy-draft/shared' + path);
    errors.push('resolved');
  } catch (error) {
    errors.push(error.code);
  }
}
console.log(JSON.stringify(errors));
`], { cwd: SCRIPTS_DIR, encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual(Array(3).fill('ERR_PACKAGE_PATH_NOT_EXPORTED'));
  });

  it('loads every exact subpath and every declared runtime export from built output', () => {
    const manifest = JSON.parse(readFileSync(join(SCRIPTS_DIR, '..', 'shared', 'package.json'), 'utf8'));
    expect(Object.keys(manifest.exports).sort()).toEqual(subpaths.map(subpath => `./${subpath}`).sort());
    expect(manifest).not.toHaveProperty('main');
    expect(manifest).not.toHaveProperty('types');
    const expected = Object.fromEntries(subpaths.map(subpath => {
      const source = readFileSync(join(SCRIPTS_DIR, '..', 'shared', 'src', subpath, 'index.ts'), 'utf8');
      const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
      const names = file.statements.flatMap(node =>
        ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.filter(element => !element.isTypeOnly).map(element => element.name.text)
          : []);
      return [subpath, names.sort()];
    }));
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
const { registerHooks } = await import('node:module');
const plainImports = [];
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'effect' || specifier.startsWith('effect/')) plainImports.push(specifier);
  return nextResolve(specifier, context);
} });
for (const subpath of ['league', 'draft', 'units', 'sync']) await import('@fantasy-draft/shared/' + subpath);
hook.deregister();
const exports = {};
for (const subpath of ${JSON.stringify(subpaths)}) {
  exports[subpath] = Object.keys(await import('@fantasy-draft/shared/' + subpath)).sort();
}
const sync = await import('@fantasy-draft/shared/sync');
console.log(JSON.stringify({ exports, plainImports, route: sync.parseDraftRoomUrl('https://sleeper.com/draft/nfl/demo') }));
`], { cwd: SCRIPTS_DIR, encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual({
      exports: expected,
      plainImports: [],
      route: { isInDraftRoom: true, provider: 'sleeper', draftId: 'demo' },
    });
  });

  it('rejects root access in NodeNext and resolves every declared subpath contract', () => {
    const diagnostics = consumerDiagnostics(`
import type { Player } from '@fantasy-draft/shared';
import type * as Shared from '@fantasy-draft/shared';
import type { DraftRoomStatus } from '@fantasy-draft/shared/draft-url';
`);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([2307, 2307, 2307]);
    const contracts = Object.fromEntries(subpaths.map(subpath => {
      const source = readFileSync(join(SCRIPTS_DIR, '..', 'shared', 'src', subpath, 'index.ts'), 'utf8');
      const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
      const names = file.statements.flatMap(node =>
        ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map(element => `${node.isTypeOnly || element.isTypeOnly ? 'type ' : ''}${element.name.text}`)
          : []);
      return [subpath, names.sort().join(', ')] as const;
    }));
    expect(contracts).toMatchInlineSnapshot(`
      {
        "catalog": "CATALOG, CORE_DRAFT_DATA_KEYS, DRAFT_DATA_REFRESH_STEPS, DRAFT_READINESS_DEFINITIONS, DRAFT_SESSION_LINEAGE_LIMIT, OPTIONAL_SIGNAL_KEYS, REFRESHABLE_CORE_DRAFT_DATA_KEYS, SAFE_RECOMMENDATION_POLICY, americanOddsToImpliedProbability, areKeepersValid, browserDataFiles, buildDraftReadinessReport, calculateSportsbookProjectionAdjustment, catalogDataClassification, catalogPath, createSafeRecommendationPolicy, decodeContractDataFile, decodeDraftDataRefreshStatus, decodeDraftMetadata, decodeDraftSessionChange, decodeDraftSessionIdentity, decodeDraftSessionList, decodeDraftSessionSummary, decodeDraftSyncConnection, decodeDraftSyncSnapshot, decodeDraftSyncUpdate, decodeEspnDraftSnapshot, decodeFantasyProsSnapshot, decodeKeeperFile, decodeLeagueSetupPreferences, decodeLeagueSurvivalModel, decodeMarketAdpSnapshot, decodeOrNull, decodePlayerIdentityFile, decodePredictionsDataFile, decodePrimaryLeagueSettingsFile, decodeQuickMockPreferences, decodeRecommendationPolicyFile, decodeShadowRecommendationEvent, decodeSleeperDataFile, decodeSleeperDraftMetadata, decodeSleeperDraftPick, decodeSleeperDraftPickList, decodeSportsbookSnapshot, decodeStoredDraftSession, decodeTeamEnvDataFile, evaluateDraftReadiness, formatDraftReadinessAge, formatDraftReadinessTimestamp, getTeamByeWeeks, isDecentOffense, isDraftDataRefreshStatus, isDraftMetadata, isDraftSessionIdentity, isDraftSessionSummary, isDraftSyncConnection, isDraftSyncSnapshot, isDraftSyncUpdate, isEspnDraftSnapshot, isLeagueSurvivalModel, isMarketAdpFormat, isMarketAdpSnapshot, isQuickMockPreferences, isRecommendationPolicyFile, isShadowRecommendationEvent, isSleeperDraftMetadata, isSleeperDraftPick, isSleeperDraftPickList, isSportsbookSnapshot, isTeamEnvironment, isTopOffense, isValidDraftSyncId, normalizeSportsbookPlayerName, parsePlayerNameAndTeam, parsePositionString, type ContractDataFile, type ContractPlayer, type CoreDraftDataKey, type DecodeOptions, type DraftDataRefreshState, type DraftDataRefreshStatus, type DraftDataRefreshStepState, type DraftReadinessDefinition, type DraftReadinessDependencyObservation, type DraftReadinessItem, type DraftReadinessKey, type DraftReadinessReport, type DraftReadinessSourceObservation, type DraftReadinessWarning, type DraftReadinessWarningInput, type ECRPlayer, type FantasyProsAdpPlayer, type FantasyProsMarketStats, type FantasyProsNewsItem, type FantasyProsProjection, type FantasyProsSnapshot, type KeeperFile, type LoadedArtifact, type MarketAdpFormat, type MarketAdpPlayer, type MarketAdpSnapshot, type PlayerIdentityFile, type PredictionsDataFile, type RecommendationPolicyFile, type SleeperDataFile, type SportsbookOverUnderLine, type SportsbookSnapshot, type TeamEnvDataFile, type TeamEnvironment, type VolumeLevel",
        "draft": "DEFAULT_QUICK_MOCK, LIVE_RECOMMENDATION_ARCHITECTURE, applyLeagueSurvivalModel, applyPositionTiers, blocksLiveRecommendations, blocksRecommendations, calculateAllScarcityScores, calculateTeamNeeds, calculateTierAvailability, canonicalizeKeeperSupply, comparisonBar, createDraftDecisionOutput, createDraftDecisionView, createDraftDisplayContext, createQuickMockSettings, createSlotSequence, deriveDraft, estimateLeagueSurvivalProbability, estimateMockSurvivalProbabilities, evaluateWorkspaceDraftReadiness, filterDrafted, formatSignedNumber, getAvailabilitySignal, getComparisonHighlights, getComparisonMetrics, getCriticalPositions, getEffectiveKeeperAssignments, getKeeperAtPick, getKeeperPickNumber, getNextOpenPickNumber, getNextUserPick, getPreferredRecommendation, getRecommendationBoard, getRecommendationExplanation, getRecommendationPolicyLabel, getRecommendations, getRosterAnswer, getTierKey, getWaitAnswer, getWaitingCostSummary, getWhyRows, isKeeperSupplyComplete, isNeedPriority, mergeCoreSources, mergePlayerData, normalizePlayerName, optimizeLineupUtility, resolveDraftPickImports, selectCpuPlayer, simulateCpuDraft, sortRecommendationsForPool, survivalPercent, type AssistantAnswerRow, type CanonicalKeeperAssignment, type ComparisonMetric, type ContractPlayerData, type CorePlayerDataSources, type CpuSelection, type DecisionDivergenceFactor, type DecisionLens, type DecisionOutput, type DerivedDraft, type DraftDecisionOutput, type DraftDecisionView, type DraftDisplayContext, type DraftFormat, type DraftKeeper, type DraftPick, type DraftPickImportRejection, type DraftPickImportResult, type DraftSelection, type DraftSource, type ExpectedNextPickAlternative, type HelpMetric, type KeeperPreloadStatus, type KeeperSupplyEntry, type LeagueSurvivalModel, type LineupPlayer, type MockDraftEngineConfig, type MockDraftPickLike, type MockKeeperAssignment, type MockLeagueHistoryModel, type NeedPriority, type PlayerIdentityData, type PoolSort, type PositionNeed, type QuickMockPreferences, type Recommendation, type RecommendationContext, type RecommendationDecisionFactors, type RecommendationResult, type RecommendationSelection, type SelectCpuPlayerInput, type ShadowRecommendation, type ShadowRecommendationEvent, type SimulatedMockPick, type SleeperADPPlayer, type SlotRef, type SlotSequence",
        "league": "DEFAULT_ROSTER_REQUIREMENTS, DEFAULT_SCORING_RULES, NFL_TEAMS, POSITIONS, createDefaultLeagueSettings, createEmptyRoster, createLeagueSettings, isLeagueSettings, isNFLTeam, isNewsStatus, isPlayer, isPosition, isPredictionSource, isRosterRequirements, isSleeperLeague, normalizeSleeperLeagueSettings, type HighlightLevel, type LeagueSettings, type NFLTeam, type NewsStatus, type Player, type PlayerPrediction, type Position, type PredictionSource, type Roster, type RosterRequirements, type ScoringRules, type SleeperLeague, type SurvivalModelSource, type TierSource",
        "node": "localDevPorts",
        "sync": "DraftSyncEngine, isDraftProvider, normalizeSleeperDraftMetadata, normalizeSleeperPick, parseDraftRoomUrl, resolveSleeperDraftLeagueId, type DraftMetadata, type DraftPickEvent, type DraftProvider, type DraftRoomStatus, type DraftSessionSummary, type DraftStatus, type DraftSyncSnapshot, type DraftSyncState, type DraftSyncUpdate, type DraftType, type EspnDraftSnapshot, type SleeperDraftMetadata, type SleeperDraftPick",
        "units": "MAX_DRAFT_PICKS, MAX_DRAFT_ROUNDS, MAX_DRAFT_TEAMS, MAX_ROSTER_SPOTS, isBoundedInteger, isDraftSize",
      }
    `);
    const source = Object.entries(contracts).flatMap(([subpath, names]) => names.split(', ').map(name => {
      const exported = name.replace(/^type /, '');
      return `import type { ${exported} as ${subpath}_${exported} } from '@fantasy-draft/shared/${subpath}';`;
    })).join('\n');
    expect(consumerDiagnostics(source)).toEqual([]);
  });

  it('rejects unregistered catalog handles at the type boundary', () => {
    const diagnostics = consumerDiagnostics(`
import { CATALOG, catalogPath } from '@fantasy-draft/shared/catalog';
catalogPath(CATALOG.identities);
catalogPath(Symbol('unregistered'));
`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(2345);
  });

  it('closes duplicate roster exports on draft in Node and NodeNext', () => {
    const names = ['DEFAULT_ROSTER_REQUIREMENTS', 'createEmptyRoster', 'Roster', 'RosterRequirements'];
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
const draft = await import('@fantasy-draft/shared/draft');
console.log(JSON.stringify(${JSON.stringify(names)}.filter(name => name in draft)));
`], { cwd: SCRIPTS_DIR, encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual([]);
    const diagnostics = consumerDiagnostics(names.map(name => `import type { ${name} } from '@fantasy-draft/shared/draft';`).join('\n'));
    expect(diagnostics).toHaveLength(names.length);
    for (const [index, name] of names.entries()) {
      expect(diagnostics[index]?.code).toBeOneOf([2305, 2724]);
      expect(diagnostics[index]?.message).toContain(name);
    }
  });

  it('type-checks consumers under NodeNext and rejects nonexistent DraftSyncEngine methods', () => {
    const source = `
import { DraftSyncEngine } from '@fantasy-draft/shared/sync';
const engine = new DraftSyncEngine('sleeper', 'draft-1');
engine.getSnapshot();
engine.notARealMethod();
`;
    const diagnostics = consumerDiagnostics(source);

    expect(diagnostics).toEqual([
      {
        code: 2339,
        message: "Property 'notARealMethod' does not exist on type 'DraftSyncEngine'.",
      },
    ]);
  });
});
