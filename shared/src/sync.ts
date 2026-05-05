import type { Position } from './player';

export interface SleeperDraftPick {
  readonly round: number;
  readonly roster_id: number;
  readonly player_id: string;
  readonly picked_by: string;
  readonly pick_no: number;
  readonly metadata: {
    readonly first_name: string;
    readonly last_name: string;
    readonly position: string;
    readonly team: string;
    readonly status: string;
  } | null;
  readonly is_keeper: boolean | null;
  readonly draft_slot: number;
  readonly draft_id: string;
}

export interface SleeperDraftMetadata {
  readonly draft_id: string;
  readonly status: 'pre_draft' | 'drafting' | 'complete';
  readonly type: 'snake' | 'linear' | 'auction';
  readonly settings: {
    readonly teams: number;
    readonly rounds: number;
    readonly pick_timer: number;
  };
  readonly draft_order: Record<string, number> | null;
}

export type DraftSyncSource = 'sleeper-api' | 'extension-dom' | 'manual';

export type DraftPickConfidence = 'confirmed' | 'probable';

export interface DraftPickEvent {
  readonly draftId: string;
  readonly pickNumber: number;
  readonly round: number;
  readonly rosterId: number;
  readonly draftSlot: number;
  readonly teamIndex: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly nflTeam: string | null;
  readonly isKeeper: boolean;
  readonly source: DraftSyncSource;
  readonly confidence: DraftPickConfidence;
  readonly observedAt: number;
}

export type DraftSyncState = 'idle' | 'syncing' | 'synced' | 'error';

export interface DraftSyncSnapshot {
  readonly draftId: string;
  readonly draft: SleeperDraftMetadata | null;
  readonly picks: readonly DraftPickEvent[];
  readonly status: DraftSyncState;
  readonly lastPolledAt: number | null;
  readonly lastSuccessfulSyncAt: number | null;
  readonly lastError: string | null;
}

export interface DraftSyncUpdate {
  readonly type: 'snapshot' | 'pick' | 'status';
  readonly snapshot: DraftSyncSnapshot;
  readonly pick?: DraftPickEvent;
}

function normalizePosition(value: string | undefined): Position {
  switch (value?.toUpperCase()) {
    case 'QB':
      return 'QB';
    case 'RB':
      return 'RB';
    case 'WR':
      return 'WR';
    case 'TE':
      return 'TE';
    case 'K':
      return 'K';
    case 'DEF':
    case 'DST':
    case 'D/ST':
      return 'DEF';
    default:
      return 'RB';
  }
}

function getPlayerName(pick: SleeperDraftPick): string {
  if (pick.metadata) {
    return `${pick.metadata.first_name} ${pick.metadata.last_name}`.trim();
  }

  return pick.player_id;
}

export function normalizeSleeperPick(pick: SleeperDraftPick): DraftPickEvent {
  return {
    draftId: pick.draft_id,
    pickNumber: pick.pick_no,
    round: pick.round,
    rosterId: pick.roster_id,
    draftSlot: pick.draft_slot,
    teamIndex: pick.draft_slot - 1,
    playerId: pick.player_id,
    playerName: getPlayerName(pick),
    position: normalizePosition(pick.metadata?.position),
    nflTeam: pick.metadata?.team ?? null,
    isKeeper: Boolean(pick.is_keeper),
    source: 'sleeper-api',
    confidence: 'confirmed',
    observedAt: Date.now(),
  };
}

export class DraftSyncEngine {
  private readonly draftId: string;
  private snapshot: DraftSyncSnapshot;
  private readonly picksByNumber = new Map<number, DraftPickEvent>();

  public constructor(draftId: string) {
    this.draftId = draftId;
    this.snapshot = {
      draftId,
      draft: null,
      picks: [],
      status: 'idle',
      lastPolledAt: null,
      lastSuccessfulSyncAt: null,
      lastError: null,
    };
  }

  public getSnapshot(): DraftSyncSnapshot {
    return this.snapshot;
  }

  public beginSync(now: number = Date.now()): DraftSyncSnapshot {
    this.snapshot = {
      ...this.snapshot,
      status: 'syncing',
      lastPolledAt: now,
      lastError: null,
    };
    return this.snapshot;
  }

  public failSync(message: string, now: number = Date.now()): DraftSyncSnapshot {
    this.snapshot = {
      ...this.snapshot,
      status: 'error',
      lastPolledAt: now,
      lastError: message,
    };
    return this.snapshot;
  }

  public reconcile(
    draft: SleeperDraftMetadata,
    rawPicks: readonly SleeperDraftPick[],
    now: number = Date.now()
  ): {
    readonly snapshot: DraftSyncSnapshot;
    readonly newPicks: readonly DraftPickEvent[];
  } {
    const normalizedPicks = rawPicks
      .map((pick) => normalizeSleeperPick(pick))
      .sort((a, b) => a.pickNumber - b.pickNumber);

    const newPicks: DraftPickEvent[] = [];

    for (const pick of normalizedPicks) {
      if (this.picksByNumber.has(pick.pickNumber)) {
        continue;
      }

      this.picksByNumber.set(pick.pickNumber, pick);
      newPicks.push(pick);
    }

    const picks = [...this.picksByNumber.values()].sort(
      (a, b) => a.pickNumber - b.pickNumber
    );

    this.snapshot = {
      draftId: this.draftId,
      draft,
      picks,
      status: 'synced',
      lastPolledAt: now,
      lastSuccessfulSyncAt: now,
      lastError: null,
    };

    return {
      snapshot: this.snapshot,
      newPicks,
    };
  }
}
