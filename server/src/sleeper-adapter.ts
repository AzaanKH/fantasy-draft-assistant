import { decodeSleeperDraftMetadata, decodeSleeperDraftPickList } from '@fantasy-draft/shared/catalog';
import {
  normalizeSleeperDraftMetadata,
  resolveSleeperDraftLeagueId,
  normalizeSleeperPick,
} from '@fantasy-draft/shared/sync';
import {
  isSleeperLeague,
  normalizeSleeperLeagueSettings,
} from '@fantasy-draft/shared/league';
import { Effect } from 'effect';
import {
  ProviderError,
  requestJson,
  type DraftAdapterSnapshot,
  type DraftSyncAdapter,
  type FetchJson,
} from './sync-adapter.js';

export const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';
export const SLEEPER_SETTINGS_CACHE_MS = 60_000;

export class SleeperSyncAdapter implements DraftSyncAdapter {
  public readonly provider = 'sleeper' as const;
  private settingsCache: {
    leagueId: string;
    expiresAt: number;
    settings: ReturnType<typeof normalizeSleeperLeagueSettings>;
  } | undefined;
  private settingsGeneration = 0;

  public invalidateSettings(): void {
    this.settingsCache = undefined;
    this.settingsGeneration += 1;
  }

  public constructor(
    public readonly draftId: string,
    private readonly fetchJson: FetchJson
  ) {}

  public poll(): Effect.Effect<DraftAdapterSnapshot, ProviderError> {
    return Effect.gen({ self: this }, function* () {
      const [draftResponse, picksResponse] = yield* Effect.all([
        requestJson(this.fetchJson, `${SLEEPER_API_BASE}/draft/${this.draftId}`),
        requestJson(this.fetchJson, `${SLEEPER_API_BASE}/draft/${this.draftId}/picks`),
      ], { concurrency: 'unbounded' });

      const { draft, picks } = yield* Effect.try({
        try: () => ({ draft: decodeSleeperDraftMetadata(draftResponse), picks: decodeSleeperDraftPickList(picksResponse) }),
        catch: () => {
          console.warn('[sleeper-adapter] Rejected invalid draft payload');
          return new ProviderError({ message: 'Sleeper returned an invalid draft payload' });
        },
      });
      if (draft.draft_id !== this.draftId || picks.some(pick => pick.draft_id !== this.draftId)) {
        console.warn('[sleeper-adapter] Rejected draft payload for another session');
        return yield* new ProviderError({ message: 'Sleeper returned an invalid draft payload' });
      }

      const leagueId = resolveSleeperDraftLeagueId(draft);
      if (this.settingsCache?.leagueId !== leagueId) this.invalidateSettings();
      // League settings refine the draft, so a failed lookup still publishes picks.
      const leagueSettings = leagueId
        ? yield* this.fetchLeagueSettings(leagueId).pipe(Effect.orElseSucceed(() => undefined))
        : undefined;

      return {
        draft: normalizeSleeperDraftMetadata(draft, leagueSettings),
        picks: picks.map(normalizeSleeperPick),
      };
    });
  }

  private fetchLeagueSettings(leagueId: string) {
    return Effect.gen({ self: this }, function* () {
      const cached = this.settingsCache;
      if (cached?.leagueId === leagueId && cached.expiresAt > Date.now()) {
        return cached.settings;
      }
      // Never fall back to expired settings when a verification request fails.
      this.settingsCache = undefined;
      const generation = this.settingsGeneration;
      const leagueResponse = yield* requestJson(this.fetchJson, `${SLEEPER_API_BASE}/league/${leagueId}`);
      if (!isSleeperLeague(leagueResponse) || leagueResponse.league_id !== leagueId) {
        console.warn('[sleeper-adapter] Rejected invalid league settings');
        return yield* new ProviderError({ message: 'Sleeper returned invalid league settings' });
      }
      const settings = normalizeSleeperLeagueSettings(leagueResponse);
      // An interrupted poll never reaches this point, so only completed lookups are cached.
      if (generation === this.settingsGeneration) {
        this.settingsCache = { leagueId, settings, expiresAt: Date.now() + SLEEPER_SETTINGS_CACHE_MS };
      }
      return settings;
    });
  }
}
