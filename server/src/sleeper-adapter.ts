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

function decodeDraftPayload<A>(decode: (value: unknown) => A): (value: unknown) => A {
  return value => {
    try { return decode(value); }
    catch {
      console.warn('[sleeper-adapter] Rejected invalid draft payload');
      throw new ProviderError({ message: 'Sleeper returned an invalid draft payload' });
    }
  };
}

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
      const [draft, picks] = yield* Effect.all([
        requestJson(this.fetchJson, `${SLEEPER_API_BASE}/draft/${this.draftId}`, decodeDraftPayload(decodeSleeperDraftMetadata)),
        requestJson(this.fetchJson, `${SLEEPER_API_BASE}/draft/${this.draftId}/picks`, decodeDraftPayload(decodeSleeperDraftPickList)),
      ], { concurrency: 'unbounded' });

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
      const settings = yield* requestJson(this.fetchJson, `${SLEEPER_API_BASE}/league/${leagueId}`, value => {
        if (!isSleeperLeague(value) || value.league_id !== leagueId) {
          console.warn('[sleeper-adapter] Rejected invalid league settings');
          throw new ProviderError({ message: 'Sleeper returned invalid league settings' });
        }
        return normalizeSleeperLeagueSettings(value);
      });
      // An interrupted poll never reaches this point, so only completed lookups are cached.
      if (generation === this.settingsGeneration) {
        this.settingsCache = { leagueId, settings, expiresAt: Date.now() + SLEEPER_SETTINGS_CACHE_MS };
      }
      return settings;
    });
  }
}
