import {
  isSleeperDraftMetadata,
  isSleeperDraftPickList,
  isSleeperLeague,
  normalizeSleeperDraftMetadata,
  normalizeSleeperLeagueSettings,
  resolveSleeperDraftLeagueId,
  type SleeperLeague,
  normalizeSleeperPick,
  type SleeperDraftMetadata,
  type SleeperDraftPick,
} from '@fantasy-draft/shared';
import type {
  DraftAdapterSnapshot,
  DraftSyncAdapter,
  FetchJson,
} from './sync-adapter.js';

export const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

export class SleeperSyncAdapter implements DraftSyncAdapter {
  public readonly provider = 'sleeper' as const;

  public constructor(
    public readonly draftId: string,
    private readonly fetchJson: FetchJson
  ) {}

  public async poll(signal: AbortSignal): Promise<DraftAdapterSnapshot> {
    const [draftResponse, picksResponse] = await Promise.all([
      this.fetchJson<SleeperDraftMetadata>(
        `${SLEEPER_API_BASE}/draft/${this.draftId}`,
        signal
      ),
      this.fetchJson<SleeperDraftPick[]>(
        `${SLEEPER_API_BASE}/draft/${this.draftId}/picks`,
        signal
      ),
    ]);

    if (
      !isSleeperDraftMetadata(draftResponse) ||
      !isSleeperDraftPickList(picksResponse)
    ) {
      throw new Error('Sleeper returned an invalid draft payload');
    }

    const leagueId = resolveSleeperDraftLeagueId(draftResponse);
    const leagueSettings = leagueId
      ? await this.fetchLeagueSettings(leagueId, signal)
      : undefined;

    return {
      draft: normalizeSleeperDraftMetadata(draftResponse, leagueSettings),
      picks: picksResponse.map(normalizeSleeperPick),
    };
  }

  private async fetchLeagueSettings(
    leagueId: string,
    signal: AbortSignal
  ) {
    const leagueResponse = await this.fetchJson<SleeperLeague>(
      `${SLEEPER_API_BASE}/league/${leagueId}`,
      signal
    );
    if (!isSleeperLeague(leagueResponse)) {
      throw new Error('Sleeper returned invalid league settings');
    }
    return normalizeSleeperLeagueSettings(leagueResponse);
  }
}
