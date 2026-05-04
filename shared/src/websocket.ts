import type { DraftState } from './draft';

/**
 * WebSocket event types for real-time draft synchronization
 */
export type WebSocketEvent =
  | PlayerDraftedEvent
  | UndoDraftEvent
  | StateSyncEvent
  | PickAdvancedEvent
  | ConnectionStatusEvent;

/**
 * Event emitted when a player is drafted
 */
export interface PlayerDraftedEvent {
  readonly type: 'PLAYER_DRAFTED';
  readonly playerId: string;
  readonly teamIndex: number;
}

/**
 * Event to undo a draft pick
 */
export interface UndoDraftEvent {
  readonly type: 'UNDO_DRAFT';
  readonly playerId: string;
}

/**
 * Event to synchronize full draft state
 */
export interface StateSyncEvent {
  readonly type: 'STATE_SYNC';
  readonly state: DraftState;
}

/**
 * Event when the current pick advances
 */
export interface PickAdvancedEvent {
  readonly type: 'PICK_ADVANCED';
  readonly pickNumber: number;
}

/**
 * Event for connection status changes
 */
export interface ConnectionStatusEvent {
  readonly type: 'CONNECTION_STATUS';
  readonly connected: boolean;
}

/**
 * All possible event type strings
 */
export const WEBSOCKET_EVENT_TYPES = [
  'PLAYER_DRAFTED',
  'UNDO_DRAFT',
  'STATE_SYNC',
  'PICK_ADVANCED',
  'CONNECTION_STATUS',
] as const;

export type WebSocketEventType = (typeof WEBSOCKET_EVENT_TYPES)[number];

/**
 * Type guard to check if value is a valid WebSocketEventType
 */
export function isWebSocketEventType(value: unknown): value is WebSocketEventType {
  return typeof value === 'string' && WEBSOCKET_EVENT_TYPES.includes(value as WebSocketEventType);
}

/**
 * Type guard to validate WebSocketEvent structure
 */
export function isWebSocketEvent(obj: unknown): obj is WebSocketEvent {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  if (!isWebSocketEventType(candidate['type'])) {
    return false;
  }

  switch (candidate['type']) {
    case 'PLAYER_DRAFTED':
      return (
        typeof candidate['playerId'] === 'string' &&
        typeof candidate['teamIndex'] === 'number'
      );
    case 'UNDO_DRAFT':
      return typeof candidate['playerId'] === 'string';
    case 'STATE_SYNC':
      return typeof candidate['state'] === 'object' && candidate['state'] !== null;
    case 'PICK_ADVANCED':
      return typeof candidate['pickNumber'] === 'number';
    case 'CONNECTION_STATUS':
      return typeof candidate['connected'] === 'boolean';
    default:
      return false;
  }
}
