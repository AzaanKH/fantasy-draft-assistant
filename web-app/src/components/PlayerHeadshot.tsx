import * as React from 'react';
import { cn } from '@/lib/utils';

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function getPlayerImageUrl(playerId: string, position?: string): string | null {
  if (position === 'DEF' || !/^\d+$/.test(playerId)) return null;
  // Keep the provider URL isolated so a licensed image service can replace it centrally.
  return `https://sleepercdn.com/content/nfl/players/${encodeURIComponent(playerId)}.jpg`;
}

export function PlayerHeadshot({
  playerId,
  name,
  position,
  className,
  imageClassName,
}: {
  readonly playerId: string;
  readonly name: string;
  readonly position?: string;
  readonly className?: string;
  readonly imageClassName?: string;
}): React.ReactElement {
  const imageUrl = typeof document !== 'undefined' &&
    document.documentElement.hasAttribute('data-visual-test')
    ? null
    : getPlayerImageUrl(playerId, position);
  const [imageFailed, setImageFailed] = React.useState(false);

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-muted to-muted/45 text-xs font-bold text-muted-foreground',
        className
      )}
      aria-hidden="true"
    >
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn('size-full object-cover object-top', imageClassName)}
          onError={() => {
            setImageFailed(true);
          }}
        />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </span>
  );
}
