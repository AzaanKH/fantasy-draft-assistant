import type * as React from 'react';
import type { Position } from '@fantasy-draft/shared';

/** Filled position tag in its design-system position color; the label is always visible. */
export function PositionTag({ position }: { readonly position: Position | 'FLEX' }): React.ReactElement {
  return <span className="position-tag" data-position={position}>{position}</span>;
}
