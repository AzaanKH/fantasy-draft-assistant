import type * as React from 'react';
import type { Position } from '@fantasy-draft/shared';

/** Position abbreviation in its design-system position color. */
export function PositionLabel({ position }: { readonly position: Position }): React.ReactElement {
  return <span className="position-text" data-position={position}>{position}</span>;
}
