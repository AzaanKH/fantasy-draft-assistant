import type * as React from 'react';
import type { Position } from '@fantasy-draft/shared/league';

/**
 * Position text in its design-system position color, the same on every surface. `label` replaces the abbreviation
 * with a longer form that starts with it, such as the position rank "WR3".
 */
export function PositionLabel({ position, label = position }: { readonly position: Position; readonly label?: string }): React.ReactElement {
  return <span className="position-text" data-position={position}>{label}</span>;
}
