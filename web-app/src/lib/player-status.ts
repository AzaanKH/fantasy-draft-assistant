import type { NewsStatus, Player } from '@fantasy-draft/shared/league';

export interface InjuryTag {
  readonly abbreviation: string;
  readonly label: string;
  readonly tone: 'warn' | 'bad';
}

/**
 * Compact availability tag from the player's news status. Only designations the
 * data actually carries are shown; healthy and unknown players get no tag.
 */
export function getInjuryTag(status: NewsStatus): InjuryTag | null {
  switch (status) {
    case 'questionable': return { abbreviation: 'Q', label: 'Questionable', tone: 'warn' };
    case 'limited': return { abbreviation: 'LIM', label: 'Limited', tone: 'warn' };
    case 'out': return { abbreviation: 'O', label: 'Out', tone: 'bad' };
    case 'healthy':
    case 'unknown':
      return null;
  }
}

/** "WR2"-style position rank. */
export function formatPositionRank(player: Pick<Player, 'position' | 'positionalRank'>): string {
  return `${player.position}${String(player.positionalRank)}`;
}

/** Observed draft ADP, falling back to the market ADP the catalog derives from it. */
export function getPlayerAdp(player: Pick<Player, 'consensusAdp' | 'marketAdp'>): number | null {
  const adp = player.consensusAdp ?? player.marketAdp;
  return Number.isFinite(adp) && adp > 0 ? adp : null;
}

export function formatAdp(adp: number | null): string {
  return adp === null ? '—' : adp >= 100 ? String(Math.round(adp)) : adp.toFixed(1);
}
