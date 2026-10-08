import { isDraftSize, isLeagueSettings, isRosterRequirements } from '@fantasy-draft/shared';
import { rebuildCanonicalRosters } from './state';
import type { DraftActions, SetDraftState } from './types';

export function createConfigurationActions(
  set: SetDraftState
): Pick<
  DraftActions,
  'setConfig' |
  'applyLeagueSettings' |
  'setRosterRequirements' |
  'setMockSettings' |
  'setMockAutoAdvancePaused' |
  'setMockSettingsOpen'
> {
  return {
    setConfig: (newConfig) =>
      { set((state) => {
        if ((newConfig.myPickPosition !== undefined && !Number.isFinite(newConfig.myPickPosition)) ||
            !isDraftSize(newConfig.totalTeams ?? state.config.totalTeams, newConfig.totalRounds ?? state.config.totalRounds) ||
            (newConfig.draftType !== undefined && !['snake', 'linear', 'auction'].includes(newConfig.draftType)) ||
            (newConfig.rosterRequirements !== undefined && !isRosterRequirements(newConfig.rosterRequirements))) return;
        const nextTotalTeams = Math.max(
          2,
          Math.round(newConfig.totalTeams ?? state.config.totalTeams)
        );
        const nextTotalRounds = Math.max(
          1,
          Math.round(newConfig.totalRounds ?? state.config.totalRounds)
        );
        const nextPickPosition = Math.min(
          nextTotalTeams,
          Math.max(
            1,
            Math.round(newConfig.myPickPosition ?? state.config.myPickPosition)
          )
        );
        if (
          nextTotalTeams === state.config.totalTeams &&
          nextTotalRounds === state.config.totalRounds &&
          nextPickPosition === state.config.myPickPosition &&
          (newConfig.draftType ?? state.config.draftType) === state.config.draftType &&
          newConfig.rosterRequirements === undefined
        ) {
          return;
        }
        Object.assign(state.config, newConfig);
        state.config.totalTeams = nextTotalTeams;
        state.config.totalRounds = nextTotalRounds;
        state.config.myPickPosition = nextPickPosition;
        rebuildCanonicalRosters(state);
        state.mockSurvivalProbabilities = {};
      }); },
    applyLeagueSettings: (settings) =>
      { set((state) => {
        if (!isLeagueSettings(settings)) return;
        if (
          state.leagueSettings.fingerprint === settings.fingerprint &&
          state.leagueSettings.source === settings.source &&
          state.leagueSettings.leagueId === settings.leagueId &&
          state.leagueSettings.unsupportedScoringKeys.join('\0') ===
            settings.unsupportedScoringKeys.join('\0') &&
          state.leagueSettings.unsupportedRosterSlots.join('\0') ===
            settings.unsupportedRosterSlots.join('\0')
        ) return;
        state.leagueSettings = {
          ...settings,
          scoringRules: {
            passing: { ...settings.scoringRules.passing },
            rushing: { ...settings.scoringRules.rushing },
            receiving: { ...settings.scoringRules.receiving },
            kicking: { ...settings.scoringRules.kicking },
            defense: {
              ...settings.scoringRules.defense,
              pointsAllowed: { ...settings.scoringRules.defense.pointsAllowed },
            },
            misc: { ...settings.scoringRules.misc },
          },
          rosterRequirements: {
            QB: { ...settings.rosterRequirements.QB },
            RB: { ...settings.rosterRequirements.RB },
            WR: { ...settings.rosterRequirements.WR },
            TE: { ...settings.rosterRequirements.TE },
            FLEX: {
              starters: settings.rosterRequirements.FLEX.starters,
              eligiblePositions: [
                ...settings.rosterRequirements.FLEX.eligiblePositions,
              ],
            },
            K: { ...settings.rosterRequirements.K },
            DEF: { ...settings.rosterRequirements.DEF },
            BENCH: { ...settings.rosterRequirements.BENCH },
          },
          rawScoringSettings: { ...settings.rawScoringSettings },
          unsupportedScoringKeys: [...settings.unsupportedScoringKeys],
          unsupportedRosterSlots: [...settings.unsupportedRosterSlots],
        };
        state.config.totalTeams = Math.max(2, Math.round(settings.totalTeams));
        state.config.myPickPosition = Math.min(
          state.config.totalTeams,
          state.config.myPickPosition
        );
        state.config.rosterRequirements = {
          QB: { ...settings.rosterRequirements.QB },
          RB: { ...settings.rosterRequirements.RB },
          WR: { ...settings.rosterRequirements.WR },
          TE: { ...settings.rosterRequirements.TE },
          FLEX: {
            starters: settings.rosterRequirements.FLEX.starters,
            eligiblePositions: [
              ...settings.rosterRequirements.FLEX.eligiblePositions,
            ],
          },
          K: { ...settings.rosterRequirements.K },
          DEF: { ...settings.rosterRequirements.DEF },
          BENCH: { ...settings.rosterRequirements.BENCH },
        };
        rebuildCanonicalRosters(state);
        state.mockSurvivalProbabilities = {};
      }); },
    setRosterRequirements: (requirements) =>
      { set((state) => {
        state.config.rosterRequirements.QB = { ...requirements.QB };
        state.config.rosterRequirements.RB = { ...requirements.RB };
        state.config.rosterRequirements.WR = { ...requirements.WR };
        state.config.rosterRequirements.TE = { ...requirements.TE };
        state.config.rosterRequirements.FLEX = {
          starters: requirements.FLEX.starters,
          eligiblePositions: [...requirements.FLEX.eligiblePositions],
        };
        state.config.rosterRequirements.K = { ...requirements.K };
        state.config.rosterRequirements.DEF = { ...requirements.DEF };
        state.config.rosterRequirements.BENCH = { ...requirements.BENCH };
      }); },
    setMockSettings: (settings) =>
      { set((state) => {
        Object.assign(state.mockSettings, settings);
        state.mockSettings.randomness = Math.min(
          1,
          Math.max(0, state.mockSettings.randomness)
        );
        state.mockSettings.seed = Math.max(0, Math.round(state.mockSettings.seed));
        state.mockSettings.survivalIterations = Math.min(
          1000,
          Math.max(25, Math.round(state.mockSettings.survivalIterations))
        );
      }); },
    setMockAutoAdvancePaused: (paused) =>
      { set((state) => { state.mockAutoAdvance.paused = paused; }); },
    setMockSettingsOpen: (open) =>
      { set((state) => { state.mockAutoAdvance.settingsOpen = open; }); },

    // Draft actions
  };
}
